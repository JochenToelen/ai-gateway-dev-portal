import { describe, expect, it } from 'vitest';
import { buildCostQuery } from './kql';
import { addNewPrice, createRule, setRuleActive, type RuleInput } from './mutations';
import { buildConsumers, buildCostReport, parseCostRows } from './report';
import { EMPTY_DOCUMENT } from './types';

const input: RuleInput = {
  provider: 'Azure OpenAI', modelName: 'GPT-4o', pricingMode: 'Standard',
  inputPricePerMillion: '2.50', cachedInputPricePerMillion: '1.25', outputPricePerMillion: '10.00',
  currency: 'eur', validFrom: '2025-01-01T00:00:00.000Z',
};
const NOW = '2025-02-01T00:00:00.000Z';

describe('KQL cost query', () => {
  it('inlines only active rules as decimals and resolves by effective date and specificity', () => {
    const doc = createRule(EMPTY_DOCUMENT, input, 'a@x', NOW).doc;
    const off = setRuleActive(doc, doc.rules[0].id, false, 'a@x', NOW).doc;
    const q = buildCostQuery(doc.rules, { start: 'ago(7d)', models: ['gpt-4o'] });
    expect(q).toContain("'gpt-4o'");
    expect(q).toContain('decimal(2.50)');
    expect(q).toContain('TimeGenerated >= ValidFrom and (isnull(ValidTo) or TimeGenerated < ValidTo)');
    expect(q).toContain("| where Model in ('gpt-4o')");
    expect(buildCostQuery(off.rules, { start: 'ago(7d)' })).toContain('__none__');
  });

  it('escapes quotes in filters', () => {
    expect(buildCostQuery([], { start: 'ago(1d)', models: ["a'b"] })).toContain("'a''b'");
  });
});

describe('pricing mutations', () => {
  it('records old and new values and never deletes rules', () => {
    const created = createRule(EMPTY_DOCUMENT, input, 'a@x', NOW);
    expect(created.doc.currency).toBe('EUR');
    const id = created.doc.rules[0].id;
    const off = setRuleActive(created.doc, id, false, 'b@x', NOW);
    expect(off.doc.rules).toHaveLength(1);
    expect(off.doc.audit.map((a) => a.action)).toEqual(['create', 'deactivate']);
    expect(off.doc.audit[1].before?.isActive).toBe(true);
    expect(off.doc.audit[1].after?.isActive).toBe(false);
  });

  it('adds a new effective-dated price and end-dates the previous one', () => {
    const doc = createRule(EMPTY_DOCUMENT, input, 'a@x', NOW).doc;
    const res = addNewPrice(doc, doc.rules[0].id, { ...input, validFrom: '2025-03-01T00:00:00.000Z', inputPricePerMillion: '2.00' }, 'a@x', NOW);
    expect(res.errors).toEqual([]);
    expect(res.doc.rules).toHaveLength(2);
    expect(res.doc.rules[0].validTo).toBe('2025-03-01T00:00:00.000Z');
  });

  it('rejects a second currency', () => {
    const doc = createRule(EMPTY_DOCUMENT, input, 'a@x', NOW).doc;
    expect(createRule(doc, { ...input, modelName: 'other', currency: 'USD' }, 'a@x', NOW).errors.length).toBeGreaterThan(0);
  });
});

describe('cost report', () => {
  it('rolls up priced and unpriced rows and lists missing pricing with first/last seen', () => {
    const rows = parseCostRows([
      { Day: '2025-02-01', Model: 'gpt-4o', Deployment: 'd', Region: 'r', Subscription: 's', Api: 'a', Priced: 'true', Requests: 2, PromptTokens: 1000, CompletionTokens: 200, CachedTokens: 0, InCost: '0.0025', CachedCost: '0', OutCost: '0.002', FirstSeen: '2025-02-01T01:00:00Z', LastSeen: '2025-02-01T02:00:00Z' },
      { Day: '2025-02-01', Model: 'new-model', Deployment: 'd2', Region: 'r', Subscription: 's', Api: 'a', Priced: 'false', Requests: 5, PromptTokens: 500, CompletionTokens: 100, CachedTokens: 0, InCost: '0', CachedCost: '0', OutCost: '0', FirstSeen: '2025-02-01T03:00:00Z', LastSeen: '2025-02-01T04:00:00Z' },
      { Day: '2025-02-02', Model: 'new-model', Deployment: 'd2', Region: 'r', Subscription: 's', Api: 'a', Priced: 'false', Requests: 1, PromptTokens: 10, CompletionTokens: 10, CachedTokens: 0, InCost: '0', CachedCost: '0', OutCost: '0', FirstSeen: '2025-02-02T01:00:00Z', LastSeen: '2025-02-02T01:30:00Z' },
    ]);
    const r = buildCostReport(rows, 'EUR', 'day');
    expect(r.estimatedCost).toBeCloseTo(0.0045, 10);
    expect(r.incomplete).toBe(true);
    expect(r.missingRequests).toBe(6);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toMatchObject({ model: 'new-model', requests: 6, tokens: 620, firstSeen: '2025-02-01T03:00:00Z', lastSeen: '2025-02-02T01:30:00Z' });
    expect(r.avgCostPerRequest).toBeCloseTo(0.00225, 10);
    expect(buildCostReport(rows, 'EUR', 'month').series).toHaveLength(1);
  });
});

describe('consumers', () => {
  it('groups per subscription with a per-model breakdown', () => {
    const base = { Day: '2025-01-01', Deployment: 'd', Region: 'r', Api: 'a', Priced: 'true', Requests: 1, PromptTokens: 1000, CompletionTokens: 0, CachedTokens: 0, OutCost: '0', CachedCost: '0' };
    const rows = parseCostRows([
      { ...base, Subscription: 's1', Model: 'm1', InCost: '0.5' },
      { ...base, Subscription: 's1', Model: 'm2', InCost: '0.25' },
      { ...base, Subscription: 's2', Model: 'm1', InCost: '1' },
    ]);
    const c = buildConsumers(rows);
    expect(c).toHaveLength(2);
    const s1 = c.find((x) => x.name === 's1');
    expect(s1?.cost).toBe(0.75);
    expect(s1?.models.map((m) => m.name)).toEqual(['m1', 'm2']);
  });
});
