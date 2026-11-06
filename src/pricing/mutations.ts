import { supersedeRule, validateRule } from './engine';
import type { PricingAuditEntry, PricingDocument, PricingRule } from './types';

/** Editable fields of a rule (everything except identity/bookkeeping) */
export type RuleInput = Omit<PricingRule, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>;

export interface MutationResult {
  doc: PricingDocument;
  errors: string[];
}

const newId = () => `price-${crypto.randomUUID()}`;

function audit(doc: PricingDocument, entry: Omit<PricingAuditEntry, 'at'>, now: string): PricingAuditEntry[] {
  return [...doc.audit, { at: now, ...entry }];
}

const nz = (s?: string) => {
  const t = s?.trim();
  return t === '' ? undefined : t;
};

const clean = (i: RuleInput): RuleInput => ({
  ...i,
  provider: i.provider.trim(), modelName: i.modelName.trim(),
  deploymentName: nz(i.deploymentName), region: nz(i.region),
  currency: i.currency.trim().toUpperCase(), validTo: nz(i.validTo),
});

/** Records are never deleted: edits keep the id, deactivation keeps the row. */
export function createRule(doc: PricingDocument, input: RuleInput, user: string, now: string): MutationResult {
  const rule: PricingRule = { ...clean(input), id: newId(), isActive: true, createdAt: now, updatedAt: now };
  const { errors } = validateRule(rule, doc.rules, doc.currency);
  if (errors.length) return { doc, errors };
  return {
    doc: { ...doc, currency: doc.currency ?? rule.currency, rules: [...doc.rules, rule], audit: audit(doc, { user, action: 'create', ruleId: rule.id, before: null, after: rule }, now) },
    errors: [],
  };
}

export function updateRule(doc: PricingDocument, id: string, input: RuleInput, user: string, now: string): MutationResult {
  const before = doc.rules.find((r) => r.id === id);
  if (!before) return { doc, errors: ['Rule not found.'] };
  const after: PricingRule = { ...before, ...clean(input), needsReview: undefined, updatedAt: now };
  const { errors } = validateRule(after, doc.rules, doc.currency);
  if (errors.length) return { doc, errors };
  return {
    doc: { ...doc, rules: doc.rules.map((r) => (r.id === id ? after : r)), audit: audit(doc, { user, action: 'update', ruleId: id, before, after }, now) },
    errors: [],
  };
}

export function setRuleActive(doc: PricingDocument, id: string, isActive: boolean, user: string, now: string): MutationResult {
  const before = doc.rules.find((r) => r.id === id);
  if (!before) return { doc, errors: ['Rule not found.'] };
  const after: PricingRule = { ...before, isActive, updatedAt: now };
  const { errors } = validateRule(after, doc.rules, doc.currency);
  if (errors.length) return { doc, errors };
  return {
    doc: { ...doc, rules: doc.rules.map((r) => (r.id === id ? after : r)), audit: audit(doc, { user, action: isActive ? 'reactivate' : 'deactivate', ruleId: id, before, after }, now) },
    errors: [],
  };
}

/** New effective-dated price: ends the current rule at the new ValidFrom and adds the new one. */
export function addNewPrice(doc: PricingDocument, oldId: string, input: RuleInput, user: string, now: string): MutationResult {
  const before = doc.rules.find((r) => r.id === oldId);
  const next: PricingRule = { ...clean(input), id: newId(), isActive: true, createdAt: now, updatedAt: now };
  const res = supersedeRule(doc.rules, oldId, next, doc.currency, now);
  if (res.errors.length) return { doc, errors: res.errors };
  const ended = res.rules.find((r) => r.id === oldId) ?? null;
  return {
    doc: {
      ...doc, rules: res.rules,
      audit: audit(
        { ...doc, audit: audit(doc, { user, action: 'supersede', ruleId: oldId, before: before ?? null, after: ended }, now) },
        { user, action: 'create', ruleId: next.id, before: null, after: next }, now,
      ),
    },
    errors: [],
  };
}
