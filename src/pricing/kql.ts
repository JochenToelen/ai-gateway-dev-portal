import type { PricingRule } from './types';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");
const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Cached prompt tokens are not part of the current ApiManagementGatewayLlmLog telemetry. When a
 * column becomes available, set its name here (e.g. via column_ifexists) and cost calculation picks
 * it up without further changes.
 */
export const CACHED_TOKENS_COLUMN: string | null = null;

export interface CostQueryFilters {
  /** KQL expression, e.g. ago(7d) or datetime('...') */
  start: string;
  /** optional KQL expression for the upper bound (inclusive) */
  end?: string;
  models?: string[];
  deployments?: string[];
  subscriptions?: string[];
  apis?: string[];
}

function datatable(rules: PricingRule[]): string {
  const active = rules.filter((r) => r.isActive);
  const dt = (iso: string | undefined) => (iso ? `datetime(${new Date(iso).toISOString()})` : 'datetime(null)');
  const rows = active.length
    ? active.map((r) => [
      `'${esc(r.id)}'`, `'${esc(lower(r.modelName))}'`, `'${esc(lower(r.deploymentName))}'`, `'${esc(lower(r.region).replace(/\s+/g, ''))}'`,
      `decimal(${r.inputPricePerMillion.trim()})`, `decimal(${r.cachedInputPricePerMillion.trim()})`, `decimal(${r.outputPricePerMillion.trim()})`,
      `'${esc(r.currency.toUpperCase())}'`, dt(r.validFrom), dt(r.validTo),
    ].join(', '))
    // a row that can never match keeps the datatable valid when no rule exists
    : ["'', '__none__', '', '', decimal(0), decimal(0), decimal(0), '', datetime(1970-01-01), datetime(null)"];
  return `datatable(RuleId:string, PModel:string, PDep:string, PReg:string, InPrice:decimal, CachedPrice:decimal, OutPrice:decimal, Currency:string, ValidFrom:datetime, ValidTo:datetime)[\n${rows.join(',\n')}\n]`;
}

const inList = (col: string, values: string[] | undefined) =>
  values?.length ? `| where ${col} in (${values.map((v) => `'${esc(v)}'`).join(', ')})` : '';

/**
 * Pricing is resolved inside Log Analytics: the (small) pricing table is inlined as a datatable and
 * joined to every LLM log row by model, then filtered to rules that are effective at TimeGenerated
 * (ValidFrom <= t < ValidTo) and matching the optional deployment/region. The most specific rule wins
 * (deployment+region > deployment > region > model, then latest ValidFrom). Rows with no rule are
 * flagged Priced=false and never receive another model's price. Output is aggregated per day and
 * dimension, so no request-level telemetry reaches the browser.
 */
export function buildCostQuery(rules: PricingRule[], f: CostQueryFilters): string {
  const endC = f.end ? `| where TimeGenerated <= ${f.end}` : '';
  const cached = CACHED_TOKENS_COLUMN ? `coalesce(tolong(column_ifexists('${esc(CACHED_TOKENS_COLUMN)}', long(0))), 0)` : 'long(0)';
  return `
let Pricing = ${datatable(rules)};
let Gw = ApiManagementGatewayLogs
| where TimeGenerated > ${f.start}
${endC}
| summarize Subscription=tostring(take_any(ApimSubscriptionId)), Api=tostring(take_any(ApiId)) by CorrelationId;
let U = materialize(
ApiManagementGatewayLlmLog
| where TimeGenerated > ${f.start}
${endC}
| extend Region = tostring(column_ifexists('Region', '')), Prompt = coalesce(tolong(PromptTokens), 0), Completion = coalesce(tolong(CompletionTokens), 0), Cached = ${cached}
| join kind=leftouter Gw on CorrelationId
| extend Model = iff(isnotempty(ModelName), tostring(ModelName), iff(isnotempty(DeploymentName), tostring(DeploymentName), '(not logged)')), Deployment = iff(isempty(DeploymentName), '(not logged)', tostring(DeploymentName)), Region = iff(isempty(Region), '(unknown)', Region)
${inList('Model', f.models)}
${inList('Deployment', f.deployments)}
${inList('Subscription', f.subscriptions)}
${inList('Api', f.apis)}
| project TimeGenerated, Model, Deployment, Region, Subscription, Api, Prompt, Completion, Cached,
    MKey = tolower(Model), DKey = tolower(Deployment), RKey = replace_string(tolower(Region), ' ', '')
| serialize
| extend Rn = row_number());
let Best = U
| join kind=inner Pricing on $left.MKey == $right.PModel
| where (PDep == '' or PDep == DKey) and (PReg == '' or PReg == RKey)
| where TimeGenerated >= ValidFrom and (isnull(ValidTo) or TimeGenerated < ValidTo)
| extend Score = (iff(PDep != '', 2, 0) + iff(PReg != '', 1, 0)) * 1000000000000 + datetime_diff('minute', ValidFrom, datetime(2000-01-01))
| summarize arg_max(Score, RuleId, InPrice, CachedPrice, OutPrice, Currency) by Rn;
U
| join kind=leftouter Best on Rn
| extend Priced = isnotempty(RuleId), NonCached = max_of(Prompt - Cached, 0)
| extend InCost = iff(Priced, todecimal(NonCached) * InPrice / 1000000, decimal(0)),
    CachedCost = iff(Priced, todecimal(Cached) * CachedPrice / 1000000, decimal(0)),
    OutCost = iff(Priced, todecimal(Completion) * OutPrice / 1000000, decimal(0))
| summarize Requests = count(), PromptTokens = sum(Prompt), CompletionTokens = sum(Completion), CachedTokens = sum(Cached),
    InCost = tostring(sum(InCost)), CachedCost = tostring(sum(CachedCost)), OutCost = tostring(sum(OutCost)),
    FirstSeen = min(TimeGenerated), LastSeen = max(TimeGenerated)
  by Day = format_datetime(bin(TimeGenerated, 1d), 'yyyy-MM-dd'), Model, Deployment, Region, Subscription, Api, Priced
| take 50000`.trim();
}
