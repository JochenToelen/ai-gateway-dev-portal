// Hosts the AI Gateway Dev Portal on Azure Container Apps (Consumption, scale to zero).
// Deploy: az deployment group create -g rg-aigatewayinsights-dev -f infra/main.bicep -p infra/main.bicepparam

targetScope = 'resourceGroup'

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Short workload name used in resource names.')
param workloadName string = 'aigwportal'

@description('Existing storage account that holds the AI model pricing JSON (must be in this resource group).')
param pricingStorageAccountName string = 'stoaigwinsightswc001'

@description('Blob container with the pricing file.')
param pricingContainerName string = 'ai-model-pricing'

@description('Pricing blob name.')
param pricingBlobName string = 'ai-model-pricing.json'

@description('Container image. Default is a placeholder so the infrastructure can be created before the first image is pushed; afterwards set it to <acr>.azurecr.io/ai-gateway-dev-portal:<tag>.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Port the container listens on (8080 for the portal image, 80 for the placeholder).')
param targetPort int = 80

@description('Comma-separated user principal names allowed to edit pricing (PRICING_EDITORS).')
param pricingEditors string = ''

param tags object = {}

var suffix = uniqueString(resourceGroup().id)
var pricingBlobUrl = 'https://${pricingStorageAccountName}.blob.${environment().suffixes.storage}/${pricingContainerName}/${pricingBlobName}'

// Built-in roles
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

module identity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.1' = {
  name: 'identity'
  params: {
    name: 'id-${workloadName}'
    location: location
    tags: tags
  }
}

module logs 'br/public:avm/res/operational-insights/workspace:0.11.1' = {
  name: 'logs'
  params: {
    name: 'log-${workloadName}'
    location: location
    tags: tags
    skuName: 'PerGB2018'
    dataRetention: 30
  }
}

module registry 'br/public:avm/res/container-registry/registry:0.9.1' = {
  name: 'registry'
  params: {
    name: 'acr${workloadName}${suffix}'
    location: location
    tags: tags
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    roleAssignments: [
      {
        principalId: identity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: acrPullRoleId
      }
    ]
  }
}

module managedEnvironment 'br/public:avm/res/app/managed-environment:0.10.0' = {
  name: 'managedEnvironment'
  params: {
    name: 'cae-${workloadName}'
    location: location
    tags: tags
    zoneRedundant: false
    publicNetworkAccess: 'Enabled'
    logsDestination: 'log-analytics'
    logAnalyticsWorkspaceResourceId: logs.outputs.resourceId
  }
}

module containerApp 'br/public:avm/res/app/container-app:0.16.0' = {
  name: 'containerApp'
  params: {
    name: 'ca-${workloadName}'
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    environmentResourceId: managedEnvironment.outputs.resourceId
    managedIdentities: {
      userAssignedResourceIds: [
        identity.outputs.resourceId
      ]
    }
    registries: [
      {
        server: registry.outputs.loginServer
        identity: identity.outputs.resourceId
      }
    ]
    ingressExternal: true
    ingressTargetPort: targetPort
    ingressAllowInsecure: false
    scaleSettings: {
      minReplicas: 0
      maxReplicas: 2
      rules: [
        {
          name: 'http'
          http: {
            metadata: {
              concurrentRequests: '50'
            }
          }
        }
      ]
    }
    containers: [
      {
        name: 'portal'
        image: containerImage
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: [
          { name: 'PORT', value: string(targetPort) }
          { name: 'PRICING_BLOB_URL', value: pricingBlobUrl }
          { name: 'PRICING_EDITORS', value: pricingEditors }
          { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
        ]
      }
    ]
  }
}

// Lets the managed identity read/write the pricing blob (existing storage account).
resource pricingStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: pricingStorageAccountName
}

resource pricingBlobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: pricingStorage
  name: guid(pricingStorage.id, identity.name, storageBlobDataContributorRoleId)
  properties: {
    principalId: identity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

output containerAppFqdn string = containerApp.outputs.fqdn
output containerRegistryLoginServer string = registry.outputs.loginServer
output containerRegistryName string = registry.outputs.name
output pricingBlobUrl string = pricingBlobUrl
