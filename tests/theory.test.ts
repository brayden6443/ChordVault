import test from "node:test";
import assert from "node:assert/strict";
import { STANDARD_TUNING } from "../src/chords/types.ts";
import {
  chordToneCoverage, intervalsRelativeToRoot, inversionForPitches,
  pitchClassFromName, pitchFromTuningAndFret, pitchesForVoicing,
  reliableAlternateChordNames,
} from "../src/chords/theory.ts";

test("calculates pitches from tuning and fret deterministically", () => {
  const pitch = pitchFromTuningAndFret(40, 3);
  assert.equal(pitch.midi, 43);
  assert.equal(pitch.note, "G");
  assert.equal(pitchClassFromName("Bb"), 10);
});

test("calculates notes, intervals, bass, and inversion for open C", () => {
  const pitches = pitchesForVoicing(STANDARD_TUNING, [null, 3, 2, 0, 1, 0]);
  assert.deepEqual(pitches.map((pitch) => pitch.note), ["C", "E", "G", "C", "E"]);
  const intervals = intervalsRelativeToRoot(pitches, "C");
  assert.deepEqual(intervals, [0, 4, 7, 0, 4]);
  assert.equal(chordToneCoverage(intervals, [0, 4, 7]), 1);
  assert.equal(inversionForPitches(pitches, "C"), "Root position");
  assert.deepEqual(reliableAlternateChordNames("C", intervals, "C major"), ["C"]);
});
