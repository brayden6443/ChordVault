import type { ChordVoicing } from "./types.ts";

export interface CurationPreferenceProfile {
  name: string;
  sourceCount: number;
  fretSpanWeights: Record<number, number>;
  openStringWeights: Record<number, number>;
  difficultyWeights: Record<number, number>;
  playedStringWeights: Record<number, number>;
  inversionWeights: Record<string, number>;
  movableShapeTemplates: string[];
}

// Derived from the 36 approved C-major voicings supplied on 2026-08-02.
// Frequencies are normalized against the most common choice in each category.
export const APPROVED_C_PROFILE: CurationPreferenceProfile = {
  name: "Approved C profile",
  sourceCount: 36,
  fretSpanWeights: { 0: 0.1, 1: 0.27, 2: 1, 3: 0.36 },
  openStringWeights: { 0: 0.17, 1: 0.67, 2: 1, 3: 0.17 },
  difficultyWeights: { 1: 0.1, 2: 0.48, 3: 1, 4: 0.24, 5: 0 },
  playedStringWeights: { 3: 0.07, 4: 0.93, 5: 1, 6: 0.4 },
  inversionWeights: { "Root position": 1, "1st inversion": 0.58, "2nd inversion": 0.32 },
  movableShapeTemplates: ["x|x|2|1|0|0", "x|x|2|1|0|x", "x|0|2|2|2|x"],
};

function normalizedMovableShape(voicing: ChordVoicing): string | null {
  if (voicing.fretPositions.some((fret) => fret === 0)) return null;
  const fretted = voicing.fretPositions.filter((fret): fret is number => fret !== null);
  if (!fretted.length) return null;
  const minimum = Math.min(...fretted);
  return voicing.fretPositions.map((fret) => fret === null ? "x" : fret - minimum).join("|");
}

export function curationFit(voicing: ChordVoicing, profile: CurationPreferenceProfile): number {
  const playedStrings = voicing.fretPositions.filter((fret) => fret !== null).length;
  const shape = normalizedMovableShape(voicing);
  const movableMatch = shape !== null && profile.movableShapeTemplates.includes(shape) ? 1 : 0;
  const weighted =
    (profile.fretSpanWeights[voicing.fretSpan] ?? 0) * 25
    + (profile.openStringWeights[voicing.openStringCount] ?? 0) * 20
    + (profile.difficultyWeights[voicing.difficulty] ?? 0) * 15
    + (profile.playedStringWeights[playedStrings] ?? 0) * 15
    + (profile.inversionWeights[voicing.inversion] ?? 0.1) * 15
    + movableMatch * 10;
  return Math.round(weighted);
}

export function rankWithCurationProfile(
  voicings: ChordVoicing[],
  profile: CurationPreferenceProfile = APPROVED_C_PROFILE,
): ChordVoicing[] {
  return voicings.map((voicing) => {
    const fit = curationFit(voicing, profile);
    return {
      ...voicing,
      generatorQualityScore: voicing.generatorQualityScore ?? voicing.qualityScore,
      curationFitScore: fit,
      qualityScore: Math.round((voicing.generatorQualityScore ?? voicing.qualityScore) * 0.7 + fit * 0.3),
    };
  }).sort((a, b) => b.qualityScore - a.qualityScore || (b.curationFitScore ?? 0) - (a.curationFitScore ?? 0));
}
