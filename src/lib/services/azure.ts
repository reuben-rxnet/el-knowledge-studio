// AZURE PROVIDER STUBS — not implemented in the prototype.
// Each throws until configured so a misconfiguration fails loudly instead of silently mocking.
import type { GuideGenerationService, PublishingConnector } from "./interfaces";

class NotConfiguredError extends Error {
  constructor(service: string) {
    super(`${service} is not configured. Set MOCK_AI_SERVICES=true for local development or configure the provider (see docs/integrations.md).`);
  }
}

// TODO(azure-openai): call the Azure OpenAI deployment (AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_DEPLOYMENT)
// with the versioned prompt from src/lib/services/prompts.ts, JSON-schema response format, and
// Managed Identity auth. Validate with generatedContentSchema before persisting.
export const azureGuideGenerator: GuideGenerationService = {
  async generate() { throw new NotConfiguredError("Azure OpenAI guide generation"); },
};

// TODO(graph): Microsoft Graph upload to the SharePoint drive item for the configured site,
// using an app registration with Sites.Selected permission.
export const graphSharePointConnector: PublishingConnector = {
  key: "sharepoint",
  simulated: false,
  async publish() { throw new NotConfiguredError("SharePoint (Microsoft Graph) connector"); },
};
