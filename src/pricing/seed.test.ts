import { describe, expect, it } from 'vitest';
import { defaultPriceFor } from './defaults';
import { createRule, updateRule } from './mutations';
import { seedObservedModels } from './seed';
import { EMPTY_DOCUMENT } from './types';

const NOW = '2026-11-06T10:00:00.000Z';
const observed = (...names: string[]) => names.map((modelName) => ({ modelName, firstSeen: '2026-10-01T13:45:00.000Z' }));

describe('default prices', () => {
  it('matches known names with a version suffix but never a different variant', () => {
    expect(defaultPriceFor('gpt-4o-2024-08-06')?.input).toBe('2.3');
    expect(defaultPriceFor('GPT-4o-mini-2024-07-18')?.input).toBe('0.138');
    expect(defaultPriceFor('gpt-4o-audio-preview')).toBeNull();
    expect(defaultPriceFor('some-new-model')).toBeNull();
  });
});

describe('seeding logged models', () => {
  it('adds default-priced rules flagged for review, valid from the first observed day', () => {
    const res = seedObservedModels(EMPTY_DOCUMENT, observed('gpt-4o', 'mystery-model'), 'u', NOW);
    expect(res.added).toEqual(['gpt-4o']);
    expect(res.unknown).toEqual(['mystery-model']);
    expect(res.doc.currency).toBe('EUR');
    expect(res.doc.rules[0]).toMatchObject({ needsReview: true, validFrom: '2026-10-01T00:00:00.000Z', outputPricePerMillion: '9.2' });
    expect(res.doc.audit).toHaveLength(1);
  });

  it('never touches models that already have a rule', () => {
    const manual = createRule(EMPTY_DOCUMENT, {
      provider: 'Azure OpenAI', modelName: 'GPT-4o', pricingMode: 'Standard', inputPricePerMillion: '9', cachedInputPricePerMillion: '9',
      outputPricePerMillion: '9', currency: 'EUR', validFrom: '2026-01-01T00:00:00.000Z',
    }, 'u', NOW).doc;
    const res = seedObservedModels(manual, observed('gpt-4o'), 'u', NOW);
    expect(res.added).toEqual([]);
    expect(res.doc).toBe(manual);
  });

  it('does not mix currencies', () => {
    const usd = createRule(EMPTY_DOCUMENT, {
      provider: 'x', modelName: 'other', pricingMode: 'Standard', inputPricePerMillion: '1', cachedInputPricePerMillion: '1',
      outputPricePerMillion: '1', currency: 'USD', validFrom: '2026-01-01T00:00:00.000Z',
    }, 'u', NOW).doc;
    const res = seedObservedModels(usd, observed('gpt-4o'), 'u', NOW);
    expect(res.currencyMismatch).toBe(true);
    expect(res.doc.rules).toHaveLength(1);
  });

  it('clears the review flag when an administrator edits the rule', () => {
    const seeded = seedObservedModels(EMPTY_DOCUMENT, observed('gpt-4o'), 'u', NOW).doc;
    const r = seeded.rules[0];
    const edited = updateRule(seeded, r.id, { ...r, inputPricePerMillion: '2.75' }, 'admin', NOW);
    expect(edited.errors).toEqual([]);
    expect(edited.doc.rules[0].needsReview).toBeUndefined();
  });
});
