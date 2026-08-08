import { inferFingerLabels, renderChordDiagram } from "./diagram.ts";
import type { PublicChordDetails } from "./public-chord.ts";

export interface ChordPositionView {
  chord: PublicChordDetails;
  diagram: string;
  fingers: string[];
  frets: number[];
}

export function positionAt(positions: PublicChordDetails[], index: number): ChordPositionView {
  const chord = positions[index];
  if (!chord) throw new RangeError("Chord position is unavailable.");
  const frets = chord.fretPositions.map((fret) => fret ?? -1);
  const fingers = inferFingerLabels(frets, chord.fingerPositions);
  return { chord, frets, fingers, diagram: renderChordDiagram({ name: chord.chordName, frets, fingers }) };
}

export function hasMultiplePositions(positions: PublicChordDetails[]): boolean { return positions.length > 1; }
