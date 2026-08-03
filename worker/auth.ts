import type { WorkerEnv } from "./types.ts";

export interface AdminPrincipal { email: string; subject: string; expiresAt: number }
export type AuthenticationResult =
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; status: 401 | 403 | 503; code: "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_FORBIDDEN" | "AUTH_NOT_CONFIGURED" };

interface AccessClaims { aud?: string | string[]; email?: string; exp?: number; iss?: string; nbf?: number; sub?: string }
interface Jwk { alg?: string; e?: string; kid?: string; kty?: string; n?: string; use?: string }
interface Jwks { keys?: Jwk[] }
interface AuthOptions { fetcher?: typeof fetch; now?: () => number }

const keyCache = new Map<string, { expiresAt: number; keys: Jwk[] }>();
const decoder = new TextDecoder();

function normalizeTeamDomain(value: string): string {
  const withScheme = /^https:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" || url.pathname !== "/") throw new Error("Invalid Access team domain");
  return url.origin;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T { return JSON.parse(decoder.decode(decodeBase64Url(value))) as T; }

async function signingKeys(teamDomain: string, fetcher: typeof fetch, now: number): Promise<Jwk[]> {
  const endpoint = `${teamDomain}/cdn-cgi/access/certs`;
  const cached = keyCache.get(endpoint);
  if (cached && cached.expiresAt > now) return cached.keys;
  const response = await fetcher(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Access signing keys unavailable");
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error("Access signing keys invalid");
  keyCache.set(endpoint, { expiresAt: now + 5 * 60, keys: value.keys });
  return value.keys;
}

function tokenFrom(request: Request): string | null {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) return assertion;
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function authenticateAdmin(request: Request, env: WorkerEnv, options: AuthOptions = {}): Promise<AuthenticationResult> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED" };
  const token = tokenFrom(request);
  if (!token) return { ok: false, status: 401, code: "AUTH_REQUIRED" };
  try {
    const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token");
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodeJson<AccessClaims>(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token");
    const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (claims.iss !== teamDomain || !audiences.includes(env.ACCESS_AUD) || !claims.exp || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now)) throw new Error("Invalid claims");
    if (!claims.email || !claims.sub) throw new Error("Missing identity");
    const keys = await signingKeys(teamDomain, options.fetcher ?? fetch, now);
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.alg || key.alg === "RS256"));
    if (!jwk) throw new Error("Unknown signing key");
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = decodeBase64Url(parts[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature.buffer as ArrayBuffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) throw new Error("Invalid signature");
    const email = claims.email.trim().toLowerCase();
    const allowed = new Set(env.ADMIN_EMAILS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (!allowed.has(email)) return { ok: false, status: 403, code: "AUTH_FORBIDDEN" };
    return { ok: true, principal: { email, subject: claims.sub, expiresAt: claims.exp } };
  } catch {
    return { ok: false, status: 401, code: "AUTH_INVALID" };
  }
}

export function clearAuthenticationCache(): void { keyCache.clear(); }
