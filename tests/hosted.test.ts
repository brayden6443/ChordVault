import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { LocalStorageChordRepository, type StoragePort } from "../src/chords/chord-repository.ts";
import { HostedReadChordRepository } from "../src/chords/hosted-repository.ts";
import { HostedReviewClient } from "../src/chords/hosted-review-client.ts";
import { backupThenUpload, preparedPreReviewedImport, prepareHostedImport, uploadPreparedImport } from "../src/chords/hosted-import.ts";
import { hydratePersistedChord, persistChordVoicing, validatePersistedChord } from "../src/chords/persisted.ts";
import { createChordRepository, repositoryConfiguration } from "../src/chords/repository-composition.ts";
import { legacyChordSlug } from "../src/chords/slug.ts";
import { D1ChordStore, HostedDataError } from "../worker/d1-repository.ts";
import worker, { handleApi, handleRequest } from "../worker/index.ts";
import type { D1Database, WorkerEnv } from "../worker/types.ts";
import { importRecordCandidate, parseCsvObjects } from "../src/chords/csv-import.ts";
import { chordExportCsv, createChordExport } from "../src/chords/admin-export.ts";

class MemoryStorage implements StoragePort { values = new Map<string, string>(); getItem(key: string): string | null { return this.values.get(key) ?? null; } setItem(key: string, value: string): void { this.values.set(key, value); } removeItem(key: string): void { this.values.delete(key); } }
const cMajor = CANONICAL_VOICINGS.find((item) => item.chordName === "C" && item.category === "Essential Open")!;
const cMajorBarre = CANONICAL_VOICINGS.find((item) => item.chordName === "C" && item.category === "Essential Barre")!;
const dMajor = CANONICAL_VOICINGS.find((item) => item.chordName === "D" && item.category === "Essential Open")!;
const cRecord = persistChordVoicing({ ...cMajor, id: "hosted-c" }, "published");
const cBarreRecord = persistChordVoicing({ ...cMajorBarre, id: "hosted-c-barre" }, "published");
const dRecord = persistChordVoicing({ ...dMajor, id: "hosted-d" }, "published");
async function applyMigration(db: D1Database): Promise<void> { const sql = await readFile(new URL("../migrations/0001_initial_schema.sql", import.meta.url), "utf8"); for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run(); }
const adminDependencies = { authenticate: async () => ({ ok: true as const, principal: { email: "admin@example.test", subject: "admin", expiresAt: 2_000_000_000 } }) };

async function database(): Promise<{ mf: Miniflare; db: D1Database; store: D1ChordStore }> {
  const mf = new Miniflare({ modules: true, script: "export default { fetch(){ return new Response('ok') } }", d1Databases: ["DB"] });
  const db = await mf.getD1Database("DB") as unknown as D1Database;
  await applyMigration(db);
  return { mf, db, store: new D1ChordStore(db) };
}

async function publishRecord(store: D1ChordStore, record: typeof cRecord): Promise<void> {
  await store.preReview({ ...record, workflowStatus: "pre-reviewed" }); await store.publish(record);
}

test("initial migration is retry-safe and creates the tracked schema", async () => {
  const { mf, db } = await database();
  await applyMigration(db);
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chord_voicings'").first<{ name: string }>(); assert.equal(row?.name, "chord_voicings"); await mf.dispose();
});

test("workflow contract imports every new chord as pre-reviewed", async () => {
  const { mf, store } = await database(); const report = await store.importRecords([cRecord], false, "admin@example.test");
  assert.equal(report.inserted, 1); assert.equal(report.records[0]?.workflowStatus, "pre-reviewed");
  assert.equal((await store.get(cRecord.id))?.workflowStatus, "pre-reviewed"); await mf.dispose();
});

test("workflow contract approves pre-reviewed chords as published", async () => {
  const { mf, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  const result = await store.publish(cRecord, "admin@example.test"); assert.equal(result.workflowStatus, "published");
  assert.equal((await store.get(cRecord.id))?.workflowStatus, "published"); await mf.dispose();
});

test("workflow contract rejects pre-reviewed chords without deleting them", async () => {
  const { mf, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  const result = await store.reject(cRecord.id, "admin@example.test"); assert.equal(result.workflowStatus, "rejected");
  assert.equal((await store.get(cRecord.id))?.id, cRecord.id); await mf.dispose();
});

test("workflow contract preserves status during enrichment", async () => {
  for (const status of ["pre-reviewed", "published", "rejected"] as const) {
    const setup = await database(); await setup.store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
    if (status === "published") await setup.store.publish(cRecord);
    if (status === "rejected") await setup.store.reject(cRecord.id);
    const report = await setup.store.applyEnrichment([{ id: cRecord.id, description: `Updated ${status}` }], "admin@example.test");
    assert.equal(report.records[0]?.workflowStatus, status); assert.equal((await setup.store.get(cRecord.id))?.workflowStatus, status); await setup.mf.dispose();
  }
});

test("workflow contract rejects invalid transitions with a specific conflict", async () => {
  const { mf, db, store } = await database();
  await assert.rejects(store.publish(cRecord), (error) => error instanceof HostedDataError && error.code === "INVALID_TRANSITION");
  await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" }); await store.publish(cRecord);
  await assert.rejects(store.reject(cRecord.id), (error) => error instanceof HostedDataError && error.code === "INVALID_TRANSITION");
  const response = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/reject`, { method: "POST" }), { DB: db, ALLOW_ADMIN_MUTATIONS: "true" } as WorkerEnv, adminDependencies);
  assert.equal(response.status, 409); assert.equal(((await response.json()) as { error: { code: string } }).error.code, "INVALID_TRANSITION"); await mf.dispose();
});

test("hosted store inserts valid records, rejects invalid versions, and returns published only", async () => {
  const { mf, store } = await database(); await store.preReview({ ...dRecord, workflowStatus: "pre-reviewed" }); await publishRecord(store, cRecord);
  assert.deepEqual((await store.list("published")).map((item) => item.id), [cRecord.id]);
  await assert.rejects(store.publish({ ...cRecord, id: "future", schemaVersion: 99 }), (error) => error instanceof HostedDataError && error.code === "UNKNOWN_VERSION");
  await assert.rejects(store.publish({ id: "bad" }), (error) => error instanceof HostedDataError && error.code === "INVALID_RECORD"); await mf.dispose();
});

test("malformed database rows are rejected before becoming domain records", async () => {
  const { mf, db, store } = await database();
  await db.prepare("INSERT INTO chord_voicings (id,schema_version,root,recipe_id,tuning_json,frets_json,description,difficulty,workflow_status,provenance_json,record_json) VALUES ('bad',1,'C','major','{}','[]','',1,'published','{}','{broken')").run();
  await assert.rejects(store.list("published"), (error) => error instanceof HostedDataError && error.code === "INVALID_RECORD"); await mf.dispose();
});

test("duplicate published voicings conflict", async () => {
  const { mf, store } = await database(); await publishRecord(store, cRecord);
  await store.preReview({ ...cRecord, id: "duplicate-c", workflowStatus: "pre-reviewed" });
  await assert.rejects(store.publish({ ...cRecord, id: "duplicate-c" }), (error) => error instanceof HostedDataError && error.code === "DUPLICATE"); await mf.dispose();
});

test("duplicate lookup reports a duplicate that is currently published", async () => {
  const { mf, store } = await database(); await publishRecord(store, cRecord);
  const duplicate = await store.findDuplicate({ ...cRecord, id: "incoming-c", workflowStatus: "pre-reviewed" });
  assert.equal(duplicate?.matchedRecordId, cRecord.id); assert.equal(duplicate?.existingWorkflowStatus, "published"); assert.equal(duplicate?.matchType, "exact-identity");
  assert.deepEqual(duplicate?.allowedActions, ["merge-metadata", "replace", "keep-existing"]);
  await mf.dispose();
});

test("duplicate lookup reports exact-id pre-reviewed records with review actions", async () => {
  const { mf, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  const duplicate = await store.findDuplicate({ ...cRecord, workflowStatus: "pre-reviewed" });
  assert.equal(duplicate?.matchType, "exact-id"); assert.equal(duplicate?.existingWorkflowStatus, "pre-reviewed");
  assert.deepEqual(duplicate?.allowedActions, ["open-existing-review", "merge-metadata", "replace"]); await mf.dispose();
});

test("duplicate lookup finds archived chords but ignores quarantine rows", async () => {
  const { mf, db, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" }); await store.reject(cRecord.id);
  await db.prepare("INSERT INTO quarantined_records (source,raw_json,issues_json) VALUES (?1,?2,?3)").bind("test", JSON.stringify({ ...cRecord, id: "quarantined-c" }), "[]").run();
  const duplicate = await store.findDuplicate({ ...cRecord, id: "incoming-c", workflowStatus: "pre-reviewed" });
  assert.equal(duplicate?.record.id, cRecord.id); assert.equal(duplicate?.existingWorkflowStatus, "rejected"); assert.equal(duplicate?.matchType, "exact-identity");
  assert.deepEqual(duplicate?.allowedActions, ["restore", "replace", "keep-rejected"]);
  await store.preReview({ ...dRecord, id: "incoming-d", workflowStatus: "pre-reviewed" }); await store.publish({ ...dRecord, id: "incoming-d" });
  assert.equal((await store.list("published")).some((record) => record.id === "quarantined-c"), false);
  await mf.dispose();
});

test("a stale duplicate destination is rejected without changing D1", async () => {
  const { mf, store } = await database();
  await assert.rejects(store.replace("deleted-record", cRecord), (error) => error instanceof HostedDataError && error.code === "NOT_FOUND");
  await assert.rejects(store.merge("deleted-record", cRecord), (error) => error instanceof HostedDataError && error.code === "NOT_FOUND");
  assert.equal((await store.listAll()).length, 0); await mf.dispose();
});

test("merge combines approved metadata while preserving a pre-reviewed destination", async () => {
  const { mf, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed", tags: ["Open"] });
  const source = { ...cRecord, id: "incoming-c", workflowStatus: "pre-reviewed" as const, description: "New description", tags: ["Essential"], moods: ["Warm" as const], styles: ["Blues" as const] };
  await store.preReview(source); const merged = await store.merge(cRecord.id, source, "admin@example.test");
  assert.equal(merged.workflowStatus, "pre-reviewed"); assert.equal(merged.description, "New description"); assert.deepEqual(merged.tags.sort(), ["Essential", "Open"]); assert.deepEqual(merged.moods, ["Warm"]); assert.deepEqual(merged.styles, ["Blues"]);
  assert.equal((await store.get(source.id))?.workflowStatus, "rejected"); assert.deepEqual((await store.list("published")), []);
  await mf.dispose();
});

test("rejected duplicate can be replaced without changing the workflow contract", async () => {
  const { mf, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" }); await store.reject(cRecord.id);
  const replacement = { ...dRecord, id: "replacement-d", workflowStatus: "pre-reviewed" as const }; await store.preReview(replacement);
  const published = await store.replace(cRecord.id, replacement, "admin@example.test");
  assert.equal(published.workflowStatus, "published"); assert.equal((await store.get(cRecord.id))?.workflowStatus, "rejected"); await mf.dispose();
});

test("approve after duplicate resolution leaves one public chord", async () => {
  const { mf, store } = await database(); await publishRecord(store, cRecord);
  const candidate = { ...cRecord, id: "approved-c", workflowStatus: "pre-reviewed" as const };
  await store.preReview(candidate); const duplicate = await store.findDuplicate(candidate, { excludeExactId: true }); assert.equal(duplicate?.record.workflowStatus, "published");
  const published = await store.replace(duplicate!.record.id, candidate, "admin@example.test");
  assert.equal(published.workflowStatus, "published"); assert.deepEqual((await store.list("published")).map((record) => record.id), [candidate.id]);
  await mf.dispose();
});

test("publish transaction rolls back when audit insertion fails", async () => {
  const setup = await database(); await setup.store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" }); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run();
  await assert.rejects(setup.store.publish(cRecord)); assert.equal((await setup.store.get(cRecord.id))?.workflowStatus, "pre-reviewed"); await setup.mf.dispose();
});

test("replacement transaction preserves the old record on failure", async () => {
  const setup = await database(); await publishRecord(setup.store, cRecord); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run();
  await assert.rejects(setup.store.replace(cRecord.id, dRecord)); assert.equal((await setup.store.get(cRecord.id))?.workflowStatus, "published"); assert.equal(await setup.store.get(dRecord.id), null); await setup.mf.dispose();
});

test("merge and rejection transactions roll back with their audit entry", async () => {
  for (const action of ["merge", "reject"] as const) { const setup = await database(); if (action === "merge") await publishRecord(setup.store, cRecord); else await setup.store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" }); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run(); if (action === "merge") await assert.rejects(setup.store.merge(cRecord.id, { ...cRecord, tags: ["Warm"] })); else await assert.rejects(setup.store.reject(cRecord.id)); const current = await setup.store.get(cRecord.id); assert.equal(current?.workflowStatus, action === "merge" ? "published" : "pre-reviewed"); assert.deepEqual(current?.tags, cRecord.tags); await setup.mf.dispose(); }
});

test("import dry-run is non-mutating and retry is idempotent", async () => {
  const { mf, store } = await database(); const incoming = { ...cRecord, workflowStatus: "pre-reviewed" as const };
  const dry = await store.importRecords([incoming], true); assert.equal(dry.inserted, 1); assert.equal(await store.get(cRecord.id), null);
  const first = await store.importRecords([incoming], false); const retry = await store.importRecords([incoming], false); assert.equal(first.inserted, 1); assert.equal(retry.skipped, 1); await mf.dispose();
});

test("authoritative import pipeline classifies and applies a mixed batch", async () => {
  const { mf, store } = await database(); await publishRecord(store, cRecord);
  const report = await store.importRecords([
    { ...dRecord, workflowStatus: "pre-reviewed" },
    cRecord,
    { id: cRecord.id, description: "Enriched through the import endpoint" },
    { ...cRecord, fretPositions: [0, 0, 0, 0, 0, 0] },
    { ...cRecord, id: "duplicate-c-identity", workflowStatus: "pre-reviewed" },
    { id: "invalid" },
  ], false, "admin@example.test");
  assert.deepEqual({ inserted: report.inserted, updated: report.updated, skipped: report.skipped, duplicate: report.duplicate, quarantined: report.quarantined, failed: report.failed },
    { inserted: 1, updated: 1, skipped: 1, duplicate: 1, quarantined: 1, failed: 1 });
  assert.equal((await store.get(dRecord.id))?.workflowStatus, "pre-reviewed");
  assert.equal((await store.get(cRecord.id))?.description, "Enriched through the import endpoint");
  await mf.dispose();
});

test("hosted enrichment preview applies only approved fields", async () => {
  const { mf, store } = await database(); await publishRecord(store, cRecord);
  const imported = { ...createChordExport([cRecord]).records[0], description: "Enriched", difficulty: 4, moods: ["Warm"], fretPositions: cRecord.fretPositions };
  const preview = await store.previewEnrichment([imported]); assert.equal(preview.counts["enrichment-update"], 1);
  const report = await store.applyEnrichment([imported], "admin@example.test"); assert.deepEqual(report.applied, { new: 0, updated: 1 });
  const updated = await store.get(cRecord.id); assert.equal(updated?.description, "Enriched"); assert.equal(updated?.difficulty, 4); assert.deepEqual(updated?.moods, ["Warm"]);
  assert.deepEqual(updated?.fretPositions, cRecord.fretPositions); assert.deepEqual(updated?.tuning, cRecord.tuning); assert.equal(updated?.workflowStatus, cRecord.workflowStatus); assert.deepEqual(updated?.provenance, cRecord.provenance);
  await mf.dispose();
});

test("hosted review import posts pre-reviewed records with the current Access session", async () => {
  let requestUrl = ""; let requestInit: RequestInit | undefined;
  const prepared = preparedPreReviewedImport([cMajor]);
  await uploadPreparedImport(prepared, { apiBase: "/api", dryRun: false, fetcher: async (input, init) => {
    requestUrl = String(input); requestInit = init; return Response.json({ report: { inserted: 1 } });
  } });
  assert.equal(requestUrl, "/api/admin/chords/import");
  assert.equal(requestInit?.credentials, "same-origin");
  const payload = JSON.parse(String(requestInit?.body)) as { records: Array<{ workflowStatus: string }>; dryRun: boolean };
  assert.equal(payload.records.length, 1); assert.equal(payload.records[0]?.workflowStatus, "pre-reviewed"); assert.equal(payload.dryRun, false);
});

test("hosted review workspace loads pre-reviewed D1 records with the Access session", async () => {
  let requestUrl = ""; let requestInit: RequestInit | undefined;
  const workspace = await new HostedReviewClient("/api", async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input); requestInit = init;
    return Response.json({ records: [{ ...cRecord, workflowStatus: "pre-reviewed" }, dRecord] });
  }).loadWorkspace();
  assert.equal(requestUrl, "/api/admin/backups"); assert.equal(requestInit?.credentials, "same-origin");
  assert.deepEqual(workspace.preReviewed.map((record) => record.id), [cRecord.id]);
  assert.deepEqual(workspace.published.map((record) => record.id), [dRecord.id]);
});

function reviewClient(db: D1Database): HostedReviewClient {
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "true", ALLOW_EDITORIAL_MUTATIONS: "true" } as WorkerEnv;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.test");
    return handleApi(new Request(url, init), env, adminDependencies);
  };
  return new HostedReviewClient("https://example.test/api", fetcher);
}

test("hosted review refresh reloads the queue from D1 and approval persists", async () => {
  const { mf, db, store } = await database();
  await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  const first = await reviewClient(db).loadWorkspace();
  assert.deepEqual(first.preReviewed.map((record) => record.id), [cRecord.id]);
  await reviewClient(db).publish(first.preReviewed[0]!);
  const refreshed = await reviewClient(db).loadWorkspace();
  assert.deepEqual(refreshed.preReviewed, []); assert.deepEqual(refreshed.published.map((record) => record.id), [cRecord.id]);
  await mf.dispose();
});

test("hosted review rejection persists after a fresh client reload", async () => {
  const { mf, db, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  await reviewClient(db).reject(cRecord.id);
  const refreshed = await reviewClient(db).loadWorkspace();
  assert.deepEqual(refreshed.preReviewed, []); assert.deepEqual(refreshed.rejected.map((record) => record.id), [cRecord.id]);
  await mf.dispose();
});

test("hosted pre-reviewed edits persist after refresh", async () => {
  const { mf, db, store } = await database(); await store.preReview({ ...cRecord, workflowStatus: "pre-reviewed" });
  await reviewClient(db).editPreReviewed(cRecord.id, { difficulty: 4, moods: ["Warm"] });
  const refreshed = await reviewClient(db).loadWorkspace();
  assert.equal(refreshed.preReviewed[0]?.difficulty, 4); assert.deepEqual(refreshed.preReviewed[0]?.moodTags, ["Warm"]);
  await mf.dispose();
});

test("hosted review actions never invoke disabled browser repository mutations", async () => {
  const local = new LocalStorageChordRepository(new MemoryStorage());
  const disabled = new HostedReadChordRepository(local, []);
  const original = disabled.publishVoicing.bind(disabled);
  let disabledCalls = 0;
  disabled.publishVoicing = (...args) => { disabledCalls += 1; return original(...args); };
  const requests: string[] = [];
  const client = new HostedReviewClient("/api", async (input) => { requests.push(String(input)); return Response.json({ record: cRecord }); });
  await client.publish(cMajor);
  assert.equal(disabledCalls, 0); assert.deepEqual(requests, [`/api/admin/chords/${cMajor.id}/publish`]);
});

test("disabled production mutations stay hidden while public API remains unauthenticated", async () => {
  const { mf, db, store } = await database(); await publishRecord(store, cRecord); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const publicResponse = await handleApi(new Request("https://example.test/api/chords/published"), env); assert.equal(publicResponse.status, 200); assert.equal(((await publicResponse.json()) as { records: unknown[] }).records.length, 1);
  const mutation = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/reject`, { method: "POST" }), env, adminDependencies); assert.equal(mutation.status, 404); await mf.dispose();
});

test("published chords have a public slug endpoint while unpublished chords remain hidden", async () => {
  const { mf, db, store } = await database();
  await publishRecord(store, cRecord);
  await publishRecord(store, cBarreRecord);
  await store.preReview({ ...dRecord, workflowStatus: "pre-reviewed" });
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const slug = hydratePersistedChord(cRecord).slug;
  const response = await handleApi(new Request(`https://example.test/api/chords/slug/${slug}`), env);
  const payload = await response.json() as { chord: { id: string; slug: string; notes: string[]; qualityScore?: number }; positions: Array<{ id: string }>; positionIndex: number };
  assert.equal(response.status, 200); assert.equal(payload.chord.id, cRecord.id); assert.equal(payload.chord.slug, slug); assert.ok(payload.chord.notes.length > 0); assert.equal(payload.chord.qualityScore, undefined);
  assert.deepEqual(payload.positions.map((position) => position.id), [cRecord.id, cBarreRecord.id]); assert.equal(payload.positionIndex, 0);
  const hiddenSlug = hydratePersistedChord({ ...dRecord, workflowStatus: "pre-reviewed" }).slug;
  assert.equal((await handleApi(new Request(`https://example.test/api/chords/slug/${hiddenSlug}`), env)).status, 404);
  await mf.dispose();
});

test("dynamic chord routes render SEO metadata and a friendly 404", async () => {
  const { mf, db, store } = await database(); await publishRecord(store, cRecord);
  const template = "<title>__CHORD_PAGE_TITLE__</title><meta content=\"__CHORD_PAGE_DESCRIPTION__\"><link href=\"__CHORD_PAGE_CANONICAL__\"><h1>__CHORD_PAGE_NAME__</h1>";
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false", ASSETS: { fetch: async () => new Response(template, { headers: { "Content-Type": "text/html" } }) } } as WorkerEnv;
  const slug = hydratePersistedChord(cRecord).slug;
  const found = await handleRequest(new Request(`https://example.test/chords/${slug}`), env); const html = await found.text();
  assert.equal(found.status, 200); assert.match(html, /C Guitar Chord \| Diagram, Notes &amp; Variations \| Chord Vault/); assert.match(html, new RegExp(`https://example\\.test/chords/${slug}`)); assert.match(html, /<h1>C<\/h1>/);
  const missing = await handleRequest(new Request("https://example.test/chords/not-real"), env); assert.equal(missing.status, 404); assert.match(await missing.text(), /Chord not found/);
  const oldSlug = legacyChordSlug("C", cRecord.id); const redirect = await handleRequest(new Request(`https://example.test/chords/${oldSlug}`), env);
  assert.equal(redirect.status, 301); assert.equal(redirect.headers.get("Location"), `https://example.test/chords/${slug}`);
  await mf.dispose();
});

test("API maps invalid payloads without leaking internals", async () => {
  const { mf, db } = await database(); const response = await handleApi(new Request("https://example.test/api/admin/chords/x/publish", { method: "POST", body: "{}" }), { DB: db, ALLOW_ADMIN_MUTATIONS: "true" } as WorkerEnv, adminDependencies); const payload = await response.json() as { error: { code: string; message: string } }; assert.equal(response.status, 400); assert.equal(payload.error.code, "INVALID_RECORD"); assert.doesNotMatch(payload.error.message, /SQL|stack/i); await mf.dispose();
});

test("review route and every admin endpoint reject unauthenticated requests", async () => {
  const { mf, db } = await database(); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "true", ASSETS: { fetch: async () => new Response("private review") } } as WorkerEnv;
  const unauthenticated = { authenticate: async () => ({ ok: false as const, status: 401 as const, code: "AUTH_REQUIRED" as const }) };
  assert.equal((await handleRequest(new Request("https://example.test/review.html"), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/audit"), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/export?format=json"), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/import", { method: "POST", body: JSON.stringify({ records: [] }) }), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/enrichment/preview", { method: "POST", body: JSON.stringify({ records: [] }) }), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/enrichment/apply", { method: "POST", body: JSON.stringify({ records: [] }) }), env, unauthenticated)).status, 401);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/x/reject", { method: "POST" }), env, unauthenticated)).status, 401);
  await mf.dispose();
});

test("administrator export includes lossless records and AI enrichment fields in JSON and CSV", async () => {
  const { mf, db, store } = await database();
  await publishRecord(store, cRecord); await store.preReview({ ...dRecord, workflowStatus: "pre-reviewed" });
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const jsonResponse = await handleApi(new Request("https://example.test/api/admin/chords/export?format=json"), env, adminDependencies);
  assert.equal(jsonResponse.status, 200); assert.equal(jsonResponse.headers.get("Cache-Control"), "no-store");
  assert.match(jsonResponse.headers.get("Content-Disposition") ?? "", /^attachment; filename="chord-vault-export-\d{4}-\d{2}-\d{2}\.json"$/);
  const json = await jsonResponse.json() as { recordCount: number; records: Array<Record<string, unknown>> };
  assert.equal(json.recordCount, 2);
  const exported = json.records.find((record) => record.id === cRecord.id)!;
  assert.equal(exported.chordName, "C"); assert.equal(exported.recipeId, cRecord.recipeId); assert.equal(exported.workflowStatus, "published");
  assert.deepEqual(exported.fretPositions, cRecord.fretPositions); assert.deepEqual(exported.tuning, cRecord.tuning);
  assert.ok(Array.isArray(exported.notes)); assert.ok("description" in exported); assert.ok("tags" in exported); assert.ok("difficulty" in exported);

  const csvResponse = await handleApi(new Request("https://example.test/api/admin/chords/export?format=csv"), env, adminDependencies);
  assert.equal(csvResponse.status, 200); assert.match(csvResponse.headers.get("Content-Disposition") ?? "", /chord-vault-export-\d{4}-\d{2}-\d{2}\.csv/);
  const csv = await csvResponse.text();
  assert.match(csv, /^schemaVersion,id,chordName,slug,root,recipeId,quality,type,tuning,fretPositions/);
  assert.ok(csv.includes(cRecord.id)); assert.ok(csv.includes(JSON.stringify(cRecord.fretPositions).replaceAll('"', '""'))); assert.ok(csv.includes("recordJson"));
  await mf.dispose();
});

test("administrator export handles an empty database", async () => {
  const { mf, db } = await database(); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const jsonResponse = await handleApi(new Request("https://example.test/api/admin/chords/export?format=json"), env, adminDependencies);
  const payload = await jsonResponse.json() as { exportedAt: string; recordCount: number; records: unknown[] };
  assert.match(payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/); assert.equal(payload.recordCount, 0); assert.deepEqual(payload.records, []);
  const csvResponse = await handleApi(new Request("https://example.test/api/admin/chords/export?format=csv"), env, adminDependencies);
  const csv = await csvResponse.text(); assert.equal(csv.split("\r\n").length, 1); assert.match(csv, /^schemaVersion,id,chordName/);
  await mf.dispose();
});

test("a freshly exported chord CSV round-trips through strict persisted validation", () => {
  const csv = chordExportCsv(createChordExport([cRecord, dRecord], new Date("2026-08-08T00:00:00Z")));
  const imported = parseCsvObjects(csv).map((row, index) => importRecordCandidate(row, index));
  const validated = imported.map(validatePersistedChord);
  assert.equal(validated.every((result) => result.ok), true);
  assert.deepEqual(validated.flatMap((result) => result.ok ? [result.value.id] : []), [cRecord.id, dRecord.id]);
  const first = validated[0]; assert.equal(first?.ok, true);
  if (first?.ok) {
    assert.deepEqual(first.value.fretPositions, cRecord.fretPositions); assert.deepEqual(first.value.tuning, cRecord.tuning);
    assert.equal(first.value.workflowStatus, cRecord.workflowStatus); assert.deepEqual(first.value.tags, cRecord.tags);
  }
});

test("exported fetch does not pass Cloudflare ExecutionContext into dependency injection", async () => {
  const { mf, db } = await database();
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const response = await Reflect.apply(worker.fetch, worker, [new Request("https://example.test/api/admin/session"), env, { waitUntil() {}, passThroughOnException() {} }]);
  const payload = await response.json() as { error: { code: string } };
  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "AUTH_NOT_CONFIGURED");
  await mf.dispose();
});

test("administrator session returns only minimal identity with private security headers", async () => {
  const { mf, db } = await database();
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const response = await handleApi(new Request("https://example.test/api/admin/session"), env, adminDependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { administrator: { email: "admin@example.test" }, expiresAt: 2_000_000_000 });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Vary") ?? "", /Cf-Access-Jwt-Assertion/);
  await mf.dispose();
});

test("authenticated non-admin users cannot access review or mutate", async () => {
  const { mf, db } = await database(); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "true", ASSETS: { fetch: async () => new Response("private review") } } as WorkerEnv;
  const ordinaryUser = { authenticate: async () => ({ ok: false as const, status: 403 as const, code: "AUTH_FORBIDDEN" as const }) };
  assert.equal((await handleRequest(new Request("https://example.test/review.html"), env, ordinaryUser)).status, 403);
  assert.equal((await handleApi(new Request("https://example.test/api/admin/chords/x/reject", { method: "POST" }), env, ordinaryUser)).status, 403);
  await mf.dispose();
});

test("authenticated administrator can load review, edit and publish with attributed audits", async () => {
  const { mf, db, store } = await database(); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "true", ASSETS: { fetch: async () => new Response("private review") } } as WorkerEnv;
  const review = await handleRequest(new Request("https://example.test/review.html"), env, adminDependencies); assert.equal(review.status, 200); assert.equal(review.headers.get("Cache-Control"), "no-store");
  const preReview = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/pre-review`, { method: "POST", body: JSON.stringify(cRecord) }), env, adminDependencies); assert.equal(preReview.status, 200);
  const publish = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/publish`, { method: "POST", body: JSON.stringify(cRecord) }), env, adminDependencies); assert.equal(publish.status, 200);
  const edit = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/edit`, { method: "POST", body: JSON.stringify({ difficulty: 4, styles: ["Jazz"] }) }), env, adminDependencies); assert.equal(edit.status, 200);
  const current = await store.get(cRecord.id); assert.equal(current?.difficulty, 4); assert.deepEqual(current?.styles, ["Jazz"]); assert.deepEqual(current?.tags, []);
  assert.ok((await store.auditLog()).every((entry) => entry.actor_identifier === "admin@example.test")); await mf.dispose();
});

test("authenticated editorial saves work without enabling broader administrator mutations", async () => {
  const { mf, db, store } = await database(); await publishRecord(store, cRecord);
  const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false", ALLOW_EDITORIAL_MUTATIONS: "true" } as WorkerEnv;
  const edit = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/edit`, { method: "POST", body: JSON.stringify({ difficulty: 3, moods: ["Warm"], styles: ["Jazz"] }) }), env, adminDependencies);
  assert.equal(edit.status, 200);
  const updated = await store.get(cRecord.id); assert.equal(updated?.difficulty, 3); assert.deepEqual(updated?.moods, ["Warm"]); assert.deepEqual(updated?.styles, ["Jazz"]); assert.deepEqual(updated?.tags, []);
  const publish = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/publish`, { method: "POST", body: JSON.stringify(cRecord) }), env, adminDependencies);
  assert.equal(publish.status, 404); await mf.dispose();
});

test("logout redirects to the Cloudflare Access application logout endpoint", async () => {
  const { mf, db } = await database(); const response = await handleApi(new Request("https://example.test/api/admin/logout"), { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv);
  assert.equal(response.status, 302); assert.equal(response.headers.get("Location"), "https://example.test/cdn-cgi/access/logout"); await mf.dispose();
});

test("adapter selection is centralized and hosted records are runtime validated", async () => {
  assert.equal(repositoryConfiguration({}).mode, "local"); assert.equal(repositoryConfiguration({ PROD: true }).mode, "hosted"); assert.equal(repositoryConfiguration({ PROD: true, VITE_CHORD_REPOSITORY: "local" }).mode, "local");
  const local = new MemoryStorage(); const selection = await createChordRepository({ localStorage: local, sessionStorage: local, env: { VITE_CHORD_REPOSITORY: "hosted" }, fetcher: async () => Response.json({ records: [cRecord] }) });
  assert.equal(selection.capabilities.backend, "hosted"); assert.deepEqual(selection.repository.listPublishedVoicings().map((item) => item.id), [cRecord.id]); assert.throws(() => selection.repository.publishVoicing(cMajor));
  selection.repository.updateEditorialFields(cRecord.id, { difficulty: 4, moods: ["Warm"], styles: ["Jazz"] });
  assert.deepEqual(selection.repository.loadWorkspace().libraryEdits[cRecord.id], { difficulty: 4, moods: ["Warm"], styles: ["Jazz"] });
  assert.ok(selection.repository instanceof HostedReadChordRepository); assert.ok(new LocalStorageChordRepository(new MemoryStorage()));
});

test("hosted quarantine reporting returns isolated invalid-import diagnostics", async () => {
  const { mf, db, store } = await database(); await db.prepare("INSERT INTO quarantined_records (source,raw_json,issues_json) VALUES (?1,?2,?3)").bind("test", "{}", "[]").run(); const records = await store.quarantine(); assert.equal(records.length, 1); assert.equal(records[0].source, "test"); await mf.dispose();
});

test("local-to-hosted preparation validates records and creates backup before upload", async () => {
  const prepared = prepareHostedImport({ preReviewed: [cMajor], published: [dMajor] }); assert.equal(prepared.records.length, 2); const order: string[] = [];
  const result = await backupThenUpload(prepared, async (contents) => { assert.ok(contents.includes("preReviewed")); order.push("backup"); }, async () => { order.push("upload"); return "ok"; });
  assert.equal(result, "ok"); assert.deepEqual(order, ["backup", "upload"]);
});
