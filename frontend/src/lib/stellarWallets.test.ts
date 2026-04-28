import { describe, expect, it } from 'vitest';
import { buildAlbedoPaymentUrl, buildFreighterPaymentUri } from './stellarWallets';

const payment = {
  paymentAddress: `G${'B'.repeat(55)}`,
  amount: 0.05,
  memo: 'haz-ds-123',
};

describe('stellarWallets', () => {
  it('builds a Freighter-compatible SEP-7 payment URI', () => {
    const uri = buildFreighterPaymentUri(payment);

    expect(uri).toContain('web+stellar:pay?');
    expect(uri).toContain(`destination=${payment.paymentAddress}`);
    expect(uri).toContain('amount=0.05');
    expect(uri).toContain('asset_code=USDC');
    expect(uri).toContain('memo=haz-ds-123');
    expect(uri).toContain('network_passphrase=Test+SDF+Network');
  });

  it('builds an Albedo payment intent URL', () => {
    const url = buildAlbedoPaymentUrl(payment);

    expect(url).toContain('https://albedo.link/intent/pay?');
    expect(url).toContain(`destination=${payment.paymentAddress}`);
    expect(url).toContain('amount=0.05');
    expect(url).toContain('asset_code=USDC');
    expect(url).toContain('network=testnet');
    expect(url).toContain('submit=true');
  });
});
