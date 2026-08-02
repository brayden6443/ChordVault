import type { GenerationConfig, PlayedPitch, PlayabilityAnalysis, ScoreBreakdown } from "./types.ts";
import { chordToneCoverage, normalizeInterval, pitchClassFromName } from "./theory.ts";

export function scoreVoicing(
  pitches: PlayedPitch[],
  intervals: number[],
  analysis: PlayabilityAnalysis,
  config: GenerationConfig,
): { score: number; breakdown: ScoreBreakdown } {
  const allTones = [...config.requiredTones, ...(config.optionalTones ?? [])];
  const scoreRequiredTones = config.allowOmitFifth
    ? config.requiredTones.filter((tone) => normalizeInterval(tone) !== 7)
    : config.requiredTones;
  const requiredCoverage = chordToneCoverage(intervals, scoreRequiredTones);
  const totalCoverage = chordToneCoverage(intervals, allTones);
  const uniquePitchClasses = new Set(pitches.map((pitch) => pitch.pitchClass));
  const bassInterval = pitches.length
    ? normalizeInterval(pitches.reduce((a, b) => a.midi < b.midi ? a : b).pitchClass - pitchClassFromName(config.root))
    : -1;
  const extensionSet = new Set((config.optionalTones ?? []).filter((tone) => ![0, 3, 4, 7, 10, 11].includes(normalizeInterval(tone))).map(normalizeInterval));
  const presentExtensions = [...extensionSet].filter((tone) => intervals.map(normalizeInterval).includes(tone)).length;
  let muddyPairs = 0;
  const lowPitches = pitches.filter((pitch) => pitch.midi < 52).sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < lowPitches.length; i += 1) {
    if (lowPitches[i].midi - lowPitches[i - 1].midi <= 2) muddyPairs += 1;
  }
  const duplicateCount = Math.max(0, pitches.length - uniquePitchClasses.size - 1);

  const breakdown: ScoreBreakdown = {
    harmonicCompleteness: Math.round(25 * requiredCoverage),
    playability: Math.max(0, 25 - analysis.fretSpan * 2 - Math.max(0, analysis.estimatedFingerCount - 3) * 3 - analysis.internalMutedStringCount * 2),
    usefulBass: bassInterval === 0 ? 10 : [3, 4, 7, 10, 11].includes(bassInterval) ? 7 : 3,
    openStrings: Math.min(8, analysis.openStringCount * 3),
    extensions: extensionSet.size ? Math.round(8 * (presentExtensions / extensionSet.size)) : Math.round(8 * totalCoverage),
    uniqueness: Math.min(8, Math.max(0, uniquePitchClasses.size - 2) * 3),
    fretSpanPenalty: analysis.fretSpan > 3 ? (analysis.fretSpan - 3) * 3 : 0,
    muddyIntervalPenalty: muddyPairs * 5,
    duplicateNotePenalty: duplicateCount * 2,
  };
  const positive = breakdown.harmonicCompleteness + breakdown.playability + breakdown.usefulBass
    + breakdown.openStrings + breakdown.extensions + breakdown.uniqueness;
  const negative = breakdown.fretSpanPenalty + breakdown.muddyIntervalPenalty + breakdown.duplicateNotePenalty;
  return { score: Math.max(0, Math.min(100, Math.round(positive - negative))), breakdown };
}
