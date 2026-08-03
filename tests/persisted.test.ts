import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { migrateChordRecords, migrateJsonSources } from "../src/chords/migration.ts";
import { hydratePersistedChord, persistChordVoicing, safeParseJson, validatePersistedChord } from "../src/chords/persisted.ts";
import { CHORD_RECIPES, generatorRecipes, recipeById } from "../src/chords/recipes.ts";

const source = CANONICAL_VOICINGS.find((voicing) => voicing.chordName === "C" && voicing.category === "Essential Open")!;
const valid = persistChordVoicing(source, "published");

test("validates a versioned persisted chord", () => {
  assert.equal(validatePersistedChord(valid).ok, true);
});

test("rejects malformed positions, tuning, recipe, difficulty, and workflow status", () => {
  const cases: unknown[] = [
    { ...valid, fretPositions: [0, 1] },
    { ...valid, tuning: { ...valid.tuning, strings: valid.tuning.strings.slice(1) } },
    { ...valid, recipeId: "future-recipe" },
    { ...valid, difficulty: 6 },
    { ...valid, workflowStatus: "maybe" },
    { ...valid, provenance: null },
  ];
  for (const candidate of cases) assert.equal(validatePersistedChord(candidate).ok, false);
});

test("rejects malformed JSON without throwing", () => {
  assert.equal(safeParseJson("{broken").ok, false);
  const result = migrateJsonSources([{ source: "bad.json", workflowStatus: "pre-reviewed", json: "{broken" }]);
  assert.equal(result.report.quarantined, 1);
  assert.equal(result.report.failed, 0);
});

test("migration is deterministic, reports dry runs, and skips already-versioned records", () => {
  const first = migrateChordRecords([{ source: "legacy", workflowStatus: "published", value: source }], true);
  assert.deepEqual(first.report, { dryRun: true, migrated: 1, skipped: 0, quarantined: 0, failed: 0, diagnostics: [] });
  const second = migrateChordRecords([{ source: "v1", workflowStatus: "published", value: first.records[0] }]);
  assert.equal(second.report.skipped, 1);
  assert.deepEqual(second.records, first.records);
});

test("unknown schema versions are quarantined instead of treated as legacy", () => {
  const result = migrateChordRecords([{ source: "future", workflowStatus: "published", value: { ...valid, schemaVersion: 999 } }]);
  assert.equal(result.report.quarantined, 1);
  assert.equal(result.records.length, 0);
});

test("hydration recalculates derived fields and ignores tampered legacy calculations", () => {
  const tampered = { ...source, notes: ["Wrong"], intervals: [99], bassNote: "Wrong", fretSpan: 99, openStringCount: 99, qualityScore: -999 };
  const hydrated = hydratePersistedChord(persistChordVoicing(tampered, "published"));
  assert.deepEqual(hydrated.notes, source.notes);
  assert.deepEqual(hydrated.intervals, source.intervals);
  assert.equal(hydrated.bassNote, source.bassNote);
  assert.equal(hydrated.fretSpan, source.fretSpan);
  assert.equal(hydrated.openStringCount, source.openStringCount);
  assert.notEqual(hydrated.qualityScore, -999);
});

test("the recipe registry is unique and covers every canonical and generator recipe", () => {
  assert.equal(new Set(CHORD_RECIPES.map((recipe) => recipe.id)).size, CHORD_RECIPES.length);
  for (const voicing of CANONICAL_VOICINGS) assert.ok(recipeById(voicing.chordQuality));
  assert.deepEqual(generatorRecipes().map((recipe) => recipe.id), CHORD_RECIPES.filter((recipe) => recipe.generatorAvailable).map((recipe) => recipe.id));
});
