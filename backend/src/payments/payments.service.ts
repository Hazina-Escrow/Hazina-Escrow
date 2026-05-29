import { v4 as uuidv4 } from 'uuid';
import {
  getDataset,
  updateDataset,
  getTransactionByHash,
  updateTransactionByHash,
  addTransaction,
  getTransactionByMemo,
  updateTransactionByMemo,
} from '../common/storage';
import { sellerShare, platformFee as computePlatformFee } from '../common/constants';
import { generateDataSummary } from '../ai/claude.service';
import { notifySeller } from '../webhooks/webhook.service';
import { transactionEventEmitter } from '../websocket/transaction-events';
// import { sellerShare, platformFee as computePlatformFee } from '../common/constants';
// import { generateDataSummary } from '../ai/claude.service';
// import { notifySeller } from '../webhooks/webhook.service';
// import { transactionEventEmitter } from '../websocket/transaction-events';
import { verifyStellarPayment } from './stellar.service';
} from "../common/storage";
import { sellerShare, platformFee as computePlatformFee } from "../common/constants";
import { generateDataSummary } from "../ai/claude.service";
import { notifySeller } from "../webhooks/webhook.service";
import { transactionEventEmitter } from "../websocket/transaction-events";
import { verifyStellarPayment, PaymentError } from "./stellar.service";

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
    status: 'completed' | 'delivery_failed' | 'verified' | 'pending';
    deliveryStatus: 'delivered' | 'failed' | 'pending';
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
    throw new Error('Dataset not found');
  }

  const summaryResult = await generateDataSummary(dataset.data, buyerQuestion);
  const sellerAmount = sellerShare(dataset.pricePerQuery);
  const platformFee = computePlatformFee(dataset.pricePerQuery);

  await updateDataset(dataset.id, {
    queriesServed: dataset.queriesServed + 1,
    totalEarned: parseFloat((dataset.totalEarned + sellerAmount).toFixed(4)),
  });

  await updateTransactionByHash(txHash, {
    status: 'completed',
    deliveryStatus: 'delivered',
    deliveryError: undefined,
    deliveredAt: new Date().toISOString(),
    aiSummary: summaryResult.summary,
    sellerPaid: true,
    sellerAmount,
  });

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, 'completed', {
    amount: dataset.pricePerQuery.toString(),
    aiSummary: summaryResult.summary,
    deliveryStatus: 'delivered',
  });

  notifySeller(dataset.sellerWallet, 'payment.received', {
    datasetId: dataset.id,
    datasetName: dataset.name,
    txHash,
    amount: dataset.pricePerQuery,
    buyerQuery: buyerQuestion,
  }).catch(() => {});

  domainMetrics.datasetQueried({
    datasetType: dataset.type,
    mode: txHash.startsWith('demo-') ? 'demo' : 'real',
    source: 'buyer',
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
      status: 'completed',
      deliveryStatus: 'delivered',
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
    throw new Error('Dataset not found');
  }

  const message = error instanceof Error ? error.message : String(error);
  const existing = await getTransactionByHash(txHash);
  const attempts = (existing?.deliveryAttempts ?? 0) + 1;

  await updateTransactionByHash(txHash, {
    status: 'delivery_failed',
    deliveryStatus: 'failed',
    deliveryError: message,
    deliveryAttempts: attempts,
    buyerQuery: buyerQuestion,
  });

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, 'delivery_failed', {
    amount: dataset.pricePerQuery.toString(),
    buyerQuery: buyerQuestion,
    deliveryStatus: 'failed',
    error: message,
  });

  // Track delivery failure and retry attempt
  domainMetrics.paymentDeliveryFailed({
    datasetType: dataset.type,
    mode: txHash.startsWith('demo-') ? 'demo' : 'real',
    reason: message.toLowerCase().includes('ai') ? 'ai_error' : 'delivery_error',
  });

  domainMetrics.deliveryRetryAttempt({
    datasetType: dataset.type,
    mode: txHash.startsWith('demo-') ? 'demo' : 'real',
    attempt: attempts,
  });

  return {
    success: true,
    pendingDelivery: true,
    warning: 'DELIVERY_PENDING_RETRY' as const,
    transaction: {
      hash: txHash,
      status: 'delivery_failed',
      deliveryStatus: 'failed',
//       status: "delivery_failed",
//       deliveryStatus: "failed",
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
    throw new Error('Dataset not found');
  }

  // Idempotency check
  let existing = await getTransactionByHash(txHash);
  if (!existing && memo) {
    existing = await getTransactionByMemo(memo);
  }

  if (existing && existing.status === 'completed') {
    return {
      success: true,
      transaction: {
        hash: existing.txHash,
        status: 'completed',
        deliveryStatus: 'delivered',
        amount: existing.amount,
        sellerReceived: existing.sellerAmount ?? 0,
        platformFee: computePlatformFee(existing.amount),
      },
      ai: {
        summary: existing.aiSummary ?? '',
      },
    };
  }

  const transactionId = existing?.id || `tx-${uuidv4()}`;
  const destinationAddress = process.env.ESCROW_WALLET || dataset.sellerWallet;

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, 'verifying', {
    amount: dataset.pricePerQuery.toString(),
    buyerQuery: buyerQuestion,
  });

  const verification = await verifyStellarPayment({
    txHash,
    expectedAmount: dataset.pricePerQuery,
    destinationAddress,
  });

  if (!verification.valid) {
    const mode = txHash.startsWith('demo-') ? 'demo' : 'real';
    domainMetrics.paymentVerificationError({
      mode,
      errorType: verification.reason?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
    });

    transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, 'failed', {
      error: verification.reason || 'Stellar payment verification failed',
    });
    throw new Error(verification.reason || 'Stellar payment verification failed');

  }

  // Bind the payment to this specific dataset via its memo.
  // Without this check a buyer could redirect a payment made for dataset A (using
  // its memo) to unlock dataset B if both share the same price — the memo on the
  // Stellar transaction is the only artefact that ties a payment to a purchase.
  const txMemo = verification.memo ?? '';
  if (!txMemo) {
    throw new Error(
      'Payment must include the memo provided at query initiation — memo-less payments cannot be bound to a specific dataset',
    );
  }
  const memoOwner = await getTransactionByMemo(txMemo);
  if (!memoOwner) {
    throw new Error(
      'Payment memo does not match any pending transaction — ensure you used the memo from your query initiation',
    );
  }
//   if (memoOwner.datasetId !== datasetId) {
//     throw new Error(
//       'Payment memo belongs to a different dataset — use the memo generated for this specific query',
//     );
//     throw new PaymentError(verification.reason || "Stellar payment verification failed");
//   }

  // Bind the payment to this specific dataset via its memo.
  // Without this check a buyer could redirect a payment made for dataset A (using
  // its memo) to unlock dataset B if both share the same price — the memo on the
  // Stellar transaction is the only artefact that ties a payment to a purchase.
  const txMemo = verification.memo ?? '';
  if (!txMemo) {
    throw new PaymentError(
      'Payment must include the memo provided at query initiation — memo-less payments cannot be bound to a specific dataset',
    );
  }
  const memoOwner = await getTransactionByMemo(txMemo);
  if (!memoOwner) {
    throw new PaymentError(
      'Payment memo does not match any pending transaction — ensure you used the memo from your query initiation',
    );
  }
  }

  // Update or add transaction
  if (existing) {
    await updateTransactionByMemo(existing.memo || '', {
      txHash,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    });
  } else {
    await addTransaction({
      id: transactionId,
      datasetId: dataset.id,
      txHash,
      memo,
      amount: dataset.pricePerQuery,
      status: 'verified',
      deliveryStatus: 'pending',
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
    dataset.pricePerQuery.toString(),
  );

  transactionEventEmitter.updateTransactionStatus(transactionId, dataset.id, 'delivery_pending', {
    amount: dataset.pricePerQuery.toString(),
    buyerQuery: buyerQuestion,
    deliveryStatus: 'pending',
  });

  try {
    const response = await deliverVerifiedPayment({
      transactionId,
      txHash,
      datasetId: dataset.id,
      buyerQuestion,
    });

    transactionEventEmitter.queryDataset(transactionId, dataset.id, dataset.queriesServed + 1);

    domainMetrics.paymentVerified({
      datasetType: dataset.type,
      mode: 'real',
      status: 'delivered',
    });

    return response;
  } catch (deliveryErr) {
    logger.error('[Escrow] Delivery failed — queued for retry:', deliveryErr);
    domainMetrics.paymentVerified({
      datasetType: dataset.type,
      mode: 'real',
      status: 'pending',
    });
    return await markDeliveryFailure({
      transactionId,
      txHash,
      datasetId: dataset.id,
      buyerQuestion,
      error: deliveryErr,
    });
  }
}
\nimport { logger } from '../lib/logger';