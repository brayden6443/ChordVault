import { authenticateAdmin, type AdminPrincipal, type AuthenticationResult } from "./auth.ts";
import { D1ChordStore, HostedDataError } from "./d1-repository.ts";
import { toPublicChordDetails } from "../src/chords/public-chord.ts";
import { chordExportCsv, chordExportFilename, chordExportJson, createChordExport } from "../src/chords/admin-export.ts";
import type { WorkerEnv } from "./types.ts";

interface WorkerDependencies { authenticate(request: Request, env: WorkerEnv): Promise<AuthenticationResult> }
const defaultDependencies: WorkerDependencies = { authenticate: authenticateAdmin };
const securityHeaders = { "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };

function json(value: unknown, status = 200, isPublic = false): Response {
  return Response.json(value, { status, headers: { ...securityHeaders, "Cache-Control": isPublic && status === 200 ? "public, max-age=60" : "no-store", ...(isPublic ? {} : { Vary: "Cf-Access-Jwt-Assertion, Cookie" }) } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HostedDataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" || error.code === "INVALID_TRANSITION" ? 409 : error.code === "DATABASE" ? 503 : 400;
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

function exportResponse(contents: string, format: "csv" | "json", now: Date): Response {
  return withPrivateHeaders(new Response(contents, { headers: {
    "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${chordExportFilename(format, now)}"`,
  } }));
}

export async function handleApi(request: Request, env: WorkerEnv, dependencies: WorkerDependencies = defaultDependencies): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const store = new D1ChordStore(env.DB);
  if (!sameOrigin(request, url)) return json({ error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }, 403);
  try {
    if (request.method === "GET" && path === "/api/chords/published") return json({ records: await store.list("published") }, 200, true);
    const chordSlugMatch = path.match(/^\/api\/chords\/slug\/([^/]+)$/);
    if (request.method === "GET" && chordSlugMatch) {
      const resolution = await store.resolvePublishedSlug(decodeURIComponent(chordSlugMatch[1]));
      if (!resolution) return json({ error: { code: "NOT_FOUND", message: "Chord not found." } }, 404, true);
      const positions = resolution.positions.map((position) => toPublicChordDetails(position.record, position.slug));
      return json({ chord: positions[resolution.positionIndex], positions, positionIndex: resolution.positionIndex }, 200, true);
    }
    const chordMatch = path.match(/^\/api\/chords\/([^/]+)$/);
    if (request.method === "GET" && chordMatch) {
      const record = await store.get(decodeURIComponent(chordMatch[1]));
      return record?.workflowStatus === "published" ? json({ record }, 200, true) : json({ error: { code: "NOT_FOUND", message: "Chord not found." } }, 404);
    }
    if (request.method === "GET" && path === "/api/admin/logout") return Response.redirect(new URL("/cdn-cgi/access/logout", url.origin), 302);
    if (!path.startsWith("/api/admin/")) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;
    if (request.method === "GET" && path === "/api/admin/session") return json({ administrator: { email: principal.email }, expiresAt: principal.expiresAt });
    if (request.method === "GET" && path === "/api/admin/chords/export") {
      const format = url.searchParams.get("format");
      if (format !== "csv" && format !== "json") return json({ error: { code: "INVALID_FORMAT", message: "Export format must be csv or json." } }, 400);
      const now = new Date(); const bundle = createChordExport(await store.listAll(), now);
      return exportResponse(format === "csv" ? chordExportCsv(bundle) : chordExportJson(bundle), format, now);
    }
    if (request.method === "GET" && path === "/api/admin/chords/pre-reviewed") return json({ records: await store.list("pre-reviewed") });
    if (request.method === "GET" && path === "/api/admin/audit") return json({ entries: await store.auditLog() });
    if (request.method === "GET" && path === "/api/admin/quarantine") return json({ records: await store.quarantine() });
    if (request.method === "GET" && path === "/api/admin/backups") return json({ records: [...await store.list("pre-reviewed"), ...await store.list("published"), ...await store.list("rejected")] });
    if (request.method === "POST" && path === "/api/admin/chords/enrichment/preview") {
      const value = await body(request) as { records?: unknown[] };
      return json({ preview: await store.previewEnrichment(Array.isArray(value.records) ? value.records : []) });
    }
    const operation = path.match(/^\/api\/admin\/chords\/([^/]+)\/(pre-review|publish|reject|restore|replace|merge|edit)$/);
    if (operation?.[2] === "edit" && request.method === "POST" && editorialEnabled(env)) {
      const id = decodeURIComponent(operation[1]);
      return json({ record: await store.edit(id, await body(request), principal.email) });
    }
    if (!adminEnabled(env)) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    if (request.method === "POST" && path === "/api/admin/chords/import") {
      const value = await body(request) as { records?: unknown[]; dryRun?: boolean };
      return json({ report: await store.importRecords(Array.isArray(value.records) ? value.records : [], value.dryRun === true, principal.email) });
    }
    if (request.method === "POST" && path === "/api/admin/chords/enrichment/apply") {
      const value = await body(request) as { records?: unknown[] };
      return json({ report: await store.applyEnrichment(Array.isArray(value.records) ? value.records : [], principal.email) });
    }
    if (request.method === "POST" && path === "/api/admin/chords/duplicate") {
      return json({ duplicate: await store.findDuplicate(await body(request)) });
    }
    if (!operation || request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
    const id = decodeURIComponent(operation[1]); const action = operation[2];
    if (action === "reject") return json({ record: await store.reject(id, principal.email) });
    if (action === "restore") return json({ record: await store.restore(id, principal.email) });
    const value = await body(request);
    if ((action === "pre-review" || action === "publish") && (!value || typeof value !== "object" || Array.isArray(value) || (value as { id?: unknown }).id !== id)) {
      throw new HostedDataError("INVALID_RECORD", "Request path and chord ID must match.");
    }
    if (action === "pre-review") return json({ record: await store.preReview(value, principal.email) });
    if (action === "publish") return json({ record: await store.publish(value, principal.email) });
    if (action === "replace") return json({ record: await store.replace(id, value, principal.email) });
    if (action === "edit") return json({ record: await store.edit(id, value, principal.email) });
    return json({ record: await store.merge(id, value, principal.email) });
  } catch (error) { return errorResponse(error); }
}

function adminEnabled(env: WorkerEnv): boolean { return env.ALLOW_ADMIN_MUTATIONS === "true"; }
function editorialEnabled(env: WorkerEnv): boolean { return env.ALLOW_EDITORIAL_MUTATIONS === "true"; }
function isReviewPath(path: string): boolean { return path === "/review" || path === "/review/" || path === "/review.html"; }

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function chordPage(request: Request, env: WorkerEnv, url: URL, slug: string): Promise<Response> {
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  let resolution = null;
  try { resolution = await new D1ChordStore(env.DB).resolvePublishedSlug(slug); } catch { return errorResponse(new HostedDataError("DATABASE", "Chord query failed.")); }
  if (resolution?.legacy) return Response.redirect(new URL(`/chords/${encodeURIComponent(resolution.slug)}`, url.origin), 301);
  const chord = resolution ? toPublicChordDetails(resolution.record, resolution.slug) : null;
  const name = chord?.chordName ?? "Chord not found";
  const title = chord ? `${name} Guitar Chord | Diagram, Notes & Variations | Chord Vault` : "Chord Not Found | Chord Vault";
  const description = chord
    ? `Learn how to play the ${name} guitar chord with a diagram, finger positions, notes, and related chord ideas.`
    : "The requested guitar chord could not be found in Chord Vault.";
  const assetResponse = await env.ASSETS.fetch(new Request(new URL("/chord", url), request));
  if (!assetResponse.ok) return assetResponse;
  const canonicalUrl = `${url.origin}/chords/${encodeURIComponent(slug)}`;
  const html = (await assetResponse.text())
    .replaceAll("__CHORD_PAGE_TITLE__", escapeHtml(title))
    .replaceAll("__CHORD_PAGE_DESCRIPTION__", escapeHtml(description))
    .replaceAll("__CHORD_PAGE_NAME__", escapeHtml(name))
    .replaceAll("__CHORD_PAGE_CANONICAL__", escapeHtml(canonicalUrl));
  return new Response(html, { status: chord ? 200 : 404, headers: { ...securityHeaders, "Cache-Control": "public, max-age=60", "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleRequest(request: Request, env: WorkerEnv, dependencies: WorkerDependencies = defaultDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, dependencies);
  const chordRoute = url.pathname.match(/^\/chords\/([^/]+)\/?$/);
  if (request.method === "GET" && chordRoute) return chordPage(request, env, url, decodeURIComponent(chordRoute[1]));
  if (isReviewPath(url.pathname)) {
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;
    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    const assetRequest = url.pathname === "/review.html" ? request : new Request(new URL("/review.html", url), request);
    return withPrivateHeaders(await env.ASSETS.fetch(assetRequest));
  }
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
