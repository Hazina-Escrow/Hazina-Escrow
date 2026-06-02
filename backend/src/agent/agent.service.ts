import { v4 as uuidv4 } from 'uuid';
import {
  getAllDatasets,
  getDataset,
  updateDataset,
  addTransaction,
  txHashUsed,
  getAgentJobByTxHash,
} from '../common/storage';
import { verifyStellarPayment } from '../payments/stellar.service';
import { sendUsdcPayment, getAgentPublicKey } from './agent.wallet';
import { logger } from '../lib/logger';
import { domainMetrics } from '../common/datadog';
import {
  synthesizeResearch,
  parseRiskTolerance,
  parseBudget,
  ResearchReport,
} from '../ai/research.service';
import { notifySeller } from '../webhooks/webhook.service';

// Fee the agent charges the human (1 USDC flat by default).
// Override via AGENT_FEE_USDC environment variable (e.g. "2.5").
const RAW_FEE = process.env.AGENT_FEE_USDC ?? '1';
const PARSED_FEE = parseFloat(RAW_FEE);
export const AGENT_FEE_USDC = Number.isFinite(PARSED_FEE) && PARSED_FEE >= 0 ? PARSED_FEE : 1;

// Dataset types the agent purchases and their roles in the report
export const SELLER_TYPES = [
  { type: 'yield-data', role: 'yieldData', description: 'APY & protocol data' },
  { type: 'whale-wallets', role: 'whaleData', description: 'Whale wallet movements' },
  { type: 'risk-scores', role: 'riskData', description: 'Protocol risk scores' },
  { type: 'sentiment', role: 'sentimentData', description: 'Social market sentiment' },
] as const;

export interface AgentJob {
  jobId: string;
  query: string;
  budget: number;
  riskTolerance: string;
  humanTxHash: string;
  agentWallet: string | null;
  purchases: PurchaseRecord[];
  totalSpent: number;
  agentProfit: number;
  report: ResearchReport;
  timestamp: string;
  datasetsAvailable: number;
  datasetsTotal: number;
}

/**
 * Returned by runResearchAgent when the supplied txHash has already been
 * successfully processed.  The caller should surface this as HTTP 200 with
 * an `idempotent: true` flag so clients can distinguish a replay hit from a
 * genuine error.
 */
export interface IdempotentJobResult {
  idempotent: true;
  txHash: string;
  /** Original query text stored when the job was first processed. */
  query: string | undefined;
  /** AI analysis text from the original job, if available. */
  cachedSummary: string | undefined;
  /** ISO timestamp of the original job. */
  originalTimestamp: string | undefined;
}

export interface PurchaseRecord {
  datasetId: string;
  datasetName: string;
  type: string;
  role: string;
  amountPaid: number;
  txHash: string;
  demo: boolean;
}

/**
 * Verifies the human's 1 USDC payment then runs the full research pipeline.
 * Real mode: sends actual Stellar payments from agent's funded wallet.
 */
export async function runResearchAgent(
  query: string,
  humanTxHash: string,
): Promise<AgentJob | IdempotentJobResult> {
  // 1. Idempotency guard — if this txHash was already processed, return the
  //    cached result so callers can surface it as HTTP 200 rather than an error.
  if (await txHashUsed(humanTxHash)) {
    const existing = await getAgentJobByTxHash(humanTxHash);

    if (!existing) {
      throw new Error('Transaction hash already used');
    }

    const result: IdempotentJobResult = {
      idempotent: true,
      txHash: humanTxHash,
      query: existing.buyerQuery,
      cachedSummary: existing.aiSummary,
      originalTimestamp: existing.timestamp,
    };
    return result;
  }

  const escrowWallet = process.env.ESCROW_WALLET;
  if (!escrowWallet) throw new Error('ESCROW_WALLET not configured');

  const verification = await verifyStellarPayment({
    txHash: humanTxHash,
    expectedAmount: AGENT_FEE_USDC,
    destinationAddress: escrowWallet,
  });

  if (!verification.valid) {
    domainMetrics.agentHumanPaymentVerified({
      mode: 'real',
      status: 'failed',
    });
    throw new Error(verification.reason || 'Human payment verification failed');
  }

  domainMetrics.agentHumanPaymentVerified({
    mode: 'real',
    status: 'verified',
  });

  return _executeResearch(query, humanTxHash, false);
}

/**
 * Demo mode — skips real Stellar payments. Uses stored dataset data directly.
 * Simulates the x402 flow and shows what payments would have been made.
 */
export async function runResearchAgentDemo(query: string): Promise<AgentJob> {
  const demoTxHash = `demo-agent-${Date.now()}`;
  return _executeResearch(query, demoTxHash, true);
}

async function _executeResearch(
  query: string,
  humanTxHash: string,
  demo: boolean,
): Promise<AgentJob> {
  const jobId = `job-${uuidv4()}`;
  const budget = parseBudget(query);
  const riskTolerance = parseRiskTolerance(query);
  const agentWallet = getAgentPublicKey();

  const allDatasets = await getAllDatasets();

  // 2. Find which seller types have matching datasets
  const availableSellers = SELLER_TYPES.map(seller => {
    const dataset = allDatasets.find(d => d.type === seller.type);
    return { seller, dataset };
  });

  const datasetsAvailable = availableSellers.filter(s => s.dataset).length;

  if (datasetsAvailable === 0) {
    throw new Error(
      'No datasets available for research. The platform currently has no active data sellers.',
    );
  }

  const purchases: PurchaseRecord[] = [];
  const sellerData: import('../ai/research.service').SellerDataset[] = [];
  let totalSpent = 0;

  for (const { seller, dataset } of availableSellers) {
    if (!dataset) {
      logger.warn(`[Agent] No dataset found for type: ${seller.type}`);
      continue;
    }

    let txHash: string;

    if (demo) {
      // Demo: simulate payment, read data directly
      txHash = `demo-${seller.type}-${Date.now()}`;
      logger.info(
        `[Agent][Demo] Simulating payment of ${dataset.pricePerQuery} USDC → ${dataset.sellerWallet} for ${dataset.name}`,
      );
    } else {
      // Real: send USDC from agent wallet → seller wallet
      logger.info(
        `[Agent] Paying ${dataset.pricePerQuery} USDC → ${dataset.sellerWallet} for ${dataset.name}`,
      );
      const payment = await sendUsdcPayment({
        destinationAddress: dataset.sellerWallet,
        amount: dataset.pricePerQuery.toFixed(7),
        memo: `haz-agent-${jobId.slice(0, 8)}`,
      });
      txHash = payment.txHash;
    }

    // Record the purchase
    purchases.push({
      datasetId: dataset.id,
      datasetName: dataset.name,
      type: dataset.type,
      role: seller.role,
      amountPaid: dataset.pricePerQuery,
      txHash,
      demo,
    });

    totalSpent += dataset.pricePerQuery;

    // Track agent dataset purchase
    domainMetrics.agentDatasetPurchase({
      datasetType: dataset.type,
      mode: demo ? 'demo' : 'real',
      amountPaid: dataset.pricePerQuery,
    });

    // Update dataset stats
    await updateDataset(dataset.id, {
      queriesServed: dataset.queriesServed + 1,
      totalEarned: parseFloat((dataset.totalEarned + dataset.pricePerQuery * 0.95).toFixed(4)),
    });

    // Log individual transaction
    await addTransaction({
      id: `tx-agent-${uuidv4()}`,
      datasetId: dataset.id,
      txHash,
      amount: dataset.pricePerQuery,
      sellerPaid: true,
      sellerAmount: parseFloat((dataset.pricePerQuery * 0.95).toFixed(7)),
      buyerQuery: `[Agent Job ${jobId}] ${query}`,
      timestamp: new Date().toISOString(),
    });

    // Notify seller via webhook
    notifySeller(dataset.sellerWallet, 'dataset.queried', {
      datasetId: dataset.id,
      datasetName: dataset.name,
      type: dataset.type,
      txHash,
      amount: dataset.pricePerQuery,
      agentJobId: jobId,
      demo,
    }).catch(() => {});

    domainMetrics.datasetQueried({
      datasetType: dataset.type,
      mode: demo ? 'demo' : 'real',
      source: 'agent',
    });

    // Read the actual data
    const fresh = await getDataset(dataset.id);
    sellerData.push({
      role: seller.role,
      displayName: seller.description,
      data: fresh?.data ?? {},
      cost: dataset.pricePerQuery,
    });
  }

  const agentProfit = parseFloat((AGENT_FEE_USDC - totalSpent).toFixed(4));

  // 3. Synthesise with Claude using only the available datasets
  const report = await synthesizeResearch({
    userQuery: query,
    budget,
    riskTolerance,
    availableSellers: sellerData,
  });

  // 4. Log the agent job as a transaction for audit trail
  await addTransaction({
    id: `tx-agent-job-${jobId}`,
    datasetId: 'agent-job',
    txHash: humanTxHash,
    amount: AGENT_FEE_USDC,
    sellerPaid: true,
    buyerQuery: query,
    aiSummary: report.rawAnalysis,
    timestamp: new Date().toISOString(),
  });

  domainMetrics.agentJobCompleted({
    mode: demo ? 'demo' : 'real',
    status: 'completed',
    datasetsQueried: purchases.length,
    totalSpent,
  });

  return {
    jobId,
    query,
    budget,
    riskTolerance,
    humanTxHash,
    agentWallet,
    purchases,
    totalSpent: parseFloat(totalSpent.toFixed(4)),
    agentProfit,
    report,
    timestamp: new Date().toISOString(),
    datasetsAvailable,
    datasetsTotal: SELLER_TYPES.length,
  };
}
