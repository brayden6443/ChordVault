import assert from "node:assert/strict";
import test from "node:test";
import { authenticateAdmin, clearAuthenticationCache } from "../worker/auth.ts";
import type { WorkerEnv } from "../worker/types.ts";

const issuer = "https://chord-vault.cloudflareaccess.com";
const audience = "test-audience";
const adminEmail = "admin@example.test";

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function failureStatus(result: Awaited<ReturnType<typeof authenticateAdmin>>): number {
  assert.equal(result.ok, false);
  return result.ok ? 0 : result.status;
}

async function fixture(): Promise<{ env: WorkerEnv; fetcher: typeof fetch; token(claims?: Record<string, unknown>): Promise<string> }> {
  clearAuthenticationCache();
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const fetcher = (async () => Response.json({ keys: [{ ...publicKey, kid: "test-key", alg: "RS256", use: "sig" }] })) as typeof fetch;
  const env = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience, ADMIN_EMAILS: adminEmail } as WorkerEnv;
  return {
    env,
    fetcher,
    async token(overrides = {}) {
      const header = base64url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
      const payload = base64url(JSON.stringify({ iss: issuer, aud: audience, email: adminEmail, sub: "admin-subject", exp: 2_000_000_000, ...overrides }));
      const input = `${header}.${payload}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
      return `${input}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

test("valid Access assertion authenticates an allowlisted administrator", async () => {
  const setup = await fixture();
  const result = await authenticateAdmin(new Request("https://example.test/review.html", { headers: { "Cf-Access-Jwt-Assertion": await setup.token() } }), setup.env, { fetcher: setup.fetcher, now: () => 1_900_000_000_000 });
  assert.deepEqual(result, { ok: true, principal: { email: adminEmail, subject: "admin-subject", expiresAt: 2_000_000_000 } });
});

test("missing, expired, and forged Access tokens are rejected", async () => {
  const setup = await fixture();
  assert.equal(failureStatus(await authenticateAdmin(new Request("https://example.test/review.html"), setup.env, { fetcher: setup.fetcher })), 401);
  const expired = await authenticateAdmin(new Request("https://example.test/review.html", { headers: { "Cf-Access-Jwt-Assertion": await setup.token({ exp: 10 }) } }), setup.env, { fetcher: setup.fetcher, now: () => 20_000 });
  assert.equal(failureStatus(expired), 401);
  const forged = `${await setup.token()}broken`;
  assert.equal(failureStatus(await authenticateAdmin(new Request("https://example.test/review.html", { headers: { "Cf-Access-Jwt-Assertion": forged } }), setup.env, { fetcher: setup.fetcher, now: () => 1_900_000_000_000 })), 401);
});

test("authenticated non-admin identity is forbidden", async () => {
  const setup = await fixture();
  const result = await authenticateAdmin(new Request("https://example.test/review.html", { headers: { "Cf-Access-Jwt-Assertion": await setup.token({ email: "reader@example.test" }) } }), setup.env, { fetcher: setup.fetcher, now: () => 1_900_000_000_000 });
  assert.equal(failureStatus(result), 403);
});

test("authentication fails closed when Access configuration is absent", async () => {
  const result = await authenticateAdmin(new Request("https://example.test/review.html"), {} as WorkerEnv);
  assert.deepEqual(result, { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED" });
});
