import { useState } from 'react';
import { RotateCcw, Settings2, X } from 'lucide-react';
import type { Thresholds } from '../../dashboard/types';
import { THRESHOLD_LABELS } from '../../dashboard/config';

interface Props {
  thresholds: Thresholds;
  onThresholds: (t: Thresholds) => void;
  onReset: () => void;
}

export default function ThresholdSettings({ thresholds, onThresholds, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(THRESHOLD_LABELS) as (keyof typeof THRESHOLD_LABELS)[];
  return (
    <>
      <button className="exec-btn" onClick={() => { setOpen(true); }}><Settings2 size={14} /> Settings</button>
      {open && (
        <div className="exec-drawer-backdrop" onClick={() => { setOpen(false); }}>
          <aside className="exec-drawer" onClick={(e) => { e.stopPropagation(); }}>
            <header>
              <h3>Gateway thresholds</h3>
              <button className="exec-icon-btn" aria-label="Close" onClick={() => { setOpen(false); }}><X size={16} /></button>
            </header>
            <h4 className="exec-drawer-h">Gateway alert &amp; status thresholds</h4>
            <p className="exec-muted">Stored in this browser. Alerts and status colours are recalculated immediately.</p>
            <div className="exec-threshold-list">
              {keys.map((k) => (
                <label key={k}>
                  <span>{THRESHOLD_LABELS[k].label}</span>
                  <span className="exec-threshold-input">
                    <input type="number" step="any" value={thresholds[k]}
                      onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onThresholds({ ...thresholds, [k]: v }); }} />
                    <em>{THRESHOLD_LABELS[k].unit}</em>
                  </span>
                </label>
              ))}
            </div>
            <button className="exec-btn" onClick={onReset}><RotateCcw size={14} /> Restore defaults</button>
          </aside>
        </div>
      )}
    </>
  );
}
