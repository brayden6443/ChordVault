import { hydratePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";

export interface PublicChordDetails {
  id: string;
  slug: string;
  chordName: string;
  root: string;
  recipeId: string;
  tuningName: string;
  fretPositions: Array<number | null>;
  fingerPositions: Array<number | null>;
  notes: string[];
  intervals: number[];
  bassNote: string;
  inversion: string;
  difficulty: number;
  tags: string[];
  description: string;
  possibleBarres: Array<{ fret: number; fromString: number; toString: number }>;
}

export function toPublicChordDetails(record: PersistedChordRecordV1): PublicChordDetails {
  const chord = hydratePersistedChord(record);
  return {
    id: chord.id,
    slug: chord.slug,
    chordName: chord.chordName,
    root: chord.root,
    recipeId: record.recipeId,
    tuningName: chord.tuning.name,
    fretPositions: [...chord.fretPositions],
    fingerPositions: chord.fingerPositions ? [...chord.fingerPositions] : chord.fretPositions.map(() => null),
    notes: [...chord.notes],
    intervals: [...chord.intervals],
    bassNote: chord.bassNote,
    inversion: chord.inversion,
    difficulty: chord.difficulty,
    tags: [...chord.descriptorTags ?? []],
    description: chord.description,
    possibleBarres: chord.possibleBarres.map((barre) => ({ ...barre })),
  };
}
