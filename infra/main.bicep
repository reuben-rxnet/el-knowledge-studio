// EL Knowledge Studio — Azure pilot environment.
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.parameters.json
// Everything authenticates with the Container App's managed identity: no storage keys, no passwords
// in configuration. Secrets (Entra client secret, session secret, AI gateway key) live in Key Vault
// and are referenced by the Container App; IT sets their values once after deployment.

targetScope = 'resourceGroup'

@description('Short environment name used in resource names, e.g. pilot, test, prod.')
param env string = 'pilot'
param location string = resourceGroup().location
@description('Container image, e.g. <acr>.azurecr.io/el-knowledge-studio:<tag>')
param image string
@description('Azure Container Registry name that holds the image (pull with managed identity).')
param acrName string
@description('Public URL of the app (Entra redirect base), e.g. https://knowledge-studio.essilorluxottica.com')
param appBaseUrl string
@description('Entra ID tenant and app registration (from the IAM team).')
param entraTenantId string
param entraClientId string
@description('Entra object id of the PostgreSQL administrator group (admins log in with Entra, not a password).')
param postgresAdminGroupObjectId string
param postgresAdminGroupName string
@secure()
@description('Bootstrap admin password (store it in Key Vault and rotate after creating the app database user).')
param postgresBootstrapPassword string
@description('Codex APIM gateway settings (non-secret); the key itself goes in Key Vault.')
param openAiBaseUrl string = 'https://dev-apim-ai.luxottica.com/codex/openai/v1'
param openAiModel string = 'gpt-5.3-codex_codeassist'
param llmEndpointAllowlist string = 'dev-apim-ai.luxottica.com'
param tags object = { application: 'el-knowledge-studio', environment: env }

var name = 'elks-${env}'
var unique = uniqueString(resourceGroup().id)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 90 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-insights'
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id, DisableLocalAuth: true }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv${replace(name, '-', '')}${unique}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled' // restrict with private endpoints in production
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('st${replace(name, '-', '')}${unique}', 24)
  location: location
  tags: tags
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // managed identity only
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    encryption: { services: { blob: { enabled: true } }, keySource: 'Microsoft.Storage' }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
    // Direct uploads: the browser PUTs blocks to a short-lived SAS URL (src/app/api/uploads/direct). Only the app's origin.
    cors: {
      corsRules: [
        { allowedOrigins: [ appBaseUrl ], allowedMethods: [ 'PUT', 'OPTIONS' ], allowedHeaders: [ 'content-type', 'x-ms-*' ], exposedHeaders: [ 'x-ms-*', 'etag' ], maxAgeInSeconds: 3600 }
      ]
    }
  }
}

resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'media'
  properties: { publicAccess: 'None' }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${name}-pg-${unique}'
  location: location
  tags: tags
  sku: { name: 'Standard_B2s', tier: 'Burstable' }
  properties: {
    version: '16'
    storage: { storageSizeGB: 64, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    // Admins sign in with Entra. The app uses a least-privilege database user whose password is in Key Vault
    // (database-url secret): Prisma can't refresh Entra access tokens itself. Revisit with a token-aware driver.
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Enabled', tenantId: subscription().tenantId }
    administratorLogin: 'elksadmin'
    administratorLoginPassword: postgresBootstrapPassword
    highAvailability: { mode: 'Disabled' } // enable ZoneRedundant for production
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'elks'
}

resource postgresAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: postgres
  name: postgresAdminGroupObjectId
  properties: { principalType: 'Group', principalName: postgresAdminGroupName, tenantId: subscription().tenantId }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } }
  }
}

var kvUri = vault.properties.vaultUri

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-app'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: acr.properties.loginServer, identity: 'system' }]
      secrets: [
        { name: 'entra-client-secret', keyVaultUrl: '${kvUri}secrets/entra-client-secret', identity: 'system' }
        { name: 'session-secret', keyVaultUrl: '${kvUri}secrets/session-secret', identity: 'system' }
        { name: 'openai-api-key', keyVaultUrl: '${kvUri}secrets/openai-api-key', identity: 'system' }
        { name: 'database-url', keyVaultUrl: '${kvUri}secrets/database-url', identity: 'system' }
      ]
    }
    template: {
      containers: [{
        name: 'web'
        image: image
        resources: { cpu: json('2.0'), memory: '4Gi' } // speech models and FFmpeg run in-process
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'AUTH_PROVIDER', value: 'entra' }
          { name: 'APP_BASE_URL', value: appBaseUrl }
          { name: 'ENTRA_TENANT_ID', value: entraTenantId }
          { name: 'ENTRA_CLIENT_ID', value: entraClientId }
          { name: 'ENTRA_CLIENT_SECRET', secretRef: 'entra-client-secret' }
          { name: 'SESSION_SECRET', secretRef: 'session-secret' }
          { name: 'DATABASE_URL', secretRef: 'database-url' }
          { name: 'STORAGE_PROVIDER', value: 'azure-blob' }
          { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
          { name: 'AZURE_STORAGE_CONTAINER', value: mediaContainer.name }
          { name: 'AI_PROVIDER', value: 'openai' }
          { name: 'OPENAI_BASE_URL', value: openAiBaseUrl }
          { name: 'OPENAI_MODEL', value: openAiModel }
          { name: 'OPENAI_API_STYLE', value: 'RESPONSES' }
          { name: 'OPENAI_AUTH_LOCATION', value: 'QUERY_PARAMETER' }
          { name: 'OPENAI_AUTH_QUERY_PARAMETER', value: 'subscription-key' }
          { name: 'OPENAI_EXTRA_HEADERS', value: 'x-openai-supplier: EssilorLuxottica' }
          { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
          { name: 'LLM_ENDPOINT_ALLOWLIST', value: llmEndpointAllowlist }
          { name: 'SPEECH_PROVIDER', value: 'local' }
          { name: 'MOCK_PUBLISHING_CONNECTORS', value: 'true' }
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        ]
        probes: [
          { type: 'Liveness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/api/health?ready=1', port: 3000 }, periodSeconds: 15 }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// Least-privilege roles for the app's managed identity.
var roles = {
  blobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  blobDelegator: 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.blobDataContributor)
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobDataContributor) }
}

// Direct uploads: the app signs short-lived upload links with a user delegation key (shared keys stay disabled).
// Blob Data Contributor already allows that; the explicit Delegator role keeps it working if that role is narrowed.
resource blobDelegatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.blobDelegator)
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobDelegator) }
}

resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, roles.keyVaultSecretsUser)
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser) }
}

resource acrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, app.id, roles.acrPull)
  properties: { principalId: app.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull) }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output keyVaultName string = vault.name
output storageAccount string = storage.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output appPrincipalId string = app.identity.principalId
