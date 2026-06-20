import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  buildAlbedoPaymentUrl,
  buildFreighterPaymentUri,
  detectWallets,
  connectFreighter,
} from './stellarWallets';
import { initEnv } from './env';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  isAllowed: vi.fn(),
}));

import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  isAllowed as freighterIsAllowed,
} from '@stellar/freighter-api';

const payment = {
  paymentAddress: `G${'B'.repeat(55)}`,
  amount: 0.05,
  memo: 'haz-ds-123',
};

describe('stellarWallets', () => {
  beforeEach(() => {
    initEnv();
    vi.clearAllMocks();
  });

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

  describe('detectWallets', () => {
    it('detects Freighter when extension is connected', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(true);
      const result = await detectWallets();
      expect(result.freighter).toBe(true);
    });

    it('reports Freighter as unavailable when not connected', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(false);
      const result = await detectWallets();
      expect(result.freighter).toBe(false);
    });

    it('handles Freighter detection errors gracefully', async () => {
      vi.mocked(freighterIsConnected).mockRejectedValue(new Error('Extension not found'));
      const result = await detectWallets();
      expect(result.freighter).toBe(false);
    });

    it('detects Albedo when window.albedo is available', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(false);
      window.albedo = { pay: vi.fn() };
      const result = await detectWallets();
      expect(result.albedo).toBe(true);
      delete window.albedo;
    });

    it('reports Albedo as unavailable when not loaded', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(false);
      delete window.albedo;
      const result = await detectWallets();
      expect(result.albedo).toBe(false);
    });
  });

  describe('connectFreighter', () => {
    it('requests access when Freighter is connected but not allowed', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(true);
      vi.mocked(freighterIsAllowed).mockResolvedValue(false);
      vi.mocked(freighterRequestAccess).mockResolvedValue('GPUBLICKEY123');

      const publicKey = await connectFreighter();
      expect(publicKey).toBe('GPUBLICKEY123');
      expect(freighterRequestAccess).toHaveBeenCalled();
    });

    it('returns public key when already allowed', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(true);
      vi.mocked(freighterIsAllowed).mockResolvedValue(true);
      vi.mocked(freighterRequestAccess).mockResolvedValue('GPUBLICKEY456');

      const publicKey = await connectFreighter();
      expect(publicKey).toBe('GPUBLICKEY456');
    });

    it('throws when Freighter is not installed', async () => {
      vi.mocked(freighterIsConnected).mockResolvedValue(false);

      await expect(connectFreighter()).rejects.toThrow('Freighter extension is not installed');
    });
  });
});
