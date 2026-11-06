import type { MsalCredential } from '../services/azure';
import { queryLogAnalytics } from '../services/azure';
import { buildCostQuery, type CostQueryFilters } from './kql';
import { parseCostRows, type CostRow } from './report';
import type { PricingRule } from './types';
import type { ObservedModel } from './seed';

/** Distinct models seen in the LLM log, with their first request date (aggregated in Log Analytics). */
export async function loadObservedModels(credential: MsalCredential, apimResourceId: string, days = 90): Promise<ObservedModel[]> {
  const rows = await queryLogAnalytics(credential, apimResourceId,
    `ApiManagementGatewayLlmLog | where TimeGenerated > ago(${days.toString()}d) | extend ModelName = iff(isnotempty(ModelName), tostring(ModelName), tostring(DeploymentName)) | where isnotempty(ModelName) | summarize FirstSeen = min(TimeGenerated) by ModelName`);
  const list = rows.flatMap((r) => (typeof r.ModelName === 'string' && r.FirstSeen != null
    ? [{ modelName: r.ModelName, firstSeen: new Date(String(r.FirstSeen)).toISOString() }] : []));
  // one common start keeps defaults valid for the whole observed window, whichever model appeared first
  const earliest = list.reduce((m, o) => (o.firstSeen < m ? o.firstSeen : m), list[0]?.firstSeen ?? '');
  return list.map((o) => ({ ...o, firstSeen: earliest }));
}

/** Runs the priced, aggregated cost query in Log Analytics (no request-level rows reach the browser). */
export async function loadCostRows(
  credential: MsalCredential, apimResourceId: string, rules: PricingRule[], filters: CostQueryFilters,
): Promise<CostRow[]> {
  return parseCostRows(await queryLogAnalytics(credential, apimResourceId, buildCostQuery(rules, filters)));
}

