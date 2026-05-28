import { v4 as uuidv4 } from "uuid";
import {
  getDataset,
  updateDataset,
  getTransactionByHash,
  updateTransactionByHash,
  addTransaction,
  getTransactionByMemo,
  updateTransactionByMemo,
  getTransactionsWithFailedSellerNotification,
} from "../common/storage";
import { Sentry } from "../common/sentry";
import { sellerShare, platformFee as computePlatformFee } from "../common/constants";
import { generateDataSummary } from "../ai/claude.service";
import { notifySeller } from "../webhooks/webhook.service";
import { transactionEventEmitter } from "../websocket/transaction-events";
import { verifyStellarPayment } from "./stellar.service";

export interface DeliveryResult {
  success: boolean;
  pendingDelivery?: boolean;
  warning?: string | null;
  data?: Record<string, unknown>;
  ai?: {
    summary: string;
    answer?: string;
  };
  transaction: {
    hash: string;
    status: "completed" | "delivery_failed" | "verified" | "pending";
    deliveryStatus: "delivered" | "failed" | "pending";
    amount: number;
    sellerReceived: number;
    platformFee: number;
    deliveryError?: string;
  };
}

export async function deliverVerifiedPayment(params: {
  transactionId: string;
  txHash: string;
  datasetId: string;
  buyerQuestion?: string;
}): Promise<DeliveryResult> {
  const { transactionId, txHash, datasetId, buyerQuestion } = params;
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new Error("Dataset not found");
  }

  const summaryResult = await generateDataSummary(dataset.data, buyerQuestion);
  const sellerAmount = sellerShare(dataset.pricePerQuery);
  const platformFee = computePlatformFee(dataset.pricePerQuery);

  await updateDataset(dataset.id, {
    queriesServed: dataset.queriesServed + 1,
    totalEarned: parseFloat((dataset.totalEarned + sellerAmount).toFixed(4)),
  });

  await updateTransactionByHash(txHash, {
    status: "completed",
    deliveryStatus: "delivered",
    deliveryError: undefined,
    deliveredAt: new Date().toISOString(),
    aiSummary: summaryResult.summary,
    sellerPaid: true,
    sellerAmount,
  });

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, "completed", {
    amount: dataset.pricePerQuery.toString(),
    aiSummary: summaryResult.summary,
    deliveryStatus: "delivered",
  });

  // Notify seller via webhook. Failures are recorded on the transaction for
  // the retry worker to pick up — never silently dropped.
  notifySeller(dataset.sellerWallet, "payment.received", {
    datasetId: dataset.id,
    datasetName: dataset.name,
    txHash,
    amount: dataset.pricePerQuery,
    buyerQuery: buyerQuestion,
  }).then(() => {
    void updateTransactionByHash(txHash, {
      sellerNotifiedAt: new Date().toISOString(),
      sellerNotificationError: undefined,
    });
  }).catch((notifyErr: unknown) => {
    const errMsg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
    const attempts = 1; // first attempt; incremented on each retry
    void updateTransactionByHash(txHash, {
      sellerNotificationError: errMsg,
      sellerNotificationAttempts: attempts,
    });
    console.error(
      `[Escrow] Seller notification failed for txHash=${txHash} dataset=${dataset.id}: ${errMsg}`,
    );
    Sentry.captureException(notifyErr, {
      tags: { component: 'seller-notification' },
      extra: { txHash, datasetId: dataset.id, sellerWallet: dataset.sellerWallet },
    });
  });

  return {
    success: true,
    data: dataset.data,
    ai: {
      summary: summaryResult.summary,
      answer: summaryResult.answer,
    },
    transaction: {
      hash: txHash,
      status: "completed",
      deliveryStatus: "delivered",
      amount: dataset.pricePerQuery,
      sellerReceived: sellerAmount,
      platformFee,
    },
  };
}

export async function markDeliveryFailure(params: {
  transactionId: string;
  txHash: string;
  datasetId: string;
  buyerQuestion?: string;
  error: unknown;
}): Promise<DeliveryResult> {
  const { transactionId, txHash, datasetId, buyerQuestion, error } = params;
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new Error("Dataset not found");
  }

  const message = error instanceof Error ? error.message : String(error);
  const existing = await getTransactionByHash(txHash);
  await updateTransactionByHash(txHash, {
    status: "verified",
    deliveryStatus: "failed",
    deliveryError: message,
    deliveryAttempts: (existing?.deliveryAttempts ?? 0) + 1,
    buyerQuery: buyerQuestion,
  });

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, "delivery_failed", {
    amount: dataset.pricePerQuery.toString(),
    buyerQuery: buyerQuestion,
    deliveryStatus: "failed",
    error: message,
  });

  return {
    success: true,
    pendingDelivery: true,
    warning: "DELIVERY_PENDING_RETRY" as const,
    transaction: {
      hash: txHash,
      status: "verified",
      deliveryStatus: "failed",
      amount: dataset.pricePerQuery,
      sellerReceived: sellerShare(dataset.pricePerQuery),
      platformFee: computePlatformFee(dataset.pricePerQuery),
      deliveryError: message,
    },
  };
}

export async function processPayment(params: {
  txHash: string;
  datasetId: string;
  buyerQuestion?: string;
  memo?: string;
}): Promise<DeliveryResult> {
  const { txHash, datasetId, buyerQuestion, memo } = params;
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new Error("Dataset not found");
  }

  // Idempotency check
  let existing = await getTransactionByHash(txHash);
  if (!existing && memo) {
    existing = await getTransactionByMemo(memo);
  }

  if (existing && existing.status === "completed") {
    return {
      success: true,
      transaction: {
        hash: existing.txHash,
        status: "completed",
        deliveryStatus: "delivered",
        amount: existing.amount,
        sellerReceived: existing.sellerAmount ?? 0,
        platformFee: computePlatformFee(existing.amount),
      },
      ai: {
        summary: existing.aiSummary ?? "",
      },
    };
  }

  const transactionId = existing?.id || `tx-${uuidv4()}`;
  const destinationAddress = process.env.ESCROW_WALLET || dataset.sellerWallet;

  transactionEventEmitter.updateTransactionStatus(
    transactionId,
    dataset.id,
    "verifying",
    {
      amount: dataset.pricePerQuery.toString(),
      buyerQuery: buyerQuestion,
    }
  );

  const verification = await verifyStellarPayment({
    txHash,
    expectedAmount: dataset.pricePerQuery,
    destinationAddress,
  });

  if (!verification.valid) {
    transactionEventEmitter.updateTransactionStatus(
      transactionId,
      dataset.id,
      "failed",
      {
        error: verification.reason || "Stellar payment verification failed",
      }
    );
    throw new Error(verification.reason || "Stellar payment verification failed");
  }

  // Update or add transaction
  if (existing) {
    await updateTransactionByMemo(existing.memo || "", {
      txHash,
      status: "verified",
      verifiedAt: new Date().toISOString(),
    });
  } else {
    await addTransaction({
      id: transactionId,
      datasetId: dataset.id,
      txHash,
      memo,
      amount: dataset.pricePerQuery,
      status: "verified",
      deliveryStatus: "pending",
      sellerPaid: false,
      buyerQuery: buyerQuestion,
      timestamp: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      deliveryAttempts: 0,
    });
  }

  transactionEventEmitter.receivePayment(
    transactionId,
    dataset.id,
    dataset.pricePerQuery.toString()
  );

  transactionEventEmitter.updateTransactionStatus(
    transactionId,
    dataset.id,
    "delivery_pending",
    {
      amount: dataset.pricePerQuery.toString(),
      buyerQuery: buyerQuestion,
      deliveryStatus: "pending",
    }
  );

  try {
    const response = await deliverVerifiedPayment({
      transactionId,
      txHash,
      datasetId: dataset.id,
      buyerQuestion,
    });

    transactionEventEmitter.queryDataset(
      transactionId,
      dataset.id,
      dataset.queriesServed + 1
    );

    return response;
  } catch (deliveryErr) {
    console.error("[Escrow] Delivery failed — queued for retry:", deliveryErr);
    return await markDeliveryFailure({
      transactionId,
      txHash,
      datasetId: dataset.id,
      buyerQuestion,
      error: deliveryErr,
    });
  }
}

const MAX_SELLER_NOTIFICATION_ATTEMPTS = 10;

export async function retryFailedSellerNotifications(): Promise<void> {
  const pending = await getTransactionsWithFailedSellerNotification();

  await Promise.all(
    pending.map(async (tx) => {
      const attempts = (tx.sellerNotificationAttempts ?? 1) + 1;
      if (attempts > MAX_SELLER_NOTIFICATION_ATTEMPTS) {
        // Exhausted retries — surface a durable alert so an operator can investigate
        console.error(
          `[Escrow] Seller notification permanently failed after ${MAX_SELLER_NOTIFICATION_ATTEMPTS} attempts ` +
          `txHash=${tx.txHash} dataset=${tx.datasetId} seller=${tx.datasetId}`,
        );
        Sentry.captureMessage(
          `Seller notification permanently failed: txHash=${tx.txHash}`,
          { level: 'error', tags: { component: 'seller-notification-dlq' }, extra: { tx } },
        );
        // Mark with a sentinel so it leaves the retry queue while staying visible
        await updateTransactionByHash(tx.txHash, {
          sellerNotificationError: `PERMANENT_FAILURE after ${MAX_SELLER_NOTIFICATION_ATTEMPTS} attempts: ${tx.sellerNotificationError}`,
          sellerNotificationAttempts: attempts,
        });
        return;
      }

      const dataset = await getDataset(tx.datasetId);
      if (!dataset) return;

      try {
        await notifySeller(dataset.sellerWallet, "payment.received", {
          datasetId: dataset.id,
          datasetName: dataset.name,
          txHash: tx.txHash,
          amount: tx.amount,
          buyerQuery: tx.buyerQuery,
        });
        await updateTransactionByHash(tx.txHash, {
          sellerNotifiedAt: new Date().toISOString(),
          sellerNotificationError: undefined,
          sellerNotificationAttempts: attempts,
        });
        console.log(`[Escrow] Seller notification succeeded on retry attempt ${attempts} txHash=${tx.txHash}`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await updateTransactionByHash(tx.txHash, {
          sellerNotificationError: errMsg,
          sellerNotificationAttempts: attempts,
        });
        console.error(
          `[Escrow] Seller notification retry ${attempts}/${MAX_SELLER_NOTIFICATION_ATTEMPTS} failed ` +
          `txHash=${tx.txHash}: ${errMsg}`,
        );
      }
    }),
  );
}

let sellerNotificationRetryWorker: NodeJS.Timeout | null = null;

export function startSellerNotificationRetryWorker(intervalMs = 5 * 60_000): void {
  if (sellerNotificationRetryWorker) return;

  void retryFailedSellerNotifications().catch((err) => {
    console.error("[Escrow] Initial seller notification retry run failed:", err);
  });

  sellerNotificationRetryWorker = setInterval(() => {
    void retryFailedSellerNotifications().catch((err) => {
      console.error("[Escrow] Seller notification retry worker failed:", err);
    });
  }, intervalMs);
}

export function stopSellerNotificationRetryWorker(): void {
  if (!sellerNotificationRetryWorker) return;
  clearInterval(sellerNotificationRetryWorker);
  sellerNotificationRetryWorker = null;
}
