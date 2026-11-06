/** Currency-aware formatting for the pricing/cost UI (kept local: no global currency state). */
export function formatMoney(n: number, currency: string, digits = 2): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`;
  }
}

/** Adaptive precision: tiny per-request costs need more decimals than totals */
export function formatMoneyAuto(n: number, currency: string): string {
  const abs = Math.abs(n);
  const digits = abs === 0 || abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return formatMoney(n, currency, digits);
}
