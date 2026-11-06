import type { MsalCredential } from '../../services/azure';
import { queryLogAnalytics } from '../../services/azure';
import type { GatewayRow } from '../types';

const esc = (s: string) => s.replace(/'/g, "''");

/**
 * Daily APIM-observed usage by model / deployment / subscription / API for the last `days` days.
 * Needs ApiManagementGatewayLogs and (for tokens and models) ApiManagementGatewayLlmLog diagnostics.
 * When inference APIs are known the base set is their gateway requests (so requests without an
 * LLM log row show up as "(not logged)"); otherwise only requests with an LLM log row are counted.
 */
export function buildGatewayQuery(days: number, inferenceApiIds: string[]): string {
  const apiFilter = inferenceApiIds.length > 0
    ? `| where ApiId in (${inferenceApiIds.map((a) => `'${esc(a)}'`).join(', ')})`
    : '';
  const llmOnly = inferenceApiIds.length > 0 ? '' : '| where isnotempty(LlmModel)';
  return `
let llm = ApiManagementGatewayLlmLog
| where TimeGenerated > ago(${days.toString()}d)
| summarize LlmModel=take_any(ModelName), LlmDeployment=take_any(DeploymentName),
    Prompt=sum(todouble(PromptTokens)), Completion=sum(todouble(CompletionTokens)) by LlmCorrelationId=CorrelationId;
ApiManagementGatewayLogs
| where TimeGenerated > ago(${days.toString()}d)
${apiFilter}
| join kind=leftouter llm on $left.CorrelationId == $right.LlmCorrelationId
${llmOnly}
| extend Code = toint(ResponseCode)
| summarize Requests=count(), PromptTokens=sum(Prompt), CompletionTokens=sum(Completion),
    Failed=countif(Code >= 400 and Code != 429), Throttled=countif(Code == 429),
    Auth=countif(Code == 401 or Code == 403), Latency=sum(todouble(TotalTime))
  by Day=format_datetime(bin(TimeGenerated, 1d), 'yyyy-MM-dd'),
     Model=iff(isempty(LlmModel), '(not logged)', tostring(LlmModel)),
     Deployment=iff(isempty(LlmDeployment), '(not logged)', tostring(LlmDeployment)),
     Subscription=tostring(ApimSubscriptionId), Api=tostring(ApiId)
| take 50000`;
}

export async function loadGatewayUsage(
  credential: MsalCredential,
  apimResourceId: string,
  inferenceApiIds: string[],
  days: number,
): Promise<GatewayRow[]> {
  const rows = await queryLogAnalytics(credential, apimResourceId, buildGatewayQuery(days, inferenceApiIds));
  return rows.map((r) => ({
    day: String(r.Day ?? ''),
    model: String(r.Model ?? '(not logged)'),
    deployment: String(r.Deployment ?? '(not logged)'),
    subscription: String(r.Subscription ?? ''),
    api: String(r.Api ?? ''),
    requests: Number(r.Requests ?? 0),
    promptTokens: Number(r.PromptTokens ?? 0),
    completionTokens: Number(r.CompletionTokens ?? 0),
    failed: Number(r.Failed ?? 0),
    throttled: Number(r.Throttled ?? 0),
    authFailures: Number(r.Auth ?? 0),
    latencySumMs: Number(r.Latency ?? 0),
  }));
}
