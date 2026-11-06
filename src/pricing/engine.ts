import { addCosts, formatCost, isValidDecimalString, parsePrice, tokenCost } from './decimal';
import type {
  CostBreakdown, CostTotals, PricingLookup, PricingRule, TokenUsage, UsageCostInput,
} from './types';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const ts = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/** Specificity precedence: 4 = model+deployment+region, 3 = model+deployment, 2 = model+region, 1 = model */
export function specificity(rule: Pick<PricingRule, 'deploymentName' | 'region'>): number {
  const d = norm(rule.deploymentName) !== '';
  const r = norm(rule.region) !== '';
  if (d && r) return 4;
  if (d) return 3;
  if (r) return 2;
  return 1;
}

/** ValidFrom <= t < ValidTo (open ended when ValidTo is empty) */
export function isEffective(rule: PricingRule, timestamp: string): boolean {
  const t = ts(timestamp);
  const from = ts(rule.validFrom);
  if (Number.isNaN(t) || Number.isNaN(from) || from > t) return false;
  if (!rule.validTo) return true;
  const to = ts(rule.validTo);
  return !Number.isNaN(to) && t < to;
}

/**
 * Deterministic lookup: only active, effective rules for the same model whose optional
 * deployment/region match are considered. Highest specificity wins; ties (which overlap validation
 * prevents) fall back to the latest ValidFrom, then the lowest id. Returns null when nothing matches.
 */
export function resolvePrice(rules: PricingRule[], lookup: PricingLookup): PricingRule | null {
  const model = norm(lookup.modelName);
  if (!model) return null;
  const deployment = norm(lookup.deploymentName);
  const region = norm(lookup.region);
  let best: PricingRule | null = null;
  for (const rule of rules) {
    if (!rule.isActive || norm(rule.modelName) !== model) continue;
    if (norm(rule.deploymentName) && norm(rule.deploymentName) !== deployment) continue;
    if (norm(rule.region) && norm(rule.region) !== region) continue;
    if (!isEffective(rule, lookup.timestamp)) continue;
    if (!best || compareRules(rule, best) < 0) best = rule;
  }
  return best;
}

/** negative when a is preferred over b */
function compareRules(a: PricingRule, b: PricingRule): number {
  return specificity(b) - specificity(a)
    || ts(b.validFrom) - ts(a.validFrom)
    || a.id.localeCompare(b.id);
}

/**
 * Cost of one usage record. Cached tokens are a subset of prompt tokens:
 * NonCached = max(Prompt - Cached, 0); TotalTokens is never multiplied by a price.
 */
export function calculateCost(usage: TokenUsage, rule: PricingRule | null): CostBreakdown {
  const cached = Math.max(usage.cachedInputTokens || 0, 0);
  const nonCached = Math.max((usage.promptTokens || 0) - cached, 0);
  if (!rule) {
    return {
      status: 'Missing', ruleId: null, currency: null, nonCachedInputTokens: nonCached,
      inputCost: '0', cachedInputCost: '0', outputCost: '0', estimatedModelCost: '0',
    };
  }
  const input = tokenCost(nonCached, parsePrice(rule.inputPricePerMillion));
  const cachedCost = tokenCost(cached, parsePrice(rule.cachedInputPricePerMillion));
  const output = tokenCost(usage.completionTokens, parsePrice(rule.outputPricePerMillion));
  return {
    status: 'Priced', ruleId: rule.id, currency: rule.currency, nonCachedInputTokens: nonCached,
    inputCost: formatCost(input), cachedInputCost: formatCost(cachedCost), outputCost: formatCost(output),
    estimatedModelCost: formatCost(input + cachedCost + output),
  };
}

export function priceRecord(rules: PricingRule[], usage: UsageCostInput): CostBreakdown {
  return calculateCost(usage, resolvePrice(rules, usage));
}

export function emptyTotals(): CostTotals {
  return {
    requests: 0, promptTokens: 0, completionTokens: 0, cachedInputTokens: 0,
    pricedRequests: 0, missingPricingRequests: 0,
    inputCost: '0', cachedInputCost: '0', outputCost: '0', estimatedModelCost: '0', incomplete: false,
  };
}

/**
 * Aggregates usage records. Totals are kept separate per currency (no FX). Missing-pricing records are
 * counted but add no cost, so the group flags `incomplete`; records without any price land in the
 * `missing` bucket (currency unknown).
 */
export function aggregateCosts(rules: PricingRule[], items: UsageCostInput[]): {
  byCurrency: Record<string, CostTotals>;
  missing: CostTotals;
} {
  const byCurrency: Record<string, CostTotals> = {};
  const missing = emptyTotals();
  for (const item of items) {
    const requests = item.requests ?? 1;
    const cost = priceRecord(rules, item);
    const bucket = cost.status === 'Missing' ? missing : (byCurrency[cost.currency ?? ''] ??= emptyTotals());
    bucket.requests += requests;
    bucket.promptTokens += item.promptTokens;
    bucket.completionTokens += item.completionTokens;
    bucket.cachedInputTokens += item.cachedInputTokens;
    if (cost.status === 'Missing') {
      bucket.missingPricingRequests += requests;
      continue;
    }
    bucket.pricedRequests += requests;
    bucket.inputCost = addCosts(bucket.inputCost, cost.inputCost);
    bucket.cachedInputCost = addCosts(bucket.cachedInputCost, cost.cachedInputCost);
    bucket.outputCost = addCosts(bucket.outputCost, cost.outputCost);
    bucket.estimatedModelCost = addCosts(bucket.estimatedModelCost, cost.estimatedModelCost);
  }
  for (const b of Object.values(byCurrency)) b.incomplete = missing.requests > 0;
  missing.incomplete = missing.requests > 0;
  return { byCurrency, missing };
}

/* ---------------- Validation ---------------- */

export interface RuleValidation {
  errors: string[];
}

const scopeKey = (r: PricingRule) => `${norm(r.modelName)}|${norm(r.deploymentName)}|${norm(r.region)}`;

/** [aFrom, aTo) overlaps [bFrom, bTo); empty ValidTo = open ended */
export function rangesOverlap(a: PricingRule, b: PricingRule): boolean {
  const aFrom = ts(a.validFrom);
  const bFrom = ts(b.validFrom);
  const aTo = a.validTo ? ts(a.validTo) : Infinity;
  const bTo = b.validTo ? ts(b.validTo) : Infinity;
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Validates a rule against field constraints, the table currency, and overlapping active rules
 * of the same scope (model + deployment + region).
 */
export function validateRule(rule: PricingRule, existing: PricingRule[], tableCurrency: string | null): RuleValidation {
  const errors: string[] = [];
  if (!rule.modelName.trim()) errors.push('Model name is required.');
  if (!rule.provider.trim()) errors.push('Provider is required.');
  const prices: [string, string][] = [
    ['Input price', rule.inputPricePerMillion],
    ['Cached input price', rule.cachedInputPricePerMillion],
    ['Output price', rule.outputPricePerMillion],
  ];
  for (const [label, value] of prices) {
    if (!isValidDecimalString(value ?? '')) errors.push(`${label} must be a number >= 0 (up to 10 decimals).`);
  }
  const currency = rule.currency.trim();
  if (!currency) errors.push('Currency is required.');
  else if (!/^[A-Za-z]{3}$/.test(currency)) errors.push('Currency must be a 3-letter ISO code.');
  else if (tableCurrency && currency.toUpperCase() !== tableCurrency.toUpperCase()) {
    errors.push(`Currency must be ${tableCurrency}: the pricing table uses a single currency.`);
  }
  if (!rule.validFrom || Number.isNaN(ts(rule.validFrom))) errors.push('Valid from is required.');
  if (rule.validTo) {
    if (Number.isNaN(ts(rule.validTo))) errors.push('Valid to is not a valid date.');
    else if (!Number.isNaN(ts(rule.validFrom)) && ts(rule.validTo) <= ts(rule.validFrom)) {
      errors.push('Valid to must be later than valid from.');
    }
  }
  if (errors.length === 0 && rule.isActive) {
    const clash = existing.find((o) => o.id !== rule.id && o.isActive && scopeKey(o) === scopeKey(rule) && rangesOverlap(o, rule));
    if (clash) {
      errors.push(`Overlaps an active rule for the same scope (${describeRange(clash)}). End-date it first or use "Add new price".`);
    }
  }
  return { errors };
}

export function describeRange(r: Pick<PricingRule, 'validFrom' | 'validTo'>): string {
  return `${r.validFrom.slice(0, 10)} → ${r.validTo ? r.validTo.slice(0, 10) : 'open'}`;
}

/**
 * "Add a new effective-dated price": end-dates the rule that is open or running at newRule.validFrom
 * and adds the new rule. Past consumption keeps the old price because the old rule stays intact until
 * newRule.validFrom. Returns the updated list, or errors.
 */
export function supersedeRule(
  rules: PricingRule[], oldId: string, newRule: PricingRule, tableCurrency: string | null, now: string,
): { rules: PricingRule[]; errors: string[] } {
  const old = rules.find((r) => r.id === oldId);
  if (!old) return { rules, errors: ['The rule to supersede was not found.'] };
  if (!(ts(newRule.validFrom) > ts(old.validFrom))) {
    return { rules, errors: ['The new price must start after the current price starts.'] };
  }
  if (old.validTo && ts(old.validTo) < ts(newRule.validFrom)) {
    return { rules, errors: ['The current price already ended before the new start date.'] };
  }
  const ended: PricingRule = { ...old, validTo: newRule.validFrom, updatedAt: now };
  const next = rules.map((r) => (r.id === oldId ? ended : r));
  const { errors } = validateRule(newRule, next, tableCurrency);
  return errors.length ? { rules, errors } : { rules: [...next, newRule], errors: [] };
}

/** Rules that are still open ended or currently in force: the currently "live" prices */
export const isCurrent = (r: PricingRule, now: string) => r.isActive && isEffective(r, now);
