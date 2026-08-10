import { hydratePersistedChord, validatePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";
import { recipeById, type RecipeId } from "./recipes.ts";

export type EnrichmentClassification = "new" | "unchanged" | "update" | "conflict" | "invalid";
export interface EnrichmentPatch {
  displayNameOverride?: string;
  recipeId?: RecipeId;
  difficulty?: PersistedChordRecordV1["difficulty"];
  moods?: PersistedChordRecordV1["moods"];
  styles?: PersistedChordRecordV1["styles"];
  tags?: string[];
  description?: string;
  relatedChords?: string[];
}
export interface EnrichmentPreviewRow {
  index: number; id: string; classification: EnrichmentClassification; changedFields: string[]; reasons: string[]; patch?: EnrichmentPatch; record?: PersistedChordRecordV1;
}
export interface EnrichmentPreview {
  counts: Record<EnrichmentClassification, number>;
  rows: EnrichmentPreviewRow[];
}

const protectedFields: Array<keyof PersistedChordRecordV1> = ["id", "schemaVersion", "root", "tuning", "fretPositions", "fingerPositions", "workflowStatus", "provenance", "catalog"];
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function persistedOnly(record: PersistedChordRecordV1): PersistedChordRecordV1 {
  return {
    schemaVersion: record.schemaVersion, id: record.id, root: record.root, recipeId: record.recipeId, tuning: record.tuning,
    fretPositions: record.fretPositions, ...(record.fingerPositions ? { fingerPositions: record.fingerPositions } : {}),
    ...(record.displayNameOverride ? { displayNameOverride: record.displayNameOverride } : {}), description: record.description,
    difficulty: record.difficulty, tags: record.tags, ...(record.moods ? { moods: record.moods } : {}), ...(record.styles ? { styles: record.styles } : {}),
    workflowStatus: record.workflowStatus, ...(record.catalog ? { catalog: record.catalog } : {}), provenance: record.provenance,
    ...(record.relatedChords ? { relatedChords: record.relatedChords } : {}),
  };
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be an array of strings`);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function requestedPatch(raw: Record<string, unknown>, current: PersistedChordRecordV1): EnrichmentPatch {
  const patch: EnrichmentPatch = {};
  const requestedName = typeof raw.correctedName === "string" && raw.correctedName.trim() ? raw.correctedName.trim() : typeof raw.chordName === "string" ? raw.chordName.trim() : undefined;
  const quality = typeof raw.quality === "string" && raw.quality.trim() ? raw.quality.trim() : typeof raw.recipeId === "string" ? raw.recipeId : undefined;
  if (quality !== undefined) {
    const recipe = recipeById(quality); if (!recipe || recipe.id !== quality) throw new Error("quality must be a canonical registered recipe id"); patch.recipeId = recipe.id as RecipeId;
  }
  const effectiveRecipe = patch.recipeId ?? current.recipeId; const defaultName = `${current.root}${recipeById(effectiveRecipe)?.suffix ?? ""}`;
  if (requestedName !== undefined) patch.displayNameOverride = requestedName && requestedName !== defaultName ? requestedName : undefined;
  if (Object.hasOwn(raw, "difficulty")) patch.difficulty = raw.difficulty as PersistedChordRecordV1["difficulty"];
  if (Object.hasOwn(raw, "moods")) patch.moods = strings(raw.moods, "moods") as PersistedChordRecordV1["moods"];
  if (Object.hasOwn(raw, "styles")) patch.styles = strings(raw.styles, "styles") as PersistedChordRecordV1["styles"];
  if (Object.hasOwn(raw, "tags")) patch.tags = strings(raw.tags, "tags");
  if (Object.hasOwn(raw, "description")) { if (typeof raw.description !== "string") throw new Error("description must be a string"); patch.description = raw.description; }
  if (Object.hasOwn(raw, "relatedChords")) patch.relatedChords = strings(raw.relatedChords, "relatedChords");
  return patch;
}

export function applyEnrichmentPatch(current: PersistedChordRecordV1, patch: EnrichmentPatch): PersistedChordRecordV1 {
  const next = { ...current,
    ...(Object.hasOwn(patch, "displayNameOverride") ? { displayNameOverride: patch.displayNameOverride } : {}),
    ...(patch.recipeId !== undefined ? { recipeId: patch.recipeId } : {}),
    ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
    ...(patch.moods !== undefined ? { moods: patch.moods } : {}),
    ...(patch.styles !== undefined ? { styles: patch.styles } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.relatedChords !== undefined ? { relatedChords: patch.relatedChords } : {}),
  };
  const validation = validatePersistedChord(next); if (!validation.ok) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return validation.value;
}

export function duplicateMergePatch(target: PersistedChordRecordV1, source: PersistedChordRecordV1): EnrichmentPatch {
  return {
    difficulty: source.difficulty,
    tags: [...new Set([...target.tags, ...source.tags])],
    moods: [...new Set([...(target.moods ?? []), ...(source.moods ?? [])])],
    styles: [...new Set([...(target.styles ?? []), ...(source.styles ?? [])])],
    description: target.description || source.description,
    relatedChords: [...new Set([...(target.relatedChords ?? []), ...(source.relatedChords ?? [])])],
    ...(source.displayNameOverride ? { displayNameOverride: source.displayNameOverride } : {}),
  };
}

export function classifyEnrichmentRows(values: unknown[], existingRecords: PersistedChordRecordV1[]): EnrichmentPreview {
  const existing = new Map(existingRecords.map((record) => [record.id, record]));
  const rows: EnrichmentPreviewRow[] = values.map((value, index) => {
    if (!object(value)) return { index, id: "", classification: "invalid", changedFields: [], reasons: ["record must be an object"] };
    if (typeof value.__importError === "string") return { index, id: typeof value.id === "string" ? value.id : "", classification: "invalid", changedFields: [], reasons: [value.__importError] };
    const id = typeof value.id === "string" ? value.id : ""; if (!id) return { index, id, classification: "invalid", changedFields: [], reasons: ["id must be a non-empty string"] };
    const current = existing.get(id);
    if (!current) {
      const validation = validatePersistedChord(value); return validation.ok
        ? { index, id, classification: "new", changedFields: [], reasons: [], record: persistedOnly({ ...validation.value, workflowStatus: "pre-reviewed" }) }
        : { index, id, classification: "invalid", changedFields: [], reasons: validation.issues.map((issue) => `${issue.path}: ${issue.message}`) };
    }
    const conflicts = protectedFields.filter((field) => Object.hasOwn(value, field) && !same(value[field], current[field])).map(String);
    if (conflicts.length) return { index, id, classification: "conflict", changedFields: conflicts, reasons: conflicts.map((field) => `${field} differs from the persisted record`) };
    try {
      const patch = requestedPatch(value, current); const next = applyEnrichmentPatch(current, patch); const chord = hydratePersistedChord(next);
      if (Object.hasOwn(value, "notes") && !same(value.notes, chord.notes)) return { index, id, classification: "invalid", changedFields: ["notes"], reasons: ["notes do not match deterministic fret and quality calculation"] };
      if (Object.hasOwn(value, "intervals") && !same(value.intervals, chord.intervals)) return { index, id, classification: "invalid", changedFields: ["intervals"], reasons: ["intervals do not match deterministic fret and quality calculation"] };
      const changedFields = Object.keys(patch).filter((field) => !same(next[field as keyof PersistedChordRecordV1], current[field as keyof PersistedChordRecordV1]));
      if (Object.hasOwn(value, "notes") && !same(value.notes, hydratePersistedChord(current).notes)) changedFields.push("notes");
      if (Object.hasOwn(value, "intervals") && !same(value.intervals, hydratePersistedChord(current).intervals)) changedFields.push("intervals");
      return { index, id, classification: changedFields.length ? "update" : "unchanged", changedFields: [...new Set(changedFields)], reasons: [], patch };
    } catch (error) { return { index, id, classification: "invalid", changedFields: [], reasons: [error instanceof Error ? error.message : "invalid enrichment values"] }; }
  });
  const counts = { new: 0, unchanged: 0, update: 0, conflict: 0, invalid: 0 } satisfies Record<EnrichmentClassification, number>;
  rows.forEach((row) => { counts[row.classification] += 1; }); return { counts, rows };
}
