import { v4 as uuidv4 } from "uuid";
import {
  getDataset,
  updateDataset,
  getTransactionByHash,
  updateTransactionByHash,
  addTransaction,
  getTransactionByMemo,
  updateTransactionByMemo,
} from "../common/storage";
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

  notifySeller(dataset.sellerWallet, "payment.received", {
    datasetId: dataset.id,
    datasetName: dataset.name,
    txHash,
    amount: dataset.pricePerQuery,
    buyerQuery: buyerQuestion,
  }).catch(() => {});

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
