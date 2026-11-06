import type { MsalCredential } from '../../services/azure';
import { listBudgets, queryCostManagement, type CostQueryResult } from '../../services/azure';
import { addDays, daysInMonth, monthStart } from '../dates';
import type { BudgetInfo, CostDay, DashboardSettings, TagCostDay } from '../types';

const AI_RESOURCE_TYPE = 'microsoft.cognitiveservices/accounts';
const MONTHS_BACK = 5;

function isoDate(v: string | number | null): string {
  const s = String(v ?? '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

function col(result: CostQueryResult, ...names: string[]): number {
  const lower = result.columns.map((c) => c.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function costFilter(scope: DashboardSettings['costScope']) {
  return scope === 'ai'
    ? { dimensions: { name: 'ResourceType', operator: 'In', values: [AI_RESOURCE_TYPE] } }
    : undefined;
}

function body(from: string, to: string, grouping: object[], scope: DashboardSettings['costScope']) {
  return {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping,
      filter: costFilter(scope),
    },
  };
}

export function costWindow(today: string): { from: string; to: string } {
  let from = monthStart(today);
  for (let i = 0; i < MONTHS_BACK; i++) from = monthStart(addDays(from, -1));
  return { from, to: today };
}

export async function loadCostByResource(
  credential: MsalCredential, scopeId: string, settings: DashboardSettings, today: string,
): Promise<{ currency: string; daily: CostDay[] }> {
  const { from, to } = costWindow(today);
  const res = await queryCostManagement(credential, scopeId,
    body(from, to, [{ type: 'Dimension', name: 'ResourceId' }], settings.costScope));
  const ci = col(res, 'Cost', 'PreTaxCost');
  const di = col(res, 'UsageDate');
  const ri = col(res, 'ResourceId');
  const cu = col(res, 'Currency');
  if (ci < 0 || di < 0) throw new Error('Unexpected Cost Management response shape');
  const daily = res.rows.map((r) => ({
    day: isoDate(r[di]),
    resourceId: ri >= 0 ? String(r[ri] ?? '') : '',
    cost: Number(r[ci] ?? 0),
  }));
  const currency = cu >= 0 ? String(res.rows[0]?.[cu] ?? '') : '';
  return { currency, daily };
}

export async function loadCostByTag(
  credential: MsalCredential, scopeId: string, settings: DashboardSettings, today: string,
): Promise<TagCostDay[]> {
  const { from, to } = costWindow(today);
  const res = await queryCostManagement(credential, scopeId,
    body(from, to, [{ type: 'TagKey', name: settings.tagKey }], settings.costScope));
  const ci = col(res, 'Cost', 'PreTaxCost');
  const di = col(res, 'UsageDate');
  const vi = col(res, 'TagValue', settings.tagKey);
  if (ci < 0 || di < 0) throw new Error('Unexpected Cost Management response shape');
  return res.rows.map((r) => ({
    day: isoDate(r[di]),
    value: vi >= 0 ? String(r[vi] ?? '').trim() : '',
    cost: Number(r[ci] ?? 0),
  }));
}

/** Forecast for the remainder of the current month, or throws if Cost Management cannot forecast. */
export async function loadForecastRemaining(
  credential: MsalCredential, scopeId: string, settings: DashboardSettings, today: string,
): Promise<number> {
  const from = monthStart(today);
  const to = `${today.slice(0, 8)}${String(daysInMonth(today)).padStart(2, '0')}`;
  const req = {
    ...body(from, to, [], settings.costScope),
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      filter: costFilter(settings.costScope),
    },
  };
  const res = await queryCostManagement(credential, scopeId, {
    ...req, includeActualCost: true, includeFreshPartialCost: false,
  }, 'forecast');
  const ci = col(res, 'Cost', 'PreTaxCost');
  const si = col(res, 'CostStatus');
  if (ci < 0 || si < 0) throw new Error('Unexpected forecast response shape');
  return res.rows
    .filter((r) => String(r[si]).toLowerCase() === 'forecast')
    .reduce((s, r) => s + Number(r[ci] ?? 0), 0);
}

const GRAIN_DIVISOR: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };

export async function loadBudgetInfo(credential: MsalCredential, scopeId: string): Promise<BudgetInfo[]> {
  const budgets = await listBudgets(credential, scopeId);
  return budgets.map((b) => ({
    name: b.name,
    monthlyAmount: b.amount / (GRAIN_DIVISOR[b.timeGrain.toLowerCase()] ?? 1),
    timeGrain: b.timeGrain,
    hasFilter: b.hasFilter,
  }));
}
