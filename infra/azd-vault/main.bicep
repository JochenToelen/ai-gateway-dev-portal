targetScope = 'resourceGroup'

param workloadName string = 'aigwportal'
param location string = resourceGroup().location

var suffix = uniqueString(resourceGroup().id)
var authKeyVaultName = 'kvaigw${suffix}'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-${workloadName}'
}

module authKeyVault 'br/public:avm/res/key-vault/vault:0.14.2' = {
  name: 'authKeyVault'
  params: {
    name: authKeyVaultName
    location: location
    tags: resourceGroup().tags
    sku: 'standard'
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    enableVaultForDeployment: false
    enableVaultForDiskEncryption: false
    enableVaultForTemplateDeployment: false
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    roleAssignments: [
      {
        principalId: identity.properties.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Key Vault Secrets User'
      }
    ]
  }
}

output AZURE_KEY_VAULT_NAME string = authKeyVaultName
