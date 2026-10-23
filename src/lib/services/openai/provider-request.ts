// One way to send a request to the model provider. Ported from Knowzy (GATEWAY-M1).
//
//   * The key is revealed here and nowhere else: into the configured header OR the configured
//     query parameter — never both, no fallback between them.
//   * A query-parameter key exists only in a local URL inside providerFetch. That URL is never
//     returned, stored, logged or put in an error. Use sanitizeUrl to describe a URL.
//   * The key is sent only to an allow-listed host, over https (loopback excepted), with
//     redirects refused — a redirect could deliver the credential to another origin.
//   * Transport failures are classified into a cause; the exception's own message is discarded.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Query parameters that carry credentials, matched by exact name. */
export const CREDENTIAL_QUERY_PARAMETERS = new Set(["subscription-key", "api-key", "apikey", "key", "token", "access_token", "code", "sig"]);
export const isCredentialQueryParameter = (name: string) => CREDENTIAL_QUERY_PARAMETERS.has(name.toLowerCase());

export type ProviderAuth =
  | { readonly location: "HEADER"; readonly headerName: string }
  | { readonly location: "QUERY_PARAMETER"; readonly parameterName: string };

export interface ProviderEndpoint {
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly auth: ProviderAuth;
  readonly extraHeaders: Readonly<Record<string, string>>;
  /** A function, so the key is read at the moment of sending and not held in config objects. */
  readonly revealKey: () => string;
}

export const sanitizeUrl = (input: string | URL): string => {
  let url: URL;
  try { url = new URL(input.toString()); } catch { return "[unparseable URL]"; }
  url.username = "";
  url.password = "";
  for (const name of [...url.searchParams.keys()]) if (isCredentialQueryParameter(name)) url.searchParams.set(name, "REDACTED");
  return url.toString();
};

export function endpointPermission(baseUrl: string, allowedHosts: readonly string[]):
  | { readonly allowed: true; readonly url: URL }
  | { readonly allowed: false; readonly reason: string } {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return { allowed: false, reason: "The base URL is not a URL." }; }
  const allowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(url.host.toLowerCase()) && !allowed.includes(url.hostname.toLowerCase())) {
    return { allowed: false, reason: `${url.hostname} is not an allowed host for the AI credential (allowed: ${allowed.join(", ") || "none"}). The key was not sent. Add the host to LLM_ENDPOINT_ALLOWLIST.` };
  }
  if (url.protocol !== "https:" && !LOOPBACK.has(url.hostname)) return { allowed: false, reason: "The base URL is not https. The key was not sent." };
  if (url.username || url.password) return { allowed: false, reason: "The base URL carries credentials of its own. The key was not sent." };
  if ([...url.searchParams.keys()].some(isCredentialQueryParameter)) {
    return { allowed: false, reason: "The base URL carries a credential in its query string. Put the key in OPENAI_API_KEY instead. The key was not sent." };
  }
  return { allowed: true, url };
}

export function providerFetch(
  endpoint: ProviderEndpoint,
  permitted: URL,
  path: string,
  init: { method: "GET" | "POST"; body?: string | FormData; timeoutMs: number; fetch?: typeof fetch },
): Promise<Response> {
  const base = permitted.toString().replace(/\/+$/, "");
  // Held only in this scope. Never returned, logged or thrown.
  const url = new URL(`${base}${path}`);
  const headers: Record<string, string> = { accept: "application/json" };
  // FormData sets its own multipart content type with the boundary.
  if (typeof init.body === "string") headers["content-type"] = "application/json";
  for (const [name, value] of Object.entries(endpoint.extraHeaders)) headers[name.trim().toLowerCase()] = value;

  if (endpoint.auth.location === "QUERY_PARAMETER") {
    url.searchParams.set(endpoint.auth.parameterName, endpoint.revealKey());
  } else {
    const name = endpoint.auth.headerName.toLowerCase();
    headers[name] = name === "authorization" ? `Bearer ${endpoint.revealKey()}` : endpoint.revealKey();
  }

  return (init.fetch ?? fetch)(url, {
    method: init.method,
    redirect: "error",
    signal: AbortSignal.timeout(init.timeoutMs),
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

export type TransportFailureCause = "DNS" | "TIMEOUT" | "TLS_TRUST" | "TLS_CERTIFICATE" | "CONNECTION_REFUSED" | "CONNECTION_RESET" | "REDIRECT_REFUSED" | "UNREACHABLE";

const TLS_TRUST = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_UNTRUSTED"]);
const TLS_CERT = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_REVOKED"]);
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
const TIMEOUT = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

const causeChain = (error: unknown): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  const visit = (v: unknown, d: number) => {
    if (d > 6 || v === null || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    out.push(r);
    visit(r["cause"], d + 1);
    if (Array.isArray(r["errors"])) for (const m of r["errors"]) visit(m, d + 1);
  };
  visit(error, 0);
  return out;
};

/** Reads only machine-readable codes and names, so a message quoting a URL cannot leak it. */
export function classifyTransportError(error: unknown, host: string, timeoutMs: number): { cause: TransportFailureCause; detail: string } {
  const chain = causeChain(error);
  const codes = chain.map((e) => String(e["code"] ?? ""));
  const names = chain.map((e) => String(e["name"] ?? ""));
  const messages = chain.map((e) => String(e["message"] ?? "").toLowerCase());
  if (names.includes("TimeoutError") || names.includes("AbortError") || codes.some((c) => TIMEOUT.has(c))) return { cause: "TIMEOUT", detail: `No response from ${host} within ${timeoutMs} ms. Check the network route (VPN, proxy, firewall).` };
  if (codes.some((c) => DNS.has(c))) return { cause: "DNS", detail: `${host} could not be resolved. An internal gateway usually needs the corporate DNS or VPN.` };
  if (codes.some((c) => TLS_TRUST.has(c))) return { cause: "TLS_TRUST", detail: `${host} presented a certificate this server does not trust. Set NODE_EXTRA_CA_CERTS to the internal CA certificate. TLS verification is never disabled.` };
  if (codes.some((c) => TLS_CERT.has(c))) return { cause: "TLS_CERTIFICATE", detail: `${host} presented an expired, revoked or mismatched certificate.` };
  if (codes.includes("ECONNREFUSED")) return { cause: "CONNECTION_REFUSED", detail: `${host} refused the connection.` };
  if (codes.includes("ECONNRESET") || codes.includes("UND_ERR_SOCKET")) return { cause: "CONNECTION_RESET", detail: `The connection to ${host} closed before a response arrived.` };
  if (messages.some((m) => m.includes("redirect"))) return { cause: "REDIRECT_REFUSED", detail: `${host} answered with a redirect, which is refused so the credential can't reach another origin.` };
  return { cause: "UNREACHABLE", detail: `${host} could not be reached (network error).` };
}
