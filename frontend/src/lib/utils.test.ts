// Feature: frontend-testing-infrastructure
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatUSDC, truncateAddress } from './utils';

describe('formatUSDC', () => {
  // Property 6: formatUSDC always produces a string containing a decimal point
  it('always contains a decimal point', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1_000_000, noNaN: true }), amount => {
        const result = formatUSDC(amount);
        expect(result).toContain('.');
      }),
    );
  });
});

describe('truncateAddress', () => {
  // Property 7: truncateAddress never produces a longer string than the input
  it('never lengthens the input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), addr => {
        expect(truncateAddress(addr).length).toBeLessThanOrEqual(addr.length);
      }),
    );
  });

  // Property 8: long addresses get ellipsis and correct prefix/suffix
  it('uses ellipsis and preserves prefix/suffix for long addresses', () => {
    const chars = 6;
    fc.assert(
      fc.property(fc.string({ minLength: chars * 2 + 1, maxLength: 100 }), addr => {
        const result = truncateAddress(addr, chars);
        expect(result).toContain('...');
        expect(result.startsWith(addr.slice(0, chars))).toBe(true);
        expect(result.endsWith(addr.slice(-chars))).toBe(true);
      }),
    );
  });
});
