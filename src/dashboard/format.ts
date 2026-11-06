interface Formatters {
  full: Intl.NumberFormat;
  fine: Intl.NumberFormat;
  short: Intl.NumberFormat;
}

function build(currency: string): Formatters {
  const base = currency ? { style: 'currency' as const, currency } : {};
  const fmt = (o: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(undefined, { ...base, ...o });
    } catch {
      return new Intl.NumberFormat(undefined, o);
    }
  };
  return {
    full: fmt({ maximumFractionDigits: 0 }),
    fine: fmt({ minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    short: fmt({ notation: 'compact', maximumFractionDigits: 1 }),
  };
}

let fmts = build('');

/** Currency comes from Cost Management; call before rendering any money value. */
export function setCurrency(currency: string) {
  fmts = build(currency);
}

const numCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const numFull = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export const money = (n: number) => fmts.full.format(n);
export const money2 = (n: number) => fmts.fine.format(n);
export const moneyShort = (n: number) => fmts.short.format(n);
export const compact = (n: number) => numCompact.format(n);
export const num = (n: number) => numFull.format(n);
export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
export const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
