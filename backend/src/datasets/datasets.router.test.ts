import crypto from 'crypto';
import express, { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../webhooks/webhook.service', () => ({
  notifySeller: vi.fn(() => Promise.resolve()),
}));

vi.mock('./datasets.repository', () => ({
  getAllDatasets: vi.fn(),
  getDataset: vi.fn(),
  addDataset: vi.fn(),
  getTransactions: vi.fn(),
  getTransactionsCount: vi.fn(),
}));

import { datasetsRouter } from './datasets.router';
import {
  getAllDatasets,
  getDataset,
  getTransactions,
  getTransactionsCount,
} from './datasets.repository';
import type { Dataset, Transaction } from '../common/storage';

const SELLER_A = `G${'A'.repeat(55)}`;
const SELLER_B = `G${'B'.repeat(55)}`;

const datasetA: Dataset = {
  id: 'ds-seller-a',
  name: 'Seller A Dataset',
  description: 'Seller A private dashboard data',
  type: 'yield-data',
  pricePerQuery: 1,
  sellerWallet: SELLER_A,
  data: { hidden: true },
  queriesServed: 2,
  totalEarned: 1.9,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const datasetB: Dataset = {
  id: 'ds-seller-b',
  name: 'Seller B Dataset',
  description: 'Seller B private dashboard data',
  type: 'sentiment',
  pricePerQuery: 2,
  sellerWallet: SELLER_B,
  data: { hidden: true },
  queriesServed: 1,
  totalEarned: 1.9,
  createdAt: '2026-01-02T00:00:00.000Z',
};

const transactions: Transaction[] = [
  {
    id: 'tx-a',
    datasetId: datasetA.id,
    txHash: 'hash-a',
    amount: 1,
    sellerPaid: true,
    timestamp: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'tx-b',
    datasetId: datasetB.id,
    txHash: 'hash-b',
    amount: 2,
    sellerPaid: true,
    timestamp: '2026-01-04T00:00:00.000Z',
  },
];

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/datasets', datasetsRouter);
  return app;
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signSellerJwt(
  payload: Record<string, unknown>,
  secret = process.env.SELLER_JWT_SECRET ?? 'test-secret',
) {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64UrlJson(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('datasets seller dashboard auth', () => {
  let app: Express;
  const originalSellerJwtSecret = process.env.SELLER_JWT_SECRET;

  beforeEach(async () => {
    app = makeApp();
    process.env.SELLER_JWT_SECRET = 'test-secret';

    vi.mocked(getAllDatasets).mockResolvedValue([datasetA, datasetB]);
    vi.mocked(getDataset).mockImplementation(async (id: string) =>
      [datasetA, datasetB].find(d => d.id === id),
    );
    vi.mocked(getTransactions).mockImplementation(async (datasetId?: string) =>
      datasetId ? transactions.filter(t => t.datasetId === datasetId) : transactions,
    );
    vi.mocked(getTransactionsCount).mockImplementation(async (datasetId?: string) =>
      datasetId ? transactions.filter(t => t.datasetId === datasetId).length : transactions.length,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalSellerJwtSecret === undefined) {
      delete process.env.SELLER_JWT_SECRET;
    } else {
      process.env.SELLER_JWT_SECRET = originalSellerJwtSecret;
    }
  });

  it('rejects seller dashboard requests when the JWT secret is missing', async () => {
    delete process.env.SELLER_JWT_SECRET;

    const res = await request(app).get('/api/v1/datasets/seller/dashboard');

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('SELLER_JWT_SECRET');
  });

  it('requires a bearer token for seller dashboard data', async () => {
    const res = await request(app).get('/api/v1/datasets/seller/dashboard');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization header');
  });

  it('rejects expired seller JWTs', async () => {
    const expiredToken = signSellerJwt({
      sellerWallet: SELLER_A,
      exp: Math.floor(Date.now() / 1000) - 1,
    });

    const res = await request(app)
      .get('/api/v1/datasets/seller/dashboard')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired');
  });

  it('returns only datasets and transactions owned by the JWT seller wallet', async () => {
    const token = signSellerJwt({
      sellerWallet: SELLER_A,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const res = await request(app)
      .get('/api/v1/datasets/seller/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sellerWallet).toBe(SELLER_A);
    expect(res.body.datasets).toHaveLength(1);
    expect(res.body.datasets[0]).toMatchObject({ id: datasetA.id, sellerWallet: SELLER_A });
    expect(res.body.datasets[0].data).toBeUndefined();
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({ id: 'tx-a', datasetId: datasetA.id });
    expect(res.body.stats).toEqual({
      totalDatasets: 1,
      totalQueries: 2,
      totalUsdcEarned: 1.9,
      totalTransactions: 1,
    });
  });

  it('scopes the legacy transactions endpoint to the JWT seller wallet', async () => {
    const token = signSellerJwt({
      sellerWallet: SELLER_B,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const res = await request(app)
      .get('/api/v1/datasets/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([
      expect.objectContaining({ id: 'tx-b', datasetId: datasetB.id }),
    ]);
  });

  it('blocks dataset transaction history for another seller', async () => {
    const token = signSellerJwt({
      sellerWallet: SELLER_A,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetB.id}/transactions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

