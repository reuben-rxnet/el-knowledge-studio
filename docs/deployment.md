# Deployment (target architecture)

| Concern | Azure service |
| --- | --- |
| Web app | Azure Container Apps (Next.js standalone output) behind Front Door + WAF |
| Identity | Microsoft Entra ID (OIDC). Set `AUTH_PROVIDER=entra`. Demo auth is refused in production builds |
| Database | Azure Database for PostgreSQL Flexible Server. Change `provider` in `schema.prisma` and use `prisma migrate deploy` |
| Media | Azure Blob Storage per data region, private containers, SAS per request |
| Jobs | Azure Service Bus + Durable Functions (or Container Apps Jobs) per ContentGenerationJob |
| AI | OpenAI Codex through EssilorLuxottica APIM (see integrations.md). Azure AI Speech, Translator, Video Indexer and AI Search |
| Publishing | Microsoft Graph connectors (SharePoint, Teams, Stream). Leonardo and Knowzy adapters |
| Secrets | Azure Key Vault + Managed Identity |
| Telemetry | Application Insights (redacted) |

Before production: replace the placeholder product mark, connect Entra ID, set `MOCK_PUBLISHING_CONNECTORS=false` only after real connectors are registered, record the AI data-processing approval, and complete language review for non-English UI text.
