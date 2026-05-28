import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRequestThrottleForTests,
  api,
  DEFAULT_REQUEST_TIMEOUT_MS,
  AGENT_REQUEST_TIMEOUT_MS,
} from './api';

function createFetchResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

describe('api request throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T00:00:00Z'));
    __resetRequestThrottleForTests();
  });

  afterEach(() => {
    __resetRequestThrottleForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('spaces repeated calls to the same endpoint', async () => {
    let resolveFirstResponse = () => {};

    const firstResponse = new Promise<ReturnType<typeof createFetchResponse>>(resolve => {
      resolveFirstResponse = () =>
        resolve(
          createFetchResponse({
            success: true,
            data: [],
            total: 0,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
        );
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(() =>
        Promise.resolve(
          createFetchResponse({
            success: true,
            data: [],
            total: 0,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const firstCall = api.getDatasets();
    const secondCall = api.getDatasets();

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirstResponse();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(firstCall).resolves.toMatchObject({ total: 0 });
    await expect(secondCall).resolves.toMatchObject({ total: 0 });
  });

  it('keeps different endpoints independent', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/datasets/stats')) {
        return Promise.resolve(
          createFetchResponse({
            success: true,
            stats: {
              totalDatasets: 1,
              totalQueries: 2,
              totalUsdcEarned: 3,
              totalTransactions: 4,
            },
          }),
        );
      }

      return Promise.resolve(
        createFetchResponse({
          success: true,
          data: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }),
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const datasetsPromise = api.getDatasets();
    const statsPromise = api.getStats();

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(datasetsPromise).resolves.toMatchObject({ total: 0 });
    await expect(statsPromise).resolves.toMatchObject({
      totalDatasets: 1,
      totalQueries: 2,
      totalUsdcEarned: 3,
      totalTransactions: 4,
    });
  });

  it('serializes advanced dataset filters', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        createFetchResponse({
          success: true,
          data: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }),
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    await api.getDatasets({
      page: 2,
      limit: 12,
      search: 'yield',
      types: ['yield-data', 'risk-scores'],
      minPrice: 0.5,
      maxPrice: 5,
      minQueries: 1000,
      sort: 'price-asc',
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const url = new URL(String(firstCall?.[0]), 'http://localhost');
    expect(url.searchParams.getAll('type')).toEqual(['yield-data', 'risk-scores']);
    expect(url.searchParams.get('minPrice')).toBe('0.5');
    expect(url.searchParams.get('maxPrice')).toBe('5');
    expect(url.searchParams.get('minQueries')).toBe('1000');
    expect(url.searchParams.get('sort')).toBe('price-asc');
  });

  it('times out with friendly message for default API requests', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const abort = new Error('Aborted');
        abort.name = 'AbortError';
        if (signal?.aborted) {
          reject(abort);
          return;
        }
        signal?.addEventListener('abort', () => reject(abort));
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const datasetsPromise = api.getDatasets();

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);

    await expect(datasetsPromise).rejects.toThrow('Request timed out — please try again');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the agent timeout constant for agent AI requests', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const abort = new Error('Aborted');
        abort.name = 'AbortError';
        if (signal?.aborted) {
          reject(abort);
          return;
        }
        signal?.addEventListener('abort', () => reject(abort));
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const agentPromise = api.agentDemo('long running query');

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(AGENT_REQUEST_TIMEOUT_MS);

    await expect(agentPromise).rejects.toThrow('Request timed out — please try again');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/agent/research/demo');
  });
});
