import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicModel } from '../ai/anthropic.config';
import { getAllCircuitBreakerStats } from './circuit-breaker';
import { HORIZON_URL } from '../lib/stellar.config';
import { readStore } from './storage';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  checks: {
    anthropic: ServiceCheck;
    stellarHorizon: ServiceCheck;
    storage: ServiceCheck;
  };
  circuitBreakers: ReturnType<typeof getAllCircuitBreakerStats>;
}

interface ServiceCheck {
  status: 'ok' | 'error' | 'unavailable';
  message?: string;
  responseTime?: number;
}

export async function checkHealth(): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();
  const [anthropic, stellarHorizon, storage] = await Promise.all([
    checkAnthropicService(),
    checkStellarHorizon(),
    checkStorage(),
  ]);

  const checks = { anthropic, stellarHorizon, storage };
  const hasError = Object.values(checks).some(
    check => check.status === 'error' || check.status === 'unavailable',
  );

  return {
    status: hasError ? 'degraded' : 'healthy',
    timestamp,
    service: 'Hazina Escrow API',
    checks,
    circuitBreakers: getAllCircuitBreakerStats(),
  };
}

async function checkAnthropicService(): Promise<ServiceCheck> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'unavailable', message: 'ANTHROPIC_API_KEY not configured' };
  }

  const startTime = Date.now();
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.messages.countTokens({
      model: getAnthropicModel(),
      messages: [{ role: 'user', content: 'health check' }],
    });
    return { status: 'ok', responseTime: Date.now() - startTime };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

async function checkStellarHorizon(): Promise<ServiceCheck> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(HORIZON_URL, { signal: controller.signal });
      if (!res.ok) {
        return {
          status: 'error',
          message: `Horizon returned HTTP ${res.status}`,
          responseTime: Date.now() - startTime,
        };
      }
      return { status: 'ok', responseTime: Date.now() - startTime };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

async function checkStorage(): Promise<ServiceCheck> {
  const startTime = Date.now();
  try {
    await readStore();
    return { status: 'ok', responseTime: Date.now() - startTime };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}
