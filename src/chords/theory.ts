import type { PlayedPitch, Tuning } from "./types.ts";

export const SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#",
};

export function normalizeInterval(interval: number): number {
  return ((interval % 12) + 12) % 12;
}

export function pitchClassFromName(note: string): number {
  const withoutOctave = note.replace(/-?\d+$/, "");
  const normalized = FLAT_TO_SHARP[withoutOctave] ?? withoutOctave;
  const result = SHARP_NOTE_NAMES.indexOf(normalized as (typeof SHARP_NOTE_NAMES)[number]);
  if (result < 0) throw new Error(`Unknown note name: ${note}`);
  return result;
}

export function pitchClassName(pitchClass: number): string {
  return SHARP_NOTE_NAMES[normalizeInterval(pitchClass)];
}

export function pitchFromTuningAndFret(openMidi: number, fret: number): PlayedPitch {
  if (!Number.isInteger(fret) || fret < 0) throw new Error("Fret must be a non-negative integer");
  const midi = openMidi + fret;
  return {
    stringIndex: -1,
    fret,
    midi,
    pitchClass: normalizeInterval(midi),
    note: pitchClassName(midi),
  };
}

export function pitchesForVoicing(tuning: Tuning, frets: Array<number | null>): PlayedPitch[] {
  if (frets.length !== tuning.strings.length) throw new Error("Fret positions must match the tuning's string count");
  return frets.flatMap((fret, stringIndex) => {
    if (fret === null) return [];
    return [{ ...pitchFromTuningAndFret(tuning.strings[stringIndex].midi, fret), stringIndex }];
  });
}

export function intervalsRelativeToRoot(pitches: PlayedPitch[], root: string): number[] {
  const rootPitchClass = pitchClassFromName(root);
  return pitches.map((pitch) => normalizeInterval(pitch.pitchClass - rootPitchClass));
}

export function uniqueIntervals(intervals: number[]): number[] {
  return [...new Set(intervals.map(normalizeInterval))].sort((a, b) => a - b);
}

export function chordToneCoverage(intervals: number[], requestedTones: number[]): number {
  const present = new Set(intervals.map(normalizeInterval));
  const requested = [...new Set(requestedTones.map(normalizeInterval))];
  if (requested.length === 0) return 1;
  return requested.filter((tone) => present.has(tone)).length / requested.length;
}

export function bassPitch(pitches: PlayedPitch[]): PlayedPitch | null {
  return pitches.length ? pitches.reduce((lowest, pitch) => pitch.midi < lowest.midi ? pitch : lowest) : null;
}

export function inversionForPitches(pitches: PlayedPitch[], root: string): string {
  const bass = bassPitch(pitches);
  if (!bass) return "No bass";
  const interval = normalizeInterval(bass.pitchClass - pitchClassFromName(root));
  if (interval === 0) return "Root position";
  if (interval === 3 || interval === 4) return "1st inversion";
  if (interval === 7) return "2nd inversion";
  if (interval === 10 || interval === 11) return "3rd inversion";
  return `${pitchClassName(bass.pitchClass)} in bass`;
}

const RELIABLE_CHORD_NAMES: Record<string, string> = {
  "0,4,7": "", "0,3,7": "m", "0,4,7,11": "maj7", "0,4,7,10": "7",
  "0,3,7,10": "m7", "0,3,6,10": "m7b5", "0,3,6,9": "dim7",
  "0,2,7": "sus2", "0,5,7": "sus4", "0,4,8": "aug", "0,3,6": "dim",
};

export function reliableAlternateChordNames(root: string, intervals: number[], currentName = ""): string[] {
  const suffix = RELIABLE_CHORD_NAMES[uniqueIntervals(intervals).join(",")];
  if (suffix === undefined) return [];
  const name = `${pitchClassName(pitchClassFromName(root))}${suffix}`;
  return name === currentName ? [] : [name];
}

export function intervalLabel(interval: number): string {
  return ["R", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"][normalizeInterval(interval)];
}
