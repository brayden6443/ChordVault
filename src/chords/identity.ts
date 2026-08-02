import { normalizeInterval, pitchesForVoicing } from "./theory.ts";
import type { ChordVoicing, Tuning } from "./types.ts";

export function normalizeFret(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === -1 || String(value).toLowerCase() === "x") return "x";
  const fret = Number(value);
  if (!Number.isInteger(fret) || fret < 0) throw new Error(`Invalid fret value: ${value}`);
  return String(fret);
}

export function normalizedFretPattern(frets: Array<number | string | null | undefined>): string {
  return frets.map(normalizeFret).join("-");
}

export function exactVoicingKey(voicing: Pick<ChordVoicing, "tuning" | "root" | "chordQuality" | "chordName" | "fretPositions">): string {
  const inferredQuality = voicing.chordName.replace(voicing.root, "") || "major";
  const quality = (voicing.chordQuality ?? inferredQuality).toLowerCase();
  return [voicing.tuning.id.toLowerCase(), voicing.root.toLowerCase(), quality, normalizedFretPattern(voicing.fretPositions)].join("|");
}

function setSimilarity<T>(left: Set<T>, right: Set<T>, containment = false): number {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / (containment ? Math.max(1, Math.min(left.size, right.size)) : Math.max(1, new Set([...left, ...right]).size));
}

function playedStringSet(voicing: ChordVoicing): Set<number> {
  return new Set(voicing.fretPositions.flatMap((fret, index) => fret === null ? [] : [index]));
}

function movablePattern(voicing: ChordVoicing): string | null {
  if (voicing.fretPositions.some((fret) => fret === 0)) return null;
  const fretted = voicing.fretPositions.filter((fret): fret is number => fret !== null);
  if (!fretted.length) return null;
  const lowest = Math.min(...fretted);
  return voicing.fretPositions.map((fret) => fret === null ? "x" : fret - lowest).join("-");
}

export function voicingSimilarity(left: ChordVoicing, right: ChordVoicing): number {
  if (left.tuning.id !== right.tuning.id || left.root !== right.root || (left.chordQuality ?? "") !== (right.chordQuality ?? "")) return 0;
  const leftPitches = pitchesForVoicing(left.tuning, left.fretPositions);
  const rightPitches = pitchesForVoicing(right.tuning, right.fretPositions);
  const midiContainment = setSimilarity(new Set(leftPitches.map((pitch) => pitch.midi)), new Set(rightPitches.map((pitch) => pitch.midi)), true);
  const pitchClassSimilarity = setSimilarity(new Set(leftPitches.map((pitch) => pitch.pitchClass)), new Set(rightPitches.map((pitch) => pitch.pitchClass)));
  const intervalSimilarity = setSimilarity(new Set(left.intervals.map(normalizeInterval)), new Set(right.intervals.map(normalizeInterval)));
  const stringSimilarity = setSimilarity(playedStringSet(left), playedStringSet(right));
  const sameBass = left.bassNote === right.bassNote ? 1 : 0;
  const sameInversion = left.inversion === right.inversion ? 1 : 0;
  const sameOpenCharacter = (left.openStringCount > 0) === (right.openStringCount > 0) ? 1 : 0;
  const sameMovableShape = movablePattern(left) !== null && movablePattern(left) === movablePattern(right) ? 1 : 0;
  const spanSimilarity = Math.max(0, 1 - Math.abs(left.fretSpan - right.fretSpan) / 4);
  return Math.round((midiContainment * 25 + pitchClassSimilarity * 10 + intervalSimilarity * 15 + stringSimilarity * 12 + sameBass * 10
    + sameInversion * 10 + sameOpenCharacter * 10 + sameMovableShape * 5 + spanSimilarity * 3) * 100) / 100;
}

export function tuningKey(tuning: Tuning): string {
  return `${tuning.id}|${tuning.strings.map((string) => string.midi).join("-")}`;
}
