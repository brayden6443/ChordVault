import test from "node:test";
import assert from "node:assert/strict";
import { analyzePlayability, findPossibleBarres } from "../src/chords/playability.ts";
import { scoreVoicing } from "../src/chords/scoring.ts";
import { intervalsRelativeToRoot, pitchesForVoicing } from "../src/chords/theory.ts";
import { STANDARD_TUNING, type GenerationConfig } from "../src/chords/types.ts";

const config: GenerationConfig = {
  tuning: STANDARD_TUNING, chordName: "C", root: "C", requiredTones: [0, 4, 7],
  maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1,
};

test("accepts a playable open chord and identifies its metrics", () => {
  const frets = [null, 3, 2, 0, 1, 0];
  const result = analyzePlayability(frets, config);
  assert.equal(result.valid, true);
  assert.equal(result.fretSpan, 2);
  assert.equal(result.openStringCount, 2);
  assert.ok(result.difficulty <= 3);
});

test("rejects missing defining tones and excessive stretches", () => {
  const missingThird = analyzePlayability([null, 3, 5, 5, 8, null], config);
  assert.equal(missingThird.valid, false);
  assert.ok(missingThird.reasons.some((reason) => reason.includes("Missing required")));
  assert.ok(missingThird.reasons.some((reason) => reason.includes("span") || reason.includes("stretch")));
});

test("recognizes a possible barre and produces a bounded score", () => {
  assert.deepEqual(findPossibleBarres([1, 3, 3, 2, 1, 1])[0], { fret: 1, fromString: 0, toString: 5 });
  const frets = [null, 3, 2, 0, 1, 0];
  const pitches = pitchesForVoicing(STANDARD_TUNING, frets);
  const intervals = intervalsRelativeToRoot(pitches, "C");
  const analysis = analyzePlayability(frets, config);
  const scored = scoreVoicing(pitches, intervals, analysis, config);
  assert.ok(scored.score >= 0 && scored.score <= 100);
  assert.equal(scored.breakdown.harmonicCompleteness, 25);
});
