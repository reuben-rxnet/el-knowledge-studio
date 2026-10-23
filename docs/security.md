# Security

## Implemented in the prototype

- **Authorization in every server action and route handler** through capabilities (`assertPermission`). The UI hides controls too, but never relies on it.
- **Workspace isolation**: all reads go through `findProject()` / `listProjects()`, scoped to the active workspace. The active workspace is re-validated against memberships on every request. Other workspaces' resources answer `404`, the same as missing ones (no IDOR).
- **Input validation** with Zod on the server. Client checks are convenience only.
- **Consistent error envelope** without stack traces (`src/server/actions/result.ts`, `src/lib/utilities/errors.ts`).
- **Secure headers** (`next.config.ts`): CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` (screen capture and microphone limited to self), HSTS.
- **Session cookies**: `httpOnly`, `sameSite=lax`, `secure` in production. Server actions carry Next.js's built-in origin check (CSRF).
- **Demo authentication cannot run in production**: `isDemoAuthEnabled()` returns false when `NODE_ENV=production`, whatever the configuration.
- **Immutable audit log**: there is no update or delete path for `AuditEvent` in application code. Messages contain titles and codes, never transcript text, prompts or keys.
- **Secrets**: never in source. `.env` is git-ignored, and the AI key is read only at send time (see [integrations.md](integrations.md)).
- **Upload validation**: extension, MIME/extension agreement, size, empty file, decode check and duplicate fingerprint, with a scan hook.
- **Classification policy** (`CLASSIFICATION_POLICY`): controls recording, publishing destinations and external AI eligibility.

## Production work required

| Control | Plan |
| --- | --- |
| Identity | Entra ID OIDC (auth code + PKCE), group → role mapping, SCIM provisioning |
| Rate limiting | API Management policies plus per-user limits on AI actions |
| Signed media URLs | Short-lived Blob SAS, generated server-side per request |
| Encryption | TLS everywhere. Storage and database encryption at rest with customer-managed keys |
| Secrets | Azure Key Vault with Managed Identity. No keys in app settings |
| Malware scanning | Defender for Storage on upload containers |
| Data deletion and export | Workflow with approval, audit, and region-aware retention policies |
| Security telemetry | Application Insights with redaction. Denied authorizations as security events |

## Logging rules

Never log authentication tokens, passwords, transcript text, full prompts, or personal data not needed for diagnostics. Server errors log the error class and correlation ID only.
