import { formatCost, parsePrice } from './decimal';

/**
 * Default list prices used to seed newly observed models. They are a starting point only:
 * rules created from them are flagged `needsReview` and must be confirmed or corrected by an administrator.
 * Public USD list prices per 1,000,000 tokens, converted to EUR with one fixed indicative rate (no FX service).
 * Contract, regional and provisioned pricing differ, so every seeded rule must be reviewed.
 */
export const DEFAULT_CURRENCY = 'EUR';
/** Indicative USD to EUR rate in percent (92 = 0.92 EUR per USD); edit here to re-base the defaults. */
const USD_TO_EUR_PERCENT = 92n;

export interface DefaultPrice { provider: string; input: string; cached: string; output: string }

const AOAI = 'Azure OpenAI';

const LIST_PRICES_USD: Record<string, DefaultPrice> = {
  'gpt-4o': { provider: AOAI, input: '2.50', cached: '1.25', output: '10.00' },
  'gpt-4o-mini': { provider: AOAI, input: '0.15', cached: '0.075', output: '0.60' },
  'gpt-4.1': { provider: AOAI, input: '2.00', cached: '0.50', output: '8.00' },
  'gpt-4.1-mini': { provider: AOAI, input: '0.40', cached: '0.10', output: '1.60' },
  'gpt-4.1-nano': { provider: AOAI, input: '0.10', cached: '0.025', output: '0.40' },
  'gpt-4-turbo': { provider: AOAI, input: '10.00', cached: '10.00', output: '30.00' },
  'gpt-4': { provider: AOAI, input: '30.00', cached: '30.00', output: '60.00' },
  'gpt-35-turbo': { provider: AOAI, input: '0.50', cached: '0.50', output: '1.50' },
  'gpt-3.5-turbo': { provider: AOAI, input: '0.50', cached: '0.50', output: '1.50' },
  'gpt-5': { provider: AOAI, input: '1.25', cached: '0.125', output: '10.00' },
  'gpt-5-mini': { provider: AOAI, input: '0.25', cached: '0.025', output: '2.00' },
  'gpt-5-nano': { provider: AOAI, input: '0.05', cached: '0.005', output: '0.40' },
  o1: { provider: AOAI, input: '15.00', cached: '7.50', output: '60.00' },
  'o1-mini': { provider: AOAI, input: '1.10', cached: '0.55', output: '4.40' },
  o3: { provider: AOAI, input: '2.00', cached: '0.50', output: '8.00' },
  'o3-mini': { provider: AOAI, input: '1.10', cached: '0.55', output: '4.40' },
  'o4-mini': { provider: AOAI, input: '1.10', cached: '0.275', output: '4.40' },
  'text-embedding-3-small': { provider: AOAI, input: '0.02', cached: '0.02', output: '0' },
  'text-embedding-3-large': { provider: AOAI, input: '0.13', cached: '0.13', output: '0' },
  'text-embedding-ada-002': { provider: AOAI, input: '0.10', cached: '0.10', output: '0' },
};

const toEur = (usd: string) => formatCost(parsePrice(usd) * USD_TO_EUR_PERCENT / 100n * 1_000_000n);

/** Default prices in DEFAULT_CURRENCY */
export const DEFAULT_PRICES: Record<string, DefaultPrice> = Object.fromEntries(Object.entries(LIST_PRICES_USD).map(([k, p]) => [k, {
  provider: p.provider, input: toEur(p.input), cached: toEur(p.cached), output: toEur(p.output),
}]));

// Only a version/date suffix may follow a known name, so variants such as "gpt-4o-audio-preview" never inherit another model's price.
const VERSION_SUFFIX = /^(-\d{4}-\d{2}-\d{2}|-\d{4}|-latest|-\d+)?$/;

/** Default price for a logged model name (exact, or known name plus version suffix); null when unknown. */
export function defaultPriceFor(modelName: string): DefaultPrice | null {
  const name = modelName.trim().toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(DEFAULT_PRICES)) {
    if (name.startsWith(key) && VERSION_SUFFIX.test(name.slice(key.length)) && (best === null || key.length > best.length)) best = key;
  }
  return best ? DEFAULT_PRICES[best] : null;
}
