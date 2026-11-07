import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { useAzure } from '../context/AzureContext';
import { loadDashboardData } from '../dashboard/connectors';
import { ALL, buildDashboard, DEFAULT_FILTERS } from '../dashboard/service';
import { useThresholds } from '../dashboard/config';
import { compact } from '../dashboard/format';
import type { DashboardFilters, RawDashboardData } from '../dashboard/types';
import KpiCard from '../components/exec/KpiCard';
import { Card, Pill, SectionTitle } from '../components/exec/ExecWidgets';
import TrendChart from '../components/exec/TrendChart';
import AlertPanel from '../components/exec/AlertPanel';
import ThresholdSettings from '../components/exec/ThresholdSettings';
import ModelCostSection from '../components/ModelCostSection';
import type { CostQueryFilters } from '../pricing/kql';
import type { CostRow } from '../pricing/report';
import ConsumersCostTable from '../components/exec/ConsumersCostTable';
import {
  CoveragePanel, ExecFilters, HealthPanel, UsageDrill,
} from '../components/exec/ExecPanels';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ExecutiveDashboard() {
  const { config, workspaceData, workspaceLoading, getCredential } = useAzure();
  const apim = config.apimService;
  const [raw, setRaw] = useState<RawDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const { thresholds, setThresholds, reset } = useThresholds();
  const [reloadKey, setReloadKey] = useState(0);
  const [costData, setCostData] = useState<{ rows: CostRow[]; currency: string } | null>(null);

  const inferenceIds = useMemo(() => workspaceData.inferenceApis.map((a) => a.name), [workspaceData.inferenceApis]);
  const apiNames = useMemo(() => Object.fromEntries(workspaceData.apis.map((a) => [a.name, a.displayName || a.name])), [workspaceData.apis]);
  const subMeta = useMemo(() => Object.fromEntries(workspaceData.subscriptions.map((s) => [
    s.sid, { name: s.displayName || s.sid, hasOwner: !!(s.ownerId || s.ownerName) },
  ])), [workspaceData.subscriptions]);

  const apimId = apim?.id;
  useEffect(() => {
    if (!apimId || workspaceLoading) return;
    let cancelled = false;
    loadDashboardData({
      credential: getCredential(), apimResourceId: apimId,
      inferenceApiIds: inferenceIds, apiNames, subscriptionMeta: subMeta,
    })
      .then((d) => { if (!cancelled) { setRaw(d); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apimId, workspaceLoading, inferenceIds, apiNames, subMeta, reloadKey, getCredential]);

  const model = useMemo(() => {
    if (!raw) return null;
    return buildDashboard(raw, filters, thresholds, '', todayIso());
  }, [raw, filters, thresholds]);

  const refresh = useCallback(() => { setLoading(true); setReloadKey((k) => k + 1); }, []);

  if (!apim) {
    return (
      <div className="exec-page">
        <div className="exec-alerts-ok">Select an API Management service to see AI spend and gateway consumption.</div>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="exec-page">
        {error ? <div className="exec-alerts-ok">{error}</div> : <span className="spinner" />}
      </div>
    );
  }

  const kpis = ['consumption', 'active', 'success', 'attribution']
    .map((k) => model.kpis.find((x) => x.key === k)).filter((k) => k !== undefined);
  const costFilters: CostQueryFilters = {
    start: `ago(${filters.period.toString()}d)`,
    subscriptions: filters.subscription === ALL ? [] : [filters.subscription],
    apis: filters.api === ALL ? [] : [filters.api],
    models: filters.model === ALL ? [] : [filters.model],
    deployments: filters.deployment === ALL ? [] : [filters.deployment],
  };
  const hasFilters = (['subscription', 'api', 'model', 'deployment'] as const).some((k) => filters[k] !== ALL);

  return (
    <div className="exec-page">
      <header className="exec-header">
        <div>
          <h1><TrendingUp size={20} /> AI Gateway consumption</h1>
          <p>{apim.name} · {model.periodLabel}</p>
        </div>
        <div className="exec-header-actions">
          <button className="exec-btn" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
          <ThresholdSettings thresholds={thresholds} onThresholds={setThresholds} onReset={reset} />
        </div>
      </header>

      <ExecFilters filters={filters} model={model} onChange={setFilters} />

      <SectionTitle index="1" title="Overview" question="How much AI traffic does the gateway observe?" />
      <div className="exec-kpis exec-kpis-4">{kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}</div>
      <Card title="Alerts" subtitle="Exceptions against configurable thresholds">
        <AlertPanel alerts={model.alerts} />
      </Card>

      <SectionTitle index="2" title="Estimated model cost" question="What does the consumption cost, based on the configured model prices?" />
      <ModelCostSection apimResourceId={apim.id} filters={costFilters} spanDays={filters.period} refreshKey={reloadKey}
        subscriptionNames={model.subscriptionNames} apiNames={model.apiNames} onData={setCostData} />

      <SectionTitle index="3" title="Gateway consumption" question="What does APIM observe flowing through the gateway?" />
      <div className="exec-grid-2">
        <Card title="Tokens over time" subtitle="Observed in APIM LLM logs">
          <TrendChart data={model.tokenSeries} formatValue={compact} series={[
            { key: 'prompt', name: 'Prompt tokens', color: 'var(--chart-1)', type: 'area', stackId: 't' },
            { key: 'completion', name: 'Completion tokens', color: 'var(--chart-2)', type: 'area', stackId: 't' },
          ]} />
        </Card>
        <Card title="Requests over time" subtitle="Observed in APIM gateway logs">
          <TrendChart data={model.tokenSeries} formatValue={compact} series={[
            { key: 'requests', name: 'Requests', color: 'var(--chart-3)', type: 'bar' },
          ]} />
        </Card>
      </div>
      <Card title="Drill-down: subscription → API → model → deployment" subtitle="Click a name to drill in">
        <UsageDrill model={model} />
      </Card>

      <SectionTitle index="4" title="Operational health & attribution" question="Is the gateway healthy, and can usage be attributed?" />
      <div className="exec-grid-2">
        <Card title="Operational health" action={<Pill tone="info">Observed at gateway</Pill>}>
          <HealthPanel metrics={model.health} models={model.modelHealth} />
        </Card>
        <Card title="Attribution & governance coverage">
          <CoveragePanel items={model.coverage} />
        </Card>
      </div>

      <SectionTitle index="5" title="All consumers" question="What does each gateway consumer use and cost?" />
      <Card subtitle={hasFilters ? 'Filtered view · click a row for tokens and cost per model' : 'Grouped by subscription · click a row for tokens and cost per model'}
        action={<Pill tone="estimate">Estimate</Pill>}>
        {costData
          ? <ConsumersCostTable rows={costData.rows} currency={costData.currency} subscriptionNames={model.subscriptionNames} />
          : <span className="spinner" />}
      </Card>

    </div>
  );
}
