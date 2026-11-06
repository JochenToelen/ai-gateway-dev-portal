/** Minimal exact decimal helpers (scaled BigInt). Money is never handled as a JS float. */

export const PRICE_SCALE = 10;
const COST_SCALE = PRICE_SCALE + 6; // price scale + the "per million" divisor (10^6)

const PRICE_RE = /^\d+(\.\d+)?$/;

export function isValidDecimalString(s: string): boolean {
  if (!PRICE_RE.test(s.trim())) return false;
  const frac = s.trim().split('.')[1];
  return !frac || frac.length <= PRICE_SCALE;
}

/** Parses a non-negative decimal string into an integer scaled by 10^PRICE_SCALE */
export function parsePrice(s: string): bigint {
  const t = s.trim();
  if (!isValidDecimalString(t)) throw new Error(`Invalid decimal price: "${s}"`);
  const [whole, frac = ''] = t.split('.');
  return BigInt(whole + frac.padEnd(PRICE_SCALE, '0'));
}

/** tokens x price-per-million, as an integer scaled by 10^COST_SCALE (cost = value / 10^COST_SCALE) */
export function tokenCost(tokens: number, pricePerMillion: bigint): bigint {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0n;
  return BigInt(Math.round(tokens)) * pricePerMillion;
}

/** Formats a scaled cost as an exact decimal string with trailing zeros trimmed */
export function formatCost(scaled: bigint): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const s = abs.toString().padStart(COST_SCALE + 1, '0');
  const whole = s.slice(0, s.length - COST_SCALE);
  const frac = s.slice(s.length - COST_SCALE).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Cost string -> scaled bigint (inverse of formatCost for values it produced) */
export function parseCost(s: string): bigint {
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const [whole, frac = ''] = t.split('.');
  const v = BigInt(whole + frac.padEnd(COST_SCALE, '0').slice(0, COST_SCALE));
  return neg ? -v : v;
}

export function addCosts(a: string, b: string): string {
  return formatCost(parseCost(a) + parseCost(b));
}
