import type { MsalCredential } from '../../services/azure';
import type { GatewayRow, RawDashboardData, SourceState, SubscriptionMeta } from '../types';
import { loadGatewayUsage } from './logAnalytics';

export interface ConnectorContext {
  credential: MsalCredential;
  apimResourceId: string;
  inferenceApiIds: string[];
  apiNames: Record<string, string>;
  subscriptionMeta: Record<string, SubscriptionMeta>;
}

/** Gateway data is always fetched for 2 x the largest selectable period (current + previous). */
export const GATEWAY_DAYS = 180;

/**
 * Loads gateway usage only. Cost Management is deliberately not queried by this dashboard.
 */
export async function loadDashboardData(ctx: ConnectorContext): Promise<RawDashboardData> {
  let gateway: GatewayRow[] | null = null;
  let apimSource: SourceState;
  try {
    gateway = await loadGatewayUsage(ctx.credential, ctx.apimResourceId, ctx.inferenceApiIds, GATEWAY_DAYS);
    apimSource = {
      id: 'apim', name: 'APIM gateway logs (Log Analytics)', status: 'connected',
      detail: gateway.length === 0
        ? 'Connected, but no gateway or LLM log rows were returned. Check diagnostic settings.'
        : 'APIM gateway and LLM logs in Log Analytics',
    };
  } catch (error) {
    apimSource = {
      id: 'apim', name: 'APIM gateway logs (Log Analytics)', status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    gateway, cost: null,
    sources: [
      apimSource,
      {
        id: 'cost', name: 'Azure Cost Management', status: 'not-configured',
        detail: 'Not connected. Spend, budgets, forecasts, and cost attribution are omitted.',
      },
      {
    id: 'business', name: 'Business systems / Microsoft Foundry', status: 'not-configured',
    detail: 'Not connected: business value, users, provider availability and gateway-bypass detection are not measured.',
      },
    ],
    apiNames: ctx.apiNames, subscriptionMeta: ctx.subscriptionMeta,
    loadedAt: new Date().toISOString(),
  };
}
