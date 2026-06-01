import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../common/storage';

vi.mock('../common/storage', () => ({
  getAllDatasets: vi.fn(),
  getDataset: vi.fn(),
  updateDataset: vi.fn(() => Promise.resolve(null)),
  addTransaction: vi.fn(() => Promise.resolve()),
  txHashUsed: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../payments/stellar.service', () => ({
  verifyStellarPayment: vi.fn(() => Promise.resolve({ valid: true })),
}));

vi.mock('./agent.wallet', () => ({
  getAgentPublicKey: vi.fn(() => 'GAGENT'),
  sendUsdcPayment: vi.fn(() => Promise.resolve({ txHash: 'seller-payment-hash' })),
}));

vi.mock('../ai/research.service', () => ({
  parseBudget: vi.fn(() => 500),
  parseRiskTolerance: vi.fn(() => 'low'),
  synthesizeResearch: vi.fn(() =>
    Promise.resolve({
      topOpportunity: {
        protocol: 'Aave',
        vault: 'USDC Stable Pool',
        chain: 'Ethereum',
        apy: 7.2,
        riskLevel: 'Low',
        whaleConfidence: 'High',
        sentimentScore: 'Bullish',
      },
      reasoning: 'Reasoning text',
      alternatives: ['Alt 1'],
      warnings: [],
      rawAnalysis: 'Raw analysis text',
    }),
  ),
}));

vi.mock('../webhooks/webhook.service', () => ({
  notifySeller: vi.fn(() => Promise.resolve()),
}));

vi.mock('../common/datadog', () => ({
  domainMetrics: {
    paymentVerified: vi.fn(),
    datasetQueried: vi.fn(),
    agentJobCompleted: vi.fn(),
    agentDatasetPurchase: vi.fn(),
    agentHumanPaymentVerified: vi.fn(),
  },
}));

import { runResearchAgentDemo, SELLER_TYPES } from './agent.service';
import { getAllDatasets, getDataset } from '../common/storage';
import { domainMetrics } from '../common/datadog';

const SELLER_WALLET = `G${'A'.repeat(55)}`;

const datasets: Dataset[] = SELLER_TYPES.map((seller, index) => ({
  id: `ds-${seller.type}`,
  name: `${seller.description} Dataset`,
  description: seller.description,
  type: seller.type,
  pricePerQuery: 0.1 + index / 100,
  sellerWallet: SELLER_WALLET,
  data: { rows: [index] },
  queriesServed: index,
  totalEarned: index,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

describe('runResearchAgentDemo metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDatasets).mockResolvedValue(datasets);
    vi.mocked(getDataset).mockImplementation(async (id: string) =>
      datasets.find(dataset => dataset.id === id),
    );
  });

  it('emits domain metrics for agent dataset purchases and completed jobs', async () => {
    const job = await runResearchAgentDemo('best low risk strategy');

    expect(job.purchases).toHaveLength(SELLER_TYPES.length);
    expect(domainMetrics.datasetQueried).toHaveBeenCalledTimes(SELLER_TYPES.length);
    expect(domainMetrics.datasetQueried).toHaveBeenCalledWith({
      datasetType: 'yield-data',
      mode: 'demo',
      source: 'agent',
    });
    expect(domainMetrics.agentJobCompleted).toHaveBeenCalledWith({
      mode: 'demo',
      status: 'completed',
      datasetsQueried: SELLER_TYPES.length,
      totalSpent: expect.any(Number),
    });
  });
});
