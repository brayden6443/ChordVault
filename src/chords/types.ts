export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface TuningString {
  note: string;
  midi: number;
}

export interface Tuning {
  id: string;
  name: string;
  strings: TuningString[];
}

export interface PlayedPitch {
  stringIndex: number;
  fret: number;
  midi: number;
  pitchClass: number;
  note: string;
}

export interface ScoreBreakdown {
  harmonicCompleteness: number;
  playability: number;
  usefulBass: number;
  openStrings: number;
  extensions: number;
  uniqueness: number;
  fretSpanPenalty: number;
  muddyIntervalPenalty: number;
  duplicateNotePenalty: number;
}

export interface ChordVoicing {
  id: string;
  slug: string;
  chordName: string;
  root: string;
  tuning: Tuning;
  fretPositions: Array<number | null>;
  fingerPositions?: Array<number | null>;
  notes: string[];
  intervals: number[];
  bassNote: string;
  inversion: string;
  alternateNames: string[];
  fretSpan: number;
  openStringCount: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  moodTags: string[];
  genreTags: string[];
  description: string;
  qualityScore: number;
  generatorQualityScore?: number;
  curationFitScore?: number;
  scoreBreakdown: ScoreBreakdown;
  approvalStatus: ApprovalStatus;
  possibleBarres: Array<{ fret: number; fromString: number; toString: number }>;
}

export interface GenerationConfig {
  tuning: Tuning;
  chordName: string;
  root: string;
  requiredTones: number[];
  optionalTones?: number[];
  fretMin?: number;
  fretMax?: number;
  allowMuted?: boolean;
  allowOpen?: boolean;
  allowOmitFifth?: boolean;
  maxFretSpan?: number;
  maxFrettedNotes?: number;
  maxInternalMutedStrings?: number;
  maxAdjacentStretch?: number;
  minPlayedStrings?: number;
  maxRawCandidates?: number;
  maxResults?: number;
}

export interface PlayabilityAnalysis {
  valid: boolean;
  reasons: string[];
  fretSpan: number;
  frettedNoteCount: number;
  openStringCount: number;
  internalMutedStringCount: number;
  possibleBarres: Array<{ fret: number; fromString: number; toString: number }>;
  estimatedFingerCount: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface BatchChordSpec {
  chordName: string;
  root: string;
  requiredTones: number[];
  optionalTones?: number[];
}

export interface BatchResult {
  rawCandidateCount: number;
  retained: ChordVoicing[];
  rejectedByRules: number;
}

export const STANDARD_TUNING: Tuning = {
  id: "standard-e",
  name: "Standard (E A D G B E)",
  strings: [
    { note: "E2", midi: 40 },
    { note: "A2", midi: 45 },
    { note: "D3", midi: 50 },
    { note: "G3", midi: 55 },
    { note: "B3", midi: 59 },
    { note: "E4", midi: 64 },
  ],
};
