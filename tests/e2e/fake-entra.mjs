// Local test identity provider for the Entra ID sign-in e2e tests. NOT used by the application.
// oidc-provider (MIT) is a certified OpenID Connect server; here it stands in for Microsoft Entra ID,
// issuing the same claims the app reads from Entra: oid, tid, email, name, roles.
import Provider from "oidc-provider";

export const TEST_TENANT = "11111111-2222-3333-4444-555555555555";
const OTHER_TENANT = "99999999-8888-7777-6666-555555555555";
const ISSUER = "http://localhost:3020";

const accounts = {
  // Seeded persona, now signing in through company SSO with an app role.
  amara: { oid: "aaaaaaaa-0000-0000-0000-000000000001", tid: TEST_TENANT, email: "amara.mensah@demo.el-knowledge.test", name: "Amara Mensah", roles: ["retail-europe.creator"] },
  // A brand-new employee with a consumer role: provisioned on first sign-in.
  newstarter: { oid: "aaaaaaaa-0000-0000-0000-000000000002", tid: TEST_TENANT, email: "new.starter@demo.el-knowledge.test", name: "New Starter", roles: ["retail-europe.consumer"] },
  // Assigned to nothing.
  norole: { oid: "aaaaaaaa-0000-0000-0000-000000000003", tid: TEST_TENANT, email: "no.role@demo.el-knowledge.test", name: "No Role", roles: [] },
  // Another organization.
  foreign: { oid: "aaaaaaaa-0000-0000-0000-000000000004", tid: OTHER_TENANT, email: "someone@other.example", name: "Someone Else", roles: ["retail-europe.creator"] },
};

const provider = new Provider(ISSUER, {
  clients: [{
    client_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    client_secret: "test-client-secret-not-a-real-one",
    redirect_uris: ["http://localhost:3012/api/auth/callback"],
    post_logout_redirect_uris: ["http://localhost:3012/sign-in"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }],
  pkce: { required: () => true },
  claims: { openid: ["sub", "oid", "tid", "roles"], email: ["email"], profile: ["name", "preferred_username"] },
  conformIdTokenClaims: false, // put the scope claims in the ID token, as Entra does
  findAccount: (_ctx, id) => {
    const a = accounts[id];
    if (!a) return undefined;
    return { accountId: id, claims: () => ({ sub: id, preferred_username: a.email, ...a }) };
  },
  features: { devInteractions: { enabled: true }, rpInitiatedLogout: { enabled: true, logoutSource: (ctx, form) => { ctx.body = `<!doctype html><html><body>${form}<script>document.forms[0].submit()</script></body></html>`; } } },
  cookies: { keys: ["e2e-only-cookie-key"] },
});
provider.proxy = false;
provider.listen(3020, () => console.log("fake-entra listening on 3020"));
