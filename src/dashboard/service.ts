import { buildAlerts } from './alerts';
import { addDays, daysInMonth, monthLabel, monthStart, shortLabel } from './dates';
import { compact, money, num, pct } from './format';
import type {
  Breakdown, BudgetInfo, BudgetPoint, CostData, CoverageItem, DashboardFilters, DashboardModel,
  GatewayRow, HealthMetric, Kpi, ModelHealth, RawDashboardData, Status, Thresholds, UsageRow, UsageTotals,
} from './types';

export const ALL = 'All';
export const DEFAULT_FILTERS: DashboardFilters = {
  period: 30, subscription: ALL, api: ALL, model: ALL, deployment: ALL,
};
export const ANONYMOUS = '(no subscription)';

export type UsageDim = 'subscription' | 'api' | 'model' | 'deployment';

const zero = (): UsageTotals => ({
  requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0, failed: 0, throttled: 0, authFailures: 0, latencySumMs: 0,
});

function add(t: UsageTotals, r: GatewayRow): UsageTotals {
  t.requests += r.requests;
  t.promptTokens += r.promptTokens;
  t.completionTokens += r.completionTokens;
  t.tokens += r.promptTokens + r.completionTokens;
  t.failed += r.failed;
  t.throttled += r.throttled;
  t.authFailures += r.authFailures;
  t.latencySumMs += r.latencySumMs;
  return t;
}

const totalsOf = (rows: GatewayRow[]) => rows.reduce(add, zero());
const inRange = (day: string, from: string, to: string) => day >= from && day <= to;
const delta = (cur: number, prev: number) => (prev > 0 ? (cur / prev - 1) * 100 : null);
const successPct = (t: UsageTotals) => (t.requests ? ((t.requests - t.failed - t.throttled) / t.requests) * 100 : 100);

function high(v: number, attn: number, crit: number): Status {
  return v >= crit ? 'critical' : v >= attn ? 'attention' : 'healthy';
}
function low(v: number, attn: number, crit: number): Status {
  return v < crit ? 'critical' : v < attn ? 'attention' : 'healthy';
}
const worst = (...s: Status[]): Status =>
  s.includes('critical') ? 'critical' : s.includes('attention') ? 'attention' : 'healthy';

function days(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

function breakdown(map: Map<string, number>, limit = 8): Breakdown[] {
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  return [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value, share: total ? (value / total) * 100 : 0 }));
}

export function groupUsage(rows: UsageRow[], dim: UsageDim): { name: string; tokens: number; requests: number; estCost: number | null }[] {
  const m = new Map<string, { name: string; tokens: number; requests: number; estCost: number | null }>();
  for (const r of rows) {
    const name = r[dim] || ANONYMOUS;
    const g = m.get(name) ?? { name, tokens: 0, requests: 0, estCost: null };
    g.tokens += r.tokens;
    g.requests += r.requests;
    if (r.estCost !== null) g.estCost = (g.estCost ?? 0) + r.estCost;
    m.set(name, g);
  }
  return [...m.values()].sort((a, b) => b.tokens - a.tokens);
}

function pickBudget(cost: CostData | null, name: string): BudgetInfo | null {
  const list = cost?.budgets ?? [];
  return list.find((b) => b.name === name) ?? list[0] ?? null;
}

/** Pure aggregation: raw connector data + filters + thresholds -> everything the page renders. */
export function buildDashboard(
  raw: RawDashboardData, filters: DashboardFilters, t: Thresholds, budgetName: string, today: string,
): DashboardModel {
  const n = filters.period;
  const to = addDays(today, -1);
  const curFrom = addDays(to, -(n - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const curDays = days(curFrom, n);
  const prevDays = days(prevFrom, n);

  const gwAll = raw.gateway ?? [];
  const hasGateway = raw.gateway !== null;
  const cost = raw.cost;
  const hasCost = cost !== null;
  const currency = cost?.currency ?? '';

  const matches = (r: GatewayRow) =>
    (filters.subscription === ALL || r.subscription === filters.subscription || (filters.subscription === ANONYMOUS && !r.subscription)) &&
    (filters.api === ALL || r.api === filters.api) &&
    (filters.model === ALL || r.model === filters.model) &&
    (filters.deployment === ALL || r.deployment === filters.deployment);
  const gw = gwAll.filter(matches);
  const curRows = gw.filter((r) => inRange(r.day, curFrom, to));
  const prevRows = gw.filter((r) => inRange(r.day, prevFrom, prevTo));
  const cur = totalsOf(curRows);
  const prev = totalsOf(prevRows);
  const curAll = totalsOf(gwAll.filter((r) => inRange(r.day, curFrom, to)));

  /* ---------- cost ---------- */
  const costByDay = new Map<string, number>();
  for (const c of cost?.daily ?? []) costByDay.set(c.day, (costByDay.get(c.day) ?? 0) + c.cost);
  const sumCost = (list: string[]) => list.reduce((s, d) => s + (costByDay.get(d) ?? 0), 0);
  const costCur = sumCost(curDays);
  const costPrev = sumCost(prevDays);

  const allocate = (tokens: number): number | null =>
    hasCost && curAll.tokens > 0 ? (costCur * tokens) / curAll.tokens : null;

  const spendSeries = curDays.map((d, i) => ({
    label: shortLabel(d),
    cost: hasCost ? (costByDay.get(d) ?? 0) : null,
    prevCost: hasCost ? (costByDay.get(prevDays[i]) ?? 0) : null,
  }));

  const byDayGw = new Map<string, UsageTotals>();
  for (const r of gw) byDayGw.set(r.day, add(byDayGw.get(r.day) ?? zero(), r));
  const tokenSeries = curDays.map((d) => {
    const t0 = byDayGw.get(d);
    return { label: shortLabel(d), prompt: t0?.promptTokens ?? 0, completion: t0?.completionTokens ?? 0, requests: t0?.requests ?? 0 };
  });

  /* ---------- forecast & budget ---------- */
  const mStart = monthStart(today);
  const dim = daysInMonth(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const mtd = sumCost(days(mStart, dayOfMonth));
  const last7 = sumCost(days(addDays(to, -6), 7)) / 7;
  const forecastEstimate = cost?.forecastRemaining == null;
  const remaining = cost?.forecastRemaining ?? last7 * (dim - dayOfMonth);
  const forecastTotal = mtd + remaining;
  const budget = pickBudget(cost, budgetName);
  const ratio = budget && budget.monthlyAmount > 0 ? (forecastTotal / budget.monthlyAmount) * 100 : null;

  const budgetSeries: BudgetPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    let ms = mStart;
    for (let k = 0; k < i; k++) ms = monthStart(addDays(ms, -1));
    const isCurrent = i === 0;
    budgetSeries.push({
      label: monthLabel(ms),
      actual: hasCost ? sumCost(days(ms, isCurrent ? dayOfMonth : daysInMonth(ms))) : null,
      forecast: hasCost && isCurrent ? forecastTotal : null,
      budget: budget ? budget.monthlyAmount : null,
    });
  }
  const budgetNote = !hasCost ? 'Cost Management unavailable'
    : !budget ? 'No budget found at this scope'
      : `Budget "${budget.name}" (${budget.timeGrain.toLowerCase()}, shown per month)${budget.hasFilter ? ' · budget has its own filter, which may differ from this cost scope' : ''}${forecastEstimate ? ' · forecast = run-rate estimate' : ''}`;

  /* ---------- cost breakdowns ---------- */
  const resMap = new Map<string, number>();
  for (const c of cost?.daily ?? []) {
    if (!inRange(c.day, curFrom, to)) continue;
    const name = c.resourceId.split('/').filter(Boolean).pop() ?? '(unknown)';
    resMap.set(name, (resMap.get(name) ?? 0) + c.cost);
  }
  let costByTag: Breakdown[] | null = null;
  let untaggedShare: number | null = null;
  if (cost?.tags) {
    const m = new Map<string, number>();
    let total = 0;
    let untagged = 0;
    for (const c of cost.tags) {
      if (!inRange(c.day, curFrom, to)) continue;
      m.set(c.value || '(untagged)', (m.get(c.value || '(untagged)') ?? 0) + c.cost);
      total += c.cost;
      if (!c.value) untagged += c.cost;
    }
    costByTag = breakdown(m);
    untaggedShare = total > 0 ? (untagged / total) * 100 : null;
  }

  /* ---------- usage rows ---------- */
  const keyOf = (r: GatewayRow) => [r.subscription, r.api, r.model, r.deployment].join('\u0001');
  const prevTok = new Map<string, number>();
  for (const r of prevRows) prevTok.set(keyOf(r), (prevTok.get(keyOf(r)) ?? 0) + r.promptTokens + r.completionTokens);
  const grouped = new Map<string, UsageRow>();
  for (const r of curRows) {
    const k = keyOf(r);
    const g = grouped.get(k) ?? {
      ...zero(), key: k, subscription: r.subscription, api: r.api, model: r.model, deployment: r.deployment,
      prevTokens: prevTok.get(k) ?? 0, estCost: null, trendPct: null, status: 'healthy' as Status,
    };
    add(g, r);
    grouped.set(k, g);
  }
  const rows = [...grouped.values()].map((g) => {
    g.estCost = allocate(g.tokens);
    g.trendPct = delta(g.tokens, g.prevTokens);
    const base: Status[] = [];
    if (g.requests >= 20) {
      base.push(low(successPct(g), t.successSloPct, t.successCriticalPct));
      base.push(high((g.throttled / g.requests) * 100, t.throttledAttentionPct, t.throttledCriticalPct));
    }
    if (g.trendPct !== null && g.trendPct >= t.consumerTrendAttentionPct) base.push('attention');
    g.status = worst(...base);
    return g;
  }).sort((a, b) => b.tokens - a.tokens);

  /* ---------- health ---------- */
  const succ = successPct(cur);
  const errPct = cur.requests ? (cur.failed / cur.requests) * 100 : 0;
  const thrPct = cur.requests ? (cur.throttled / cur.requests) * 100 : 0;
  const avgLat = cur.requests ? cur.latencySumMs / cur.requests : null;
  const noReq = cur.requests === 0;
  const health: HealthMetric[] = [
    { key: 'success', label: 'Success rate', value: noReq ? '—' : pct(succ, 2), target: `target ≥ ${pct(t.successSloPct)}`, status: noReq ? 'nodata' : low(succ, t.successSloPct, t.successCriticalPct) },
    { key: 'error', label: 'Error rate', value: noReq ? '—' : pct(errPct, 2), target: `target < ${pct(t.errorRateAttentionPct)}`, status: noReq ? 'nodata' : high(errPct, t.errorRateAttentionPct, t.errorRateCriticalPct) },
    { key: 'throttled', label: 'Throttled requests', value: noReq ? '—' : `${pct(thrPct, 2)} (${compact(cur.throttled)})`, target: `target < ${pct(t.throttledAttentionPct)}`, status: noReq ? 'nodata' : high(thrPct, t.throttledAttentionPct, t.throttledCriticalPct) },
    { key: 'latency', label: 'Average latency', value: avgLat === null ? '—' : `${Math.round(avgLat).toString()} ms`, target: `target < ${t.latencySloMs.toString()} ms`, status: avgLat === null ? 'nodata' : high(avgLat, t.latencySloMs, t.latencyCriticalMs) },
  ];

  const mh = new Map<string, UsageTotals>();
  for (const r of curRows) mh.set(r.model, add(mh.get(r.model) ?? zero(), r));
  const modelHealth: ModelHealth[] = [...mh.entries()].map(([model, m]) => ({
    model,
    requests: m.requests,
    successPct: successPct(m),
    throttledPct: m.requests ? (m.throttled / m.requests) * 100 : 0,
    avgLatencyMs: m.requests ? m.latencySumMs / m.requests : null,
    status: m.requests < 20 ? 'healthy' : worst(low(successPct(m), t.successSloPct, t.successCriticalPct),
      high(m.latencySumMs / m.requests, t.latencySloMs, t.latencyCriticalMs)),
  })).sort((a, b) => b.requests - a.requests).slice(0, 10);

  /* ---------- governance coverage ---------- */
  const anonReq = curRows.filter((r) => !r.subscription).reduce((s, r) => s + r.requests, 0);
  const anonShare = cur.requests ? (anonReq / cur.requests) * 100 : null;
  const activeSubs = [...new Set(curRows.filter((r) => r.subscription).map((r) => r.subscription))];
  const noOwner = activeSubs.filter((s) => raw.subscriptionMeta[s] && !raw.subscriptionMeta[s].hasOwner);
  const unknownSubs = activeSubs.filter((s) => !raw.subscriptionMeta[s]);
  const coverage: CoverageItem[] = [
    {
      label: 'Requests attributed to an APIM subscription',
      value: anonShare === null ? '—' : pct(100 - anonShare),
      detail: anonShare === null ? 'No gateway traffic observed' : `${num(anonReq)} request(s) have no subscription id`,
      status: anonShare === null ? 'nodata' : high(anonShare, t.anonymousSharePct, t.anonymousSharePct * 5),
    },
    {
      label: 'Active subscriptions without an owner',
      value: hasGateway ? num(noOwner.length) : '—',
      detail: !hasGateway ? 'Gateway logs unavailable'
        : `${num(activeSubs.length)} active subscription(s)${unknownSubs.length ? `, ${num(unknownSubs.length)} not found in APIM (deleted or built-in)` : ''}`,
      status: !hasGateway ? 'nodata' : noOwner.length > 0 ? 'attention' : 'healthy',
    },
    {
      label: '401 / 403 responses',
      value: hasGateway ? num(cur.authFailures) : '—',
      detail: hasGateway ? `${num(prev.authFailures)} in previous period (authentication / authorisation rejections, not Content Safety)` : 'Gateway logs unavailable',
      status: !hasGateway ? 'nodata' : 'healthy',
    },
    {
      label: '429 throttled responses',
      value: hasGateway ? num(cur.throttled) : '—',
      detail: hasGateway ? `${num(prev.throttled)} in previous period (rate-limit or token-quota policies)` : 'Gateway logs unavailable',
      status: !hasGateway ? 'nodata' : 'healthy',
    },
  ];

  /* ---------- KPIs ---------- */
  const spendSpark = spendSeries.map((p) => p.cost ?? 0);
  const tokSpark = tokenSeries.map((p) => p.prompt + p.completion);
  const dayActive = (list: UsageRow[] | GatewayRow[]) => new Set(list.map((r) => `${r.api}|${r.deployment}`));
  const activeNow = dayActive(curRows.filter((r) => r.requests > 0));
  const activePrev = dayActive(prevRows.filter((r) => r.requests > 0));
  const succSpark = curDays.map((d) => { const x = byDayGw.get(d); return x ? successPct(x) : 100; });
  const attrib = anonShare === null ? null : 100 - anonShare;

  const kpis: Kpi[] = [
    {
      key: 'spend', label: 'Actual spend', prominent: true, direction: 'down-good', spark: spendSpark,
      value: hasCost ? money(costCur) : '—',
      sub: hasCost ? `Cost Management · ${cost.scopeLabel}` : 'Cost Management unavailable',
      delta: hasCost ? delta(costCur, costPrev) : null, status: hasCost ? 'healthy' : 'nodata',
    },
    {
      key: 'forecast', label: 'Forecast vs budget', prominent: true, direction: 'down-good',
      spark: budgetSeries.map((b) => b.actual ?? 0),
      value: hasCost ? money(forecastTotal) : '—',
      sub: !hasCost ? 'Cost Management unavailable'
        : `${forecastEstimate ? 'Run-rate estimate' : 'Forecast'} for ${monthLabel(mStart)}${budget ? ` · budget ${money(budget.monthlyAmount)}` : ' · no budget found'}`,
      delta: ratio === null ? null : ratio - 100, deltaSuffix: 'vs budget',
      status: !hasCost ? 'nodata' : ratio === null ? 'nodata' : high(ratio, t.budgetAttentionPct, t.budgetCriticalPct),
    },
    {
      key: 'consumption', label: 'Gateway consumption', prominent: false, direction: 'neutral', spark: tokSpark,
      value: hasGateway ? `${compact(cur.tokens)} tokens` : '—',
      sub: hasGateway ? `${compact(cur.requests)} requests observed by APIM` : 'Gateway logs unavailable',
      delta: hasGateway ? delta(cur.tokens, prev.tokens) : null, status: hasGateway ? 'healthy' : 'nodata',
    },
    {
      key: 'active', label: 'Active APIs / deployments observed', prominent: false, direction: 'neutral', spark: [],
      value: hasGateway ? num(activeNow.size) : '—',
      sub: hasGateway ? `${num(new Set(curRows.map((r) => r.api)).size)} APIs · ${num(new Set(curRows.map((r) => r.deployment)).size)} deployments · ${num(new Set(curRows.map((r) => r.model)).size)} models` : 'Gateway logs unavailable',
      delta: hasGateway ? delta(activeNow.size, activePrev.size) : null, status: hasGateway ? 'healthy' : 'nodata',
    },
    {
      key: 'success', label: 'Observed success rate', prominent: false, direction: 'up-good', spark: succSpark,
      value: noReq ? '—' : pct(succ, 2), sub: 'HTTP outcomes at the gateway, not provider availability',
      delta: prev.requests ? succ - successPct(prev) : null, deltaSuffix: 'pts vs prev.',
      status: noReq ? 'nodata' : low(succ, t.successSloPct, t.successCriticalPct),
    },
    {
      key: 'attribution', label: 'Usage attribution', prominent: true, direction: 'up-good', spark: [],
      value: attrib === null ? '—' : pct(attrib, 1),
      sub: attrib === null ? 'No gateway traffic' : 'Requests carrying an APIM subscription id',
      delta: null, status: anonShare === null ? 'nodata' : high(anonShare, t.anonymousSharePct, t.anonymousSharePct * 5),
    },
  ];

  /* ---------- alerts ---------- */
  const win = (get: (d: string) => number) => days(addDays(to, -16), 17).map(get);
  const alerts = buildAlerts({
    t, hasGateway, hasCost, cur, prev,
    spendDaily: win((d) => costByDay.get(d) ?? 0),
    tokensDaily: win((d) => byDayGw.get(d)?.tokens ?? 0),
    budget: budget ? { name: budget.name, monthly: budget.monthlyAmount, forecast: forecastTotal, estimate: forecastEstimate } : null,
    untaggedSharePct: untaggedShare,
    anonymousSharePct: anonShare,
    subscriptionsWithoutOwner: noOwner.length,
  });

  const uniq = (f: (r: GatewayRow) => string) => [ALL, ...[...new Set(gwAll.map(f))].filter(Boolean).sort()];
  const subOptions = [...new Set(gwAll.map((r) => r.subscription || ANONYMOUS))].sort();
  const subscriptionNames: Record<string, string> = { [ANONYMOUS]: ANONYMOUS };
  for (const [id, m] of Object.entries(raw.subscriptionMeta)) subscriptionNames[id] = m.name;

  return {
    periodLabel: `${shortLabel(curFrom)} – ${shortLabel(to)} (${n.toString()} days, vs previous ${n.toString()})`,
    currency, kpis, alerts, spendSeries, tokenSeries, budgetSeries, budgetNote,
    costByResource: breakdown(resMap), costByTag, rows, health, modelHealth, coverage,
    options: { subscription: [ALL, ...subOptions], api: uniq((r) => r.api), model: uniq((r) => r.model), deployment: uniq((r) => r.deployment) },
    subscriptionNames, apiNames: raw.apiNames, hasCost, hasGateway,
  };
}
