import { defaultPriceFor, DEFAULT_CURRENCY } from './defaults';
import { createRule, type MutationResult } from './mutations';
import type { PricingDocument } from './types';

export interface ObservedModel {
  modelName: string;
  /** ISO timestamp of the first request seen in the lookback window */
  firstSeen: string;
}

export interface SeedResult extends MutationResult {
  added: string[];
  /** logged models with no known default price: left as Missing pricing for manual entry */
  unknown: string[];
  currencyMismatch: boolean;
}

/**
 * Adds one model-level rule per logged model that has no rule yet, using default prices.
 * Existing rules (active or not) are never touched, so manual prices always win.
 * The rule is valid from the first observed day, so historical consumption in the window is priced.
 */
export function seedObservedModels(doc: PricingDocument, observed: ObservedModel[], user: string, now: string): SeedResult {
  const result: SeedResult = { doc, errors: [], added: [], unknown: [], currencyMismatch: false };
  if (doc.currency && doc.currency !== DEFAULT_CURRENCY) {
    // Default prices are in DEFAULT_CURRENCY and a table has a single currency
    result.currencyMismatch = observed.some((o) => !hasRule(doc, o.modelName) && defaultPriceFor(o.modelName));
    result.unknown = observed.filter((o) => !hasRule(doc, o.modelName) && !defaultPriceFor(o.modelName)).map((o) => o.modelName);
    return result;
  }
  for (const o of observed) {
    if (hasRule(result.doc, o.modelName)) continue;
    const price = defaultPriceFor(o.modelName);
    if (!price) { result.unknown.push(o.modelName); continue; }
    const res = createRule(result.doc, {
      provider: price.provider, modelName: o.modelName, pricingMode: 'Standard',
      inputPricePerMillion: price.input, cachedInputPricePerMillion: price.cached, outputPricePerMillion: price.output,
      currency: DEFAULT_CURRENCY, validFrom: `${o.firstSeen.slice(0, 10)}T00:00:00.000Z`, needsReview: true,
    }, user, now);
    if (res.errors.length) { result.errors.push(...res.errors.map((e) => `${o.modelName}: ${e}`)); continue; }
    result.doc = res.doc;
    result.added.push(o.modelName);
  }
  return result;
}

const hasRule = (doc: PricingDocument, modelName: string) =>
  doc.rules.some((r) => r.modelName.toLowerCase() === modelName.trim().toLowerCase());
