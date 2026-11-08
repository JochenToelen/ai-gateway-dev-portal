targetScope = 'resourceGroup'

param workloadName string = 'aigwportal'
param location string = resourceGroup().location
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param targetPort int = 8080
param pricingStorageAccountName string = 'stoaigwinsightswc001'
param pricingContainerName string = 'ai-model-pricing'
param pricingBlobName string = 'ai-model-pricing.json'
param pricingEditors string = ''
@minLength(1)
param authClientId string
@minLength(1)
param authClientSecretUri string
param tags object = {}

var suffix = uniqueString(resourceGroup().id)
var authClientSecretName = 'aca-auth-client-secret'
var pricingBlobUrl = 'https://${pricingStorageAccountName}.blob.${environment().suffixes.storage}/${pricingContainerName}/${pricingBlobName}'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-${workloadName}'
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: 'acr${workloadName}${suffix}'
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-10-02-preview' existing = {
  name: 'cae-${workloadName}'
}

module containerApp 'br/public:avm/res/app/container-app:0.16.0' = {
  name: 'containerApp'
  params: {
    name: 'ca-${workloadName}'
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    environmentResourceId: managedEnvironment.id
    managedIdentities: {
      userAssignedResourceIds: [
        identity.id
      ]
    }
    registries: [
      {
        server: registry.properties.loginServer
        identity: identity.id
      }
    ]
    secrets: [
      {
        name: authClientSecretName
        keyVaultUrl: authClientSecretUri
        identity: identity.id
      }
    ]
    ingressExternal: true
    ingressTargetPort: targetPort
    ingressAllowInsecure: false
    workloadProfileName: 'Consumption'
    scaleSettings: {
      cooldownPeriod: 300
      minReplicas: 0
      maxReplicas: 2
      pollingInterval: 30
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
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        ]
      }
    ]
  }
}

module authConfig 'br/public:avm/res/app/container-app/auth-config:0.1.0' = {
  name: 'authConfig'
  params: {
    containerAppName: 'ca-${workloadName}'
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureActiveDirectory'
    }
    httpSettings: {
      requireHttps: true
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          clientSecretSettingName: authClientSecretName
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [authClientId]
        }
      }
    }
    platform: {
      enabled: true
    }
  }
  dependsOn: [
    containerApp
  ]
}

output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.properties.loginServer
output WEB_URL string = 'https://${containerApp.outputs.fqdn}'
