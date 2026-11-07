import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  type: 'area' | 'line' | 'bar';
  dashed?: boolean;
  stackId?: string;
}

interface Props {
  data: object[];
  series: TrendSeries[];
  formatValue: (n: number) => string;
  height?: number;
}

/** Generic trend chart: any mix of area / line / bar series on a shared x axis. */
export default function TrendChart({ data, series, formatValue, height = 220 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => formatValue(v)} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 0, fontSize: 12 }}
          formatter={(v) => formatValue(Number(v))}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => {
          if (s.type === 'bar') {
            return <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />;
          }
          if (s.type === 'area') {
            return (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color}
                fillOpacity={0.18} strokeWidth={2} stackId={s.stackId} isAnimationActive={false} />
            );
          }
          return (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined} dot={s.dashed ? { r: 3 } : false} connectNulls={false} isAnimationActive={false} />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
