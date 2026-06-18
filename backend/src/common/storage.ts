import { promises as fs, existsSync } from 'fs';
import path from 'path';

const DATA_PATH = process.env.DATA_PATH || path.resolve(process.cwd(), 'data/datasets.json');
const DATA_DIR = path.dirname(DATA_PATH);
const LOCK_PATH = path.join(DATA_DIR, '.store.lock');
const LOCK_STALE_MS = 30_000;
const pendingTxHashes = new Set<string>();

// Rolling window cap — keeps the transactions array and backup size bounded (#368)
const MAX_TRANSACTIONS_WINDOW = 10_000;

/**
 * Marks a tx hash as in-flight the moment the duplicate check passes, closing
 * the TOCTOU window between txHashUsed() and the eventual addTransaction() call
 * deep in the pipeline. Returns a cleanup fn — call it on any error path so the
 * slot is freed for legitimate retries (#364).
 */
export function reserveTxHash(txHash: string): () => void {
  pendingTxHashes.add(txHash);
  return () => pendingTxHashes.delete(txHash);
}

// In-memory cache: populated on first read, invalidated on every write.
let cache: Store | null = null;

const DATA_PATH = process.env.DATA_PATH || path.resolve(process.cwd(), 'data/datasets.json');

async function writeStoreFile(store: Store): Promise<void> {
  const tempPath = path.join(
    path.dirname(DATA_PATH),
    `.${path.basename(DATA_PATH)}.${process.pid}.${Date.now()}.tmp`,
  );
  const serialized = JSON.stringify(store, null, 2);

  try {
    await fs.writeFile(tempPath, serialized, 'utf-8');
    await fs.rename(tempPath, DATA_PATH);
    cache = null;
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  type: string;
  pricePerQuery: number;
  sellerWallet: string;
  data: Record<string, unknown>;
  queriesServed: number;
  totalEarned: number;
  createdAt: string;
  ratings?: {
    score: number;
    count: number;
    reviews: Array<{ txHash: string; score: number; comment?: string; timestamp: string }>;
  };
}

export interface Transaction {
  id: string;
  datasetId: string;
  txHash: string;

  buyerWallet?: string;

  memo?: string;
 main
  amount: number;
  status?:
    | 'pending'
    | 'verifying'
    | 'verified'
    | 'completed'
    | 'failed'
    | 'refunded'
    | 'delivery_failed';
  deliveryStatus?: 'pending' | 'delivered' | 'failed';
  sellerPaid?: boolean;
  sellerAmount?: number;
  sellerTxHash?: string;
  sellerNotifiedAt?: string;
  sellerNotificationError?: string;
  sellerNotificationAttempts?: number;
  buyerQuery?: string;
  aiSummary?: string;
  deliveryAttempts?: number;
  deliveryError?: string;
  verifiedAt?: string;
  deliveredAt?: string;
  timestamp: string;
}

export type WebhookEvent =
  | 'payment.received'
  | 'payment.forwarded'
  | 'dataset.queried'
  | 'dataset.created'
  | 'ping';

export interface WebhookSubscription {
  id: string;
  sellerWallet: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
}

export type PayoutFailureStatus = 'pending_retry' | 'manual_review_needed' | 'paid';

export interface PayoutFailure {
  id: string;
  datasetId: string;
  sellerWallet: string;
  buyerTxHash: string;
  intendedAmount: number;
  sellerTxHash?: string;
  status: PayoutFailureStatus;
  retryCount: number;
  nextRetryAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  datasets: Dataset[];
  transactions: Transaction[];
  webhooks: WebhookSubscription[];
  payoutFailures: PayoutFailure[];
}

function createEmptyStore(): Store {
  return {
    datasets: [],
    transactions: [],
    webhooks: [],
    payoutFailures: [],
  };
}

function normalizeStore(store: Partial<Store>): Store {
  return {
    datasets: Array.isArray(store.datasets) ? store.datasets : [],
    transactions: Array.isArray(store.transactions) ? store.transactions : [],
    webhooks: Array.isArray(store.webhooks) ? store.webhooks : [],
    payoutFailures: Array.isArray(store.payoutFailures) ? store.payoutFailures : [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readRaw(): Promise<Store> {
  if (!existsSync(DATA_PATH)) {
    const empty: Store = { datasets: [], transactions: [], webhooks: [], payoutFailures: [] };
    await writeStoreFile(empty);
    return empty;
  }
  const raw = await fs.readFile(DATA_PATH, 'utf-8');
  if (!raw.trim()) {
    return createEmptyStore();
  }
  const parsed = JSON.parse(raw) as Partial<Store>;
  return normalizeStore(parsed);
}

async function persistStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const serialized = JSON.stringify(store, null, 2);
  const tempPath = `${DATA_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempPath, serialized, 'utf-8');
  await fs.rename(tempPath, DATA_PATH);
  cache = null;
}

type LockHandle = Awaited<ReturnType<typeof fs.open>>;

async function acquireLock(timeoutMs = 10_000): Promise<LockHandle> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const startedAt = Date.now();

  for (;;) {
    try {
      return await fs.open(LOCK_PATH, 'wx');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stats = await fs.stat(LOCK_PATH);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(LOCK_PATH).catch(() => {});
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for storage lock: ${LOCK_PATH}`);
      }

      await sleep(25);
    }
  }
}

async function releaseLock(handle: LockHandle): Promise<void> {
  try {
    await handle.close();
  } finally {
    await fs.unlink(LOCK_PATH).catch(() => {});
  }
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}


// Runs fn inside the serialized queue. fn receives the current store and must
// return the (possibly mutated) store to persist, plus an optional result.
function enqueue<T>(fn: (store: Store) => Promise<[Store, T]>): Promise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  mutationQueue = mutationQueue.then(async () => {

async function withLockedWrite<T>(task: () => Promise<T>): Promise<T> {
  return enqueueWrite(async () => {
    const lock = await acquireLock();

    try {
      return await task();
    } finally {
      await releaseLock(lock);
    }
  });
}

async function updateStore<T>(mutator: (store: Store) => Promise<T> | T): Promise<T> {
  return withLockedWrite(async () => {
    const store = await readRaw();
    const result = await mutator(store);
    await writeStoreFile(store);
    return result;
  });
}

export async function readStore(): Promise<Store> {
  await writeQueue;
  if (cache) return cache;
  cache = await readStoreInternal();
  return cache;
}

export function invalidateCache(): void {
  cache = null;
}

export async function writeStore(store: Store): Promise<void> {
  return withLockedWrite(async () => {
    await writeStoreFile(store);
  });
}

export async function getDataset(id: string): Promise<Dataset | undefined> {

  return (await readStore()).datasets.find(d => d.id === id);

  return (await readStore()).datasets.find(dataset => dataset.id === id);

}

export async function getAllDatasets(): Promise<Dataset[]> {
  return (await readStore()).datasets;
}

export async function updateDataset(
  id: string,
  updates: Partial<Dataset>,
): Promise<Dataset | null> {

  return enqueue(async store => {
    const idx = store.datasets.findIndex(d => d.id === id);
    if (idx === -1) return [store, null];
    store.datasets[idx] = { ...store.datasets[idx], ...updates };
    return [store, store.datasets[idx]];

  return updateStore(async store => {
    const index = store.datasets.findIndex(dataset => dataset.id === id);
    if (index === -1) {
      return null;
    }

    store.datasets[index] = { ...store.datasets[index], ...updates };
    return store.datasets[index];

  });
}

export async function addDataset(dataset: Dataset): Promise<void> {

  return enqueue(async store => {

  return updateStore(async store => {

    store.datasets.push(dataset);
  });
}

export async function addTransaction(tx: Transaction): Promise<void> {

  pendingTxHashes.add(tx.txHash);
  return enqueue(async store => {

  if (tx.txHash) {
    pendingTxHashes.add(tx.txHash);
  }

  return updateStore(async store => {

    store.transactions.push(tx);
    // Prune oldest entries once the rolling window is exceeded (#368)
    if (store.transactions.length > MAX_TRANSACTIONS_WINDOW) {
      store.transactions = store.transactions.slice(
        store.transactions.length - MAX_TRANSACTIONS_WINDOW,
      );
    }
  }).finally(() => {
    if (tx.txHash) {
      pendingTxHashes.delete(tx.txHash);
    }
  });
}


export async function getTransactionByHash(txHash: string): Promise<Transaction | undefined> {
  return (await readStore()).transactions.find(transaction => transaction.txHash === txHash);
}

/**
 * Returns the top-level agent-job transaction for a given human payment txHash.
 * Used to serve a cached result when the same txHash is submitted more than once
 * (idempotency key behaviour).
 */
export async function getAgentJobByTxHash(txHash: string): Promise<Transaction | undefined> {
  return (await readStore()).transactions.find(
    tx => tx.txHash === txHash && tx.datasetId === 'agent-job',
  );
}

export async function getTransactionByMemo(memo: string): Promise<Transaction | undefined> {
  return (await readStore()).transactions.find(transaction => transaction.memo === memo);
}

export async function updateTransactionByHash(
  txHash: string,
  updates: Partial<Transaction>,
): Promise<Transaction | null> {
  return updateStore(async store => {
    const index = store.transactions.findIndex(transaction => transaction.txHash === txHash);
    if (index === -1) {
      return null;
    }

    store.transactions[index] = { ...store.transactions[index], ...updates };
    return store.transactions[index];
  });
}

export async function updateTransactionByMemo(
  memo: string,
  updates: Partial<Transaction>,
): Promise<Transaction | null> {
  return updateStore(async store => {
    const index = store.transactions.findIndex(transaction => transaction.memo === memo);
    if (index === -1) {
      return null;
    }

    store.transactions[index] = { ...store.transactions[index], ...updates };
    return store.transactions[index];
  });
}


export async function getTransactions(
  datasetId?: string,
  limit?: number,
  offset?: number,
): Promise<Transaction[]> {
  const store = await readStore();
  let transactions = datasetId

    ? store.transactions.filter(t => t.datasetId === datasetId)

    ? store.transactions.filter(transaction => transaction.datasetId === datasetId)

    : store.transactions;

  if (offset !== undefined && offset > 0) {
    transactions = transactions.slice(offset);
  }

  if (limit !== undefined && limit > 0) {
    transactions = transactions.slice(0, limit);
  }

  return transactions;
}

export async function getTransactionsCount(datasetId?: string): Promise<number> {
  const store = await readStore();
  return datasetId

    ? store.transactions.filter(t => t.datasetId === datasetId).length
    : store.transactions.length;
}

export async function txHashUsed(txHash: string): Promise<boolean> {
  if (pendingTxHashes.has(txHash)) return true;
  return (await readStore()).transactions.some(t => t.txHash === txHash);

    ? store.transactions.filter(transaction => transaction.datasetId === datasetId).length
    : store.transactions.length;
}

export async function getFailedDeliveryTransactions(): Promise<Transaction[]> {
  const store = await readStore();
  return store.transactions.filter(transaction => transaction.deliveryStatus === 'failed');

}

export async function txHashUsed(txHash: string): Promise<boolean> {
  if (!txHash) {
    return false;
  }

  if (pendingTxHashes.has(txHash)) {
    return true;
  }

  return (await readStore()).transactions.some(transaction => transaction.txHash === txHash);
}

export async function getAllWebhooks(): Promise<WebhookSubscription[]> {
  return (await readStore()).webhooks;
}

export async function getWebhooksForSeller(sellerWallet: string): Promise<WebhookSubscription[]> {

  return (await readStore()).webhooks.filter(w => w.sellerWallet === sellerWallet && w.active);
}

export async function getWebhookById(id: string): Promise<WebhookSubscription | undefined> {
  return (await readStore()).webhooks.find(w => w.id === id);
}

export async function addWebhook(webhook: WebhookSubscription): Promise<void> {
  return enqueue(async store => {

  return (await readStore()).webhooks.filter(
    webhook => webhook.sellerWallet === sellerWallet && webhook.active,
  );
}

export async function getWebhookById(id: string): Promise<WebhookSubscription | undefined> {
  return (await readStore()).webhooks.find(webhook => webhook.id === id);
}

export async function addWebhook(webhook: WebhookSubscription): Promise<void> {
  return updateStore(async store => {

    store.webhooks.push(webhook);
  });
}

export async function removeWebhook(id: string): Promise<boolean> {

  return enqueue(async store => {
    const idx = store.webhooks.findIndex(w => w.id === id);
    if (idx === -1) return [store, false];
    store.webhooks.splice(idx, 1);
    return [store, true];
  });
}

export async function updateWebhook(
  id: string,
  updates: Partial<WebhookSubscription>,
): Promise<WebhookSubscription | null> {
  return enqueue(async store => {
    const idx = store.webhooks.findIndex(w => w.id === id);
    if (idx === -1) return [store, null];
    store.webhooks[idx] = { ...store.webhooks[idx], ...updates };
    return [store, store.webhooks[idx]];

  return updateStore(async store => {
    const index = store.webhooks.findIndex(webhook => webhook.id === id);
    if (index === -1) {
      return false;
    }

    store.webhooks.splice(index, 1);
    return true;
  });
}

export async function updateWebhook(
  id: string,
  updates: Partial<WebhookSubscription>,
): Promise<WebhookSubscription | null> {
  return updateStore(async store => {
    const index = store.webhooks.findIndex(webhook => webhook.id === id);
    if (index === -1) {
      return null;
    }

    store.webhooks[index] = { ...store.webhooks[index], ...updates };
    return store.webhooks[index];
  });
}

export async function addPayoutFailure(payoutFailure: PayoutFailure): Promise<void> {
  return updateStore(async store => {
    store.payoutFailures.push(payoutFailure);
  });
}

export async function getPayoutFailureByBuyerTxHash(
  buyerTxHash: string,
): Promise<PayoutFailure | undefined> {
  return (await readStore()).payoutFailures.find(failure => failure.buyerTxHash === buyerTxHash);
}

export async function updatePayoutFailure(
  id: string,
  updates: Partial<PayoutFailure>,
): Promise<PayoutFailure | null> {
  return updateStore(async store => {
    const index = store.payoutFailures.findIndex(failure => failure.id === id);
    if (index === -1) {
      return null;
    }

    store.payoutFailures[index] = { ...store.payoutFailures[index], ...updates };
    return store.payoutFailures[index];

  });
}

export async function getPayoutFailuresByStatus(
  status: PayoutFailureStatus,
): Promise<PayoutFailure[]> {
  return (await readStore()).payoutFailures.filter(failure => failure.status === status);
}

export async function getPendingPayoutFailures(nowIso: string): Promise<PayoutFailure[]> {
  const now = new Date(nowIso).getTime();
  return (await readStore()).payoutFailures.filter(
    failure => failure.status === 'pending_retry' && new Date(failure.nextRetryAt).getTime() <= now,
  );
}

export async function getUnpaidTransactions(): Promise<Transaction[]> {
  const store = await readStore();

  return store.transactions.filter(t => t.sellerPaid === false);

  return store.transactions.filter(transaction => transaction.sellerPaid === false);
}

// Returns completed transactions where the seller notification failed and has not
// yet exhausted retries. Used by the seller notification retry worker.
export async function getTransactionsWithFailedSellerNotification(): Promise<Transaction[]> {
  const store = await readStore();
  return store.transactions.filter(
    t =>
      t.status === 'completed' &&
      t.sellerNotificationError !== undefined &&
      t.sellerNotifiedAt === undefined,
  );

}
