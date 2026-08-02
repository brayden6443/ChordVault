import test from "node:test";
import assert from "node:assert/strict";
import { APPROVED_C_PROFILE, curationFit, rankWithCurationProfile } from "../src/chords/curation.ts";
import { generateVoicings } from "../src/chords/generator.ts";
import { STANDARD_TUNING } from "../src/chords/types.ts";

test("C approval profile favors the selected structural tendencies", () => {
  const candidates = generateVoicings({
    tuning: STANDARD_TUNING, chordName: "D", root: "D", requiredTones: [0, 4, 7],
    maxResults: 250, maxRawCandidates: 50_000, allowOmitFifth: true,
  });
  const favored = candidates.find((item) => item.fretSpan === 2 && item.openStringCount === 2 && item.difficulty === 3);
  const outlier = candidates.find((item) => item.fretSpan >= 3 && item.openStringCount === 0 && item.difficulty >= 4);
  assert.ok(favored);
  assert.ok(outlier);
  assert.ok(curationFit(favored, APPROVED_C_PROFILE) > curationFit(outlier, APPROVED_C_PROFILE));
});

test("profile ranking preserves the deterministic generator score", () => {
  const candidates = generateVoicings({
    tuning: STANDARD_TUNING, chordName: "E", root: "E", requiredTones: [0, 4, 7], maxResults: 20,
  });
  const ranked = rankWithCurationProfile(candidates);
  assert.equal(ranked.length, candidates.length);
  assert.ok(ranked.every((item) => item.generatorQualityScore !== undefined && item.curationFitScore !== undefined));
});
