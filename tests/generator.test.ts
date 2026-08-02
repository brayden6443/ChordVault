import test from "node:test";
import assert from "node:assert/strict";
import { approvedCsv, approvedJson, exportVoicingsCsv } from "../src/chords/export.ts";
import { generateBatch, generateVoicings } from "../src/chords/generator.ts";
import { STANDARD_TUNING } from "../src/chords/types.ts";

test("generates ranked, unique, playable voicings within frets 0-12", () => {
  const voicings = generateVoicings({
    tuning: STANDARD_TUNING, chordName: "Cmaj7", root: "C",
    requiredTones: [0, 4, 11], optionalTones: [7], maxResults: 30,
  });
  assert.ok(voicings.length > 0);
  assert.ok(voicings.length <= 30);
  assert.equal(new Set(voicings.map((voicing) => voicing.id)).size, voicings.length);
  assert.ok(voicings.every((voicing) => voicing.fretPositions.every((fret) => fret === null || (fret >= 0 && fret <= 12))));
  assert.ok(voicings.every((voicing) => voicing.intervals.includes(0) && voicing.intervals.includes(4) && voicing.intervals.includes(11)));
  assert.ok(voicings.every((voicing, index) => index === 0 || voicings[index - 1].qualityScore >= voicing.qualityScore));
});

test("batch generation retains the requested top candidates", () => {
  const batch = generateBatch([
    { chordName: "C", root: "C", requiredTones: [0, 4, 7] },
    { chordName: "Cm", root: "C", requiredTones: [0, 3, 7] },
  ], { tuning: STANDARD_TUNING, maxResults: 20, maxRawCandidates: 10_000 }, 15);
  assert.ok(batch.rawCandidateCount >= batch.retained.length);
  assert.ok(batch.retained.length <= 15);
});

test("exports valid JSON and CSV, with approved-only helpers", () => {
  const voicings = generateVoicings({
    tuning: STANDARD_TUNING, chordName: "G7", root: "G", requiredTones: [0, 4, 10], optionalTones: [7], maxResults: 2,
  });
  assert.ok(voicings.length > 0);
  voicings[0].approvalStatus = "approved";
  assert.equal(JSON.parse(approvedJson(voicings)).length, 1);
  assert.equal(approvedCsv(voicings).split("\n").length, 2);
  assert.ok(exportVoicingsCsv(voicings).includes("approvalStatus"));
});

test("generates valid suspended second and suspended fourth recipes", () => {
  for (const recipe of [
    { chordName: "Csus2", tones: [0, 2, 7] },
    { chordName: "Csus4", tones: [0, 5, 7] },
  ]) {
    const voicings = generateVoicings({
      tuning: STANDARD_TUNING, chordName: recipe.chordName, root: "C",
      requiredTones: recipe.tones, maxResults: 10,
    });
    assert.ok(voicings.length > 0);
    assert.ok(voicings.every((voicing) => recipe.tones.every((tone) => voicing.intervals.includes(tone))));
  }
});
