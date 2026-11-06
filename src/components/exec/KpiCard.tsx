import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { Kpi } from '../../dashboard/types';
import { DeltaBadge, StatusDot } from './ExecWidgets';

export default function KpiCard({ kpi }: { kpi: Kpi }) {
  const data = kpi.spark.map((v, i) => ({ i, v }));
  return (
    <div className={`exec-kpi exec-kpi-${kpi.status}${kpi.prominent ? ' exec-kpi-prominent' : ''}`}>
      <div className="exec-kpi-top">
        <span className="exec-kpi-label">{kpi.label}</span>
        <StatusDot status={kpi.status} />
      </div>
      <div className="exec-kpi-value">{kpi.value}</div>
      <div className="exec-kpi-sub">{kpi.sub}</div>
      <div className="exec-kpi-bottom">
        <DeltaBadge value={kpi.delta} direction={kpi.direction}         suffix={kpi.deltaSuffix ?? 'vs prev.'} />
                {data.length > 1 && (
                  <div className="exec-kpi-spark">
                    <ResponsiveContainer width="100%" height={32}>
                      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                        <Area type="monotone" dataKey="v" stroke="var(--exec-line)" fill="var(--exec-line)" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
      </div>
    </div>
  );
}
