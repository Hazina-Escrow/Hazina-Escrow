export type StellarWalletProvider = 'freighter' | 'albedo';

export interface StellarPaymentRequest {
  paymentAddress: string;
  amount: number;
  memo: string;
}

interface AlbedoPayResult {
  tx_hash?: string;
  transaction_hash?: string;
}

interface AlbedoIntent {
  pay: (params: Record<string, string | boolean>) => Promise<AlbedoPayResult>;
}

declare global {
  interface Window {
    albedo?: AlbedoIntent;
  }
}

const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const MAINNET_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

function configuredNetwork() {
  return (import.meta.env.VITE_STELLAR_NETWORK ?? 'testnet').toString().trim().toLowerCase();
}

function configuredUsdcIssuer() {
  const value = import.meta.env.VITE_USDC_ISSUER?.toString().trim();
  if (value) return value;
  return configuredNetwork() === 'mainnet' || configuredNetwork() === 'public'
    ? MAINNET_USDC_ISSUER
    : TESTNET_USDC_ISSUER;
}

function albedoNetwork() {
  return configuredNetwork() === 'mainnet' || configuredNetwork() === 'public'
    ? 'public'
    : 'testnet';
}

function networkPassphrase() {
  return albedoNetwork() === 'public' ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE;
}

function appendParams(baseUrl: string, params: Record<string, string | boolean>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `${baseUrl}?${query.toString()}`;
}

export function getStellarPaymentParams(payment: StellarPaymentRequest) {
  return {
    destination: payment.paymentAddress,
    amount: payment.amount.toFixed(7).replace(/\.?0+$/, ''),
    asset_code: 'USDC',
    asset_issuer: configuredUsdcIssuer(),
    memo: payment.memo,
    memo_type: 'MEMO_TEXT',
  };
}

export function buildFreighterPaymentUri(payment: StellarPaymentRequest) {
  return appendParams('web+stellar:pay', {
    ...getStellarPaymentParams(payment),
    network_passphrase: networkPassphrase(),
  });
}

export function buildAlbedoPaymentUrl(payment: StellarPaymentRequest) {
  return appendParams('https://albedo.link/intent/pay', {
    ...getStellarPaymentParams(payment),
    network: albedoNetwork(),
    submit: true,
  });
}

export async function launchStellarWalletProvider(
  provider: StellarWalletProvider,
  payment: StellarPaymentRequest,
) {
  if (provider === 'freighter') {
    window.location.href = buildFreighterPaymentUri(payment);
    return null;
  }

  if (window.albedo?.pay) {
    const result = await window.albedo.pay({
      ...getStellarPaymentParams(payment),
      network: albedoNetwork(),
      submit: true,
    });
    return result.tx_hash ?? result.transaction_hash ?? null;
  }

  window.open(buildAlbedoPaymentUrl(payment), '_blank', 'noopener,noreferrer');
  return null;
}
