import { analyzePlayability } from "./playability.ts";
import { recipeById, requireRecipe, type RecipeId } from "./recipes.ts";
import { scoreVoicing } from "./scoring.ts";
import { semanticChordSlug } from "./slug.ts";
import { bassPitch, intervalsRelativeToRoot, inversionForPitches, pitchClassFromName, pitchClassName, pitchesForVoicing, reliableAlternateChordNames } from "./theory.ts";
import type { ChordVoicing, ShapeFamily, Tuning, VoicingCategory } from "./types.ts";

export const CHORD_SCHEMA_VERSION = 1 as const;
export const DIFFICULTY_MIN = 1 as const;
export const DIFFICULTY_MAX = 5 as const;
export type PersistedWorkflowStatus = "pending" | "pre-reviewed" | "published" | "rejected";

export interface PersistedCatalogMetadata {
  canonical: boolean;
  essential: boolean;
  category?: VoicingCategory;
  displayPriority?: number;
  shapeFamily?: ShapeFamily;
  movable?: boolean;
  baseShapeRoot?: string;
  applicableRoots?: string[];
}

export interface PersistedChordRecordV1 {
  schemaVersion: typeof CHORD_SCHEMA_VERSION;
  id: string;
  root: string;
  recipeId: RecipeId;
  tuning: Tuning;
  fretPositions: Array<number | null>;
  fingerPositions?: Array<number | null>;
  displayNameOverride?: string;
  description: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  workflowStatus: PersistedWorkflowStatus;
  catalog?: PersistedCatalogMetadata;
  provenance: { source: string };
}

export interface ValidationIssue { path: string; message: string }
export type ValidationResult<T> = { ok: true; value: T; issues: [] } | { ok: false; issues: ValidationIssue[] };

const WORKFLOW_STATUSES = new Set<PersistedWorkflowStatus>(["pending", "pre-reviewed", "published", "rejected"]);
const CATEGORIES = new Set<VoicingCategory>(["Essential Open", "Essential Barre", "Other Approved"]);
const SHAPE_FAMILIES = new Set<ShapeFamily>(["Open C shape", "Open A shape", "Open G shape", "Open E shape", "Open D shape", "E-shape barre", "A-shape barre", "CAGED movable shape", "Partial barre", "Shell voicing"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(value: unknown, path: string, issues: ValidationIssue[], optional = false): value is string {
  if (optional && value === undefined) return false;
  if (typeof value !== "string" || value.trim() === "") issues.push({ path, message: "must be a non-empty string" });
  return typeof value === "string" && value.trim() !== "";
}

function validateTuning(value: unknown, issues: ValidationIssue[]): value is Tuning {
  if (!isObject(value)) { issues.push({ path: "tuning", message: "must be an object" }); return false; }
  validateString(value.id, "tuning.id", issues); validateString(value.name, "tuning.name", issues);
  if (!Array.isArray(value.strings) || value.strings.length !== 6) { issues.push({ path: "tuning.strings", message: "must contain exactly six strings" }); return false; }
  value.strings.forEach((entry, index) => {
    if (!isObject(entry)) { issues.push({ path: `tuning.strings[${index}]`, message: "must be an object" }); return; }
    validateString(entry.note, `tuning.strings[${index}].note`, issues);
    if (!Number.isInteger(entry.midi) || Number(entry.midi) < 0 || Number(entry.midi) > 127) issues.push({ path: `tuning.strings[${index}].midi`, message: "must be a MIDI integer from 0 to 127" });
  });
  return true;
}

function validatePositions(value: unknown, path: string, issues: ValidationIssue[], fingers = false): value is Array<number | null> {
  if (!Array.isArray(value) || value.length !== 6) { issues.push({ path, message: "must contain exactly six string positions" }); return false; }
  value.forEach((position, index) => {
    const valid = position === null || (Number.isInteger(position) && Number(position) >= (fingers ? 1 : 0) && Number(position) <= (fingers ? 4 : 24));
    if (!valid) issues.push({ path: `${path}[${index}]`, message: fingers ? "must be null or a finger number from 1 to 4" : "must be null or a fret integer from 0 to 24" });
  });
  return true;
}

export function validatePersistedChord(value: unknown): ValidationResult<PersistedChordRecordV1> {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) return { ok: false, issues: [{ path: "$", message: "record must be an object" }] };
  if (value.schemaVersion !== CHORD_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: value.schemaVersion === undefined ? "is required" : `unsupported schema version: ${String(value.schemaVersion)}` });
  validateString(value.id, "id", issues); validateString(value.root, "root", issues);
  if (typeof value.root === "string") { try { pitchClassFromName(value.root); } catch { issues.push({ path: "root", message: "must be a recognized pitch class" }); } }
  if (typeof value.recipeId !== "string" || !recipeById(value.recipeId) || recipeById(value.recipeId)?.id !== value.recipeId) issues.push({ path: "recipeId", message: "must be a canonical registered recipe id" });
  validateTuning(value.tuning, issues); validatePositions(value.fretPositions, "fretPositions", issues);
  if (value.fingerPositions !== undefined) validatePositions(value.fingerPositions, "fingerPositions", issues, true);
  if (value.displayNameOverride !== undefined) validateString(value.displayNameOverride, "displayNameOverride", issues);
  if (typeof value.description !== "string") issues.push({ path: "description", message: "must be a string" });
  if (!Number.isInteger(value.difficulty) || Number(value.difficulty) < DIFFICULTY_MIN || Number(value.difficulty) > DIFFICULTY_MAX) issues.push({ path: "difficulty", message: "must be an integer from 1 to 5" });
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) issues.push({ path: "tags", message: "must be an array of non-empty strings" });
  if (typeof value.workflowStatus !== "string" || !WORKFLOW_STATUSES.has(value.workflowStatus as PersistedWorkflowStatus)) issues.push({ path: "workflowStatus", message: "must be pending, pre-reviewed, published, or rejected" });
  if (!isObject(value.provenance)) issues.push({ path: "provenance", message: "must be an object" });
  else validateString(value.provenance.source, "provenance.source", issues);
  if (value.catalog !== undefined) {
    if (!isObject(value.catalog)) issues.push({ path: "catalog", message: "must be an object" });
    else {
      if (typeof value.catalog.canonical !== "boolean") issues.push({ path: "catalog.canonical", message: "must be boolean" });
      if (typeof value.catalog.essential !== "boolean") issues.push({ path: "catalog.essential", message: "must be boolean" });
      if (value.catalog.category !== undefined && !CATEGORIES.has(value.catalog.category as VoicingCategory)) issues.push({ path: "catalog.category", message: "is not a recognized category" });
      if (value.catalog.displayPriority !== undefined && (!Number.isInteger(value.catalog.displayPriority) || Number(value.catalog.displayPriority) < 0)) issues.push({ path: "catalog.displayPriority", message: "must be a non-negative integer" });
      if (value.catalog.canonical === true && value.catalog.essential !== true) issues.push({ path: "catalog.essential", message: "canonical records must be essential" });
      if (value.catalog.canonical === true && value.catalog.category !== "Essential Open" && value.catalog.category !== "Essential Barre") issues.push({ path: "catalog.category", message: "canonical records must use an essential category" });
      if (value.catalog.shapeFamily !== undefined && (typeof value.catalog.shapeFamily !== "string" || !SHAPE_FAMILIES.has(value.catalog.shapeFamily as ShapeFamily))) issues.push({ path: "catalog.shapeFamily", message: "is not a recognized shape family" });
      if (value.catalog.movable !== undefined && typeof value.catalog.movable !== "boolean") issues.push({ path: "catalog.movable", message: "must be boolean" });
      if (value.catalog.baseShapeRoot !== undefined) validateString(value.catalog.baseShapeRoot, "catalog.baseShapeRoot", issues);
      if (value.catalog.applicableRoots !== undefined && (!Array.isArray(value.catalog.applicableRoots) || value.catalog.applicableRoots.some((root) => typeof root !== "string"))) issues.push({ path: "catalog.applicableRoots", message: "must be an array of roots" });
    }
  }
  if (issues.length) return { ok: false, issues };
  const record = value as unknown as PersistedChordRecordV1;
  return { ok: true, value: { ...record, tags: [...new Set(record.tags.map((tag) => tag.trim()))] }, issues: [] };
}

export function safeParseJson(text: string): ValidationResult<unknown> {
  try { return { ok: true, value: JSON.parse(text), issues: [] }; }
  catch (error) { return { ok: false, issues: [{ path: "$", message: `malformed JSON: ${error instanceof Error ? error.message : "parse failure"}` }] }; }
}

export function hydratePersistedChord(record: PersistedChordRecordV1): ChordVoicing {
  const validated = validatePersistedChord(record);
  if (!validated.ok) throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  const value = validated.value; const recipe = requireRecipe(value.recipeId);
  const root = pitchClassName(pitchClassFromName(value.root)); const chordName = value.displayNameOverride ?? `${root}${recipe.suffix}`;
  const pitches = pitchesForVoicing(value.tuning, value.fretPositions); const intervals = intervalsRelativeToRoot(pitches, root);
  const analysis = analyzePlayability(value.fretPositions, { tuning: value.tuning, chordName, chordQuality: recipe.id, root, requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals], fretMin: 0, fretMax: 24, maxFretSpan: 24, maxFrettedNotes: 6, maxInternalMutedStrings: 6, maxAdjacentStretch: 24, minPlayedStrings: 1, allowOmitFifth: recipe.permittedOmissions.includes(7) });
  const scored = scoreVoicing(pitches, intervals, analysis, { tuning: value.tuning, chordName, chordQuality: recipe.id, root, requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals] });
  const bass = bassPitch(pitches); const catalog = value.catalog;
  const chord = {
    id: value.id, slug: "", chordName, chordQuality: recipe.id, root, tuning: value.tuning,
    fretPositions: [...value.fretPositions], fingerPositions: value.fingerPositions ? [...value.fingerPositions] : undefined,
    notes: pitches.map((pitch) => pitch.note), intervals, bassNote: bass?.note ?? "", inversion: inversionForPitches(pitches, root),
    alternateNames: reliableAlternateChordNames(root, intervals, chordName), fretSpan: analysis.fretSpan,
    openStringCount: analysis.openStringCount, difficulty: value.difficulty, moodTags: [...value.tags], genreTags: [], descriptorTags: [...value.tags],
    description: value.description, qualityScore: scored.score, scoreBreakdown: scored.breakdown,
    approvalStatus: value.workflowStatus === "pending" ? "pending" : value.workflowStatus === "rejected" ? "rejected" : "approved",
    possibleBarres: analysis.possibleBarres, shapeFamily: catalog?.shapeFamily, category: catalog?.category, source: value.provenance.source,
    isCanonical: catalog?.canonical, isEssential: catalog?.essential, displayPriority: catalog?.displayPriority,
    movable: catalog?.movable, baseShapeRoot: catalog?.baseShapeRoot, applicableRoots: catalog?.applicableRoots,
  } satisfies ChordVoicing;
  chord.slug = semanticChordSlug(chord);
  return chord;
}

export function persistChordVoicing(voicing: ChordVoicing, workflowStatus?: PersistedWorkflowStatus): PersistedChordRecordV1 {
  const recipe = requireRecipe(voicing.chordQuality ?? "major"); const defaultName = `${pitchClassName(pitchClassFromName(voicing.root))}${recipe.suffix}`;
  const inferredStatus = voicing.approvalStatus === "pending" ? "pending" : voicing.approvalStatus === "rejected" ? "rejected" : "pre-reviewed";
  return {
    schemaVersion: CHORD_SCHEMA_VERSION, id: voicing.id, root: pitchClassName(pitchClassFromName(voicing.root)), recipeId: recipe.id as RecipeId,
    tuning: { ...voicing.tuning, strings: voicing.tuning.strings.map((string) => ({ ...string })) }, fretPositions: [...voicing.fretPositions],
    fingerPositions: voicing.fingerPositions ? [...voicing.fingerPositions] : undefined,
    displayNameOverride: voicing.chordName !== defaultName ? voicing.chordName : undefined, description: voicing.description,
    difficulty: voicing.difficulty, tags: [...new Set(voicing.descriptorTags ?? [...voicing.moodTags, ...voicing.genreTags])],
    workflowStatus: workflowStatus ?? inferredStatus,
    catalog: voicing.isCanonical || voicing.isEssential || voicing.category ? { canonical: Boolean(voicing.isCanonical), essential: Boolean(voicing.isEssential), category: voicing.category, displayPriority: voicing.displayPriority, shapeFamily: voicing.shapeFamily, movable: voicing.movable, baseShapeRoot: voicing.baseShapeRoot, applicableRoots: voicing.applicableRoots } : undefined,
    provenance: { source: voicing.source ?? "Chord Vault" },
  };
}
