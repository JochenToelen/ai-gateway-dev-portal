import { describe, expect, it } from 'vitest';
import { aggregateCosts, calculateCost, priceRecord, resolvePrice, supersedeRule, validateRule } from './engine';
import type { PricingRule, UsageCostInput } from './types';

let seq = 0;
function rule(over: Partial<PricingRule> = {}): PricingRule {
  seq += 1;
  return {
    id: `r${seq.toString().padStart(3, '0')}`, provider: 'OpenAI', modelName: 'gpt-4o', pricingMode: 'Standard',
    inputPricePerMillion: '2.50', cachedInputPricePerMillion: '1.25', outputPricePerMillion: '10.00',
    currency: 'EUR', validFrom: '2025-01-01T00:00:00Z', isActive: true,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', ...over,
  };
}
const usage = (over: Partial<UsageCostInput> = {}): UsageCostInput => ({
  modelName: 'gpt-4o', deploymentName: 'dep-a', region: 'westeurope', timestamp: '2025-02-10T12:00:00Z',
  promptTokens: 10_000, completionTokens: 2_000, cachedInputTokens: 0, ...over,
});

describe('cost calculation', () => {
  it('calculates standard input/output cost', () => {
    const c = calculateCost(usage(), rule());
    expect(c.inputCost).toBe('0.025');
    expect(c.outputCost).toBe('0.02');
    expect(c.estimatedModelCost).toBe('0.045');
  });

  it('example: 10k prompt, 4k cached, 2k completion = 0.040', () => {
    const c = calculateCost(usage({ cachedInputTokens: 4_000 }), rule());
    expect(c.nonCachedInputTokens).toBe(6_000);
    expect(c.inputCost).toBe('0.015');
    expect(c.cachedInputCost).toBe('0.005');
    expect(c.outputCost).toBe('0.02');
    expect(c.estimatedModelCost).toBe('0.04');
  });

  it('returns zero for zero tokens', () => {
    const c = calculateCost(usage({ promptTokens: 0, completionTokens: 0 }), rule());
    expect(c.status).toBe('Priced');
    expect(c.estimatedModelCost).toBe('0');
  });

  it('treats missing cached telemetry as 0 and bills all prompt tokens at the input price', () => {
    const c = calculateCost(usage({ cachedInputTokens: 0 }), rule());
    expect(c.nonCachedInputTokens).toBe(10_000);
    expect(c.cachedInputCost).toBe('0');
  });

  it('never goes negative when cached exceeds prompt', () => {
    expect(calculateCost(usage({ promptTokens: 100, cachedInputTokens: 500 }), rule()).nonCachedInputTokens).toBe(0);
  });

  it('is exact with decimal prices (no float drift)', () => {
    const r = rule({ inputPricePerMillion: '0.1', outputPricePerMillion: '0.2' });
    const c = calculateCost(usage({ promptTokens: 3, completionTokens: 3 }), r);
    expect(c.estimatedModelCost).toBe('0.0000009');
  });
});

describe('pricing lookup', () => {
  it('marks Missing when no rule exists and never borrows another model price', () => {
    const rules = [rule({ modelName: 'gpt-4o-mini' })];
    const c = priceRecord(rules, usage());
    expect(c.status).toBe('Missing');
    expect(c.estimatedModelCost).toBe('0');
    expect(c.ruleId).toBeNull();
  });

  it('only uses rules whose range contains the timestamp (ValidFrom inclusive, ValidTo exclusive)', () => {
    const r = rule({ validFrom: '2025-02-01T00:00:00Z', validTo: '2025-03-01T00:00:00Z' });
    expect(resolvePrice([r], usage({ timestamp: '2025-01-31T23:59:59Z' }))).toBeNull();
    expect(resolvePrice([r], usage({ timestamp: '2025-02-01T00:00:00Z' }))).toBe(r);
    expect(resolvePrice([r], usage({ timestamp: '2025-03-01T00:00:00Z' }))).toBeNull();
  });

  it('keeps historical prices after a price change', () => {
    const jan = rule({ validTo: '2025-03-01T00:00:00Z' });
    const mar = rule({ validFrom: '2025-03-01T00:00:00Z', inputPricePerMillion: '2.00', outputPricePerMillion: '8.00' });
    const rules = [jan, mar];
    const feb = priceRecord(rules, usage({ timestamp: '2025-02-15T00:00:00Z' }));
    const march = priceRecord(rules, usage({ timestamp: '2025-03-15T00:00:00Z' }));
    expect(feb.estimatedModelCost).toBe('0.045');
    expect(march.estimatedModelCost).toBe('0.036');
  });

  it('prefers deployment over model, and model+deployment+region over everything', () => {
    const model = rule({ inputPricePerMillion: '1' });
    const dep = rule({ deploymentName: 'dep-a', inputPricePerMillion: '2' });
    const reg = rule({ region: 'westeurope', inputPricePerMillion: '3' });
    const both = rule({ deploymentName: 'dep-a', region: 'westeurope', inputPricePerMillion: '4' });
    expect(resolvePrice([model, dep], usage())).toBe(dep);
    expect(resolvePrice([model, dep, reg], usage())).toBe(dep);
    expect(resolvePrice([model, dep, reg, both], usage())).toBe(both);
    expect(resolvePrice([model, dep], usage({ deploymentName: 'other' }))).toBe(model);
  });

  it('applies region-specific pricing only for that region (case-insensitive)', () => {
    const model = rule({ inputPricePerMillion: '1' });
    const reg = rule({ region: 'WestEurope', inputPricePerMillion: '3' });
    expect(resolvePrice([model, reg], usage({ region: 'westeurope' }))).toBe(reg);
    expect(resolvePrice([model, reg], usage({ region: 'swedencentral' }))).toBe(model);
  });

  it('ignores inactive rules', () => {
    const r = rule({ isActive: false });
    expect(priceRecord([r], usage()).status).toBe('Missing');
  });
});

describe('rule validation', () => {
  it('rejects negative prices, missing fields and an invalid range', () => {
    const bad = rule({ inputPricePerMillion: '-1', currency: '', validFrom: '', outputPricePerMillion: 'abc' });
    const { errors } = validateRule(bad, [], null);
    expect(errors.join(' ')).toMatch(/Input price/);
    expect(errors.join(' ')).toMatch(/Output price/);
    expect(errors.join(' ')).toMatch(/Currency is required/);
    expect(errors.join(' ')).toMatch(/Valid from is required/);
    const range = rule({ validTo: '2024-12-31T00:00:00Z' });
    expect(validateRule(range, [], null).errors.join(' ')).toMatch(/later than valid from/);
  });

  it('prevents overlapping active rules in the same scope', () => {
    const a = rule({ validTo: '2025-03-01T00:00:00Z' });
    const overlap = rule({ validFrom: '2025-02-01T00:00:00Z' });
    expect(validateRule(overlap, [a], 'EUR').errors.join(' ')).toMatch(/Overlaps/);
    const adjacent = rule({ validFrom: '2025-03-01T00:00:00Z' });
    expect(validateRule(adjacent, [a], 'EUR').errors).toEqual([]);
    const otherScope = rule({ deploymentName: 'dep-a' });
    expect(validateRule(otherScope, [a], 'EUR').errors).toEqual([]);
    const inactive = rule({ isActive: false, validFrom: '2025-02-01T00:00:00Z' });
    expect(validateRule(inactive, [a], 'EUR').errors).toEqual([]);
  });

  it('supersede end-dates the old rule so history is preserved', () => {
    const old = rule();
    const next = rule({ validFrom: '2025-03-01T00:00:00Z', inputPricePerMillion: '2.00' });
    const res = supersedeRule([old], old.id, next, 'EUR', '2025-02-20T00:00:00Z');
    expect(res.errors).toEqual([]);
    expect(res.rules.find((r) => r.id === old.id)?.validTo).toBe('2025-03-01T00:00:00Z');
    expect(priceRecord(res.rules, usage({ timestamp: '2025-02-10T00:00:00Z' })).inputCost).toBe('0.025');
  });
});

describe('currency handling', () => {
  it('enforces the single table currency', () => {
    expect(validateRule(rule({ currency: 'USD' }), [], 'EUR').errors.join(' ')).toMatch(/single currency/);
    expect(validateRule(rule({ currency: 'eur' }), [], 'EUR').errors).toEqual([]);
  });

  it('keeps totals separated per currency', () => {
    const eur = rule({ modelName: 'a', currency: 'EUR' });
    const usd = rule({ modelName: 'b', currency: 'USD' });
    const { byCurrency } = aggregateCosts([eur, usd], [usage({ modelName: 'a' }), usage({ modelName: 'b' })]);
    expect(Object.keys(byCurrency).sort()).toEqual(['EUR', 'USD']);
    expect(byCurrency.EUR.estimatedModelCost).toBe('0.045');
    expect(byCurrency.USD.estimatedModelCost).toBe('0.045');
  });
});

describe('aggregation', () => {
  it('sums multiple requests and flags incomplete totals when pricing is missing', () => {
    const r = rule();
    const items = [
      usage({ cachedInputTokens: 4_000 }),
      usage({ promptTokens: 1_000_000, completionTokens: 0 }),
      usage({ modelName: 'unknown-model', requests: 3 }),
    ];
    const { byCurrency, missing } = aggregateCosts([r], items);
    const eur = byCurrency.EUR;
    expect(eur.estimatedModelCost).toBe('2.54');
    expect(eur.requests).toBe(2);
    expect(eur.promptTokens).toBe(1_010_000);
    expect(eur.cachedInputTokens).toBe(4_000);
    expect(eur.incomplete).toBe(true);
    expect(missing.missingPricingRequests).toBe(3);
    expect(missing.estimatedModelCost).toBe('0');
  });
});
