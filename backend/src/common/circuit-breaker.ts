/**
 * Circuit Breaker pattern for external API calls.
 *
 * States:
 *   CLOSED    — Normal operation; failures are counted.
 *   OPEN      — Service is assumed down; calls fail-fast without hitting the API.
 *   HALF_OPEN — One probe request is allowed through to test recovery.
 *
 * Transitions:
 *   CLOSED  → OPEN      : failureCount reaches failureThreshold
 *   OPEN    → HALF_OPEN : resetTimeoutMs elapses
 *   HALF_OPEN → CLOSED  : probe request succeeds
 *   HALF_OPEN → OPEN    : probe request fails
 */

import { logger } from '../lib/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before attempting a probe. Default: 60_000 */
  resetTimeoutMs?: number;
  /** Optional callback invoked on state transitions (useful for metrics/logging). */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — downstream service unavailable`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private probeInFlight = false;

  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.onStateChange = options.onStateChange;
  }

  /** Current circuit state (read-only). */
  getState(): CircuitState {
    return this.state;
  }

  /** Stats snapshot — useful for health-check endpoints. */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - CLOSED:    runs normally; failure increments counter.
   * - OPEN:      throws CircuitBreakerOpenError immediately (no network call).
   * - HALF_OPEN: allows one probe; success → CLOSED, failure → OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.tryTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitBreakerOpenError(this.name);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.probeInFlight) {
        // Another concurrent call during half-open — fail fast.
        throw new CircuitBreakerOpenError(this.name);
      }
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      this.probeInFlight = false;
    }
  }

  /** Manually reset the circuit to CLOSED (e.g. after a deploy / config fix). */
  reset(): void {
    this.transition('CLOSED');
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private tryTransitionToHalfOpen(): void {
    if (
      this.state === 'OPEN' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.transition('HALF_OPEN');
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.transition('CLOSED');
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(next: CircuitState): void {
    if (this.state === next) {
      return;
    }
    const prev = this.state;
    this.state = next;
    logger.warn(`[CircuitBreaker] "${this.name}" ${prev} → ${next}`);
    this.onStateChange?.(this.name, prev, next);
  }
}

// ── Singleton registry ───────────────────────────────────────────────────────
// One breaker per named external service, shared across the process lifetime.

const registry = new Map<string, CircuitBreaker>();

/**
 * Returns (or creates) a named CircuitBreaker instance.
 * Options are only applied on first creation.
 */
export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
  if (!registry.has(name)) {
    registry.set(name, new CircuitBreaker(name, options));
  }
  const breaker = registry.get(name);
  if (!breaker) {
    throw new Error(`CircuitBreaker "${name}" not found in registry after creation`);
  }
  return breaker;
}

/** Returns stats for every registered circuit breaker (for health endpoints). */
export function getAllCircuitBreakerStats() {
  return Array.from(registry.values()).map(cb => cb.getStats());
}
