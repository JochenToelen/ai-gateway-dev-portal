import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Ban, CalendarPlus, CircleDollarSign, Download, History, Pencil, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { usePricingStore } from '../pricing/usePricingStore';
import { useAzure } from '../context/AzureContext';
import { loadObservedModels } from '../pricing/load';
import { seedObservedModels } from '../pricing/seed';
import { addNewPrice, createRule, setRuleActive, updateRule, type RuleInput } from '../pricing/mutations';
import { describeRange, isEffective } from '../pricing/engine';
import { PRICING_MODES, type PricingMode, type PricingRule } from '../pricing/types';
import { Card, Pill } from '../components/exec/ExecWidgets';

type FormMode = { kind: 'create' } | { kind: 'edit'; rule: PricingRule } | { kind: 'newprice'; rule: PricingRule };

interface FormState {
  provider: string; modelName: string; deploymentName: string; region: string; pricingMode: PricingMode;
  input: string; cached: string; output: string; currency: string; validFrom: string; validTo: string;
}

const dateOnly = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const toIso = (d: string) => (d ? `${d}T00:00:00.000Z` : '');
const today = () => new Date().toISOString().slice(0, 10);

function initialForm(mode: FormMode, currency: string | null, prefill: Partial<FormState>): FormState {
  if (mode.kind === 'create') {
    return {
      provider: 'Azure OpenAI', modelName: '', deploymentName: '', region: '', pricingMode: 'Standard',
      input: '', cached: '', output: '', currency: currency ?? 'EUR', validFrom: today(), validTo: '', ...prefill,
    };
  }
  const r = mode.rule;
  return {
    provider: r.provider, modelName: r.modelName, deploymentName: r.deploymentName ?? '', region: r.region ?? '',
    pricingMode: r.pricingMode, input: r.inputPricePerMillion, cached: r.cachedInputPricePerMillion,
    output: r.outputPricePerMillion, currency: r.currency,
    validFrom: mode.kind === 'newprice' ? today() : dateOnly(r.validFrom),
    validTo: mode.kind === 'newprice' ? '' : dateOnly(r.validTo),
  };
}

export default function ModelPricing() {
  const store = usePricingStore();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ provider: '', model: '', region: '', status: 'all' });
  const [form, setForm] = useState<{ mode: FormMode; values: FormState } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { doc } = store;
  const { config, getCredential } = useAzure();
  const apimId = config.apimService?.id;
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const autoSynced = useRef(false);

  // Adds default-priced rules for logged models that have no rule yet; existing rules are never changed
  const syncModels = useCallback(async () => {
    if (!apimId) return;
    setSyncing(true);
    try {
      const observed = await loadObservedModels(getCredential(), apimId);
      const probe = seedObservedModels(doc, observed, '', '');
      const parts: string[] = [];
      if (probe.added.length > 0) {
        const res = await store.apply((d, user, ts) => seedObservedModels(d, observed, `${user} (default prices)`, ts));
        if (res.length > 0) parts.push(res.join(' '));
        else parts.push(`Added ${probe.added.length.toString()} logged model(s) with default prices: ${probe.added.join(', ')}. Review and adjust them.`);
      }
      if (probe.unknown.length > 0) parts.push(`No default price known for: ${probe.unknown.join(', ')}. Add these manually; until then they count as missing pricing.`);
      if (probe.currencyMismatch) parts.push(`Default prices are in EUR but this table uses ${doc.currency ?? ''}; models were not added.`);
      setSyncNote(parts.length > 0 ? parts.join(' ') : 'All logged models already have a pricing rule.');
    } catch (e) {
      setSyncNote(`Could not read logged models: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSyncing(false);
    }
  }, [apimId, doc, getCredential, store]);

  useEffect(() => {
    if (autoSynced.current || store.state !== 'ready' || !store.canEdit || !apimId) return;
    autoSynced.current = true;
    void syncModels();
  }, [store.state, store.canEdit, apimId, syncModels]);
  // Deep link from the missing-pricing drill-down: open the add form prefilled
  const prefillModel = params.get('model');
  const [handledPrefill, setHandledPrefill] = useState(false);
  if (prefillModel && !handledPrefill && store.canEdit) {
    setHandledPrefill(true);
    const prefill = { modelName: prefillModel, deploymentName: params.get('deployment') ?? '', region: params.get('region') ?? '' };
    setForm({ mode: { kind: 'create' }, values: initialForm({ kind: 'create' }, doc.currency, prefill) });
    setParams({}, { replace: true });
  }

  const now = new Date().toISOString();
  const providers = useMemo(() => [...new Set(doc.rules.map((r) => r.provider))].sort(), [doc.rules]);
  const rows = useMemo(() => doc.rules
    .filter((r) => (!filters.provider || r.provider === filters.provider)
      && (!filters.model || r.modelName.toLowerCase().includes(filters.model.toLowerCase()))
      && (!filters.region || (r.region ?? '').toLowerCase().includes(filters.region.toLowerCase()))
      && (filters.status === 'all' || (filters.status === 'active' ? r.isActive : !r.isActive)))
    .sort((a, b) => a.modelName.localeCompare(b.modelName) || b.validFrom.localeCompare(a.validFrom)), [doc.rules, filters]);

  const open = (mode: FormMode) => { setErrors([]); setForm({ mode, values: initialForm(mode, doc.currency, {}) }); };

  const submit = async () => {
    if (!form) return;
    const v = form.values;
    const input: RuleInput = {
      provider: v.provider, modelName: v.modelName, deploymentName: v.deploymentName, region: v.region,
      pricingMode: v.pricingMode, inputPricePerMillion: v.input.trim(), cachedInputPricePerMillion: v.cached.trim(),
      outputPricePerMillion: v.output.trim(), currency: v.currency, validFrom: toIso(v.validFrom), validTo: toIso(v.validTo) || undefined,
    };
    setSaving(true);
    const mode = form.mode;
    const errs = await store.apply((d, user, ts) => (
      mode.kind === 'create' ? createRule(d, input, user, ts)
        : mode.kind === 'edit' ? updateRule(d, mode.rule.id, input, user, ts)
          : addNewPrice(d, mode.rule.id, input, user, ts)));
    setSaving(false);
    setErrors(errs);
    if (errs.length === 0) setForm(null);
  };

  const toggle = async (rule: PricingRule) => {
    const errs = await store.apply((d, user, ts) => setRuleActive(d, rule.id, !rule.isActive, user, ts));
    setErrors(errs);
  };

  const set = (k: keyof FormState, v: string) => setForm((f) => (f ? { ...f, values: { ...f.values, [k]: v } } : f));

  return (
    <div className="exec-page pricing-page">
      <header className="exec-header">
        <div>
          <h1><CircleDollarSign size={20} /> AI Model Pricing</h1>
          <p>Effective-dated token prices used to estimate model cost from APIM LLM logs. Shared by all users. Prices are per 1,000,000 tokens{doc.currency ? ` in ${doc.currency}` : ''}.</p>
        </div>
        <div className="exec-header-actions">
          <button className="exec-btn" onClick={store.reload} disabled={store.state === 'loading'}><RefreshCw size={14} className={store.state === 'loading' ? 'spin' : ''} /> Reload</button>
          <button className="exec-btn" onClick={() => { void syncModels(); }} disabled={!store.canEdit || !apimId || syncing}><Download size={14} className={syncing ? 'spin' : ''} /> Add logged models</button>
          <button className="exec-btn" onClick={() => { setShowHistory((s) => !s); }}><History size={14} /> Change history</button>
          <button className="exec-btn exec-btn-primary" onClick={() => { open({ kind: 'create' }); }} disabled={!store.canEdit}><Plus size={14} /> Add pricing rule</button>
        </div>
      </header>

      {store.source && (
        <p className="pricing-hint">
          Stored in {store.source === 'blob' ? 'Azure Blob Storage (server managed identity)' : 'a local JSON file on the server'}.
          {store.state === 'ready' && !store.canEdit && ' You have read-only access.'}
        </p>
      )}
      {syncNote && <div className="pricing-banner">{syncNote}</div>}
      {store.state === 'error' && store.error && (
        <div className="pricing-banner pricing-banner-error"><AlertTriangle size={16} /> {store.error.message}</div>
      )}
      {errors.length > 0 && !form && <div className="pricing-banner pricing-banner-error">{errors.join(' ')}</div>}

      {form && (
        <Card title={form.mode.kind === 'create' ? 'Add pricing rule' : form.mode.kind === 'edit' ? 'Edit pricing rule' : 'Add new effective-dated price'}
          subtitle={form.mode.kind === 'newprice' ? 'The current price is end-dated at the new "Valid from"; earlier consumption keeps the old price.' : 'Dates are UTC; "Valid from" is inclusive, "Valid to" is exclusive.'}
          action={<button className="exec-link-btn" onClick={() => { setForm(null); }} aria-label="Close"><X size={16} /></button>}>
          <div className="pricing-form">
            <label>Provider<input value={form.values.provider} onChange={(e) => { set('provider', e.target.value); }} /></label>
            <label>Model name *<input value={form.values.modelName} onChange={(e) => { set('modelName', e.target.value); }} disabled={form.mode.kind === 'newprice'} placeholder="gpt-4o" /></label>
            <label>Deployment (optional)<input value={form.values.deploymentName} onChange={(e) => { set('deploymentName', e.target.value); }} disabled={form.mode.kind === 'newprice'} /></label>
            <label>Region (optional)<input value={form.values.region} onChange={(e) => { set('region', e.target.value); }} disabled={form.mode.kind === 'newprice'} placeholder="swedencentral" /></label>
            <label>Pricing mode
              <select value={form.values.pricingMode} onChange={(e) => { set('pricingMode', e.target.value); }}>
                {PRICING_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label>Currency *<input value={form.values.currency} onChange={(e) => { set('currency', e.target.value); }} disabled={!!doc.currency} maxLength={3} /></label>
            <label>Input / 1M *<input inputMode="decimal" value={form.values.input} onChange={(e) => { set('input', e.target.value); }} placeholder="2.50" /></label>
            <label>Cached input / 1M *<input inputMode="decimal" value={form.values.cached} onChange={(e) => { set('cached', e.target.value); }} placeholder="1.25" /></label>
            <label>Output / 1M *<input inputMode="decimal" value={form.values.output} onChange={(e) => { set('output', e.target.value); }} placeholder="10.00" /></label>
            <label>Valid from *<input type="date" value={form.values.validFrom} onChange={(e) => { set('validFrom', e.target.value); }} /></label>
            <label>Valid to (optional)<input type="date" value={form.values.validTo} onChange={(e) => { set('validTo', e.target.value); }} /></label>
          </div>
          {errors.length > 0 && <ul className="pricing-error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="pricing-form-actions">
            <button className="exec-btn" onClick={() => { setForm(null); }}>Cancel</button>
            <button className="exec-btn exec-btn-primary" onClick={() => { void submit(); }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Card>
      )}

      <div className="exec-filters">
        <label>Provider
          <select value={filters.provider} onChange={(e) => { setFilters({ ...filters, provider: e.target.value }); }}>
            <option value="">All</option>{providers.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>Model<input value={filters.model} onChange={(e) => { setFilters({ ...filters, model: e.target.value }); }} placeholder="contains…" /></label>
        <label>Region<input value={filters.region} onChange={(e) => { setFilters({ ...filters, region: e.target.value }); }} placeholder="contains…" /></label>
        <label>Status
          <select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); }}>
            <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      <Card>
        {store.state === 'loading' ? <span className="spinner" /> : rows.length === 0 ? (
          <div className="exec-alerts-ok">{doc.rules.length === 0 ? 'No pricing rules yet. Add one to start estimating model cost.' : 'No rules match the filters.'}</div>
        ) : (
          <div className="exec-table-wrap">
            <table className="exec-table">
              <thead><tr>
                <th>Provider</th><th>Model</th><th>Deployment</th><th>Region</th><th>Mode</th>
                <th className="num">Input /1M</th><th className="num">Cached /1M</th><th className="num">Output /1M</th>
                <th>Currency</th><th>Validity</th><th>Status</th><th />
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const live = r.isActive && isEffective(r, now);
                  const future = r.isActive && !live && Date.parse(r.validFrom) > Date.parse(now);
                  return (
                    <tr key={r.id} className={r.isActive ? '' : 'pricing-inactive'}>
                      <td>{r.provider}</td><td>{r.modelName}{r.needsReview && <> <Pill tone="estimate">Default price – review</Pill></>}</td><td>{r.deploymentName ?? '—'}</td><td>{r.region ?? '—'}</td><td>{r.pricingMode}</td>
                      <td className="num">{r.inputPricePerMillion}</td><td className="num">{r.cachedInputPricePerMillion}</td><td className="num">{r.outputPricePerMillion}</td>
                      <td>{r.currency}</td><td>{describeRange(r)}</td>
                      <td>{!r.isActive ? <Pill tone="info">Inactive</Pill> : live ? <Pill tone="measured">In force</Pill> : future ? <Pill tone="info">Scheduled</Pill> : <Pill tone="info">Ended</Pill>}</td>
                      <td className="pricing-actions">
                        <button className="exec-link-btn" title="Edit" onClick={() => { open({ kind: 'edit', rule: r }); }} disabled={!store.canEdit}><Pencil size={14} /></button>
                        <button className="exec-link-btn" title="Add new effective-dated price" onClick={() => { open({ kind: 'newprice', rule: r }); }} disabled={!store.canEdit || !r.isActive}><CalendarPlus size={14} /></button>
                        <button className="exec-link-btn" title={r.isActive ? 'Deactivate' : 'Reactivate'} onClick={() => { void toggle(r); }} disabled={!store.canEdit}>
                          {r.isActive ? <Ban size={14} /> : <RotateCcw size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showHistory && (
        <Card title="Change history" subtitle="Every change with old and new values">
          {doc.audit.length === 0 ? <div className="exec-alerts-ok">No changes recorded.</div> : (
            <div className="exec-table-wrap">
              <table className="exec-table exec-table-compact">
                <thead><tr><th>When (UTC)</th><th>User</th><th>Action</th><th>Model</th><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {[...doc.audit].reverse().map((a, i) => (
                    <tr key={`${a.at}-${i.toString()}`}>
                      <td>{a.at.slice(0, 19).replace('T', ' ')}</td><td>{a.user}</td><td>{a.action}</td>
                      <td>{(a.after ?? a.before)?.modelName}</td>
                      <td><RuleSummary rule={a.before} /></td><td><RuleSummary rule={a.after} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function RuleSummary({ rule }: { rule: PricingRule | null }) {
  if (!rule) return <span>—</span>;
  return <span>{rule.inputPricePerMillion} / {rule.cachedInputPricePerMillion} / {rule.outputPricePerMillion} {rule.currency} · {describeRange(rule)}{rule.isActive ? '' : ' · inactive'}</span>;
}
