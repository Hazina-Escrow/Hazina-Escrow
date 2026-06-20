const NETWORK = process.env.STELLAR_NETWORK ?? 'testnet';

export const STELLAR_NETWORK = NETWORK as 'testnet' | 'mainnet';

export const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ??
  (STELLAR_NETWORK === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org');

export const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ??
  (STELLAR_NETWORK === 'mainnet'
    ? 'https://soroban.stellar.org'
    : 'https://soroban-testnet.stellar.org');

// ── Multi-token support ──────────────────────────────────────────────────────

export interface StellarToken {
  code: 'USDC' | 'EURC' | 'XLM';
  issuer?: string; // undefined for XLM (native)
  address?: string; // Soroban contract address
}

export const USDC_ISSUER =
  process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // default testnet issuer

export const EURC_ISSUER =
  process.env.EURC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // testnet: same publisher as USDC

export const SUPPORTED_TOKENS: Record<string, StellarToken> = {
  USDC: {
    code: 'USDC',
    issuer: USDC_ISSUER,
  },
  EURC: {
    code: 'EURC',
    issuer: EURC_ISSUER,
  },
  XLM: {
    code: 'XLM',
    // native, no issuer
  },
};

export const DEFAULT_TOKEN_CODE = 'USDC';

export function getTokenByCode(code: string): StellarToken | null {
  return SUPPORTED_TOKENS[code] || null;
}

export const getNetworkPassphrase = () => {
  if (STELLAR_NETWORK === 'mainnet') {
    return 'Public Global Stellar Network ; September 2015';
  }
  return 'Test SDF Network ; September 2015';
};
