# IAM registration request: EL Knowledge Studio

Hand this to the IAM / Entra ID team. Everything the application needs is listed here. The ready-to-import manifest is [`infra/entra/app-registration.json`](../infra/entra/app-registration.json), regenerated with `npm run iam:manifest -- --base-url <url>`.

## 1. The application

| Item | Value |
| --- | --- |
| Name | EL Knowledge Studio |
| Purpose | Turns recorded processes and documents into governed guides, videos and searchable knowledge for employees |
| Business owner | *to be named* |
| Technical owner | *to be named* |
| Account types | **Single tenant**: EssilorLuxottica only (`AzureADMyOrg`) |
| Platform | **Web** (server-side confidential client). Authorization code flow with **PKCE**. No implicit flow, no SPA tokens |
| Environments | Development `http://localhost:3010`, Test *(host to be assigned)*, Production *(host to be assigned; the manifest uses the placeholder `knowledge-studio.essilorluxottica.com`)* |

## 2. URLs to register (per environment)

| Setting | Value |
| --- | --- |
| Redirect URI (Web) | `<base>/api/auth/callback` |
| Front-channel logout URL | `<base>/sign-in` |
| Implicit grant (ID or access tokens) | **Off** |

## 3. Permissions

Microsoft Graph **delegated**: `openid`, `profile`, `email`, `User.Read`. These are standard sign-in scopes, with no application permissions and no admin-only scopes. Phase 3 publishing to SharePoint, Teams or Stream will be a **separate** request (app-only `Sites.Selected` or delegated), so sign-in isn't blocked by it.

## 4. Who gets access: app roles (recommended)

- Set **Assignment required = Yes** on the enterprise application, so only assigned people can sign in.
- The manifest defines one app role per *workspace × role* (`retail-europe.creator`, `global-corporate.approver`, …) plus `enterprise-admin`: 31 roles for today's 3 workspaces.
- Assign **security groups** (preferred) or users to these roles. The application reads the `roles` claim at every sign-in and **syncs** memberships: removing someone from a role in Entra removes it in the app at their next sign-in.
- Role meanings are in `src/lib/permissions` (Consumer, Creator, Editor, Reviewer, SME, Translator, Approver, Publisher, Workspace administrator, Auditor).

**Alternative: security groups.** If IAM prefers group claims, set `groupMembershipClaims = ApplicationGroup`, so only groups assigned to the app are emitted. That avoids the 200-group overage. We then configure `ENTRA_GROUP_ROLE_MAP` with each group's object ID → workspace and roles. Both methods can be used together.

## 5. Token claims we use

| Claim | Why |
| --- | --- |
| `oid` | Stable user id (stored as `User.externalId`) |
| `tid` | Must equal our tenant; other tenants are refused |
| `email` / `preferred_username` | Account email shown in the app and in audit records |
| `name` | Display name |
| `roles` (or `groups`) | Access, as in section 4 |

We store only `oid`, email, display name, last sign-in time and the workspace roles. No tokens are stored, and none are logged.

## 6. Credentials

- **Client secret**, stored in **Azure Key Vault** (`ENTRA_CLIENT_SECRET`), with rotation every 6 months at most and a calendar owner. A certificate or a federated credential with managed identity is supported as a follow-up if IAM requires it.
- `SESSION_SECRET`, a random value of 32 or more characters for signing session cookies, also in Key Vault.

## 7. What IAM hands back to us

| Variable | Value |
| --- | --- |
| `AUTH_PROVIDER` | `entra` |
| `ENTRA_TENANT_ID` | Tenant (directory) ID |
| `ENTRA_CLIENT_ID` | Application (client) ID |
| `ENTRA_CLIENT_SECRET` | Key Vault reference |
| `APP_BASE_URL` | The environment's https URL |
| `ENTRA_GROUP_ROLE_MAP` | Only if groups are used instead of app roles |

## 8. Security behaviour (for the IAM and security review)

- PKCE (S256), `state` and `nonce` are checked. They're kept in a signed, 10-minute, httpOnly cookie scoped to `/api/auth`.
- Sessions are an HMAC-signed, 8-hour, httpOnly, `SameSite=Lax`, `Secure` cookie, holding only the user ID.
- Demo sign-in is **refused in production builds**, and a demo session cookie is never accepted when demo mode is off.
- Sign-out clears the session and ends the Microsoft session (`/oauth2/v2.0/logout`).
- Conditional Access and MFA policies apply as for any Entra application. The app adds no exceptions.
- Every sign-in is written to the audit log (`auth.signed-in`).

## 9. Test plan after registration

1. Sign in as a user with no role assignment → "Your account has no EL Knowledge Studio role yet".
2. Assign `retail-europe.creator` → sign in → lands in Retail Operations · Europe with Create available.
3. Remove the assignment → sign in again → access removed.
4. Sign in with an account from another tenant → refused.
5. Sign out → Microsoft session ended, back on the sign-in page.

Steps 1–5 are already automated against a local test identity provider (`tests/e2e/entra-sso.spec.ts`).
