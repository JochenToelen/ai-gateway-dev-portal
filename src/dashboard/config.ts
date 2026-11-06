import { useCallback, useState } from 'react';
import type { DashboardSettings, Thresholds } from './types';

/** Defaults only; every value is user-editable and persisted per browser. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  budgetAttentionPct: 90,
  budgetCriticalPct: 100,
  unusualSpendPct: 50,
  minDailySpend: 5,
  unusualTokensPct: 50,
  minDailyTokens: 10000,
  successSloPct: 99,
  successCriticalPct: 97,
  errorRateAttentionPct: 1,
  errorRateCriticalPct: 3,
  throttledAttentionPct: 1,
  throttledCriticalPct: 5,
  latencySloMs: 2500,
  latencyCriticalMs: 4000,
  untaggedSharePct: 10,
  anonymousSharePct: 2,
  authSpikePct: 100,
  minAuthEvents: 20,
  consumerTrendAttentionPct: 40,
};

export const THRESHOLD_LABELS = {
  unusualTokensPct: { label: 'Unusual consumption: increase vs 14-day baseline', unit: '%' },
  minDailyTokens: { label: 'Unusual consumption: minimum daily tokens', unit: 'tokens' },
  successSloPct: { label: 'Observed success rate: attention below', unit: '%' },
  successCriticalPct: { label: 'Observed success rate: critical below', unit: '%' },
  errorRateAttentionPct: { label: 'Error rate: attention above', unit: '%' },
  errorRateCriticalPct: { label: 'Error rate: critical above', unit: '%' },
  throttledAttentionPct: { label: 'Throttled requests: attention above', unit: '%' },
  throttledCriticalPct: { label: 'Throttled requests: critical above', unit: '%' },
  latencySloMs: { label: 'Average latency: attention above', unit: 'ms' },
  latencyCriticalMs: { label: 'Average latency: critical above', unit: 'ms' },
  anonymousSharePct: { label: 'Anonymous gateway traffic share', unit: '%' },
  authSpikePct: { label: '401/403 spike vs previous period', unit: '%' },
  minAuthEvents: { label: '401/403 spike: minimum events', unit: '#' },
  consumerTrendAttentionPct: { label: 'Consumer token trend: attention above', unit: '%' },
} satisfies Partial<Record<keyof Thresholds, { label: string; unit: string }>>;

export const DEFAULT_SETTINGS: DashboardSettings = {
  costSubscriptionId: '',
  costScope: 'ai',
  tagKey: 'cost-center',
  budgetName: '',
};

function usePersisted<T extends object>(key: string, defaults: T) {
  const [value, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      /* ignore corrupt storage */
    }
    return defaults;
  });
  const set = useCallback((next: T) => {
    setState(next);
    localStorage.setItem(key, JSON.stringify(next));
  }, [key]);
  const reset = useCallback(() => {
    setState(defaults);
    localStorage.removeItem(key);
  }, [key, defaults]);
  return { value, set, reset };
}

export function useThresholds() {
  const { value, set, reset } = usePersisted('exec-dashboard-thresholds-v2', DEFAULT_THRESHOLDS);
  return { thresholds: value, setThresholds: set, reset };
}

export function useDashboardSettings() {
  const { value, set, reset } = usePersisted('exec-dashboard-settings-v2', DEFAULT_SETTINGS);
  return { settings: value, setSettings: set, resetSettings: reset };
}
