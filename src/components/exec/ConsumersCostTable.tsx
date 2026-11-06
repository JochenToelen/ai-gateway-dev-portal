import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildConsumers, type CostRow } from '../../pricing/report';
import { formatMoney, formatMoneyAuto } from '../../pricing/format';
import { num } from '../../dashboard/format';
import { Pill } from './ExecWidgets';

const PAGE_SIZE = 10;

type SortKey = 'name' | 'requests' | 'promptTokens' | 'completionTokens' | 'tokens' | 'cost' | 'avgCostPerRequest';
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Subscription / consumer' },
  { key: 'requests', label: 'Requests', num: true },
  { key: 'promptTokens', label: 'Input tokens', num: true },
  { key: 'completionTokens', label: 'Output tokens', num: true },
  { key: 'tokens', label: 'Total tokens', num: true },
  { key: 'cost', label: 'Estimated cost', num: true },
  { key: 'avgCostPerRequest', label: 'Avg cost / request', num: true },
];

interface Props {
  rows: CostRow[];
  currency: string;
  subscriptionNames: Record<string, string>;
}

/** All gateway consumers (APIM subscriptions) with estimated cost; a row expands to tokens and cost per model. */
export default function ConsumersCostTable({ rows, currency, subscriptionNames }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'cost', dir: -1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const display = (name: string) => subscriptionNames[name] ?? name;
  const money = (n: number) => (currency ? formatMoney(n, currency) : n.toFixed(2));
  const moneyFine = (n: number) => (currency ? formatMoneyAuto(n, currency) : n.toFixed(6));

  const consumers = useMemo(() => buildConsumers(rows), [rows]);
  const sorted = useMemo(() => [...consumers].sort((a, b) => {
    const x = sort.key === 'name' ? display(a.name) : (a[sort.key] ?? -1);
    const y = sort.key === 'name' ? display(b.name) : (b[sort.key] ?? -1);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return c * sort.dir || display(a.name).localeCompare(display(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [consumers, sort, subscriptionNames]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  useEffect(() => { if (page !== current) setPage(current); }, [page, current]);
  const shown = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const toggle = (name: string) => {
    setOpen((s) => { const n = new Set(s); if (!n.delete(name)) n.add(name); return n; });
  };
  const header = (c: typeof COLS[number]) => (
    <th key={c.key} className={c.num ? 'num sortable' : 'sortable'}
      aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => { setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.key === 'name' ? 1 : -1 })); setPage(0); }}>
        {c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  return (
    <div className="exec-table-wrap">
      <table className="exec-table">
        <thead><tr><th aria-label="Expand" />{COLS.map(header)}</tr></thead>
        <tbody>
          {shown.map((c) => {
            const isOpen = open.has(c.name);
            return (
              <Fragment key={c.name}>
                <tr className="consumer-row" onClick={() => { toggle(c.name); }}>
                  <td>
                    <button className="exec-link-btn" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse models' : 'Expand models'}
                      onClick={(e) => { e.stopPropagation(); toggle(c.name); }}>
                      <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
                    </button>
                  </td>
                  <td>{display(c.name)}{c.missingRequests > 0 && <> <Pill tone="info">{num(c.missingRequests)} unpriced</Pill></>}</td>
                  <td className="num">{num(c.requests)}</td><td className="num">{num(c.promptTokens)}</td>
                  <td className="num">{num(c.completionTokens)}</td><td className="num">{num(c.tokens)}</td>
                  <td className="num">{money(c.cost)}</td>
                  <td className="num">{c.avgCostPerRequest === null ? '—' : moneyFine(c.avgCostPerRequest)}</td>
                </tr>
                {isOpen && c.models.map((m) => (
                  <tr key={`${c.name}|${m.name}`} className="consumer-sub-row">
                    <td />
                    <td className="consumer-model">{m.name}{m.missingRequests > 0 && <> <Pill tone="info">{num(m.missingRequests)} unpriced</Pill></>}</td>
                    <td className="num">{num(m.requests)}</td><td className="num">{num(m.promptTokens)}</td>
                    <td className="num">{num(m.completionTokens)}</td><td className="num">{num(m.tokens)}</td>
                    <td className="num">{money(m.cost)}</td>
                    <td className="num">{m.avgCostPerRequest === null ? '—' : moneyFine(m.avgCostPerRequest)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {shown.length === 0 && <tr><td colSpan={COLS.length + 1} className="exec-empty">No gateway usage matches the filters.</td></tr>}
        </tbody>
      </table>
      <div className="consumer-pager">
        <span className="exec-muted">
          {sorted.length === 0 ? '0 consumers' : `${(current * PAGE_SIZE + 1).toString()}–${Math.min((current + 1) * PAGE_SIZE, sorted.length).toString()} of ${sorted.length.toString()} consumers`}
        </span>
        <button className="exec-btn" disabled={current === 0} onClick={() => { setPage(current - 1); }}><ChevronLeft size={14} /> Previous</button>
        <span className="exec-muted">Page {current + 1} / {pages}</span>
        <button className="exec-btn" disabled={current >= pages - 1} onClick={() => { setPage(current + 1); }}>Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
