import { analyzePlayability } from "./playability.ts";
import { scoreVoicing } from "./scoring.ts";
import {
  bassPitch, intervalsRelativeToRoot, inversionForPitches, normalizeInterval,
  pitchClassFromName, pitchClassName, pitchesForVoicing, reliableAlternateChordNames,
} from "./theory.ts";
import type { BatchChordSpec, BatchResult, ChordVoicing, GenerationConfig } from "./types.ts";

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferFingers(frets: Array<number | null>): Array<number | null> {
  const distinctFrets = [...new Set(frets.filter((fret): fret is number => fret !== null && fret > 0))].sort((a, b) => a - b);
  const fingerForFret = new Map(distinctFrets.slice(0, 4).map((fret, index) => [fret, index + 1]));
  return frets.map((fret) => fret && fingerForFret.has(fret) ? fingerForFret.get(fret)! : null);
}

function optionsForString(config: Required<Pick<GenerationConfig, "fretMin" | "fretMax" | "allowMuted" | "allowOpen">> & GenerationConfig, stringIndex: number): Array<number | null> {
  const allowedIntervals = new Set([...config.requiredTones, ...(config.optionalTones ?? [])].map(normalizeInterval));
  const root = pitchClassFromName(config.root);
  const openMidi = config.tuning.strings[stringIndex].midi;
  const options: Array<number | null> = config.allowMuted ? [null] : [];
  if (config.allowOpen && allowedIntervals.has(normalizeInterval(openMidi - root))) options.push(0);
  for (let fret = Math.max(1, config.fretMin); fret <= config.fretMax; fret += 1) {
    if (allowedIntervals.has(normalizeInterval(openMidi + fret - root))) options.push(fret);
  }
  return options;
}

function buildVoicing(frets: Array<number | null>, config: GenerationConfig): ChordVoicing | null {
  const analysis = analyzePlayability(frets, config);
  if (!analysis.valid) return null;
  const pitches = pitchesForVoicing(config.tuning, frets);
  const intervals = intervalsRelativeToRoot(pitches, config.root);
  const scored = scoreVoicing(pitches, intervals, analysis, config);
  const shapeKey = `${config.tuning.id}|${config.root}|${frets.map((fret) => fret ?? "x").join("-")}`;
  const hash = stableHash(shapeKey);
  const bass = bassPitch(pitches);
  return {
    id: `voicing_${hash}`,
    slug: `${slugify(config.chordName)}-${hash}`,
    chordName: config.chordName,
    root: pitchClassName(pitchClassFromName(config.root)),
    tuning: config.tuning,
    fretPositions: frets,
    fingerPositions: inferFingers(frets),
    notes: pitches.map((pitch) => pitch.note),
    intervals,
    bassNote: bass?.note ?? "",
    inversion: inversionForPitches(pitches, config.root),
    alternateNames: reliableAlternateChordNames(config.root, intervals, config.chordName),
    fretSpan: analysis.fretSpan,
    openStringCount: analysis.openStringCount,
    difficulty: analysis.difficulty,
    moodTags: [],
    genreTags: [],
    description: "",
    qualityScore: scored.score,
    scoreBreakdown: scored.breakdown,
    approvalStatus: "pending",
    possibleBarres: analysis.possibleBarres,
  };
}

function generateWithStats(input: GenerationConfig): { voicings: ChordVoicing[]; examined: number; rejected: number } {
  const config = {
    ...input,
    fretMin: Math.max(0, input.fretMin ?? 0),
    fretMax: Math.min(12, input.fretMax ?? 12),
    allowMuted: input.allowMuted ?? true,
    allowOpen: input.allowOpen ?? true,
  };
  if (config.fretMin > config.fretMax) throw new Error("fretMin cannot exceed fretMax");
  if (config.tuning.strings.length === 0) return [];

  const optionSets = config.tuning.strings.map((_, index) => optionsForString(config, index));
  const maxRawCandidates = input.maxRawCandidates ?? 50_000;
  const maxResults = input.maxResults ?? 250;
  const results: ChordVoicing[] = [];
  const seen = new Set<string>();
  let examined = 0;

  function search(stringIndex: number, frets: Array<number | null>, minFret: number, maxFret: number, frettedCount: number): void {
    if (examined >= maxRawCandidates) return;
    if (stringIndex === optionSets.length) {
      examined += 1;
      const voicing = buildVoicing(frets, config);
      if (!voicing) return;
      const musicalKey = voicing.fretPositions.map((fret, index) => fret === null ? "x" : `${index}:${voicing.intervals[voicing.fretPositions.slice(0, index + 1).filter((value) => value !== null).length - 1]}`).join("|");
      if (!seen.has(musicalKey)) {
        seen.add(musicalKey);
        results.push(voicing);
      }
      return;
    }
    for (const fret of optionSets[stringIndex]) {
      const isFretted = fret !== null && fret > 0;
      const nextCount = frettedCount + (isFretted ? 1 : 0);
      if (nextCount > (config.maxFrettedNotes ?? 5)) continue;
      const nextMin = isFretted ? Math.min(minFret, fret) : minFret;
      const nextMax = isFretted ? Math.max(maxFret, fret) : maxFret;
      if (nextMin !== Infinity && nextMax - nextMin > (config.maxFretSpan ?? 4)) continue;
      search(stringIndex + 1, [...frets, fret], nextMin, nextMax, nextCount);
      if (examined >= maxRawCandidates) break;
    }
  }

  search(0, [], Infinity, -Infinity, 0);
  const voicings = results.sort((a, b) => b.qualityScore - a.qualityScore || a.id.localeCompare(b.id)).slice(0, maxResults);
  return { voicings, examined, rejected: Math.max(0, examined - results.length) };
}

export function generateVoicings(input: GenerationConfig): ChordVoicing[] {
  return generateWithStats(input).voicings;
}

export function generateBatch(
  specs: BatchChordSpec[],
  baseConfig: Omit<GenerationConfig, "chordName" | "root" | "requiredTones" | "optionalTones">,
  retainTop = 500,
): BatchResult {
  const batches = specs.map((spec) => generateWithStats({ ...baseConfig, ...spec }));
  const retained = batches.flatMap((batch) => batch.voicings);
  const unique = [...new Map(retained.map((voicing) => [voicing.id, voicing])).values()]
    .sort((a, b) => b.qualityScore - a.qualityScore || a.id.localeCompare(b.id));
  return {
    rawCandidateCount: batches.reduce((total, batch) => total + batch.examined, 0),
    retained: unique.slice(0, retainTop),
    rejectedByRules: batches.reduce((total, batch) => total + batch.rejected, 0) + Math.max(0, retained.length - unique.length),
  };
}
