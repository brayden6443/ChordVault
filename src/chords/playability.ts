import type { GenerationConfig, PlayabilityAnalysis } from "./types.ts";
import { intervalsRelativeToRoot, pitchesForVoicing } from "./theory.ts";

export function fretSpanFor(frets: Array<number | null>): number {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  return fretted.length < 2 ? 0 : Math.max(...fretted) - Math.min(...fretted);
}

export function findPossibleBarres(frets: Array<number | null>): Array<{ fret: number; fromString: number; toString: number }> {
  const result: Array<{ fret: number; fromString: number; toString: number }> = [];
  const usedFrets = [...new Set(frets.filter((fret): fret is number => fret !== null && fret > 0))];
  for (const fret of usedFrets) {
    const indices = frets.flatMap((value, index) => value === fret ? [index] : []);
    if (indices.length < 2) continue;
    const fromString = Math.min(...indices);
    const toString = Math.max(...indices);
    const canBarre = frets.slice(fromString, toString + 1).every((value) => value === null || value === 0 || value >= fret);
    if (canBarre) result.push({ fret, fromString, toString });
  }
  return result;
}

function internalMutedStringCount(frets: Array<number | null>): number {
  const played = frets.flatMap((fret, index) => fret === null ? [] : [index]);
  if (played.length < 2) return 0;
  const first = Math.min(...played);
  const last = Math.max(...played);
  return frets.slice(first, last + 1).filter((fret) => fret === null).length;
}

export function analyzePlayability(frets: Array<number | null>, config: GenerationConfig): PlayabilityAnalysis {
  const reasons: string[] = [];
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  const span = fretSpanFor(frets);
  const barres = findPossibleBarres(frets);
  const internalMutes = internalMutedStringCount(frets);
  const maxSpan = config.maxFretSpan ?? 4;
  const maxFretted = config.maxFrettedNotes ?? 5;
  const maxInternalMutes = config.maxInternalMutedStrings ?? 1;
  const maxAdjacentStretch = config.maxAdjacentStretch ?? 4;
  const minPlayedStrings = config.minPlayedStrings ?? 3;

  if (frets.filter((fret) => fret !== null).length < minPlayedStrings) reasons.push("Too few played strings");
  if (span > maxSpan) reasons.push(`Fret span exceeds ${maxSpan}`);
  if (fretted.length > maxFretted) reasons.push(`More than ${maxFretted} fretted notes`);
  if (internalMutes > maxInternalMutes) reasons.push("Too many internal muted strings");

  for (let index = 1; index < frets.length; index += 1) {
    const previous = frets[index - 1];
    const current = frets[index];
    if (previous && current && Math.abs(previous - current) > maxAdjacentStretch) {
      reasons.push("Impossible adjacent-string stretch");
      break;
    }
  }

  const pitches = pitchesForVoicing(config.tuning, frets);
  const intervals = intervalsRelativeToRoot(pitches, config.root);
  const present = new Set(intervals);
  const required = config.requiredTones.filter((tone) => !(config.allowOmitFifth && tone % 12 === 7));
  const missing = required.filter((tone) => !present.has(((tone % 12) + 12) % 12));
  if (missing.length) reasons.push(`Missing required tones: ${missing.join(", ")}`);

  const barreSavings = barres.reduce((total, barre) => total + Math.max(0, frets.slice(barre.fromString, barre.toString + 1).filter((fret) => fret === barre.fret).length - 1), 0);
  const estimatedFingerCount = Math.max(0, fretted.length - barreSavings);
  if (estimatedFingerCount > 4) reasons.push("Requires more than four fingers");

  const effort = span + estimatedFingerCount + internalMutes + (Math.max(...fretted, 0) >= 9 ? 1 : 0);
  const difficulty = Math.min(5, Math.max(1, Math.ceil(effort / 2))) as 1 | 2 | 3 | 4 | 5;
  return {
    valid: reasons.length === 0,
    reasons,
    fretSpan: span,
    frettedNoteCount: fretted.length,
    openStringCount: frets.filter((fret) => fret === 0).length,
    internalMutedStringCount: internalMutes,
    possibleBarres: barres,
    estimatedFingerCount,
    difficulty,
  };
}
