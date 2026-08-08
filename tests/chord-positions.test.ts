import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { hasMultiplePositions, positionAt } from "../src/chords/chord-positions.ts";
import { persistChordVoicing } from "../src/chords/persisted.ts";
import { toPublicChordDetails } from "../src/chords/public-chord.ts";

const open = CANONICAL_VOICINGS.find((chord) => chord.chordName === "C" && chord.category === "Essential Open")!;
const barre = CANONICAL_VOICINGS.find((chord) => chord.chordName === "C" && chord.category === "Essential Barre")!;
const positions = [
  toPublicChordDetails(persistChordVoicing({ ...open, id: "c-open-position" }, "published"), "c-open"),
  toPublicChordDetails(persistChordVoicing({ ...barre, id: "c-barre-position" }, "published"), "c-barre"),
];

test("multiple positions render distinct diagrams, frets, and notes when switched", () => {
  const first = positionAt(positions, 0); const second = positionAt(positions, 1);
  assert.equal(hasMultiplePositions(positions), true);
  assert.notDeepEqual(first.chord.fretPositions, second.chord.fretPositions);
  assert.notDeepEqual(first.chord.notes, second.chord.notes);
  assert.notEqual(first.diagram, second.diagram);
});

test("single-position chords do not require position controls", () => {
  assert.equal(hasMultiplePositions([positions[0]!]), false);
});
