import { getEnv } from './env';

const REQUEST_THROTTLE_MS = 250;

function getMaxConcurrentRequests(): number {
  try {
    return getEnv().maxConcurrentRequests;
  } catch {
    return 8;
  }
}

let inFlight = 0;
const inFlightWaiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < getMaxConcurrentRequests()) {
    inFlight += 1;
    return;
  }
  await new Promise<void>(resolve => inFlightWaiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = inFlightWaiters.shift();
  if (next) next();
}

const requestQueues = new Map<string, Promise<void>>();
const requestStartedAt = new Map<string, number>();

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function getRequestKey(url: string, options?: RequestInit) {
  const method = (options?.method ?? 'GET').toUpperCase();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const { pathname } = new URL(url, origin);
  return `${method}:${pathname}`;
}

async function scheduleRequest<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = requestQueues.get(key) ?? Promise.resolve();

  const scheduled = previous.then(async () => {
    const lastStarted = requestStartedAt.get(key) ?? 0;
    const elapsed = Date.now() - lastStarted;

    if (elapsed < REQUEST_THROTTLE_MS) {
      await sleep(REQUEST_THROTTLE_MS - elapsed);
    }

    requestStartedAt.set(key, Date.now());
    return task();
  });

  const tracked = scheduled.then(
    () => undefined,
    () => undefined,
  );

  requestQueues.set(key, tracked);

  return scheduled.finally(() => {
    if (requestQueues.get(key) === tracked) {
      requestQueues.delete(key);
    }
  });
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000; // regular API calls should complete in 10-15 seconds
export const AGENT_REQUEST_TIMEOUT_MS = 120_000; // AI/agent operations may take longer than standard requests

function getApiBaseUrl(): string {
  const { apiUrl } = getEnv();
  return `${apiUrl}/api/v1`;
}

function getApiKey(): string {
  return getEnv().apiKey;
}

// ── Public interfaces ──────────────────────────────────────────────────────

export interface AgentSellerPayment {
  seller: string;
  type: string;
  amount: number;
  txHash: string;
  onChain: boolean;
}

export interface AgentReport {
  topOpportunity: {
    protocol: string;
    vault: string;
    chain: string;
    apy: number;
    riskLevel: string;
    whaleConfidence: string;
    sentimentScore: string;
  };
  reasoning: string;
  alternatives: string[];
  warnings: string[];
  rawAnalysis: string;
}

export interface AgentJob {
  success: boolean;
  demo?: boolean;
  jobId: string;
  query: string;
  report: AgentReport;
  payments: {
    humanPaid: number;
    currency: string;
    network: string;
    note?: string;
    sellerPayments: AgentSellerPayment[];
    totalSpent: number;
    agentProfit: number;
  };
  meta: {
    agentWallet: string;
    timestamp: string;
    datasetsQueried: number;
  };
}

export interface AgentInfo {
  success: boolean;
  agent: {
    name: string;
    version: string;
    description: string;
    agentWallet: string;
    fee: { amount: number; currency: string; network: string; description: string };
    sellers: { type: string; role: string; cost: number }[];
    agentProfit: number;
    escrowWallet: string;
  };
}

export interface DatasetMeta {
  id: string;
  name: string;
  description: string;
  type: string;
  pricePerQuery: number;
  sellerWallet: string;
  queriesServed: number;
  totalEarned: number;
  createdAt: string;
  thumbnail?: string;
}

export interface Transaction {
  id: string;
  datasetId: string;
  txHash: string;
  amount: number;
  buyerQuery?: string;
  aiSummary?: string;
  timestamp: string;
}

export interface Stats {
  totalDatasets: number;
  totalQueries: number;
  totalUsdcEarned: number;
  totalTransactions: number;
}

export interface PaginatedDatasets {
  data: DatasetMeta[];
  total: number;
  page: number;
  totalPages: number;
}

export interface QueryResult {
  success: boolean;
  demo?: boolean;
  pendingDelivery?: boolean;
  warning?: string | null;
  data?: Record<string, unknown>;
  ai?: { summary: string; answer?: string };
  transaction: {
    hash: string;
    status: string;
    deliveryStatus: 'pending' | 'delivered' | 'failed';
    amount: number;
    sellerReceived: number;
    platformFee: number;
    deliveryError?: string;
  };
}

interface RequestOptions extends RequestInit {
  /** Per-call override of the abort timeout, in milliseconds. */
  timeoutMs?: number;
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = getApiKey();
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return { ...headers, ...(extra as Record<string, string>) };
}

async function fetchWithTimeout(url: string, options?: RequestOptions): Promise<Response> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...init } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: authHeaders(init.headers),
      ...init,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out — please try again');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Runtime response validation ────────────────────────────────────────────
// Lightweight guards that validate critical API response shapes at runtime.
// They throw a descriptive ApiValidationError when the server returns
// unexpected data, preventing silent undefined/null crashes downstream.

export class ApiValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ApiValidationError';
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ApiValidationError(`Expected string for "${field}", got ${typeof value}`, field);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiValidationError(
      `Expected finite number for "${field}", got ${typeof value}`,
      field,
    );
  }
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiValidationError(`Expected array for "${field}", got ${typeof value}`, field);
  }
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiValidationError(`Expected object for "${field}", got ${typeof value}`, field);
  }
}

/** Validate a Stats object from the API. */
function validateStats(raw: unknown): Stats {
  assertObject(raw, 'stats');
  assertNumber(raw.totalDatasets, 'stats.totalDatasets');
  assertNumber(raw.totalQueries, 'stats.totalQueries');
  assertNumber(raw.totalUsdcEarned, 'stats.totalUsdcEarned');
  assertNumber(raw.totalTransactions, 'stats.totalTransactions');
  return raw as unknown as Stats;
}

/** Validate a DatasetMeta object from the API. */
function validateDataset(raw: unknown, index?: number): DatasetMeta {
  const label = index !== undefined ? `dataset[${index}]` : 'dataset';
  assertObject(raw, label);
  assertString(raw.id, `${label}.id`);
  assertString(raw.name, `${label}.name`);
  assertString(raw.type, `${label}.type`);
  assertNumber(raw.pricePerQuery, `${label}.pricePerQuery`);
  assertString(raw.sellerWallet, `${label}.sellerWallet`);
  return raw as unknown as DatasetMeta;
}

// ── HTTP helper ────────────────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  return scheduleRequest(getRequestKey(url, options), async () => {
    await acquireSlot();
    try {
      const res = await fetchWithTimeout(url, options);

      // Parse JSON body once. If parsing fails, we fallback to null.
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      if (data === null) {
        throw new Error('Invalid response from server');
      }

      // Handle business-level failures returned with 2xx status codes
      if (data && typeof data === 'object' && data.success === false) {
        throw new Error(data.error || 'API request failed');
      }

      return data as T;
    } finally {
      releaseSlot();
    }
  });
}

export const api = {
  getDatasets: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    type?: string | string[];
    types?: string[];
    minPrice?: number;
    maxPrice?: number;
    minQueries?: number;
    sort?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.page) searchParams.append('page', params.page.toString());
      if (params.limit) searchParams.append('limit', params.limit.toString());
      if (params.search) searchParams.append('search', params.search);
      const typeValues = [
        ...(Array.isArray(params.type) ? params.type : params.type ? [params.type] : []),
        ...(params.types ?? []),
      ];
      typeValues.forEach(type => {
        if (type) searchParams.append('type', type);
      });
      if (params.minPrice !== undefined)
        searchParams.append('minPrice', params.minPrice.toString());
      if (params.maxPrice !== undefined)
        searchParams.append('maxPrice', params.maxPrice.toString());
      if (params.minQueries !== undefined)
        searchParams.append('minQueries', params.minQueries.toString());
      if (params.sort) searchParams.append('sort', params.sort);
    }
    const query = searchParams.toString();
    const url = `${getApiBaseUrl()}/datasets${query ? `?${query}` : ''}`;
    return request<PaginatedDatasets>(url).then(r => {
      assertArray(r.data, 'datasets.data');
      r.data = r.data.map((item, i) => validateDataset(item, i));
      return r;
    });
  },

  getStats: () =>
    request<{ success: boolean; stats: unknown }>(`${getApiBaseUrl()}/datasets/stats`).then(r =>
      validateStats(r.stats),
    ),

  getDataset: (id: string) =>
    request<{ success: boolean; dataset: DatasetMeta }>(`${getApiBaseUrl()}/datasets/${id}`).then(
      r => r.dataset,
    ),

  getTransactions: (datasetId?: string) => {
    const url = datasetId
      ? `${getApiBaseUrl()}/datasets/${datasetId}/transactions`
      : `${getApiBaseUrl()}/datasets/transactions`;
    return request<{ success: boolean; transactions: Transaction[] }>(url).then(
      r => r.transactions,
    );
  },

  initiateQuery: (id: string) =>
    request<{ payment: { paymentAddress: string; amount: number; memo: string } }>(
      `${getApiBaseUrl()}/query/${id}`,
      { method: 'POST' },
    ),

  verifyPayment: (id: string, txHash: string, buyerQuestion?: string) =>
    request<QueryResult>(`${getApiBaseUrl()}/verify/${id}`, {
      method: 'POST',
      body: JSON.stringify({ txHash, buyerQuestion }),
    }),

  demoQuery: (id: string, buyerQuestion?: string) =>
    request<QueryResult>(`${getApiBaseUrl()}/verify/${id}/demo`, {
      method: 'POST',
      body: JSON.stringify({ buyerQuestion }),
    }),

  agentInfo: () => request<AgentInfo>(`${getApiBaseUrl()}/agent/info`),

  agentDemo: (query: string) =>
    request<AgentJob>(`${getApiBaseUrl()}/agent/research/demo`, {
      method: 'POST',
      body: JSON.stringify({ query }),
      timeoutMs: AGENT_REQUEST_TIMEOUT_MS,
    }),

  agentResearch: (query: string, txHash: string) =>
    request<AgentJob>(`${getApiBaseUrl()}/agent/research`, {
      method: 'POST',
      body: JSON.stringify({ query, txHash }),
      timeoutMs: AGENT_REQUEST_TIMEOUT_MS,
    }),

  createDataset: (payload: {
    name: string;
    description: string;
    type: string;
    pricePerQuery: number;
    sellerWallet: string;
    data: unknown;
  }) =>
    request<{ success: boolean; dataset: DatasetMeta }>(`${getApiBaseUrl()}/datasets`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }).then(r => r.dataset),
};

export function __resetRequestThrottleForTests() {
  requestQueues.clear();
  requestStartedAt.clear();
  inFlight = 0;
  inFlightWaiters.length = 0;
}
