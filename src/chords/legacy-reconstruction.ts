import { buildCanonicalLibrary } from "./canonical.ts";
import { exactVoicingKey } from "./identity.ts";
import { analyzePlayability } from "./playability.ts";
import { CHORD_SCHEMA_VERSION, hydratePersistedChord, persistChordVoicing, validatePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";
import { recipeById, recipeIdFromChordName, requireRecipe } from "./recipes.ts";
import { pitchClassFromName, pitchClassName } from "./theory.ts";
import { STANDARD_TUNING, type ChordVoicing } from "./types.ts";

interface LegacyPublicRecord {
  key?: unknown; name?: unknown; root?: unknown; chordQuality?: unknown; difficulty?: unknown;
  descriptorTags?: unknown; frets?: unknown; fingers?: unknown; source?: unknown;
}

interface LegacyEdit { difficulty?: unknown; descriptorTags?: unknown }
interface LegacyBackup {
  version?: unknown; exportedAt?: unknown; publishedKeys?: unknown; publicLibrary?: unknown;
  libraryEdits?: unknown; savedReviews?: unknown; auditLog?: unknown;
}

export type ReconstructionIssueKind = "missing" | "ambiguous" | "invalid" | "duplicate-identity";
export interface ReconstructionIssue { id: string; kind: ReconstructionIssueKind; reason: string }
export interface ReconstructionValidation {
  id: string; identity: string; schemaVersion: number; root: string; recipeId: string; tuningId: string;
  stringStateCount: number; notes: string[]; intervals: number[]; bass: string; inversion: string; playability: boolean;
}
export interface ReconstructionReport {
  expectedPublished: number; approvedIds: number; resolvedFromPublicLibrary: number; resolvedFromCanonicalSource: number;
  resolvedUsingBoth: number; missing: number; ambiguous: number; invalid: number; duplicateIdentity: number;
  reconstructedSuccessfully: number; finalPublishedRecordCount: number; idsPreserved: number; idsChanged: number;
  editsApplied: number; editsSkipped: number; recordsQuarantined: number; recordsUnresolved: number;
  importReady: boolean; validations: ReconstructionValidation[];
}
export interface ReconstructionResult {
  published: PersistedChordRecordV1[]; preReviewed: PersistedChordRecordV1[];
  quarantined: ReconstructionIssue[]; unresolved: ReconstructionIssue[]; report: ReconstructionReport;
}

export interface ReconstructionOptions { expectedPublished?: number; canonicalSource?: ChordVoicing[] }

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function mutedFret(value: unknown): number | null {
  if (value === null || value === -1 || String(value).toLowerCase() === "x") return null;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 24) throw new Error("fret positions must be muted or integers from 0 to 24");
  return Number(value);
}
function publicFrets(record: LegacyPublicRecord): Array<number | null> {
  if (!Array.isArray(record.frets) || record.frets.length !== 6) throw new Error("publicLibrary fret pattern must contain six strings");
  return record.frets.map(mutedFret);
}
function publicTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string" || tag.trim() === "")) throw new Error("descriptor tags must be non-empty strings");
  return [...new Set(value.map((tag) => String(tag).trim()))];
}
function difficulty(value: unknown): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) throw new Error("difficulty must be an integer from 1 to 5");
  return Number(value) as 1 | 2 | 3 | 4 | 5;
}
function publicDraft(record: LegacyPublicRecord, id: string): ChordVoicing {
  if (typeof record.name !== "string" || typeof record.root !== "string" || typeof record.chordQuality !== "string") throw new Error("publicLibrary name, root, and quality are required");
  const recipe = recipeById(record.chordQuality); if (!recipe) throw new Error("publicLibrary quality is not a registered recipe");
  const root = pitchClassName(pitchClassFromName(record.root)); const expectedName = `${root}${recipe.suffix}`;
  if (record.name !== expectedName || recipeIdFromChordName(record.name) !== recipe.id) throw new Error("displayed chord name conflicts with its root or recipe");
  const frets = publicFrets(record); const tags = publicTags(record.descriptorTags ?? []);
  const canonicalLike = buildCanonicalLibrary(false).find((candidate) => exactVoicingKey(candidate) === exactVoicingKey({ tuning: STANDARD_TUNING, root, chordQuality: recipe.id, chordName: record.name as string, fretPositions: frets }));
  const base = canonicalLike ?? buildCanonicalLibrary(false)[0];
  if (!base) throw new Error("canonical source is unavailable");
  return { ...base, id, chordName: record.name, chordQuality: recipe.id, root, tuning: STANDARD_TUNING, fretPositions: frets,
    difficulty: difficulty(record.difficulty), descriptorTags: tags, moodTags: tags, genreTags: [], description: "", source: "Legacy browser publicLibrary reconstruction", approvalStatus: "approved" };
}

function editFor(raw: Record<string, unknown>, id: string): LegacyEdit | undefined {
  const value = raw[id]; if (value === undefined) return undefined;
  if (!object(value)) throw new Error("library edit must be an object");
  return value;
}

export function reconstructLegacyApproved(raw: unknown, options: ReconstructionOptions = {}): ReconstructionResult {
  const expectedPublished = options.expectedPublished ?? 54; const canonical = options.canonicalSource ?? buildCanonicalLibrary(true);
  const unresolved: ReconstructionIssue[] = []; const quarantined: ReconstructionIssue[] = []; const published: PersistedChordRecordV1[] = [];
  const validations: ReconstructionValidation[] = []; const seenIds = new Set<string>(); const seenIdentities = new Map<string, string>();
  let fromPublic = 0, fromCanonical = 0, usingBoth = 0, idsPreserved = 0, idsChanged = 0, editsApplied = 0;
  const backup = object(raw) ? raw as LegacyBackup : {}; const ids = Array.isArray(backup.publishedKeys) ? backup.publishedKeys : [];
  const approvedIds = ids.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  const publicLibrary = Array.isArray(backup.publicLibrary) ? backup.publicLibrary.filter(object) as LegacyPublicRecord[] : [];
  const edits = object(backup.libraryEdits) ? backup.libraryEdits : {};
  for (const id of approvedIds) {
    try {
      if (seenIds.has(id)) { unresolved.push({ id, kind: "duplicate-identity", reason: "approved ID occurs more than once" }); continue; }
      seenIds.add(id);
      const publicMatches = publicLibrary.filter((record) => record.key === id);
      if (publicMatches.length > 1) { unresolved.push({ id, kind: "ambiguous", reason: "multiple publicLibrary records share the approved ID" }); continue; }
      const publicMatch = publicMatches[0]; let publicSource: ChordVoicing | undefined;
      if (publicMatch) { publicSource = publicDraft(publicMatch, id); fromPublic += 1; }
      const identityMatches = publicSource ? canonical.filter((candidate) => exactVoicingKey(candidate) === exactVoicingKey(publicSource)) : [];
      const canonicalMatches = [...new Map([...canonical.filter((candidate) => candidate.id === id), ...identityMatches].map((candidate) => [candidate.id, candidate])).values()];
      if (canonicalMatches.length > 1) { unresolved.push({ id, kind: "ambiguous", reason: "multiple canonical records match the approved ID or identity" }); continue; }
      const canonicalMatch = canonicalMatches[0];
      if (!publicSource && !canonicalMatch) { unresolved.push({ id, kind: "missing", reason: "no publicLibrary or canonical source record matched" }); continue; }
      if (canonicalMatch) fromCanonical += 1;
      if (publicSource && canonicalMatch) {
        usingBoth += 1;
        if (exactVoicingKey(publicSource) !== exactVoicingKey(canonicalMatch)) throw new Error("publicLibrary and canonical identities conflict");
        if (publicSource.chordName !== canonicalMatch.chordName) throw new Error("publicLibrary and canonical chord names conflict");
      }
      const source = canonicalMatch ? { ...canonicalMatch, id } : publicSource as ChordVoicing;
      source.source = "Reconstructed from legacy browser data (publicLibrary + canonical library v1)";
      if (publicMatch) { source.difficulty = difficulty(publicMatch.difficulty); source.descriptorTags = publicTags(publicMatch.descriptorTags ?? []); }
      const edit = editFor(edits, id);
      if (edit) {
        if (edit.difficulty !== undefined) source.difficulty = difficulty(edit.difficulty);
        if (edit.descriptorTags !== undefined) source.descriptorTags = publicTags(edit.descriptorTags);
        editsApplied += 1;
      }
      const record = persistChordVoicing(source, "published"); record.provenance = { source: "Legacy browser reconstruction: exact approved ID with canonical identity verification" };
      const schema = validatePersistedChord(record); if (!schema.ok) throw new Error(schema.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      const hydrated = hydratePersistedChord(schema.value); const recipe = requireRecipe(schema.value.recipeId);
      if (hydrated.chordName !== source.chordName) throw new Error("hydrated chord name conflicts with reconstructed source");
      const playability = analyzePlayability(schema.value.fretPositions, { tuning: schema.value.tuning, chordName: hydrated.chordName, chordQuality: recipe.id, root: hydrated.root,
        requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals], fretMin: 0, fretMax: 24, maxFretSpan: 4, maxFrettedNotes: 6,
        maxInternalMutedStrings: 1, maxAdjacentStretch: 4, minPlayedStrings: 3, allowOmitFifth: recipe.permittedOmissions.includes(7) });
      if (!playability.valid) throw new Error(`playability validation failed: ${playability.reasons.join("; ")}`);
      const identity = exactVoicingKey(hydrated); const duplicate = seenIdentities.get(identity);
      if (duplicate) { unresolved.push({ id, kind: "duplicate-identity", reason: `canonical identity duplicates approved record ${duplicate}` }); continue; }
      seenIdentities.set(identity, id); published.push(schema.value); idsPreserved += schema.value.id === id ? 1 : 0; idsChanged += schema.value.id === id ? 0 : 1;
      validations.push({ id, identity, schemaVersion: schema.value.schemaVersion, root: hydrated.root, recipeId: schema.value.recipeId, tuningId: hydrated.tuning.id,
        stringStateCount: schema.value.fretPositions.length, notes: hydrated.notes, intervals: hydrated.intervals, bass: hydrated.bassNote, inversion: hydrated.inversion, playability: true });
    } catch (error) { quarantined.push({ id, kind: "invalid", reason: error instanceof Error ? error.message : "reconstruction failed validation" }); }
  }
  const editKeys = Object.keys(edits); const editsSkipped = editKeys.filter((id) => !approvedIds.includes(id)).length;
  const counts = (kind: ReconstructionIssueKind) => [...unresolved, ...quarantined].filter((issue) => issue.kind === kind).length;
  const stop = unresolved.length > 0 || quarantined.length > 0 || published.length !== expectedPublished || approvedIds.length !== expectedPublished;
  return { published, preReviewed: [], quarantined, unresolved, report: { expectedPublished, approvedIds: approvedIds.length,
    resolvedFromPublicLibrary: fromPublic, resolvedFromCanonicalSource: fromCanonical, resolvedUsingBoth: usingBoth,
    missing: counts("missing"), ambiguous: counts("ambiguous"), invalid: counts("invalid"), duplicateIdentity: counts("duplicate-identity"),
    reconstructedSuccessfully: published.length, finalPublishedRecordCount: published.length, idsPreserved, idsChanged, editsApplied, editsSkipped,
    recordsQuarantined: quarantined.length, recordsUnresolved: unresolved.length, importReady: !stop, validations } };
}

export function reconstructionEnvelope(result: ReconstructionResult, legacy: LegacyBackup): Record<string, unknown> {
  return { schemaVersion: CHORD_SCHEMA_VERSION, published: result.published, preReviewed: result.preReviewed, quarantined: result.quarantined,
    unresolved: result.unresolved, reconstructionReport: result.report, legacyMetadata: { version: legacy.version, exportedAt: legacy.exportedAt,
      publishedKeys: legacy.publishedKeys, libraryEdits: legacy.libraryEdits, savedReviews: legacy.savedReviews, auditLog: legacy.auditLog } };
}
