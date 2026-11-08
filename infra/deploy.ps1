#Requires -Version 5.1
<#
Full deploy of the portal to Azure Container Apps (scale to zero).
1. Deploys infra (registry, environment, identity, placeholder app)
2. Builds the image in ACR
3. Updates the app to the new image

Usage: ./infra/deploy.ps1 -ClientId <entra-app-client-id> [-PricingEditors a@x.com,b@x.com]
#>
param(
    [Parameter(Mandatory)] [string] $ClientId,
    [string] $SubscriptionId = '6baf7cb2-2fb1-4636-8499-0ec168da856a',
    [string] $ResourceGroup = 'rg-aigatewayinsights-dev',
    [string] $PricingEditors = '',
    [string] $Tag = (Get-Date -Format 'yyyyMMdd-HHmmss')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$template = Join-Path $PSScriptRoot 'main.bicep'
$params = Join-Path $PSScriptRoot 'main.bicepparam'

function Invoke-Az { & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" } }

Invoke-Az account set --subscription $SubscriptionId

Write-Host '==> 1/4 Deploying infrastructure (placeholder image)'
$infra = az deployment group create -g $ResourceGroup -f $template -p $params `
    -p pricingEditors=$PricingEditors --query properties.outputs -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure deployment failed' }
$acrName = $infra.containerRegistryName.value
$loginServer = $infra.containerRegistryLoginServer.value

Write-Host "==> 2/4 Building image in $acrName"
Push-Location $repoRoot
try {
    Invoke-Az acr build -r $acrName -t "ai-gateway-dev-portal:$Tag" `
        --build-arg "VITE_AZURE_CLIENT_ID=$ClientId" .
}
finally { Pop-Location }

Write-Host '==> 3/4 Deploying app with the real image'
$final = az deployment group create -g $ResourceGroup -f $template -p $params `
    -p pricingEditors=$PricingEditors containerImage="$loginServer/ai-gateway-dev-portal:$Tag" targetPort=8080 `
    --query properties.outputs -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Application deployment failed' }

Write-Host '==> 4/4 Done'
Write-Host "URL: https://$($final.containerAppFqdn.value)"
Write-Host 'Add this URL as a SPA redirect URI on the Entra app registration.'
