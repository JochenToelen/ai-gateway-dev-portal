import { compact, money, pct, signedPct } from './format';
import type { Alert, Thresholds, UsageTotals } from './types';

export interface AlertInput {
  t: Thresholds;
  hasGateway: boolean;
  hasCost: boolean;
  cur: UsageTotals;
  prev: UsageTotals;
  /** daily values for the last 17 complete days, oldest first */
  spendDaily: number[];
  tokensDaily: number[];
  budget: { name: string; monthly: number; forecast: number; estimate: boolean } | null;
  untaggedSharePct: number | null;
  anonymousSharePct: number | null;
  subscriptionsWithoutOwner: number;
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function spike(daily: number[], min: number, thresholdPct: number): { recent: number; base: number; pctUp: number } | null {
  const recent = avg(daily.slice(-3));
  const base = avg(daily.slice(0, -3));
  if (recent < min || base <= 0) return null;
  const pctUp = (recent / base - 1) * 100;
  return pctUp >= thresholdPct ? { recent, base, pctUp } : null;
}

export function buildAlerts(i: AlertInput): Alert[] {
  const { t } = i;
  const out: Alert[] = [];

  if (i.budget && i.budget.monthly > 0) {
    const ratio = (i.budget.forecast / i.budget.monthly) * 100;
    if (ratio >= t.budgetAttentionPct) {
      out.push({
        id: 'budget', category: 'Cost', severity: ratio >= t.budgetCriticalPct ? 'critical' : 'attention',
        title: ratio >= t.budgetCriticalPct ? 'Forecast exceeds budget' : 'Forecast approaching budget',
        detail: `${i.budget.estimate ? 'Run-rate estimate' : 'Forecast'} ${money(i.budget.forecast)} for the month vs budget "${i.budget.name}" ${money(i.budget.monthly)} (${pct(ratio, 0)}).`,
      });
    }
  }

  if (i.hasCost) {
    const s = spike(i.spendDaily, t.minDailySpend, t.unusualSpendPct);
    if (s) {
      out.push({
        id: 'spend-spike', category: 'Cost', severity: 'attention', title: 'Unusual spend increase',
        detail: `Average daily spend over the last 3 days is ${money(s.recent)}, ${signedPct(s.pctUp)} vs the ${money(s.base)} baseline of the prior 14 days.`,
      });
    }
  }

  if (i.hasGateway) {
    const s = spike(i.tokensDaily, t.minDailyTokens, t.unusualTokensPct);
    if (s) {
      out.push({
        id: 'token-spike', category: 'Consumption', severity: 'attention', title: 'Unusual token consumption',
        detail: `Average daily tokens over the last 3 days are ${compact(s.recent)}, ${signedPct(s.pctUp)} vs a ${compact(s.base)} baseline.`,
      });
    }

    const { cur } = i;
    if (cur.requests > 0) {
      const successPct = ((cur.requests - cur.failed - cur.throttled) / cur.requests) * 100;
      const errPct = (cur.failed / cur.requests) * 100;
      const thrPct = (cur.throttled / cur.requests) * 100;
      const lat = cur.latencySumMs / cur.requests;
      if (successPct < t.successSloPct) {
        out.push({
          id: 'success', category: 'Reliability', severity: successPct < t.successCriticalPct ? 'critical' : 'attention',
          title: 'Observed success rate below target',
          detail: `${pct(successPct, 2)} of gateway requests succeeded (target ${pct(t.successSloPct)}).`,
        });
      }
      if (errPct >= t.errorRateAttentionPct) {
        out.push({
          id: 'errors', category: 'Reliability', severity: errPct >= t.errorRateCriticalPct ? 'critical' : 'attention',
          title: 'Error rate elevated', detail: `${pct(errPct, 2)} of requests returned an error (HTTP 4xx/5xx excluding 429).`,
        });
      }
      if (thrPct >= t.throttledAttentionPct) {
        out.push({
          id: 'throttle', category: 'Reliability', severity: thrPct >= t.throttledCriticalPct ? 'critical' : 'attention',
          title: 'Throttled requests', detail: `${pct(thrPct, 2)} of requests were throttled (HTTP 429), ${compact(cur.throttled)} in total.`,
        });
      }
      if (lat >= t.latencySloMs) {
        out.push({
          id: 'latency', category: 'Reliability', severity: lat >= t.latencyCriticalMs ? 'critical' : 'attention',
          title: 'Average latency high', detail: `Average gateway latency is ${Math.round(lat).toString()} ms (threshold ${t.latencySloMs.toString()} ms).`,
        });
      }
    }

    if (i.cur.authFailures >= t.minAuthEvents && i.prev.authFailures > 0) {
      const up = (i.cur.authFailures / i.prev.authFailures - 1) * 100;
      if (up >= t.authSpikePct) {
        out.push({
          id: 'auth', category: 'Governance', severity: 'attention', title: '401/403 responses spiking',
          detail: `${compact(i.cur.authFailures)} authentication/authorisation rejections, ${signedPct(up)} vs the previous period.`,
        });
      }
    }

    if (i.anonymousSharePct !== null && i.anonymousSharePct >= t.anonymousSharePct) {
      out.push({
        id: 'anon', category: 'Governance', severity: 'attention', title: 'Gateway traffic without a subscription',
        detail: `${pct(i.anonymousSharePct)} of requests carry no APIM subscription id, so they cannot be attributed to a consumer.`,
      });
    }
    if (i.subscriptionsWithoutOwner > 0) {
      out.push({
        id: 'owner', category: 'Governance', severity: 'attention', title: 'Subscriptions without an owner',
        detail: `${i.subscriptionsWithoutOwner.toString()} active APIM subscription(s) have no owner recorded.`,
      });
    }
  }

  if (i.untaggedSharePct !== null && i.untaggedSharePct >= t.untaggedSharePct) {
    out.push({
      id: 'untagged', category: 'Governance', severity: 'attention', title: 'Spend without a cost-centre tag',
      detail: `${pct(i.untaggedSharePct)} of spend in the period is not tagged, so it cannot be attributed to a cost centre.`,
    });
  }

  const rank = { critical: 0, attention: 1 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
