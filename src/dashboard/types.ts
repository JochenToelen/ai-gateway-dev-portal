/**
 * Normalized model for the AI Gateway consumption page.
 * Gateway usage comes from Log Analytics (APIM diagnostics); cost comes from Azure Cost Management.
 * The two are only joined by period, never per request, so cost per request/token is an estimate.
 */

export type Status = 'healthy' | 'attention' | 'critical' | 'nodata';
export type DeltaDirection = 'up-good' | 'down-good' | 'neutral';

/** One day of APIM-observed traffic for one dimension combination */
export interface GatewayRow {
  day: string;
  model: string;
  deployment: string;
  /** APIM subscription id; empty for anonymous traffic */
  subscription: string;
  api: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** HTTP >= 400 except 429 */
  failed: number;
  /** HTTP 429 */
  throttled: number;
  /** HTTP 401 / 403 */
  authFailures: number;
  latencySumMs: number;
}

export interface CostDay {
  day: string;
  resourceId: string;
  cost: number;
}

export interface TagCostDay {
  day: string;
  /** empty string = untagged */
  value: string;
  cost: number;
}

export interface BudgetInfo {
  name: string;
  /** normalised to a monthly amount */
  monthlyAmount: number;
  timeGrain: string;
  hasFilter: boolean;
}

export interface CostData {
  currency: string;
  daily: CostDay[];
  /** null when the tag query failed or the tag is not configured */
  tags: TagCostDay[] | null;
  tagKey: string;
  /** forecast for the rest of the current month; null when unavailable */
  forecastRemaining: number | null;
  budgets: BudgetInfo[] | null;
  scopeLabel: string;
}

export type SourceStatus = 'connected' | 'unavailable' | 'not-configured';

export interface SourceState {
  id: string;
  name: string;
  status: SourceStatus;
  detail: string;
}

export interface SubscriptionMeta {
  name: string;
  hasOwner: boolean;
}

export interface RawDashboardData {
  gateway: GatewayRow[] | null;
  cost: CostData | null;
  sources: SourceState[];
  apiNames: Record<string, string>;
  subscriptionMeta: Record<string, SubscriptionMeta>;
  loadedAt: string;
}

/* ---------------- Settings / thresholds ---------------- */

export interface DashboardSettings {
  /** empty = subscription of the selected APIM service */
  costSubscriptionId: string;
  costScope: 'ai' | 'all';
  tagKey: string;
  budgetName: string;
}

export interface Thresholds {
  budgetAttentionPct: number;
  budgetCriticalPct: number;
  unusualSpendPct: number;
  minDailySpend: number;
  unusualTokensPct: number;
  minDailyTokens: number;
  successSloPct: number;
  successCriticalPct: number;
  errorRateAttentionPct: number;
  errorRateCriticalPct: number;
  throttledAttentionPct: number;
  throttledCriticalPct: number;
  latencySloMs: number;
  latencyCriticalMs: number;
  untaggedSharePct: number;
  anonymousSharePct: number;
  authSpikePct: number;
  minAuthEvents: number;
  consumerTrendAttentionPct: number;
}

/* ---------------- View model ---------------- */

export interface DashboardFilters {
  period: 7 | 30 | 90;
  subscription: string;
  api: string;
  model: string;
  deployment: string;
}

export interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  delta: number | null;
  direction: DeltaDirection;
  status: Status;
  spark: number[];
  prominent: boolean;
  deltaSuffix?: string;
}

export interface Alert {
  id: string;
  severity: 'attention' | 'critical';
  category: 'Cost' | 'Consumption' | 'Reliability' | 'Governance';
  title: string;
  detail: string;
}

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  failed: number;
  throttled: number;
  authFailures: number;
  latencySumMs: number;
}

export interface UsageRow extends UsageTotals {
  key: string;
  subscription: string;
  api: string;
  model: string;
  deployment: string;
  prevTokens: number;
  /** token-weighted allocation of Cost Management spend; null when not computable */
  estCost: number | null;
  trendPct: number | null;
  status: Status;
}

export interface BudgetPoint {
  label: string;
  actual: number | null;
  forecast: number | null;
  budget: number | null;
}

export interface Breakdown {
  name: string;
  value: number;
  share: number;
}

export interface HealthMetric {
  key: string;
  label: string;
  value: string;
  target: string;
  status: Status;
}

export interface ModelHealth {
  model: string;
  requests: number;
  successPct: number;
  throttledPct: number;
  avgLatencyMs: number | null;
  status: Status;
}

export interface CoverageItem {
  label: string;
  value: string;
  detail: string;
  status: Status;
}

export interface DashboardModel {
  periodLabel: string;
  currency: string;
  kpis: Kpi[];
  alerts: Alert[];
  spendSeries: { label: string; cost: number | null; prevCost: number | null }[];
  tokenSeries: { label: string; prompt: number; completion: number; requests: number }[];
  budgetSeries: BudgetPoint[];
  budgetNote: string;
  costByResource: Breakdown[];
  costByTag: Breakdown[] | null;
  rows: UsageRow[];
  health: HealthMetric[];
  modelHealth: ModelHealth[];
  coverage: CoverageItem[];
  options: Record<'subscription' | 'api' | 'model' | 'deployment', string[]>;
  /** display names for ids */
  subscriptionNames: Record<string, string>;
  apiNames: Record<string, string>;
  hasCost: boolean;
  hasGateway: boolean;
}
