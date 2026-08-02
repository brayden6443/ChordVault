import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalLibrary, CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { exactVoicingKey, voicingSimilarity } from "../src/chords/identity.ts";
import { buildReviewQueue, canApproveVoicing, seedCanonicalVoicings, sortPublicVoicings } from "../src/chords/repository.ts";
import { intervalsRelativeToRoot, pitchesForVoicing } from "../src/chords/theory.ts";
import { STANDARD_TUNING, type ChordVoicing } from "../src/chords/types.ts";

test("canonical library seeds validated open shapes and every required barre family across 12 roots", () => {
  assert.equal(buildCanonicalLibrary(true).length, CANONICAL_VOICINGS.length);
  assert.ok(CANONICAL_VOICINGS.filter((voicing) => voicing.category === "Essential Open").length >= 25);
  for (const quality of ["major", "minor", "dom7", "maj7", "min7"]) {
    for (const family of ["E-shape barre", "A-shape barre"]) {
      const familyVoicings = CANONICAL_VOICINGS.filter((voicing) => voicing.chordQuality === quality && voicing.shapeFamily === family);
      assert.equal(new Set(familyVoicings.map((voicing) => voicing.root)).size, 12);
    }
  }
  for (const voicing of CANONICAL_VOICINGS) {
    assert.deepEqual(intervalsRelativeToRoot(pitchesForVoicing(voicing.tuning, voicing.fretPositions), voicing.root), voicing.intervals);
  }
});

test("canonical seeding is idempotent and upgrades an existing equivalent without replacing user metadata", () => {
  const existing = { ...CANONICAL_VOICINGS[0], id: "user-record", description: "Keep my description", isCanonical: false as const };
  const first = seedCanonicalVoicings([existing], false);
  const second = seedCanonicalVoicings(first.voicings, false);
  assert.equal(first.voicings.length, CANONICAL_VOICINGS.length);
  assert.equal(second.voicings.length, first.voicings.length);
  assert.equal(second.voicings.find((voicing) => voicing.id === "user-record")?.description, "Keep my description");
  assert.equal(second.voicings.find((voicing) => voicing.id === "user-record")?.isCanonical, true);
});

test("exact identity normalizes muted formatting but keeps alternate tunings distinct", () => {
  const canonical = CANONICAL_VOICINGS.find((voicing) => voicing.chordName === "C" && voicing.category === "Essential Open")!;
  const formatted = { ...canonical, fretPositions: canonical.fretPositions.map((fret) => fret === null ? "x" : String(fret)) };
  assert.equal(exactVoicingKey(canonical), exactVoicingKey(formatted as unknown as ChordVoicing));
  const dropD = { ...canonical, tuning: { ...STANDARD_TUNING, id: "drop-d", strings: [{ note: "D2", midi: 38 }, ...STANDARD_TUNING.strings.slice(1)] } };
  assert.notEqual(exactVoicingKey(canonical), exactVoicingKey(dropD));
});

test("review excludes exact, formatting-equivalent, and near duplicates but preserves a different inversion", () => {
  const barre = CANONICAL_VOICINGS.find((voicing) => voicing.root === "C" && voicing.chordQuality === "major" && voicing.shapeFamily === "A-shape barre")!;
  const exact = { ...barre, id: "generated-exact", isCanonical: false };
  const nearFrets = [8, ...barre.fretPositions.slice(1)] as Array<number | null>;
  const nearPitches = pitchesForVoicing(barre.tuning, nearFrets);
  const near = { ...barre, id: "generated-near", fretPositions: nearFrets, notes: nearPitches.map((pitch) => pitch.note), intervals: intervalsRelativeToRoot(nearPitches, "C"), fretSpan: 5, possibleBarres: [], isCanonical: false };
  assert.ok(voicingSimilarity(near, barre) >= 90);
  const inversionFrets = [0,3,2,0,1,0];
  const inversionPitches = pitchesForVoicing(barre.tuning, inversionFrets);
  const inversion = { ...barre, id: "different-inversion", fretPositions: inversionFrets, notes: inversionPitches.map((pitch) => pitch.note), intervals: intervalsRelativeToRoot(inversionPitches, "C"), bassNote: "E", inversion: "1st inversion", openStringCount: 3, fretSpan: 2, isCanonical: false };
  const result = buildReviewQueue([exact, near, inversion], []);
  assert.deepEqual(result.queue.map((voicing) => voicing.id), ["different-inversion"]);
  assert.equal(canApproveVoicing(exact, [barre]).allowed, false);
});

test("public sorting never lets score outrank essential categories", () => {
  const open = { ...CANONICAL_VOICINGS.find((voicing) => voicing.category === "Essential Open")!, qualityScore: 1 };
  const barre = { ...CANONICAL_VOICINGS.find((voicing) => voicing.category === "Essential Barre")!, qualityScore: 2 };
  const generated = { ...barre, id: "generated", category: "Other Approved" as const, isEssential: false, isCanonical: false, qualityScore: 100 };
  assert.deepEqual(sortPublicVoicings([generated, barre, open]).map((voicing) => voicing.category), ["Essential Open", "Essential Barre", "Other Approved"]);
});

test("enharmonic roots resolve to the same pitch class without duplicating canonical display spellings", () => {
  assert.equal(CANONICAL_VOICINGS.some((voicing) => voicing.root === "Db"), false);
  assert.equal(CANONICAL_VOICINGS.filter((voicing) => voicing.root === "C#" && voicing.shapeFamily === "E-shape barre").length, 5);
});
