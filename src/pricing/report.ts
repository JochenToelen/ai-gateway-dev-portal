import { addCosts } from './decimal';

type Row = Record<string, string | number | null>;

/** One day of usage for one dimension combination, already priced by Log Analytics */
export interface CostRow {
  day: string;
  model: string;
  deployment: string;
  region: string;
  subscription: string;
  api: string;
  priced: boolean;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  inputCost: string;
  cachedInputCost: string;
  outputCost: string;
  firstSeen: string;
  lastSeen: string;
}

export function parseCostRows(rows: Row[]): CostRow[] {
  return rows.map((r) => ({
    day: String(r.Day ?? ''),
    model: String(r.Model ?? ''),
    deployment: String(r.Deployment ?? ''),
    region: String(r.Region ?? ''),
    subscription: String(r.Subscription ?? ''),
    api: String(r.Api ?? ''),
    priced: String(r.Priced).toLowerCase() === 'true' || r.Priced === 1,
    requests: Number(r.Requests ?? 0),
    promptTokens: Number(r.PromptTokens ?? 0),
    completionTokens: Number(r.CompletionTokens ?? 0),
    cachedTokens: Number(r.CachedTokens ?? 0),
    inputCost: decimalText(r.InCost),
    cachedInputCost: decimalText(r.CachedCost),
    outputCost: decimalText(r.OutCost),
    firstSeen: String(r.FirstSeen ?? ''),
    lastSeen: String(r.LastSeen ?? ''),
  }));
}

function decimalText(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '0';
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? s : Number(s).toFixed(10);
}

/* ---------------- Client-side roll-up of the already-aggregated rows ---------------- */

export type CostBin = 'day' | 'week' | 'month';

export interface CostGroup {
  name: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  cost: number;
  avgCostPerRequest: number | null;
  /** requests in this group that had no price: its cost is incomplete */
  missingRequests: number;
}

export interface MissingPricingItem {
  model: string;
  deployment: string;
  region: string;
  requests: number;
  tokens: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CostReport {
  currency: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  tokens: number;
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  estimatedCost: number;
  avgCostPerRequest: number | null;
  costPer1MTokens: number | null;
  pricedRequests: number;
  missingRequests: number;
  incomplete: boolean;
  series: { label: string; cost: number; missing: number }[];
  byModel: CostGroup[];
  byDeployment: CostGroup[];
  byRegion: CostGroup[];
  bySubscription: CostGroup[];
  byApi: CostGroup[];
  missing: MissingPricingItem[];
}

/** Picks day / week / month buckets from the length of the selected range */
export function pickBin(spanDays: number): CostBin {
  if (spanDays > 120) return 'month';
  if (spanDays > 45) return 'week';
  return 'day';
}

function bucket(day: string, bin: CostBin): string {
  if (bin === 'month') return day.slice(0, 7);
  if (bin === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    const shift = (d.getUTCDay() + 6) % 7; // Monday start
    d.setUTCDate(d.getUTCDate() - shift);
    return d.toISOString().slice(0, 10);
  }
  return day;
}

interface Acc { requests: number; prompt: number; completion: number; cost: string; missing: number }

const rowCost = (r: CostRow) => addCosts(addCosts(r.inputCost, r.cachedInputCost), r.outputCost);

function group(rows: CostRow[], key: (r: CostRow) => string): CostGroup[] {
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const k = key(r);
    const a = map.get(k) ?? { requests: 0, prompt: 0, completion: 0, cost: '0', missing: 0 };
    a.requests += r.requests;
    a.prompt += r.promptTokens;
    a.completion += r.completionTokens;
    a.cost = addCosts(a.cost, rowCost(r));
    if (!r.priced) a.missing += r.requests;
    map.set(k, a);
  }
  return [...map.entries()].map(([name, a]) => ({
    name, requests: a.requests, promptTokens: a.prompt, completionTokens: a.completion,
    tokens: a.prompt + a.completion, cost: Number(a.cost), missingRequests: a.missing,
    avgCostPerRequest: a.requests - a.missing > 0 ? Number(a.cost) / (a.requests - a.missing) : null,
  })).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

/** One APIM subscription/consumer with its totals and a per-model breakdown */
export interface ConsumerGroup extends CostGroup {
  models: CostGroup[];
}

export function buildConsumers(rows: CostRow[]): ConsumerGroup[] {
  const bySub = new Map<string, CostRow[]>();
  for (const r of rows) {
    const k = r.subscription || '(anonymous)';
    bySub.set(k, [...(bySub.get(k) ?? []), r]);
  }
  return [...bySub.entries()].map(([name, subRows]) => ({
    ...(group(subRows, () => name)[0]), name, models: group(subRows, (r) => r.model),
  }));
}

export function buildCostReport(rows: CostRow[], currency: string, bin: CostBin): CostReport {
  let input = '0', cachedIn = '0', output = '0';
  let requests = 0, missingRequests = 0, prompt = 0, completion = 0, cachedTokens = 0, pricedTokens = 0;
  const series = new Map<string, { cost: string; missing: number }>();
  const missingMap = new Map<string, MissingPricingItem>();
  for (const r of rows) {
    requests += r.requests;
    prompt += r.promptTokens;
    completion += r.completionTokens;
    cachedTokens += r.cachedTokens;
    input = addCosts(input, r.inputCost);
    cachedIn = addCosts(cachedIn, r.cachedInputCost);
    output = addCosts(output, r.outputCost);
    const b = bucket(r.day, bin);
    const s = series.get(b) ?? { cost: '0', missing: 0 };
    s.cost = addCosts(s.cost, rowCost(r));
    if (r.priced) {
      pricedTokens += r.promptTokens + r.completionTokens;
    } else {
      s.missing += r.requests;
      missingRequests += r.requests;
      const k = `${r.model}|${r.deployment}|${r.region}`;
      const m = missingMap.get(k) ?? { model: r.model, deployment: r.deployment, region: r.region, requests: 0, tokens: 0, firstSeen: r.firstSeen, lastSeen: r.lastSeen };
      m.requests += r.requests;
      m.tokens += r.promptTokens + r.completionTokens;
      if (r.firstSeen && r.firstSeen < m.firstSeen) m.firstSeen = r.firstSeen;
      if (r.lastSeen > m.lastSeen) m.lastSeen = r.lastSeen;
      missingMap.set(k, m);
    }
    series.set(b, s);
  }
  const total = addCosts(addCosts(input, cachedIn), output);
  const pricedRequests = requests - missingRequests;
  return {
    currency, requests, promptTokens: prompt, completionTokens: completion, cachedTokens, tokens: prompt + completion,
    inputCost: Number(input), cachedInputCost: Number(cachedIn), outputCost: Number(output), estimatedCost: Number(total),
    avgCostPerRequest: pricedRequests > 0 ? Number(total) / pricedRequests : null,
    costPer1MTokens: pricedTokens > 0 ? (Number(total) / pricedTokens) * 1_000_000 : null,
    pricedRequests, missingRequests, incomplete: missingRequests > 0,
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, s]) => ({ label, cost: Number(s.cost), missing: s.missing })),
    byModel: group(rows, (r) => r.model),
    byDeployment: group(rows, (r) => r.deployment),
    byRegion: group(rows, (r) => r.region),
    bySubscription: group(rows, (r) => r.subscription || '(anonymous)'),
    byApi: group(rows, (r) => r.api || '(unknown)'),
    missing: [...missingMap.values()].sort((a, b) => b.requests - a.requests),
  };
}
