import { CheckCircle2, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { Alert } from '../../dashboard/types';

export default function AlertPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return <div className="exec-alerts-ok"><CheckCircle2 size={16} /> No executive alerts — everything is within configured thresholds.</div>;
  }
  return (
    <ul className="exec-alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`exec-alert exec-alert-${a.severity}`}>
          {a.severity === 'critical' ? <OctagonAlert size={16} /> : <TriangleAlert size={16} />}
          <div>
            <div className="exec-alert-title">{a.title} <span className="exec-alert-cat">{a.category}</span></div>
            <div className="exec-alert-detail">{a.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
