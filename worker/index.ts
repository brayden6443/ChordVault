import { authenticateAdmin, type AdminPrincipal, type AuthenticationResult } from "./auth.ts";
import { D1ChordStore, HostedDataError } from "./d1-repository.ts";
import type { WorkerEnv } from "./types.ts";

interface WorkerDependencies { authenticate(request: Request, env: WorkerEnv): Promise<AuthenticationResult> }
const defaultDependencies: WorkerDependencies = { authenticate: authenticateAdmin };
const securityHeaders = { "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };

function json(value: unknown, status = 200, isPublic = false): Response {
  return Response.json(value, { status, headers: { ...securityHeaders, "Cache-Control": isPublic && status === 200 ? "public, max-age=60" : "no-store", ...(isPublic ? {} : { Vary: "Cf-Access-Jwt-Assertion, Cookie" }) } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HostedDataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : error.code === "DATABASE" ? 503 : 400;
    return json({ error: { code: error.code, message: status === 503 ? "The chord service is temporarily unavailable." : error.message } }, status);
  }
  return json({ error: { code: "INTERNAL", message: "The chord service could not complete the request." } }, 500);
}

function authFailure(result: Exclude<AuthenticationResult, { ok: true }>): Response {
  const messages = {
    AUTH_REQUIRED: "Administrator authentication is required.",
    AUTH_INVALID: "The administrator session is invalid or expired.",
    AUTH_FORBIDDEN: "This identity is not authorized as an administrator.",
    AUTH_NOT_CONFIGURED: "Administrator authentication is not configured.",
  };
  return json({ error: { code: result.code, message: messages[result.code] } }, result.status);
}

async function requireAdmin(request: Request, env: WorkerEnv, dependencies: WorkerDependencies): Promise<AdminPrincipal | Response> {
  const result = await dependencies.authenticate(request, env);

  console.log("AUTH RESULT:", JSON.stringify(result));

  return result.ok ? result.principal : authFailure(result);
}

async function body(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new HostedDataError("INVALID_RECORD", "Request body must be valid JSON."); }
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).origin === url.origin; } catch { return false; }
}

function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cf-Access-Jwt-Assertion, Cookie");
  Object.entries(securityHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleApi(request: Request, env: WorkerEnv, dependencies: WorkerDependencies = defaultDependencies): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const store = new D1ChordStore(env.DB);
  if (!sameOrigin(request, url)) return json({ error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }, 403);
  try {
    if (request.method === "GET" && path === "/api/chords/published") return json({ records: await store.list("published") }, 200, true);
    const chordMatch = path.match(/^\/api\/chords\/([^/]+)$/);
    if (request.method === "GET" && chordMatch) {
      const record = await store.get(decodeURIComponent(chordMatch[1]));
      return record?.workflowStatus === "published" ? json({ record }, 200, true) : json({ error: { code: "NOT_FOUND", message: "Chord not found." } }, 404);
    }
    if (request.method === "GET" && path === "/api/admin/logout") return Response.redirect(new URL("/cdn-cgi/access/logout", url.origin), 302);
    if (!path.startsWith("/api/admin/")) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;

    console.log("ADMIN PRINCIPAL:", JSON.stringify(principal));
    if (request.method === "GET" && path === "/api/admin/session") return json({ administrator: { email: principal.email }, expiresAt: principal.expiresAt });
    if (request.method === "GET" && path === "/api/admin/chords/pre-reviewed") return json({ records: await store.list("pre-reviewed") });
    if (request.method === "GET" && path === "/api/admin/audit") return json({ entries: await store.auditLog() });
    if (request.method === "GET" && path === "/api/admin/quarantine") return json({ records: await store.quarantine() });
    if (request.method === "GET" && path === "/api/admin/backups") return json({ records: [...await store.list("pre-reviewed"), ...await store.list("published"), ...await store.list("rejected")] });
    if (!adminEnabled(env)) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    if (request.method === "POST" && path === "/api/admin/chords/import") {
      const value = await body(request) as { records?: unknown[]; dryRun?: boolean };
      return json({ report: await store.importRecords(Array.isArray(value.records) ? value.records : [], value.dryRun === true, principal.email) });
    }
    const operation = path.match(/^\/api\/admin\/chords\/([^/]+)\/(pre-review|publish|reject|replace|merge|edit)$/);
    if (!operation || request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
    const id = decodeURIComponent(operation[1]); const action = operation[2];
    if (action === "reject") { await store.reject(id, principal.email); return json({ ok: true }); }
    const value = await body(request);
    if (action === "pre-review") return json({ record: await store.preReview(value, principal.email) });
    if (action === "publish") return json({ record: await store.publish(value, principal.email) });
    if (action === "replace") return json({ record: await store.replace(id, value, principal.email) });
    if (action === "edit") return json({ record: await store.edit(id, value, principal.email) });
    return json({ record: await store.merge(id, value, principal.email) });
    } catch (error) {
    console.log("ERROR:", error instanceof Error ? error.stack : error);
    return errorResponse(error);
}
}

function adminEnabled(env: WorkerEnv): boolean { return env.ALLOW_ADMIN_MUTATIONS === "true"; }
function isReviewPath(path: string): boolean { return path === "/review" || path === "/review/" || path === "/review.html"; }

export async function handleRequest(request: Request, env: WorkerEnv, dependencies: WorkerDependencies = defaultDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, dependencies);
  if (isReviewPath(url.pathname)) {
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;
    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    const assetRequest = url.pathname === "/review.html" ? request : new Request(new URL("/review.html", url), request);
    return withPrivateHeaders(await env.ASSETS.fetch(assetRequest));
  }
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}

export default { fetch: handleRequest };
