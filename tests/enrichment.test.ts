import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { chordExportCsv, createChordExport } from "../src/chords/admin-export.ts";
import { importRecordCandidate, parseCsvObjects } from "../src/chords/csv-import.ts";
import { applyEnrichmentPatch, classifyImportRows } from "../src/chords/enrichment.ts";
import { persistChordVoicing } from "../src/chords/persisted.ts";

const c = persistChordVoicing(CANONICAL_VOICINGS.find((item) => item.chordName === "C" && item.category === "Essential Open")!, "published");
const d = persistChordVoicing(CANONICAL_VOICINGS.find((item) => item.chordName === "D" && item.category === "Essential Open")!, "published");
function exported(record = c): Record<string, unknown> { return createChordExport([record], new Date("2026-08-08T00:00:00Z")).records[0] as unknown as Record<string, unknown>; }

test("identical existing enrichment record is unchanged", () => {
  const result = classifyImportRows([exported()], [c]); assert.equal(result.counts.unchanged, 1); assert.deepEqual(result.rows[0]?.changedFields, []);
});

test("approved enrichment fields are classified as an update", () => {
  const result = classifyImportRows([{ ...exported(), description: "Clear and warm", moods: ["Warm"], relatedChords: ["Cmaj7"] }], [c]);
  assert.equal(result.counts["enrichment-update"], 1); assert.deepEqual(result.rows[0]?.changedFields.sort(), ["description", "moods", "relatedChords"]);
});

test("a protected voicing change is a conflict", () => {
  const result = classifyImportRows([{ ...exported(), fretPositions: [0, 0, 0, 0, 0, 0] }], [c]);
  assert.equal(result.counts["protected-field-conflict"], 1); assert.deepEqual(result.rows[0]?.changedFields, ["fretPositions"]);
});

test("applying enrichment preserves every protected field", () => {
  const row = classifyImportRows([{ ...exported(), difficulty: 4, styles: ["Indie"], description: "Updated" }], [c]).rows[0]!;
  const updated = applyEnrichmentPatch(c, row.patch!);
  for (const field of ["id", "schemaVersion", "root", "tuning", "fretPositions", "fingerPositions", "workflowStatus", "provenance", "catalog"] as const) assert.deepEqual(updated[field], c[field]);
  assert.equal(updated.difficulty, 4); assert.deepEqual(updated.styles, ["Indie"]); assert.equal(updated.description, "Updated");
});

test("mixed batches classify new, update, unchanged, and conflict independently", () => {
  const fresh = { ...d, id: "new-d-voicing", workflowStatus: "pre-reviewed" as const };
  const result = classifyImportRows([fresh, { ...exported(), description: "Updated" }, exported(), { ...exported(), fretPositions: [0, 0, 0, 0, 0, 0] }, { ...d, id: "duplicate-d", workflowStatus: "pre-reviewed" }], [c]);
  assert.deepEqual(result.counts, { new: 1, unchanged: 1, "enrichment-update": 1, "protected-field-conflict": 1, "duplicate-identity": 1, invalid: 0 });
});

test("exported CSV accepts AI enrichment and round-trips as an update", () => {
  const csv = chordExportCsv(createChordExport([c], new Date("2026-08-08T00:00:00Z")));
  const row = parseCsvObjects(csv)[0]!; row.description = "AI enriched description"; row.moods = '["Dreamy","Warm"]'; row.relatedChords = '["Cmaj7","Am7"]';
  const candidate = importRecordCandidate(row, 0); const result = classifyImportRows([candidate], [c]);
  assert.equal(result.counts["enrichment-update"], 1); assert.deepEqual(result.rows[0]?.changedFields.sort(), ["description", "moods", "relatedChords"]);
});

test("a new id with an existing canonical identity is a duplicate identity", () => {
  const result = classifyImportRows([{ ...c, id: "duplicate-c", workflowStatus: "pre-reviewed" }], [c]);
  assert.equal(result.rows[0]?.classification, "duplicate-identity"); assert.match(result.rows[0]?.reasons[0] ?? "", /already belongs/);
});
