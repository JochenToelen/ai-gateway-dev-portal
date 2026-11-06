/**
 * AI model pricing domain. Prices are stored as decimal strings (never floats) and all arithmetic
 * is done with scaled integers (see decimal.ts).
 */

export type PricingMode = 'Standard' | 'Batch' | 'Provisioned' | 'Other';
export const PRICING_MODES: PricingMode[] = ['Standard', 'Batch', 'Provisioned', 'Other'];

export interface PricingRule {
  id: string;
  provider: string;
  modelName: string;
  /** optional: makes the rule more specific */
  deploymentName?: string;
  /** optional: makes the rule more specific */
  region?: string;
  pricingMode: PricingMode;
  /** decimal string, price per 1,000,000 tokens */
  inputPricePerMillion: string;
  cachedInputPricePerMillion: string;
  outputPricePerMillion: string;
  currency: string;
  /** ISO timestamp, inclusive */
  validFrom: string;
  /** ISO timestamp, exclusive; empty/undefined = open ended */
  validTo?: string;
  isActive: boolean;
  /** true for rules seeded from default prices; cleared when an administrator edits or re-prices the rule */
  needsReview?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingAuditEntry {
  at: string;
  user: string;
  action: 'create' | 'update' | 'deactivate' | 'reactivate' | 'supersede';
  ruleId: string;
  before: PricingRule | null;
  after: PricingRule | null;
}

/** The persisted, shared document */
export interface PricingDocument {
  schemaVersion: 1;
  /** single currency enforced for the whole table; null until the first rule is created */
  currency: string | null;
  rules: PricingRule[];
  audit: PricingAuditEntry[];
}

export const EMPTY_DOCUMENT: PricingDocument = { schemaVersion: 1, currency: null, rules: [], audit: [] };

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** subset of promptTokens; 0 when telemetry does not provide it */
  cachedInputTokens: number;
}

export interface PricingLookup {
  modelName: string;
  deploymentName?: string;
  region?: string;
  /** ISO timestamp of the request (TimeGenerated) */
  timestamp: string;
}

export type PricingStatus = 'Priced' | 'Missing';

export interface CostBreakdown {
  status: PricingStatus;
  ruleId: string | null;
  currency: string | null;
  nonCachedInputTokens: number;
  /** decimal strings; '0' when Missing */
  inputCost: string;
  cachedInputCost: string;
  outputCost: string;
  estimatedModelCost: string;
}

export interface UsageCostInput extends TokenUsage, PricingLookup {
  requests?: number;
}

export interface CostTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  pricedRequests: number;
  missingPricingRequests: number;
  inputCost: string;
  cachedInputCost: string;
  outputCost: string;
  estimatedModelCost: string;
  /** true when any request lacked pricing: the cost total is incomplete */
  incomplete: boolean;
}
