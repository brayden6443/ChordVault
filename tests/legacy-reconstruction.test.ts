import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalLibrary } from "../src/chords/canonical.ts";
import { reconstructLegacyApproved } from "../src/chords/legacy-reconstruction.ts";
import type { ChordVoicing } from "../src/chords/types.ts";

const canonical = buildCanonicalLibrary(true);

function publicRecord(voicing: ChordVoicing, key = voicing.id) {
  return { key, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality, difficulty: voicing.difficulty,
    descriptorTags: ["Essential"], frets: voicing.fretPositions.map((fret) => fret ?? -1), source: "Main Vault" };
}

function backup(ids: string[], records: unknown[], edits: Record<string, unknown> = {}) {
  return { version: 1, exportedAt: "2026-08-03T00:00:00.000Z", publishedKeys: ids, publicLibrary: records, libraryEdits: edits, savedReviews: {}, auditLog: [] };
}

test("approved ID matched by exact public ID and canonical ID", () => {
  const chord = canonical[0]!; const result = reconstructLegacyApproved(backup([chord.id], [publicRecord(chord)]), { expectedPublished: 1, canonicalSource: [chord] });
  assert.equal(result.report.importReady, true); assert.equal(result.report.resolvedUsingBoth, 1); assert.equal(result.published[0]?.id, chord.id);
});

test("approved ID matched by canonical identity when IDs differ", () => {
  const chord = canonical[1]!; const id = "legacy-approved-id";
  const result = reconstructLegacyApproved(backup([id], [publicRecord(chord, id)]), { expectedPublished: 1, canonicalSource: [chord] });
  assert.equal(result.report.importReady, true); assert.equal(result.report.resolvedFromCanonicalSource, 1); assert.equal(result.published[0]?.id, id);
});

test("canonical ID fallback works without a public display record", () => {
  const chord = canonical[2]!; const result = reconstructLegacyApproved(backup([chord.id], []), { expectedPublished: 1, canonicalSource: [chord] });
  assert.equal(result.report.importReady, true); assert.equal(result.report.resolvedFromPublicLibrary, 0); assert.equal(result.report.resolvedFromCanonicalSource, 1);
});

test("ambiguous canonical identity is rejected", () => {
  const chord = canonical[3]!; const id = "legacy-ambiguous"; const duplicate = { ...chord, id: `${chord.id}-duplicate` };
  const result = reconstructLegacyApproved(backup([id], [publicRecord(chord, id)]), { expectedPublished: 1, canonicalSource: [chord, duplicate] });
  assert.equal(result.report.importReady, false); assert.equal(result.report.ambiguous, 1); assert.equal(result.published.length, 0);
});

test("missing approval source is rejected", () => {
  const result = reconstructLegacyApproved(backup(["missing-id"], []), { expectedPublished: 1, canonicalSource: [] });
  assert.equal(result.report.importReady, false); assert.equal(result.report.missing, 1);
});

test("valid library edit is applied", () => {
  const chord = canonical[4]!; const result = reconstructLegacyApproved(backup([chord.id], [publicRecord(chord)], { [chord.id]: { difficulty: 4, descriptorTags: ["Jazz", "Warm"] } }), { expectedPublished: 1, canonicalSource: [chord] });
  assert.equal(result.report.editsApplied, 1); assert.equal(result.published[0]?.difficulty, 4); assert.deepEqual(result.published[0]?.tags, []); assert.deepEqual(result.published[0]?.moods, ["Warm"]); assert.deepEqual(result.published[0]?.styles, ["Jazz"]);
});

test("invalid matching library edit is rejected", () => {
  const chord = canonical[5]!; const result = reconstructLegacyApproved(backup([chord.id], [publicRecord(chord)], { [chord.id]: { difficulty: 9 } }), { expectedPublished: 1, canonicalSource: [chord] });
  assert.equal(result.report.importReady, false); assert.equal(result.report.invalid, 1); assert.equal(result.report.recordsQuarantined, 1);
});

test("duplicate reconstructed canonical identity is rejected", () => {
  const chord = canonical[6]!; const first = "legacy-one"; const second = "legacy-two";
  const result = reconstructLegacyApproved(backup([first, second], [publicRecord(chord, first), publicRecord(chord, second)]), { expectedPublished: 2, canonicalSource: [] });
  assert.equal(result.report.importReady, false); assert.equal(result.report.duplicateIdentity, 1); assert.equal(result.published.length, 1);
});

test("exactly 54 expected records reconstruct successfully", () => {
  const selected = canonical.slice(0, 54); const result = reconstructLegacyApproved(backup(selected.map((chord) => chord.id), selected.map((chord) => publicRecord(chord))), { expectedPublished: 54, canonicalSource: selected });
  assert.equal(result.report.approvedIds, 54); assert.equal(result.report.finalPublishedRecordCount, 54); assert.equal(result.report.importReady, true);
});

test("reconstruction is deterministic, idempotent, and leaves input untouched", () => {
  const selected = canonical.slice(0, 3); const input = backup(selected.map((chord) => chord.id), selected.map((chord) => publicRecord(chord)));
  const before = JSON.stringify(input); const first = reconstructLegacyApproved(input, { expectedPublished: 3, canonicalSource: selected });
  const second = reconstructLegacyApproved(input, { expectedPublished: 3, canonicalSource: selected });
  assert.deepEqual(second, first); assert.equal(JSON.stringify(input), before);
});
