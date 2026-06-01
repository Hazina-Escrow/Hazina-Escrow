import { getCircuitBreaker, CircuitBreakerOpenError } from '../common/circuit-breaker';
import { logger } from '../lib/logger';

const coingeckoBreaker = getCircuitBreaker('coingecko', {
  failureThreshold: 4,
  resetTimeoutMs: 120_000, // 2 min — CoinGecko rate-limits aggressively
});

/**
 * MarketService handles external market data from CoinGecko
 * and provides deep links for manual data verification on Stellar.Expert.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MarketService {
  private static readonly COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

  /**
   * Fetches the current USD price for a given asset from CoinGecko.
   * Returns null when the circuit is open or the request fails.
   */
  static async getPrice(coinId: string = 'stellar'): Promise<number | null> {
    try {
      const apiKey = process.env.COINGECKO_API_KEY;
      const headers: Record<string, string> = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};

      const data = await coingeckoBreaker.execute(async () => {
        const response = await fetch(
          `${this.COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`,
          { headers },
        );
        return response.json() as Promise<Record<string, { usd?: number }>>;
      });

      return data[coinId]?.usd ?? null;
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        logger.warn(`[MarketService] ${error.message} — returning null for getPrice`);
      } else {
        logger.error(
          `[MarketService] getPrice error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Generates a clickable link to Stellar.Expert for a specific asset.
   */
  static getExplorerLink(assetCode: string, issuer?: string): string {
    const code = assetCode.toUpperCase();
    if (code === 'XLM') {
      return 'https://stellar.expert/explorer/public/asset/XLM';
    }
    return `https://stellar.expert/explorer/public/asset/${code}${issuer ? '-' + issuer : ''}`;
  }

  /**
   * Fetches market metrics (volume, change) for broader synthesis correlation.
   * Returns null when the circuit is open or the request fails.
   */
  static async getMarketMetrics(coinId: string = 'stellar'): Promise<{
    price: number | null;
    volume24h: number | null;
    change24h: number | null;
  } | null> {
    try {
      const apiKey = process.env.COINGECKO_API_KEY;
      const headers: Record<string, string> = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};

      const data = await coingeckoBreaker.execute(async () => {
        const response = await fetch(
          `${this.COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true`,
          { headers },
        );
        return response.json() as Promise<{
          market_data?: {
            current_price?: { usd?: number };
            total_volume?: { usd?: number };
            price_change_percentage_24h?: number;
          };
        }>;
      });

      return {
        price: data.market_data?.current_price?.usd ?? null,
        volume24h: data.market_data?.total_volume?.usd ?? null,
        change24h: data.market_data?.price_change_percentage_24h ?? null,
      };
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        logger.warn(`[MarketService] ${error.message} — returning null for getMarketMetrics`);
      }
      return null;
    }
  }
}
