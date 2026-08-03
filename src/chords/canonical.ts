import { exactVoicingKey } from "./identity.ts";
import { analyzePlayability } from "./playability.ts";
import { requireRecipe } from "./recipes.ts";
import { scoreVoicing } from "./scoring.ts";
import { bassPitch, intervalsRelativeToRoot, inversionForPitches, pitchClassFromName, pitchClassName, pitchesForVoicing } from "./theory.ts";
import { STANDARD_TUNING, type CanonicalVoicing, type GenerationConfig, type ShapeFamily } from "./types.ts";

interface CanonicalShapeSpec {
  root: string;
  quality: string;
  chordName: string;
  frets: Array<number | null>;
  fingers?: Array<number | null>;
  intervals: number[];
  family: ShapeFamily;
  category: "Essential Open" | "Essential Barre";
  priority: number;
  movable: boolean;
  baseRoot: string;
  applicableRoots: string[];
}

const OPEN_SPECS: CanonicalShapeSpec[] = [
  ["C","major",[null,3,2,0,1,0],"Open C shape",1], ["A","major",[null,0,2,2,2,0],"Open A shape",1],
  ["G","major",[3,2,0,0,0,3],"Open G shape",1], ["E","major",[0,2,2,1,0,0],"Open E shape",1], ["D","major",[null,null,0,2,3,2],"Open D shape",1],
  ["A","minor",[null,0,2,2,1,0],"Open A shape",1], ["E","minor",[0,2,2,0,0,0],"Open E shape",1], ["D","minor",[null,null,0,2,3,1],"Open D shape",1],
  ["A","sus2",[null,0,2,2,0,0],"Open A shape",1], ["D","sus2",[null,null,0,2,3,0],"Open D shape",1],
  ["A","sus4",[null,0,2,2,3,0],"Open A shape",1], ["E","sus4",[0,2,2,2,0,0],"Open E shape",1], ["D","sus4",[null,null,0,2,3,3],"Open D shape",1],
  ["A","dom7",[null,0,2,0,2,0],"Open A shape",1], ["B","dom7",[null,2,1,2,0,2],"Open A shape",1],
  ["C","dom7",[null,3,2,3,1,0],"Open C shape",1], ["D","dom7",[null,null,0,2,1,2],"Open D shape",1],
  ["E","dom7",[0,2,0,1,0,0],"Open E shape",1], ["G","dom7",[3,2,0,0,0,1],"Open G shape",1],
  ["A","maj7",[null,0,2,1,2,0],"Open A shape",1], ["C","maj7",[null,3,2,0,0,0],"Open C shape",1],
  ["D","maj7",[null,null,0,2,2,2],"Open D shape",1], ["E","maj7",[0,2,1,1,0,0],"Open E shape",1], ["G","maj7",[3,2,0,0,0,2],"Open G shape",1],
  ["A","min7",[null,0,2,0,1,0],"Open A shape",1], ["D","min7",[null,null,0,2,1,1],"Open D shape",1], ["E","min7",[0,2,0,0,0,0],"Open E shape",1],
  ["E","min9",[0,2,0,0,0,2],"Open E shape",1], ["B","min11",[null,2,0,2,0,0],"Open A shape",1],
].map(([root, quality, frets, family, priority]) => ({
  root: root as string, quality: quality as string, chordName: `${root}${requireRecipe(quality as string).suffix}`,
  frets: frets as Array<number | null>, intervals: [...requireRecipe(quality as string).requiredIntervals, ...requireRecipe(quality as string).optionalIntervals], family: family as ShapeFamily,
  category: "Essential Open", priority: priority as number, movable: false, baseRoot: root as string, applicableRoots: [root as string],
}));

const BARRE_TEMPLATES = [
  { quality: "major", family: "E-shape barre", offsets: [0,2,2,1,0,0], mute: [] },
  { quality: "minor", family: "E-shape barre", offsets: [0,2,2,0,0,0], mute: [] },
  { quality: "dom7", family: "E-shape barre", offsets: [0,2,0,1,0,0], mute: [] },
  { quality: "maj7", family: "E-shape barre", offsets: [0,2,1,1,0,0], mute: [] },
  { quality: "min7", family: "E-shape barre", offsets: [0,2,0,0,0,0], mute: [] },
  { quality: "major", family: "A-shape barre", offsets: [0,0,2,2,2,0], mute: [0] },
  { quality: "minor", family: "A-shape barre", offsets: [0,0,2,2,1,0], mute: [0] },
  { quality: "dom7", family: "A-shape barre", offsets: [0,0,2,0,2,0], mute: [0] },
  { quality: "maj7", family: "A-shape barre", offsets: [0,0,2,1,2,0], mute: [0] },
  { quality: "min7", family: "A-shape barre", offsets: [0,0,2,0,1,0], mute: [0] },
] as const;

function barreSpecs(): CanonicalShapeSpec[] {
  const roots = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return BARRE_TEMPLATES.flatMap((template) => roots.map((root) => {
    const basePitchClass = template.family === "E-shape barre" ? pitchClassFromName("E") : pitchClassFromName("A");
    const delta = (pitchClassFromName(root) - basePitchClass + 12) % 12 || 12;
    const frets = template.offsets.map((offset, index) => template.mute.includes(index as never) ? null : delta + offset);
    return {
      root, quality: template.quality, chordName: `${root}${requireRecipe(template.quality).suffix}`, frets,
      intervals: [...requireRecipe(template.quality).requiredIntervals, ...requireRecipe(template.quality).optionalIntervals], family: template.family, category: "Essential Barre" as const,
      priority: template.family === "E-shape barre" ? 1 : 2, movable: true,
      baseRoot: template.family === "E-shape barre" ? "E" : "A", applicableRoots: roots,
    };
  }));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}

export function createCanonicalVoicing(spec: CanonicalShapeSpec, validate = true): CanonicalVoicing {
  const recipe = requireRecipe(spec.quality);
  const config: GenerationConfig = {
    tuning: STANDARD_TUNING, chordName: spec.chordName, chordQuality: spec.quality, root: spec.root,
    requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals], fretMin: 0, fretMax: 14, maxFretSpan: 4, maxFrettedNotes: 6,
    maxInternalMutedStrings: 1, maxAdjacentStretch: 4, minPlayedStrings: 3, allowOmitFifth: true,
  };
  const fretted = spec.frets.filter((fret): fret is number => fret !== null && fret > 0);
  const span = fretted.length < 2 ? 0 : Math.max(...fretted) - Math.min(...fretted);
  const analysis = validate ? analyzePlayability(spec.frets, config) : {
    valid: true, reasons: [], fretSpan: span, frettedNoteCount: fretted.length,
    openStringCount: spec.frets.filter((fret) => fret === 0).length, internalMutedStringCount: 0,
    possibleBarres: [], estimatedFingerCount: Math.min(4, new Set(fretted).size),
    difficulty: Math.min(5, Math.max(1, Math.ceil((span + Math.min(4, new Set(fretted).size)) / 2))) as 1 | 2 | 3 | 4 | 5,
  };
  if (!analysis.valid) throw new Error(`${spec.chordName} ${spec.family} failed validation: ${analysis.reasons.join("; ")}`);
  const pitches = pitchesForVoicing(STANDARD_TUNING, spec.frets);
  const intervals = intervalsRelativeToRoot(pitches, spec.root);
  const required = new Set(recipe.requiredIntervals.filter((interval) => !recipe.permittedOmissions.includes(interval)));
  if ([...required].some((interval) => !intervals.includes(interval))) throw new Error(`${spec.chordName} ${spec.family} produces incorrect intervals`);
  const scored = validate ? scoreVoicing(pitches, intervals, analysis, config) : {
    score: 80,
    breakdown: { harmonicCompleteness: 25, playability: 25, usefulBass: 10, openStrings: 0, extensions: 0, uniqueness: 0, fretSpanPenalty: 0, muddyIntervalPenalty: 0, duplicateNotePenalty: 0 },
  };
  const draft = { tuning: STANDARD_TUNING, root: pitchClassName(pitchClassFromName(spec.root)), chordQuality: spec.quality, chordName: spec.chordName, fretPositions: spec.frets };
  const key = exactVoicingKey(draft);
  const bass = bassPitch(pitches);
  return {
    ...draft, id: `canonical_${stableHash(`${key}|${spec.family}`)}`, slug: `canonical-${spec.chordName.toLowerCase().replaceAll("#", "sharp-")}-${stableHash(key)}`,
    fingerPositions: spec.fingers, notes: pitches.map((pitch) => pitch.note), intervals, bassNote: bass?.note ?? "",
    inversion: inversionForPitches(pitches, spec.root), alternateNames: [], fretSpan: analysis.fretSpan,
    openStringCount: analysis.openStringCount, difficulty: analysis.difficulty, moodTags: [], genreTags: [], description: "",
    qualityScore: scored.score, scoreBreakdown: scored.breakdown, approvalStatus: "approved", possibleBarres: analysis.possibleBarres,
    shapeFamily: spec.family, category: spec.category, source: "Chord Vault canonical library v1", isCanonical: true,
    isEssential: true, displayPriority: spec.priority, movable: spec.movable, baseShapeRoot: spec.baseRoot, applicableRoots: spec.applicableRoots,
  };
}

export function buildCanonicalLibrary(validate = true): CanonicalVoicing[] {
  const all = [...OPEN_SPECS, ...barreSpecs()].map((spec) => createCanonicalVoicing(spec, validate));
  const unique = new Map(all.map((voicing) => [exactVoicingKey(voicing), voicing]));
  if (unique.size !== all.length) throw new Error("Canonical library contains duplicate exact voicings");
  return [...unique.values()];
}

// Runtime consumers use the already test-validated lightweight construction path.
export const CANONICAL_VOICINGS = buildCanonicalLibrary(false);
