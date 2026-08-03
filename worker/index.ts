import { D1ChordStore, HostedDataError } from "./d1-repository.ts";
import type { WorkerEnv } from "./types.ts";

const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers: { "Cache-Control": status === 200 ? "public, max-age=60" : "no-store" } });
const errorResponse = (error: unknown): Response => {
  if (error instanceof HostedDataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : error.code === "DATABASE" ? 503 : 400;
    return json({ error: { code: error.code, message: status === 503 ? "The chord service is temporarily unavailable." : error.message } }, status);
  }
  return json({ error: { code: "INTERNAL", message: "The chord service could not complete the request." } }, 500);
};

async function body(request: Request): Promise<unknown> { try { return await request.json(); } catch { throw new HostedDataError("INVALID_RECORD", "Request body must be valid JSON."); } }
function adminEnabled(env: WorkerEnv): boolean { return env.ALLOW_ADMIN_MUTATIONS === "true"; }

export async function handleApi(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const store = new D1ChordStore(env.DB);
  if (request.headers.get("Origin") && new URL(request.headers.get("Origin")!).host !== url.host) return json({ error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }, 403);
  try {
    if (request.method === "GET" && path === "/api/chords/published") return json({ records: await store.list("published") });
    const chordMatch = path.match(/^\/api\/chords\/([^/]+)$/); if (request.method === "GET" && chordMatch) { const record = await store.get(decodeURIComponent(chordMatch[1])); return record?.workflowStatus === "published" ? json({ record }) : json({ error: { code: "NOT_FOUND", message: "Chord not found." } }, 404); }
    if (!path.startsWith("/api/admin/")) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    if (!adminEnabled(env)) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    if (request.method === "GET" && path === "/api/admin/chords/pre-reviewed") return json({ records: await store.list("pre-reviewed") });
    if (request.method === "GET" && path === "/api/admin/audit") return json({ entries: await store.auditLog() });
    if (request.method === "GET" && path === "/api/admin/quarantine") return json({ records: await store.quarantine() });
    if (request.method === "GET" && path === "/api/admin/backups") return json({ records: [...await store.list("pre-reviewed"), ...await store.list("published"), ...await store.list("rejected")] });
    if (request.method === "POST" && path === "/api/admin/chords/import") { const value = await body(request) as { records?: unknown[]; dryRun?: boolean }; return json({ report: await store.importRecords(Array.isArray(value.records) ? value.records : [], value.dryRun === true) }); }
    const operation = path.match(/^\/api\/admin\/chords\/([^/]+)\/(pre-review|publish|reject|replace|merge)$/); if (!operation || request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
    const id = decodeURIComponent(operation[1]); const action = operation[2];
    if (action === "reject") { await store.reject(id); return json({ ok: true }); }
    const value = await body(request); if (action === "pre-review") return json({ record: await store.preReview(value) }); if (action === "publish") return json({ record: await store.publish(value) }); if (action === "replace") return json({ record: await store.replace(id, value) }); return json({ record: await store.merge(id, value) });
  } catch (error) { return errorResponse(error); }
}

export default { async fetch(request: Request, env: WorkerEnv): Promise<Response> { const url = new URL(request.url); if (url.pathname.startsWith("/api/")) return handleApi(request, env); return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 }); } };
