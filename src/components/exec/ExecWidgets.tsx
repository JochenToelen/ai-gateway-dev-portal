import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { DeltaDirection, Status } from '../../dashboard/types';
import { signedPct } from '../../dashboard/format';

const STATUS_LABEL: Record<Status, string> = {
  healthy: 'Healthy', attention: 'Attention', critical: 'Critical', nodata: 'No data',
};

export function StatusDot({ status, label }: { status: Status; label?: string | false }) {
  return (
    <span className={`exec-status exec-status-${status}`}>
      <span className="exec-status-dot" />
      {label !== false && (label ?? STATUS_LABEL[status])}
    </span>
  );
}

export function DeltaBadge({ value, direction, suffix = 'vs prev.' }: {
  value: number | null; direction: DeltaDirection; suffix?: string;
}) {
  if (value === null) return <span className="exec-delta exec-delta-flat"><Minus size={12} /> n/a</span>;
  const up = value >= 0;
  const good = direction === 'neutral' ? null : direction === 'up-good' ? up : !up;
  const tone = Math.abs(value) < 0.05 ? 'flat' : good === null ? 'flat' : good ? 'good' : 'bad';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`exec-delta exec-delta-${tone}`}>
      <Icon size={12} /> {signedPct(value)} <span className="exec-delta-suffix">{suffix}</span>
    </span>
  );
}

export function Card({ title, subtitle, action, children, className = '' }: {
  title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`exec-card ${className}`}>
      {(title ?? action) && (
        <header className="exec-card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ index, title, question }: { index: string; title: string; question: string }) {
  return (
    <div className="exec-section-title">
      <span className="exec-section-index">{index}</span>
      <h2>{title}</h2>
      <span className="exec-section-question">{question}</span>
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'measured' | 'estimate' | 'info'; children: ReactNode }) {
  return <span className={`exec-pill exec-pill-${tone}`}>{children}</span>;
}
