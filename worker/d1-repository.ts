import { exactVoicingKey } from "../src/chords/identity.ts";
import { findVoicingDuplicate } from "../src/chords/repository.ts";
import { hydratePersistedChord, validatePersistedChord, type PersistedChordRecordV1, type PersistedWorkflowStatus } from "../src/chords/persisted.ts";
import { legacyChordSlug, withPublicSlugs } from "../src/chords/slug.ts";
import type { D1Database, D1PreparedStatement } from "./types.ts";
import { applyEnrichmentPatch, classifyEnrichmentRows, type EnrichmentPreview } from "../src/chords/enrichment.ts";

interface ChordRow { id: string; schema_version: number; record_json: string }
export interface HostedImportReport { inserted: number; updated: number; skipped: number; duplicate: number; quarantined: number; failed: number; diagnostics: string[] }
export interface HostedEnrichmentApplyReport { preview: EnrichmentPreview; applied: { new: number; updated: number } }
export interface PublishedPosition { record: PersistedChordRecordV1; slug: string }
export interface PublishedSlugResolution { record: PersistedChordRecordV1; slug: string; legacy: boolean; positions: PublishedPosition[]; positionIndex: number }
export interface HostedDuplicateMatch { record: PersistedChordRecordV1; similarity: number; exact: boolean }

export class HostedDataError extends Error {
  readonly code: "INVALID_RECORD" | "UNKNOWN_VERSION" | "DUPLICATE" | "NOT_FOUND" | "DATABASE";
  constructor(code: "INVALID_RECORD" | "UNKNOWN_VERSION" | "DUPLICATE" | "NOT_FOUND" | "DATABASE", message: string) { super(message); this.name = "HostedDataError"; this.code = code; }
}

function parseRow(row: ChordRow): PersistedChordRecordV1 {
  let raw: unknown;
  try { raw = JSON.parse(row.record_json); } catch { throw new HostedDataError("INVALID_RECORD", "Stored chord JSON is malformed."); }
  const validation = validatePersistedChord(raw);
  if (!validation.ok) {
    const unknown = validation.issues.some((issue) => issue.path === "schemaVersion");
    throw new HostedDataError(unknown ? "UNKNOWN_VERSION" : "INVALID_RECORD", "Stored chord failed schema validation.");
  }
  hydratePersistedChord(validation.value);
  return validation.value;
}

function slug(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function lowestPlayedFret(frets: Array<number | null>): number { const played = frets.filter((fret): fret is number => fret !== null && fret > 0); return played.length ? Math.min(...played) : 0; }

export class D1ChordStore {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async list(status: PersistedWorkflowStatus): Promise<PersistedChordRecordV1[]> {
    const result = await this.db.prepare("SELECT id, schema_version, record_json FROM chord_voicings WHERE workflow_status = ?1 ORDER BY updated_at DESC, id ASC").bind(status).all<ChordRow>();
    if (!result.success) throw new HostedDataError("DATABASE", "Chord query failed.");
    return result.results.map(parseRow);
  }

  async listAll(): Promise<PersistedChordRecordV1[]> {
    const result = await this.db.prepare("SELECT id, schema_version, record_json FROM chord_voicings ORDER BY workflow_status ASC, updated_at DESC, id ASC").all<ChordRow>();
    if (!result.success) throw new HostedDataError("DATABASE", "Chord export query failed.");
    return result.results.map(parseRow);
  }

  async get(id: string): Promise<PersistedChordRecordV1 | null> {
    const row = await this.db.prepare("SELECT id, schema_version, record_json FROM chord_voicings WHERE id = ?1").bind(id).first<ChordRow>();
    return row ? parseRow(row) : null;
  }

  async findDuplicate(value: unknown): Promise<HostedDuplicateMatch | null> {
    const validation = validatePersistedChord(value);
    if (!validation.ok) throw new HostedDataError("INVALID_RECORD", "Chord payload failed validation.");
    const candidate = hydratePersistedChord(validation.value);
    const records = (await this.listAll()).filter((record) => record.id !== validation.value.id);
    const match = findVoicingDuplicate(candidate, records.map(hydratePersistedChord));
    if (!match) return null;
    const record = records.find((item) => item.id === match.match.id);
    return record ? { record, similarity: match.similarity, exact: match.exact } : null;
  }

  async resolvePublishedSlug(slug: string): Promise<PublishedSlugResolution | null> {
    const published = await this.list("published");
    const chords = withPublicSlugs(published.map(hydratePersistedChord));
    for (const chord of chords) {
      const canonical = chord.slug === slug; const legacy = legacyChordSlug(chord.chordName, chord.id) === slug;
      if (canonical || legacy) {
        const record = published.find((candidate) => candidate.id === chord.id);
        if (record) {
          const positions = chords.filter((candidate) => candidate.root === chord.root
            && candidate.chordQuality === chord.chordQuality
            && candidate.chordName === chord.chordName
            && candidate.tuning.id === chord.tuning.id)
            .sort((left, right) => Number(right.openStringCount > 0) - Number(left.openStringCount > 0)
              || lowestPlayedFret(left.fretPositions) - lowestPlayedFret(right.fretPositions)
              || left.fretPositions.map((fret) => fret ?? -1).join("-").localeCompare(right.fretPositions.map((fret) => fret ?? -1).join("-"))
              || left.id.localeCompare(right.id))
            .flatMap((position) => {
              const positionRecord = published.find((candidate) => candidate.id === position.id);
              return positionRecord ? [{ record: positionRecord, slug: position.slug }] : [];
            });
          return { record, slug: chord.slug, legacy: !canonical && legacy, positions, positionIndex: positions.findIndex((position) => position.record.id === record.id) };
        }
      }
    }
    return null;
  }

  async getPublishedBySlug(slug: string): Promise<PersistedChordRecordV1 | null> {
    return (await this.resolvePublishedSlug(slug))?.record ?? null;
  }

  private validated(value: unknown, status: PersistedWorkflowStatus): PersistedChordRecordV1 {
    const result = validatePersistedChord(value);
    if (!result.ok) {
      const unknown = result.issues.some((issue) => issue.path === "schemaVersion" && issue.message.includes("unsupported"));
      throw new HostedDataError(unknown ? "UNKNOWN_VERSION" : "INVALID_RECORD", "Chord payload failed validation.");
    }
    const record = { ...result.value, workflowStatus: status }; hydratePersistedChord(record); return record;
  }

  private upsert(record: PersistedChordRecordV1): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO chord_voicings (id,schema_version,root,recipe_id,tuning_json,frets_json,fingers_json,display_name_override,description,difficulty,workflow_status,catalog_json,provenance_json,record_json,updated_at,published_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,CURRENT_TIMESTAMP,CASE WHEN ?11='published' THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,root=excluded.root,recipe_id=excluded.recipe_id,tuning_json=excluded.tuning_json,frets_json=excluded.frets_json,fingers_json=excluded.fingers_json,display_name_override=excluded.display_name_override,description=excluded.description,difficulty=excluded.difficulty,workflow_status=excluded.workflow_status,catalog_json=excluded.catalog_json,provenance_json=excluded.provenance_json,record_json=excluded.record_json,updated_at=CURRENT_TIMESTAMP,published_at=CASE WHEN excluded.workflow_status='published' THEN COALESCE(chord_voicings.published_at,CURRENT_TIMESTAMP) ELSE chord_voicings.published_at END`)
      .bind(record.id, record.schemaVersion, record.root, record.recipeId, JSON.stringify(record.tuning), JSON.stringify(record.fretPositions), record.fingerPositions ? JSON.stringify(record.fingerPositions) : null, record.displayNameOverride ?? null, record.description, record.difficulty, record.workflowStatus, record.catalog ? JSON.stringify(record.catalog) : null, JSON.stringify(record.provenance), JSON.stringify(record));
  }

  private tagStatements(record: PersistedChordRecordV1): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [this.db.prepare("DELETE FROM chord_voicing_tags WHERE chord_voicing_id = ?1").bind(record.id)];
    for (const label of record.tags) {
      statements.push(this.db.prepare("INSERT INTO tags (slug,label,category) VALUES (?1,?2,'descriptor') ON CONFLICT(slug) DO UPDATE SET label=excluded.label").bind(slug(label), label));
      statements.push(this.db.prepare("INSERT OR IGNORE INTO chord_voicing_tags (chord_voicing_id,tag_id) SELECT ?1,id FROM tags WHERE slug=?2").bind(record.id, slug(label)));
    }
    return statements;
  }

  private audit(id: string | null, action: string, actor: string, metadata: unknown = {}): D1PreparedStatement { return this.db.prepare("INSERT INTO admin_audit_log (chord_voicing_id,action,actor_identifier,metadata_json) VALUES (?1,?2,?3,?4)").bind(id, action, actor, JSON.stringify(metadata)); }
  private async atomic(statements: D1PreparedStatement[]): Promise<void> { const results = await this.db.batch(statements); if (results.some((result) => !result.success)) throw new HostedDataError("DATABASE", "Atomic chord operation failed."); }

  async preReview(value: unknown, actor = "system"): Promise<PersistedChordRecordV1> {
    const record = this.validated(value, "pre-reviewed"); await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, "Moved to pre-reviewed", actor)]); return record;
  }

  async publish(value: unknown, actor = "system"): Promise<PersistedChordRecordV1> {
    const record = this.validated(value, "published"); const hydrated = hydratePersistedChord(record); const published = await this.list("published");
    if (published.some((item) => item.id !== record.id && exactVoicingKey(hydratePersistedChord(item)) === exactVoicingKey(hydrated))) throw new HostedDataError("DUPLICATE", "An equivalent voicing is already published.");
    await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, "Published", actor)]); return record;
  }

  async reject(id: string, actor = "system"): Promise<void> {
    const current = await this.get(id); if (!current) throw new HostedDataError("NOT_FOUND", "Chord not found.");
    const record = { ...current, workflowStatus: "rejected" as const }; await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(id, "Rejected", actor)]);
  }

  async replace(replacedId: string, value: unknown, actor = "system"): Promise<PersistedChordRecordV1> {
    const old = await this.get(replacedId); if (!old) throw new HostedDataError("NOT_FOUND", "Replacement target not found.");
    const replacement = this.validated(value, "published"); const rejected = { ...old, workflowStatus: "rejected" as const };
    await this.atomic([this.upsert(rejected), this.upsert(replacement), ...this.tagStatements(replacement), this.audit(replacement.id, "Replaced chord", actor, { replacedId })]); return replacement;
  }

  async merge(targetId: string, value: unknown, actor = "system"): Promise<PersistedChordRecordV1> {
    const target = await this.get(targetId); if (!target) throw new HostedDataError("NOT_FOUND", "Merge target not found.");
    const source = this.validated(value, "published");
    const merged = { ...target, workflowStatus: "published" as const, description: target.description || source.description,
      tags: [...new Set([...target.tags, ...source.tags])], moods: [...new Set([...(target.moods ?? []), ...(source.moods ?? [])])],
      styles: [...new Set([...(target.styles ?? []), ...(source.styles ?? [])])] };
    const statements = [this.upsert(merged), ...this.tagStatements(merged)];
    if (source.id !== targetId) {
      const storedSource = await this.get(source.id);
      if (storedSource) statements.push(this.upsert({ ...storedSource, workflowStatus: "rejected" as const }));
    }
    statements.push(this.audit(targetId, "Merged duplicate metadata and published", actor, { sourceId: source.id }));
    await this.atomic(statements); return merged;
  }

  async edit(id: string, value: unknown, actor = "system"): Promise<PersistedChordRecordV1> {
    const current = await this.get(id); if (!current) throw new HostedDataError("NOT_FOUND", "Chord not found.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HostedDataError("INVALID_RECORD", "Editorial changes must be an object.");
    const changes = value as Partial<PersistedChordRecordV1>;
    const edited = this.validated({ ...current,
      ...(Object.hasOwn(changes, "description") ? { description: changes.description } : {}),
      ...(Object.hasOwn(changes, "difficulty") ? { difficulty: changes.difficulty } : {}),
      ...(Object.hasOwn(changes, "tags") ? { tags: changes.tags } : {}),
      ...(Object.hasOwn(changes, "moods") ? { moods: changes.moods } : {}),
      ...(Object.hasOwn(changes, "styles") ? { styles: changes.styles } : {}),
      ...(Object.hasOwn(changes, "displayNameOverride") ? { displayNameOverride: changes.displayNameOverride } : {}),
      ...(Object.hasOwn(changes, "fingerPositions") ? { fingerPositions: changes.fingerPositions } : {}),
      ...(Object.hasOwn(changes, "catalog") ? { catalog: changes.catalog } : {}),
    }, current.workflowStatus);
    await this.atomic([this.upsert(edited), ...this.tagStatements(edited), this.audit(id, "Edited chord metadata", actor)]); return edited;
  }

  async auditLog(): Promise<Array<{ id: number; chord_voicing_id: string | null; action: string; actor_identifier: string | null; metadata_json: string; created_at: string }>> { const result = await this.db.prepare("SELECT id,chord_voicing_id,action,actor_identifier,metadata_json,created_at FROM admin_audit_log ORDER BY id DESC LIMIT 500").all<{ id: number; chord_voicing_id: string | null; action: string; actor_identifier: string | null; metadata_json: string; created_at: string }>(); return result.results; }
  async quarantine(): Promise<Array<{ id: number; source: string; raw_json: string; issues_json: string; created_at: string }>> { const result = await this.db.prepare("SELECT id,source,raw_json,issues_json,created_at FROM quarantined_records ORDER BY id DESC LIMIT 500").all<{ id: number; source: string; raw_json: string; issues_json: string; created_at: string }>(); return result.results; }

  async importRecords(values: unknown[], dryRun: boolean, actor = "system"): Promise<HostedImportReport> {
    const report: HostedImportReport = { inserted: 0, updated: 0, skipped: 0, duplicate: 0, quarantined: 0, failed: 0, diagnostics: [] };
    for (const value of values) {
      try {
        const validation = validatePersistedChord(value); if (!validation.ok) { report.quarantined += 1; report.diagnostics.push(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")); continue; }
        const record = validation.value; hydratePersistedChord(record); const existing = await this.get(record.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(record)) { report.skipped += 1; continue; }
        const sameShape = (await this.list(record.workflowStatus)).some((item) => item.id !== record.id && exactVoicingKey(hydratePersistedChord(item)) === exactVoicingKey(hydratePersistedChord(record)));
        if (sameShape) { report.duplicate += 1; continue; }
        if (existing) report.updated += 1; else report.inserted += 1;
        if (!dryRun) await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, existing ? "Imported update" : "Imported insert", actor)]);
      } catch (error) { report.failed += 1; report.diagnostics.push(error instanceof Error ? error.message : "Import failure"); }
    }
    return report;
  }

  async previewEnrichment(values: unknown[]): Promise<EnrichmentPreview> { return classifyEnrichmentRows(values, await this.listAll()); }

  async applyEnrichment(values: unknown[], actor = "system"): Promise<HostedEnrichmentApplyReport> {
    const preview = await this.previewEnrichment(values); const applied = { new: 0, updated: 0 };
    for (const row of preview.rows) {
      if (row.classification === "new" && row.record) { await this.preReview(row.record, actor); applied.new += 1; }
      if (row.classification === "update" && row.patch) {
        const current = await this.get(row.id); if (!current) throw new HostedDataError("NOT_FOUND", "Enrichment target no longer exists.");
        const updated = applyEnrichmentPatch(current, row.patch);
        await this.atomic([this.upsert(updated), ...this.tagStatements(updated), this.audit(row.id, "Applied AI enrichment", actor, { changedFields: row.changedFields })]); applied.updated += 1;
      }
    }
    return { preview, applied };
  }
}
