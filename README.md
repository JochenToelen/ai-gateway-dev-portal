# AI Gateway Dev Portal

![Preview](docs/banner.png)

A starting point for building your own developer portal on top of Azure API Management AI Gateways. Fork it, open it in VS Code with GitHub Copilot (or any coding agent), and shape it to fit your organization.

This isn't a finished product — it's a foundation. The codebase is structured so that an AI coding assistant can understand and extend it: clear page patterns, consistent component conventions, and a single CSS file with predictable class naming. Ask your agent to add a page, wire up a new API, or restyle the whole thing.



## 🚀 Quick start

Try the hosted version at **https://icy-water-005686203.6.azurestaticapps.net**

Or run it locally with a single command (requires [Node.js](https://nodejs.org/) 20+):

```bash
npx github:Azure-Samples/ai-gateway-dev-portal
```

This downloads the repo, installs dependencies, and starts the dev server — no cloning required. The browser opens automatically at `http://localhost:5173`.

Then sign in with your Azure credentials or an access token.

![Preview](docs/preview.png)

Three sign-in options out of the box:
- **Microsoft Entra ID** — MSAL redirect flow with multi-tenant support
- **Bring your own app registration** — supply your own Entra ID client ID from the sign-in page, no rebuild required
- **Access token** — paste a token from `az account get-access-token` for quick CLI-based access

## What's included

The portal ships with working pages that cover the core Azure API Management AI gateway surface. Use them as-is, modify them, or tear them out and build something different.

| Page | What it does |
|---|---|
| **Dashboard** | At-a-glance KPI tiles (requests, tokens, latency, availability) with trend indicators against a configurable baseline (day/week/month/year). Tokens-by-subscription line chart with interactive legend. Resource list tiles for Inference APIs, MCP Servers, A2A Integrations, and Subscriptions with click-through navigation. |
| **AI Gateway consumption** | Executive view of token consumption and *estimated* model cost per model and subscription, based on the AI model pricing table. |
| **AI Model Pricing** | Maintain effective-dated token prices (input, cached input, output per 1M tokens) with an audit trail; stored as JSON in blob storage (or a local file). See [AI model pricing](#ai-model-pricing-and-estimated-cost). |
| **Registry** | Browse API assets in the API Center linked to your APIM instance. |
| **Model providers** | Browse AI backends with auto-detected provider types (Foundry, Azure OpenAI, OpenAI, Gemini, Anthropic, Bedrock, Hugging Face). Inspect pool members, weights, priorities, and circuit breaker rules. |
| **Inference APIs** | List inference APIs with provider badges, tag filtering, and detail panels showing subscriptions, revisions, releases, and products. |
| **MCP servers** | Manage Model Context Protocol servers and API-backed MCP endpoints. Filter by source type. |
| **A2A integrations** | Browse agent-to-agent configurations with agent IDs and routing paths. Connect to agents from the A2A Playground to test interactions. |
| **Products** | Full CRUD — create, publish, unpublish, delete products and manage API associations. |
| **Subscriptions** | Manage keys (masked display, copy, regenerate), state (activate, suspend, cancel), and scoped access. |
| **Playground** | Three playground modes: **Model** — interactive chat for testing inference APIs with streaming, code generation (JS/Python/cURL), full gateway trace visualization, token usage breakdown, and MCP tool selection; **MCP** — connect to MCP servers, browse resources/prompts/tools, execute tools, and inspect traces; **A2A** — connect to A2A agents, view agent cards (skills, tags, examples, capabilities), send messages with streaming or blocking mode, click-to-fill example prompts, and inspect full gateway traces. |
| **Labs** | Browse educational lab scenarios from the AI Gateway community. Search, filter by category/service/tags, sort, and view architecture diagrams with links to GitHub repos. |
| **Logs** | KQL queries against `ApiManagementGatewayLlmLog` with time range and model filters. Click any row for full input/output. |
| **Requests** | Request volume analytics — requests over time by subscription and by model, success vs error breakdown, and latency distribution. Shared toolbar with time range, granularity, and multi-select model/subscription filters. |
| **Tokens** | Token usage analytics — total tokens over time by subscription, input/output token breakdown, and throughput charts. |
| **Performance** | Latency analytics — P50/P95/P99 percentile trends, latency by model, request throughput, and ms-per-token efficiency. |
| **Availability** | Reliability analytics — success/error rates over time, success rate percentage, throttling trends, and error breakdown by response code. |

### Bearer token authentication in playgrounds

Both the **Model Playground** and **MCP Playground** support sending an Entra ID bearer token with requests via a **Send bearer token** toggle. When enabled:

- The portal acquires a token using MSAL (silent first, with interactive popup fallback) and sends it in the `Authorization` header
- You can specify a **custom token scope** (e.g. `api://<app-id>/.default`) to target a specific audience — leave it empty to use the default ARM scope (`https://management.azure.com/.default`)
- In the Model Playground, the bearer token is also forwarded to MCP tool servers referenced in the request
- The send bearer token toggle takes precedence over the API-level bearer token setting from Inference APIs

In the **trace window** (available on every request), you can click **Decode JWT** to expand the token header and payload inline — useful for verifying claims, audiences, and expiration without leaving the portal.

### Shared analytics features

All analytics pages (Dashboard, Requests, Tokens, Performance, Availability) share a common toolbar with:

- **Time range** — 30m to 30d presets, or custom date range picker
- **Auto-refresh** — configurable interval (1/5/15/30 min)
- **Granularity** — auto or manual (1m to 30d), resolved based on time range
- **Filters** — multi-select model and subscription dropdowns
- **Fullscreen** — expand any chart section to full screen
- **Interactive legends** — hover to highlight a series, click to lock focus

Plus: workspace selector (subscription → APIM instance → workspace), global `Ctrl+K` search, light/dark/system theme, and multi-tenant directory switching.

---

## Extend it with a coding agent

The codebase follows repeatable patterns designed for AI-assisted development:

- **Pages** follow a consistent structure: toolbar (search + filters) → table → detail panel. Adding a new page means replicating this pattern.
- **Services** are centralized in `src/services/azure.ts` — all Azure SDK and REST API calls in one file.
- **Types** live in `src/types.ts` — all interfaces in one place.
- **Styles** use a single `src/index.css` with BEM-like prefixed classes (`.sub-*`, `.mp-*`, `.logs-*`).
- **Navigation** is a single array in `src/components/Sidebar.tsx`.

**Example prompts for your coding agent:**

- *"Add rate limit information to the Inference APIs detail panel"*
- *"Change the theme colors to match our company brand"*

The repo includes ready-to-use **prompt files** in [`.github/prompts/`](.github/prompts/) that coding agents can run directly:

| Prompt file | What it builds |
|---|---|
| [`registry.prompt.md`](.github/prompts/registry.prompt.md) | An API Registry page powered by Azure API Center — browse, filter, and inspect API assets, versions, and deployments ([docs](docs/prompts/registry.md)) |
| [`evals.prompt.md`](.github/prompts/evals.prompt.md) | A Model Evals page that reuses Logs data and runs promptfoo-style model-graded evaluations through an Inference API endpoint ([docs](docs/prompts/evals.md)) |
| [`costs.prompt.md`](.github/prompts/costs.prompt.md) | A Costs page with FinOps financial metrics, budget tracking charts, and Azure Monitor custom table integration ([docs](docs/prompts/costs.md)) |

In VS Code with GitHub Copilot, open a prompt file and run it — or point your coding agent at one and let it build the feature end-to-end. Use these as templates to create your own prompt files for additional features.

The repo also includes a [KQL skill](.github/skills/apim-kql/SKILL.md) with Azure Monitor table schemas and query examples — coding agents that support skills can use this to generate accurate KQL queries.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- An Azure subscription with at least one API Management instance
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) for deployment

---

## 1. Configure the Entra ID app registration

In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**:

| Setting | Value |
|---|---|
| Name | `AI Gateway Dev Portal` |
| Supported account types | **Accounts in any organizational directory** (multi-tenant) |
| Redirect URI — Platform | **Single-page application (SPA)** |
| Redirect URI — URI | `http://localhost:5173` |

Note the **Application (client) ID**.

Or via CLI:

```bash
az ad app create \
  --display-name "AI Gateway Dev Portal" \
  --sign-in-audience AzureADMultipleOrgs
```

Add the SPA redirect URI (if created via CLI):

```bash
OBJECT_ID=$(az ad app show --id <APP_ID> --query id -o tsv)

az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$OBJECT_ID" \
  --headers "Content-Type=application/json" \
  --body '{"spa":{"redirectUris":["http://localhost:5173"]}}'
```

Add the required API permission:

```bash
az ad app permission add \
  --id <APP_ID> \
  --api 797f4846-ba00-4fd7-ba43-dac1f8f63013 \
  --api-permissions 41094075-9dad-400e-a0bd-54e686782033=Scope
```

When deploying, add your deployed URL as an additional redirect URI:

```bash
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$OBJECT_ID" \
  --headers "Content-Type=application/json" \
  --body '{"spa":{"redirectUris":["http://localhost:5173","https://<your-deployed-url>"]}}'
```

---

## 2. To run locally

### Option A: npx (no clone needed)

```bash
npx github:Azure-Samples/ai-gateway-dev-portal
```

### Option B: Clone and run

```bash
git clone https://github.com/Azure-Samples/ai-gateway-dev-portal.git
cd ai-gateway-dev-portal
npm install
cp .env.example .env   # set VITE_AZURE_CLIENT_ID to your app's client ID
npm run dev
```

Open `http://localhost:5173` and sign in.

> The dev server includes a built-in CORS proxy (`/gateway-proxy/*` → APIM gateway), so the Playground works without additional CORS configuration.

---

## 3. Deploy

Build first (Vite inlines env vars at build time):

```bash
export VITE_AZURE_CLIENT_ID=<YOUR_CLIENT_ID>
npm run build
```

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```powershell
$env:VITE_AZURE_CLIENT_ID = "<YOUR_CLIENT_ID>"
npm run build
```
</details>

### Option A: Azure Static Web Apps

```bash
az staticwebapp create \
  --name ai-gateway-dev-portal \
  --resource-group <RESOURCE_GROUP> \
  --location eastus2 \
  --sku Free

SWA_TOKEN=$(az staticwebapp secrets list \
  --name ai-gateway-dev-portal \
  --resource-group <RESOURCE_GROUP> \
  --query properties.apiKey -o tsv)

npx @azure/static-web-apps-cli deploy ./dist \
  --deployment-token $SWA_TOKEN \
  --env default
```

### Option B: Azure Container Apps (AZD, scale to zero)

`infra/main.bicep` (Azure Verified Modules) reuses the existing resource group resources: Log Analytics workspace, Consumption Container Apps environment, Basic Container Registry, user-assigned managed identity (AcrPull + **Storage Blob Data Contributor** on pricing storage), and the Container App (0–2 replicas, 0.25 vCPU / 0.5 Gi). AZD builds the image remotely in ACR, so a local Docker installation is not required. The app reads pricing from `https://stoaigwinsightswc001.blob.core.windows.net/ai-model-pricing/ai-model-pricing.json`.

**Prerequisites:** Azure Developer CLI, Azure CLI authentication, `Contributor` + `User Access Administrator` (or Owner) on the resource group, the pricing storage account in the same resource group, and an Entra app registration.

**First-time setup (PowerShell):**

```powershell
azd auth login
azd env new aigatewayinsights-dev --no-prompt
azd env set AZURE_SUBSCRIPTION_ID 6baf7cb2-2fb1-4636-8499-0ec168da856a
azd env set AZURE_LOCATION swedencentral
azd env set AZURE_RESOURCE_GROUP rg-aigatewayinsights-dev
azd env set VITE_AZURE_CLIENT_ID <YOUR_CLIENT_ID>
azd env set PRICING_EDITORS "admin@contoso.com"
azd provision auth-vault --preview --no-prompt
azd provision auth-vault --no-prompt
```

The `auth-vault` layer creates only the Key Vault and grants the existing Container App identity `Key Vault Secrets User`. Find the vault name in `azd env get-values`, then add the Entra app registration client secret to the vault as `aca-auth-client-secret` using the Azure portal. Do not pass the secret through a shell command, repository file, or chat. Set `AUTH_CLIENT_SECRET_URI` to the resulting versioned secret URI. Add `https://<app-fqdn>` and `https://<app-fqdn>/sso-silent.html` as SPA redirect URIs, plus `https://<app-fqdn>/.auth/login/aad/callback` as the Web redirect URI. Enable ID-token issuance for the app registration's hybrid flow; leave access-token issuance disabled unless otherwise required. The portal silently requests its Azure Management token from the existing Entra session and retains the sign-in form if silent SSO is unavailable. The app layer requires a non-empty client ID and secret URI, so it cannot deploy without authentication configured. Finish with:

```powershell
azd env set AUTH_CLIENT_SECRET_URI "https://<vault-name>.vault.azure.net/secrets/aca-auth-client-secret/<version>"
azd provision app --preview --no-prompt
azd up --no-prompt
```

The `.azure` environment files are ignored by Git. Never put the client secret in the repository or chat.

**Legacy manual deployment (Bicep/PowerShell):** This route does not configure Container Apps Entra authentication; use AZD when the portal needs the protected access path.

```powershell
az login
./infra/deploy.ps1 -ClientId <YOUR_CLIENT_ID> -PricingEditors "admin@contoso.com"
```

The script deploys the infrastructure with a placeholder image, builds the portal image in ACR (`az acr build`, baking in `VITE_AZURE_CLIENT_ID`), redeploys the app with that image on port 8080 and prints the URL.

**Manual steps (equivalent):**

```powershell
az account set --subscription 6baf7cb2-2fb1-4636-8499-0ec168da856a
$rg = "rg-aigatewayinsights-dev"

# 1. Infrastructure
az deployment group create -g $rg -f infra/main.bicep -p infra/main.bicepparam

# 2. Build the image in ACR
$acr = az acr list -g $rg --query "[0].name" -o tsv
az acr build -r $acr -t ai-gateway-dev-portal:1 --build-arg VITE_AZURE_CLIENT_ID=<YOUR_CLIENT_ID> .

# 3. Run the real image
az deployment group create -g $rg -f infra/main.bicep -p infra/main.bicepparam `
  -p containerImage="$acr.azurecr.io/ai-gateway-dev-portal:1" targetPort=8080 pricingEditors="admin@contoso.com"
```

**After deploying with the legacy route:**

1. Add `https://<containerAppFqdn>` (deployment output) as a SPA redirect URI on the Entra app registration (step 1).
2. Make sure the blob `ai-model-pricing/ai-model-pricing.json` exists or let the first save in **AI Model Pricing** create it.
3. Restrict who can reach the app with Container Apps authentication if `pricingEditors` is empty.

AZD infrastructure and parameters are in `infra/azd/`; the legacy manual route continues to use `infra/main.bicep` and `infra/main.bicepparam`.

---

## 4. CI/CD with GitHub Actions

Add secrets in **Settings → Secrets → Actions**:

| Secret | Value |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deployment token |
| `VITE_AZURE_CLIENT_ID` | Entra ID app client ID |

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure Static Web Apps

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]

jobs:
  build-and-deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /
          output_location: dist
        env:
          VITE_AZURE_CLIENT_ID: ${{ secrets.VITE_AZURE_CLIENT_ID }}

  close-pull-request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Close staging environment
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: close
```

---

## AI model pricing and estimated cost

The **AI Model Pricing** page maintains effective-dated token prices (per 1M input, cached input and output tokens). The **AI Gateway consumption** and **Tokens** pages use them to show *estimated* model cost from `ApiManagementGatewayLlmLog` (joined to `ApiManagementGatewayLogs` on `CorrelationId`). Pricing is resolved inside Log Analytics; the browser only receives daily aggregates. Requests with no matching rule are flagged as missing pricing and excluded from cost totals. Cached tokens are not in current APIM telemetry, so they count as 0.

The pricing table is one JSON document behind the same-origin endpoint `/api/pricing` (`server/pricing-api.mjs`). The browser holds no storage credentials or tokens.

| Environment | Where the document lives | How it is accessed |
| --- | --- | --- |
| Local (`npm run dev`) | `./data/ai-model-pricing.json` (override with `PRICING_FILE`; git-ignored) | Plain file on disk, created on first save |
| Azure Container Apps | Blob set in `PRICING_BLOB_URL` | The app's **managed identity** (`DefaultAzureCredential`) |

Container Apps setup:

1. Build and deploy the image (`Dockerfile`; `server/server.mjs` serves the SPA and the API on port 8080).
2. Enable a system-assigned managed identity on the Container App and give it **Storage Blob Data Contributor** on the container that holds the blob.
3. Set `PRICING_BLOB_URL=https://<account>.blob.core.windows.net/<container>/ai-model-pricing.json`. No CORS rule is needed because the browser never calls storage.
4. Optional: `PRICING_EDITORS` (comma-separated object ids or e-mails, as passed by Container Apps authentication in `X-MS-CLIENT-PRINCIPAL-ID`/`-NAME`) restricts who may change prices; others get read-only access. Unset means everyone who can reach the app can edit, so protect the app with Container Apps authentication.

To debug against the cloud document locally, set `PRICING_BLOB_URL` in `.env` and run `az login` (your identity needs the same role). Every change is audited inside the document (who, when, old and new values), and concurrent edits are detected with ETags. Run tests with `npm test`.
## Project structure

```
src/
├── App.tsx                    # Routes and auth gating
├── main.tsx                   # MSAL + theme + token auth providers
├── types.ts                   # All TypeScript interfaces
├── index.css                  # All styles (single file, prefixed classes)
├── config/msal.ts             # MSAL configuration
├── context/
│   ├── AzureContext.tsx        # Central state: subscriptions, services, workspace data
│   ├── TokenAuthContext.tsx    # Access token auth state
│   └── ThemeContext.tsx        # Light/dark/system theme
├── services/azure.ts          # All Azure SDK + REST API calls
├── hooks/
│   └── useLegendHighlight.ts  # Interactive chart legend highlight + lock
├── components/
│   ├── Layout.tsx              # Shell (header + sidebar + content)
│   ├── Header.tsx              # Top bar with workspace selector + search
│   ├── Sidebar.tsx             # Navigation (single navItems array)
│   ├── AnalyticsToolbar.tsx    # Shared filters, time range, granularity, auto-refresh
│   ├── SearchBar.tsx           # Ctrl+K global search
│   ├── LoginPage.tsx           # Entra ID + token sign-in
│   ├── WorkspaceSelector.tsx   # Subscription → APIM → workspace picker
│   ├── UserMenu.tsx            # Profile, tenant switcher, theme, sign out
│   ├── CodeModal.tsx           # Generated code snippets (JS/Python/cURL)
│   ├── TraceModal.tsx          # Gateway trace pipeline viewer
│   ├── ConfirmModal.tsx        # Reusable confirmation dialog
│   └── LoadingModal.tsx        # Workspace loading progress
└── pages/
    ├── Dashboard.tsx           # KPI tiles, trend chart, resource list tiles
    ├── Requests.tsx            # Request volume analytics (drill-down)
    ├── Tokens.tsx              # Token usage analytics (drill-down)
    ├── Performance.tsx         # Latency & throughput analytics (drill-down)
    ├── Availability.tsx        # Success rate & error analytics (drill-down)
    ├── ModelProviders.tsx      # AI backends + pool/circuit breaker tabs
    ├── InferenceApis.tsx       # APIs with revisions, releases, products
    ├── McpServers.tsx          # MCP server management
    ├── A2A.tsx                 # Agent-to-agent configs
    ├── Playground.tsx          # Model playground — chat, streaming, tracing, code gen
    ├── McpPlayground.tsx       # MCP playground — connect, browse, execute tools, traces
    ├── Products.tsx            # Product CRUD + API associations
    ├── Subscriptions.tsx       # Key management + state control
    ├── Logs.tsx                # KQL-based LLM log viewer
    ├── Labs.tsx                # Educational lab scenario browser
    ├── Evals.tsx               # Evaluation runner (coming soon)
    └── NamedValues.tsx         # Named value management (coming soon)
```

---

## Model provider detection

Backends are auto-classified by URL pattern:

| URL pattern | Provider |
|---|---|
| `*.cognitiveservices.azure.com`, `*.services.ai.azure.com` | Foundry |
| `*.openai.azure.com` | Azure OpenAI |
| `generativelanguage.googleapis.com` | Gemini |
| `api.openai.com` | OpenAI |
| `api.anthropic.com` | Anthropic |
| `*.amazonaws.com`, `*.api.aws` | Bedrock |
| `*.huggingface.co` | Hugging Face |

For backend pools, the type is inferred from the first member that matches.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript 5.9 |
| Build | Vite 8 |
| Auth | MSAL Browser + MSAL React |
| Charts | Recharts |
| Azure SDK | `@azure/arm-apimanagement`, `@azure/arm-monitor`, `@azure/arm-machinelearning`, `@azure/arm-resources-subscriptions` |
| Icons | Lucide React |
| Routing | React Router 7 |
| Linting | ESLint (`recommendedTypeChecked` + `stylisticTypeChecked`) |

## License

[MIT](LICENSE)