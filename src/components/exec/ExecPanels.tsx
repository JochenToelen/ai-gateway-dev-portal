import { useMemo, useState } from 'react';
import { ChevronRight, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import type {
  CoverageItem, DashboardFilters, DashboardModel, HealthMetric, ModelHealth, SourceState,
} from '../../dashboard/types';
import { ALL, ANONYMOUS, DEFAULT_FILTERS, groupUsage, type UsageDim } from '../../dashboard/service';
import { compact, num, pct } from '../../dashboard/format';
import { Pill, StatusDot } from './ExecWidgets';

/* ---------------- Gateway usage drill-down ---------------- */

const LEVELS: { dim: UsageDim; label: string }[] = [
  { dim: 'subscription', label: 'Subscription' },
  { dim: 'api', label: 'API' },
  { dim: 'model', label: 'Model' },
  { dim: 'deployment', label: 'Deployment' },
];

export function UsageDrill({ model }: { model: DashboardModel }) {
  const [path, setPath] = useState<string[]>([]);
  const level = Math.min(path.length, LEVELS.length - 1);
  const display = (dim: UsageDim, v: string) =>
    dim === 'subscription' ? (model.subscriptionNames[v] ?? v) : dim === 'api' ? (model.apiNames[v] ?? v) : v;
  const scoped = useMemo(() => model.rows.filter((r) =>
    path.every((v, i) => (r[LEVELS[i].dim] || ANONYMOUS) === v)), [model.rows, path]);
  const data = useMemo(() => groupUsage(scoped, LEVELS[level].dim).slice(0, 10), [scoped, level]);
  const max = Math.max(1, ...data.map((d) => d.tokens));
  const total = data.reduce((s, d) => s + d.tokens, 0) || 1;
  const canDrill = path.length < LEVELS.length - 1;
  return (
    <div>
      <div className="exec-crumbs">
        <button className="exec-link-btn" onClick={() => { setPath([]); }}>All gateway usage</button>
        {path.map((v, i) => (
          <span key={`${v}-${i.toString()}`} className="exec-crumb">
            <ChevronRight size={12} />
            <button className="exec-link-btn" onClick={() => { setPath(path.slice(0, i + 1)); }}>{display(LEVELS[i].dim, v)}</button>
          </span>
        ))}
        <span className="exec-muted">&nbsp;· by {LEVELS[level].label.toLowerCase()}</span>
      </div>
      <ul className="exec-bars exec-bars-wide">
        {data.map((d) => (
          <li key={d.name}>
            <span className="exec-bar-name" title={display(LEVELS[level].dim, d.name)}>
              {canDrill
                ? <button className="exec-link-btn exec-bar-link" onClick={() => { setPath([...path, d.name]); }}>{display(LEVELS[level].dim, d.name)}</button>
                : display(LEVELS[level].dim, d.name)}
            </span>
            <span className="exec-bar-track"><span className="exec-bar-fill" style={{ width: `${((d.tokens / max) * 100).toFixed(1)}%` }} /></span>
            <span className="exec-bar-value">{compact(d.tokens)} tok</span>
            <span className="exec-bar-value">{num(d.requests)} req</span>
            <span className="exec-bar-share">{pct((d.tokens / total) * 100, 0)}</span>
          </li>
        ))}
        {data.length === 0 && <li className="exec-empty">No gateway usage for this selection.</li>}
      </ul>
    </div>
  );
}

/* ---------------- Filters ---------------- */

export function ExecFilters({ filters, model, onChange }: {
  filters: DashboardFilters; model: DashboardModel; onChange: (f: DashboardFilters) => void;
}) {
  const fields: { key: 'subscription' | 'api' | 'model' | 'deployment'; label: string }[] = [
    { key: 'subscription', label: 'Subscription' }, { key: 'api', label: 'API' },
    { key: 'model', label: 'Model' }, { key: 'deployment', label: 'Deployment' },
  ];
  const label = (k: string, v: string) =>
    k === 'subscription' ? (model.subscriptionNames[v] ?? v) : k === 'api' ? (model.apiNames[v] ?? v) : v;
  const dirty = fields.some((f) => filters[f.key] !== ALL) || filters.period !== DEFAULT_FILTERS.period;
  return (
    <div className="exec-filters">
      <label>
        <span>Time period</span>
        <select value={filters.period} onChange={(e) => { onChange({ ...filters, period: Number(e.target.value) as DashboardFilters['period'] }); }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>
      {fields.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <select value={filters[f.key]} onChange={(e) => { onChange({ ...filters, [f.key]: e.target.value }); }}>
            {model.options[f.key].map((o) => <option key={o} value={o}>{o === ALL ? ALL : label(f.key, o)}</option>)}
          </select>
        </label>
      ))}
      {dirty && <button className="exec-link-btn" onClick={() => { onChange(DEFAULT_FILTERS); }}>Reset</button>}
      <span className="exec-muted exec-filters-note">Metrics include requests observed at the selected APIM gateway.</span>
    </div>
  );
}

/* ---------------- Operational health ---------------- */

export function HealthPanel({ metrics, models }: { metrics: HealthMetric[]; models: ModelHealth[] }) {
  return (
    <div>
      <p className="exec-muted exec-note">Observed at the APIM gateway only. This is not provider availability or an end-to-end SLO.</p>
      <div className="exec-health-grid">
        {metrics.map((m) => (
          <div key={m.key} className={`exec-health exec-health-${m.status}`}>
            <span className="exec-health-label">{m.label}</span>
            <span className="exec-health-value">{m.value}</span>
            <span className="exec-muted">{m.target}</span>
            <StatusDot status={m.status} />
          </div>
        ))}
      </div>
      {models.length > 0 && (
        <table className="exec-table exec-table-compact">
          <thead><tr><th>Model</th><th className="num">Requests</th><th className="num">Success</th><th className="num">Throttled</th><th className="num">Avg latency</th><th>Status</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model}>
                <td>{m.model}</td><td className="num">{num(m.requests)}</td><td className="num">{pct(m.successPct, 2)}</td>
                <td className="num">{pct(m.throttledPct, 1)}</td>
                <td className="num">{m.avgLatencyMs === null ? '—' : `${Math.round(m.avgLatencyMs).toString()} ms`}</td>
                <td><StatusDot status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Attribution & governance coverage ---------------- */

const NOT_MEASURED = [
  'Azure-billed spend, budgets and forecasts (Cost Management access required)',
  'Business value, savings, productivity and cost per business outcome (needs business-system data)',
  'Active users and adoption trends (no reliable user identity in gateway logs)',
  'Provider availability (needs Azure Monitor / Foundry telemetry)',
  'Traffic bypassing the gateway (APIM only sees traffic routed through it)',
  'Content Safety interventions and agent attribution (need policy logging or a mapping)',
];

export function CoveragePanel({ items }: { items: CoverageItem[] }) {
  return (
    <div>
      <ul className="exec-coverage">
        {items.map((c) => (
          <li key={c.label}>
            <div><b>{c.label}</b><div className="exec-muted">{c.detail}</div></div>
            <div className="exec-coverage-value">{c.value}<StatusDot status={c.status} label={false} /></div>
          </li>
        ))}
      </ul>
      <div className="exec-gap">
        <div className="exec-gap-title"><CircleSlash size={14} /> Not measured with current sources</div>
        <ul>{NOT_MEASURED.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
    </div>
  );
}

/* ---------------- Source status ---------------- */

export function SourceStatusPanel({ sources, loadedAt }: { sources: SourceState[]; loadedAt: string }) {
  return (
    <div>
      <ul className="exec-sources">
        {sources.map((s) => (
          <li key={s.id}>
            {s.status === 'connected' ? <CheckCircle2 size={14} className="exec-src-ok" />
              : s.status === 'unavailable' ? <XCircle size={14} className="exec-src-bad" /> : <CircleSlash size={14} className="exec-src-off" />}
            <div><b>{s.name}</b><div className="exec-muted">{s.detail}</div></div>
            <Pill tone={s.status === 'connected' ? 'measured' : s.status === 'unavailable' ? 'estimate' : 'info'}>
              {s.status === 'connected' ? 'Connected' : s.status === 'unavailable' ? 'Unavailable' : 'Not configured'}
            </Pill>
          </li>
        ))}
      </ul>
      <p className="exec-muted exec-note">
        Loaded {new Date(loadedAt).toLocaleString()}. Gateway metrics include only traffic routed through the selected APIM service.
      </p>
    </div>
  );
}
