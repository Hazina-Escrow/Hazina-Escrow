/**
 * localizeScale – translates known scale values (Low/Medium/High/Neutral/
 * Bullish/Bearish) via the i18n `t` function. Unrecognised values are
 * returned unchanged.
 */
export function localizeScale(value: string, t: (key: string) => string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'low') return t('agent.scales.low');
  if (normalized === 'medium') return t('agent.scales.medium');
  if (normalized === 'high') return t('agent.scales.high');
  if (normalized === 'neutral') return t('agent.scales.neutral');
  if (normalized === 'bullish') return t('agent.scales.bullish');
  if (normalized === 'bearish') return t('agent.scales.bearish');
  return value;
}
