import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { LocalStorageChordRepository, type StoragePort } from "../src/chords/chord-repository.ts";
import { HostedReadChordRepository } from "../src/chords/hosted-repository.ts";
import { backupThenUpload, prepareHostedImport } from "../src/chords/hosted-import.ts";
import { persistChordVoicing } from "../src/chords/persisted.ts";
import { createChordRepository, repositoryConfiguration } from "../src/chords/repository-composition.ts";
import { D1ChordStore, HostedDataError } from "../worker/d1-repository.ts";
import { handleApi } from "../worker/index.ts";
import type { D1Database, WorkerEnv } from "../worker/types.ts";

class MemoryStorage implements StoragePort { values = new Map<string, string>(); getItem(key: string): string | null { return this.values.get(key) ?? null; } setItem(key: string, value: string): void { this.values.set(key, value); } removeItem(key: string): void { this.values.delete(key); } }
const cMajor = CANONICAL_VOICINGS.find((item) => item.chordName === "C" && item.category === "Essential Open")!;
const dMajor = CANONICAL_VOICINGS.find((item) => item.chordName === "D" && item.category === "Essential Open")!;
const cRecord = persistChordVoicing({ ...cMajor, id: "hosted-c" }, "published");
const dRecord = persistChordVoicing({ ...dMajor, id: "hosted-d" }, "published");
async function applyMigration(db: D1Database): Promise<void> { const sql = await readFile(new URL("../migrations/0001_initial_schema.sql", import.meta.url), "utf8"); for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run(); }

async function database(): Promise<{ mf: Miniflare; db: D1Database; store: D1ChordStore }> {
  const mf = new Miniflare({ modules: true, script: "export default { fetch(){ return new Response('ok') } }", d1Databases: ["DB"] });
  const db = await mf.getD1Database("DB") as unknown as D1Database;
  await applyMigration(db);
  return { mf, db, store: new D1ChordStore(db) };
}

test("initial migration is retry-safe and creates the tracked schema", async () => {
  const { mf, db } = await database();
  await applyMigration(db);
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chord_voicings'").first<{ name: string }>(); assert.equal(row?.name, "chord_voicings"); await mf.dispose();
});

test("hosted store inserts valid records, rejects invalid versions, and returns published only", async () => {
  const { mf, store } = await database(); await store.preReview({ ...dRecord, workflowStatus: "pre-reviewed" }); await store.publish(cRecord);
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
  const { mf, store } = await database(); await store.publish(cRecord);
  await assert.rejects(store.publish({ ...cRecord, id: "duplicate-c" }), (error) => error instanceof HostedDataError && error.code === "DUPLICATE"); await mf.dispose();
});

async function failingAuditDatabase(): Promise<{ mf: Miniflare; store: D1ChordStore }> { const setup = await database(); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END").run(); return setup; }

test("publish transaction rolls back when audit insertion fails", async () => {
  const { mf, store } = await failingAuditDatabase(); await assert.rejects(store.publish(cRecord)); assert.equal(await store.get(cRecord.id), null); await mf.dispose();
});

test("replacement transaction preserves the old record on failure", async () => {
  const setup = await database(); await setup.store.publish(cRecord); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run();
  await assert.rejects(setup.store.replace(cRecord.id, dRecord)); assert.equal((await setup.store.get(cRecord.id))?.workflowStatus, "published"); assert.equal(await setup.store.get(dRecord.id), null); await setup.mf.dispose();
});

test("merge and rejection transactions roll back with their audit entry", async () => {
  for (const action of ["merge", "reject"] as const) { const setup = await database(); await setup.store.publish(cRecord); await setup.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'failure'); END").run(); if (action === "merge") await assert.rejects(setup.store.merge(cRecord.id, { ...cRecord, tags: ["Warm"] })); else await assert.rejects(setup.store.reject(cRecord.id)); const current = await setup.store.get(cRecord.id); assert.equal(current?.workflowStatus, "published"); assert.deepEqual(current?.tags, cRecord.tags); await setup.mf.dispose(); }
});

test("import dry-run is non-mutating and retry is idempotent", async () => {
  const { mf, store } = await database(); const dry = await store.importRecords([cRecord], true); assert.equal(dry.inserted, 1); assert.equal(await store.get(cRecord.id), null);
  const first = await store.importRecords([cRecord], false); const retry = await store.importRecords([cRecord], false); assert.equal(first.inserted, 1); assert.equal(retry.skipped, 1); await mf.dispose();
});

test("production admin endpoints are hidden while public API returns published records", async () => {
  const { mf, db, store } = await database(); await store.publish(cRecord); const env = { DB: db, ALLOW_ADMIN_MUTATIONS: "false" } as WorkerEnv;
  const publicResponse = await handleApi(new Request("https://example.test/api/chords/published"), env); assert.equal(publicResponse.status, 200); assert.equal(((await publicResponse.json()) as { records: unknown[] }).records.length, 1);
  const mutation = await handleApi(new Request(`https://example.test/api/admin/chords/${cRecord.id}/reject`, { method: "POST" }), env); assert.equal(mutation.status, 404); await mf.dispose();
});

test("API maps invalid payloads without leaking internals", async () => {
  const { mf, db } = await database(); const response = await handleApi(new Request("https://example.test/api/admin/chords/x/publish", { method: "POST", body: "{}" }), { DB: db, ALLOW_ADMIN_MUTATIONS: "true" } as WorkerEnv); const payload = await response.json() as { error: { code: string; message: string } }; assert.equal(response.status, 400); assert.equal(payload.error.code, "INVALID_RECORD"); assert.doesNotMatch(payload.error.message, /SQL|stack/i); await mf.dispose();
});

test("adapter selection is centralized and hosted records are runtime validated", async () => {
  assert.equal(repositoryConfiguration({}).mode, "local"); assert.equal(repositoryConfiguration({ PROD: true }).mode, "hosted"); assert.equal(repositoryConfiguration({ PROD: true, VITE_CHORD_REPOSITORY: "local" }).mode, "local");
  const local = new MemoryStorage(); const selection = await createChordRepository({ localStorage: local, sessionStorage: local, env: { VITE_CHORD_REPOSITORY: "hosted" }, fetcher: async () => Response.json({ records: [cRecord] }) });
  assert.equal(selection.capabilities.backend, "hosted"); assert.deepEqual(selection.repository.listPublishedVoicings().map((item) => item.id), [cRecord.id]); assert.throws(() => selection.repository.publishVoicing(cMajor));
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
