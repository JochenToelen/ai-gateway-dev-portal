import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useAzure } from '../context/AzureContext';
import { usePricingStore } from '../pricing/usePricingStore';
import { loadCostRows } from '../pricing/load';
import { buildCostReport, pickBin, type CostGroup, type CostReport, type CostRow } from '../pricing/report';
import type { CostQueryFilters } from '../pricing/kql';
import { formatMoney, formatMoneyAuto } from '../pricing/format';
import { compact, num } from '../dashboard/format';
import type { Kpi } from '../dashboard/types';
import KpiCard from './exec/KpiCard';
import TrendChart from './exec/TrendChart';
import { Card, Pill } from './exec/ExecWidgets';

interface Props {
  apimResourceId: string;
  /** the host page's current filters, translated to KQL */
  filters: CostQueryFilters;
  /** length of the selected range, used to pick day / week / month buckets */
  spanDays: number;
  /** change to force a reload */
  refreshKey?: string | number;
  subscriptionNames?: Record<string, string>;
  apiNames?: Record<string, string>;
  /** hands the priced aggregates to the host page, e.g. for the all-consumers table */
  onData?: (data: { rows: CostRow[]; currency: string } | null) => void;
}

type Dim = 'model' | 'deployment' | 'region' | 'api' | 'subscription';
const DIMS: { key: Dim; label: string }[] = [
  { key: 'model', label: 'Model' }, { key: 'deployment', label: 'Deployment' }, { key: 'region', label: 'Region' },
  { key: 'api', label: 'API' }, { key: 'subscription', label: 'Subscription / consumer' },
];

const kpi = (key: string, label: string, value: string, sub: string, status: Kpi['status'] = 'healthy'): Kpi => ({
  key, label, value, sub, delta: null, direction: 'neutral', status, spark: [], prominent: false, deltaSuffix: '',
});

/**
 * Estimated AI model cost for the host page's filters. Pricing is resolved inside Log Analytics
 * (see pricing/kql.ts); the browser only receives daily aggregates.  Cost is broken down by
 * the dimensions APIM provides.
 */
export default function ModelCostSection({ apimResourceId, filters, spanDays, refreshKey, subscriptionNames = {}, apiNames = {}, onData }: Props) {
  const { getCredential } = useAzure();
  const store = usePricingStore();
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dim, setDim] = useState<Dim>('model');

  const filterKey = JSON.stringify(filters);
  const rules = store.doc.rules;
  const ready = store.state === 'ready';

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      setRows(await loadCostRows(getCredential(), apimResourceId, rules, JSON.parse(filterKey) as CostQueryFilters));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cost query failed');
    } finally {
      setLoading(false);
    }
  }, [ready, getCredential, apimResourceId, rules, filterKey]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const currency = store.doc.currency ?? '';
  useEffect(() => { onData?.(rows ? { rows, currency } : null); }, [rows, currency, onData]);
  const report: CostReport | null = useMemo(
    () => (rows ? buildCostReport(rows, currency, pickBin(spanDays)) : null), [rows, currency, spanDays]);

  const money = (n: number) => (currency ? formatMoney(n, currency) : n.toFixed(2));
  const moneyFine = (n: number) => (currency ? formatMoneyAuto(n, currency) : n.toFixed(6));

  if (store.state === 'error' && store.error) {
    return (
      <Card title="Estimated model cost" action={<Pill tone="estimate">Estimate</Pill>}>
        <div className="pricing-banner pricing-banner-error"><AlertTriangle size={16} /> Pricing could not be loaded: {store.error.message}</div>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card title="Estimated model cost" action={<Pill tone="estimate">Estimate</Pill>}>
        {error ? <div className="pricing-banner pricing-banner-error"><AlertTriangle size={16} /> {error}</div> : <span className="spinner" />}
      </Card>
    );
  }

  const missing = report.missingRequests;
  const cachedKnown = report.cachedTokens > 0;
  const consumption: Kpi[] = [
    kpi('req', 'Total requests', num(report.requests), 'LLM log rows in range'),
    kpi('tok', 'Total tokens', compact(report.tokens), 'prompt + completion'),
    kpi('in', 'Input tokens', compact(report.promptTokens), 'prompt tokens'),
    kpi('out', 'Output tokens', compact(report.completionTokens), 'completion tokens'),
    kpi('cached', 'Cached input tokens', cachedKnown ? compact(report.cachedTokens) : 'n/a', cachedKnown ? 'subset of input tokens' : 'not reported by APIM LLM logs', 'nodata'),
  ];
  const cost: Kpi[] = [
    kpi('est', 'Estimated model cost', money(report.estimatedCost), report.incomplete ? `incomplete: ${num(missing)} requests unpriced` : 'estimate from pricing table', report.incomplete ? 'attention' : 'healthy'),
    kpi('cin', 'Input cost', money(report.inputCost), 'non-cached prompt tokens'),
    kpi('ccached', 'Cached input cost', money(report.cachedInputCost), cachedKnown ? 'cached prompt tokens' : 'no cached-token data'),
    kpi('cout', 'Output cost', money(report.outputCost), 'completion tokens'),
    kpi('avg', 'Avg cost / request', report.avgCostPerRequest === null ? 'n/a' : moneyFine(report.avgCostPerRequest), 'priced requests only'),
    kpi('per1m', 'Cost per 1M tokens', report.costPer1MTokens === null ? 'n/a' : moneyFine(report.costPer1MTokens), 'priced tokens only'),
    kpi('missing', 'Requests missing pricing', num(missing), missing > 0 ? 'excluded from cost totals' : 'all requests priced', missing > 0 ? 'critical' : 'healthy'),
  ];

  const label = (d: Dim, name: string) => (d === 'subscription' ? subscriptionNames[name] : d === 'api' ? apiNames[name] : undefined) ?? name;
  const groups: Record<Dim, CostGroup[]> = {
    model: report.byModel, deployment: report.byDeployment, region: report.byRegion, api: report.byApi, subscription: report.bySubscription,
  };

  return (
    <div className="pricing-cost">
      <div className="pricing-cost-head">
        <h2 className="pricing-cost-title">Estimated model cost <Pill tone="estimate">Estimate</Pill></h2>
        <span className="pricing-hint">Tokens x configured price per 1M tokens, using the price valid at each request. Not the Azure invoice.{loading ? ' Refreshing…' : ''}</span>
      </div>
      {report.incomplete && (
        <div className="pricing-banner pricing-banner-error">
          <AlertTriangle size={16} /> Cost is incomplete: {num(missing)} requests have no pricing rule and are excluded from the cost totals.
        </div>
      )}
      {error && <div className="pricing-banner pricing-banner-error"><AlertTriangle size={16} /> {error}</div>}

      <div className="exec-kpis pricing-kpis">{consumption.map((k) => <KpiCard key={k.key} kpi={k} />)}</div>
      <div className="exec-kpis pricing-kpis">{cost.map((k) => <KpiCard key={k.key} kpi={k} />)}</div>

      <div className="exec-grid-cost">
        <Card title="Cost over time" subtitle={`Estimated cost per ${pickBin(spanDays)}`}>
          <TrendChart data={report.series} formatValue={(n) => (currency ? formatMoney(n, currency, n < 10 ? 2 : 0) : compact(n))} series={[
            { key: 'cost', name: 'Estimated cost', color: 'var(--chart-1)', type: 'bar' },
          ]} />
        </Card>

      <Card title="Cost breakdown" action={
        <div className="pricing-tabs" role="tablist">
          {DIMS.map((d) => <button key={d.key} role="tab" aria-selected={dim === d.key} className={dim === d.key ? 'active' : ''} onClick={() => { setDim(d.key); }}>{d.label}</button>)}
        </div>
      }>
        <div className="exec-table-wrap">
          <table className="exec-table">
            <thead><tr>
              <th>{DIMS.find((d) => d.key === dim)?.label}</th><th className="num">Requests</th><th className="num">Input tokens</th>
              <th className="num">Output tokens</th><th className="num">Total tokens</th><th className="num">Estimated cost</th><th className="num">Avg cost / request</th>
            </tr></thead>
            <tbody>
              {groups[dim].map((g) => (
                <tr key={g.name}>
                  <td>{label(dim, g.name)}{g.missingRequests > 0 && <> <Pill tone="info">{num(g.missingRequests)} unpriced</Pill></>}</td>
                  <td className="num">{num(g.requests)}</td><td className="num">{num(g.promptTokens)}</td>
                  <td className="num">{num(g.completionTokens)}</td><td className="num">{num(g.tokens)}</td>
                  <td className="num">{money(g.cost)}</td>
                  <td className="num">{g.avgCostPerRequest === null ? '—' : moneyFine(g.avgCostPerRequest)}</td>
                </tr>
              ))}
              {groups[dim].length === 0 && <tr><td colSpan={7}>No data for the selected filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      {report.missing.length > 0 && (
        <Card title="Requests missing pricing" subtitle="Models/deployments with no pricing rule valid at request time" action={<Pill tone="info">{num(missing)} requests</Pill>}>
          <div className="exec-table-wrap">
            <table className="exec-table">
              <thead><tr><th>Model</th><th>Deployment</th><th>Region</th><th className="num">Requests</th><th className="num">Tokens</th><th>First seen</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {report.missing.map((m) => {
                  const q = new URLSearchParams({ model: m.model, deployment: m.deployment === '(not logged)' ? '' : m.deployment, region: m.region === '(unknown)' ? '' : m.region });
                  return (
                    <tr key={`${m.model}|${m.deployment}|${m.region}`}>
                      <td>{m.model}</td><td>{m.deployment}</td><td>{m.region}</td>
                      <td className="num">{num(m.requests)}</td><td className="num">{num(m.tokens)}</td>
                      <td>{m.firstSeen.slice(0, 10)}</td><td>{m.lastSeen.slice(0, 10)}</td>
                      <td><Link className="exec-btn" to={`/model-pricing?${q.toString()}`}>Add price <ArrowRight size={12} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
