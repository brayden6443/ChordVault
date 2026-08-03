import { exactVoicingKey } from "./identity.ts";
import { migrateChordRecords, migrationEnvelope, type MigrationReport, type QuarantinedChord } from "./migration.ts";
import { CHORD_SCHEMA_VERSION, hydratePersistedChord, persistChordVoicing, safeParseJson, validatePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";
import type { ChordVoicing } from "./types.ts";

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuditEntry { at: string; action: string; chord: string }
export interface LibraryEdit { difficulty?: number; descriptorTags?: string[] }
export interface PublicLibraryItem {
  key: string; name: string; root?: string; chordQuality?: string; difficulty: number;
  descriptorTags: string[]; frets?: number[]; fingers?: string[]; source: "Main Vault" | "Pre-reviewed" | "Unapproved";
}
export interface SavedReview {
  approvalStatus: ChordVoicing["approvalStatus"]; chordName: string; moodTags: string[]; genreTags: string[];
  description: string; difficulty: ChordVoicing["difficulty"]; descriptorTags?: string[];
}

export interface RepositoryWorkspace {
  preReviewed: ChordVoicing[];
  published: ChordVoicing[];
  publicLibrary: PublicLibraryItem[] | null;
  publishedKeys: string[];
  libraryEdits: Record<string, LibraryEdit>;
  savedReviews: Record<string, SavedReview>;
  rejectedShapes: string[];
  reviewLater: string[];
  auditLog: AuditEntry[];
  favorites: string[];
  candidates: ChordVoicing[];
  reviewIndex: number;
}

export type RepositoryErrorCode = "CORRUPT_STORAGE" | "SCHEMA_VALIDATION" | "UNKNOWN_SCHEMA_VERSION" | "DUPLICATE_CONFLICT" | "MISSING_RECORD" | "FAILED_WRITE" | "ROLLBACK_FAILURE";
export class ChordRepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly diagnostic?: string;
  constructor(code: RepositoryErrorCode, message: string, diagnostic?: string) { super(message); this.name = "ChordRepositoryError"; this.code = code; this.diagnostic = diagnostic; }
  get safeMessage(): string { return this.code === "DUPLICATE_CONFLICT" ? "That chord already exists." : this.code === "MISSING_RECORD" ? "That chord could not be found." : "Chord data could not be saved. Your previous data was preserved."; }
}

export interface ChordRepository {
  loadWorkspace(): RepositoryWorkspace;
  listPublishedVoicings(): ChordVoicing[];
  listPreReviewedVoicings(): ChordVoicing[];
  listReviewCandidates(): ChordVoicing[];
  getVoicingById(id: string): ChordVoicing | undefined;
  saveCandidateQueue(candidates: ChordVoicing[], reviewIndex: number): void;
  savePublicLibrary(items: PublicLibraryItem[]): void;
  saveReview(id: string, review: SavedReview): void;
  importPreReviewed(voicings: ChordVoicing[]): void;
  updateEditorialFields(id: string, edit: LibraryEdit): void;
  moveToPreReviewed(voicing: ChordVoicing): void;
  publishVoicing(voicing: ChordVoicing): void;
  approvePublicVoicing(id: string): void;
  rejectVoicing(voicing: ChordVoicing): void;
  restoreRejectedVoicing(voicing: ChordVoicing): void;
  markReviewLater(ids: string[]): void;
  replacePublishedVoicing(replacedId: string, replacement: ChordVoicing): void;
  mergeVoicings(targetId: string, source: ChordVoicing): void;
  listFavorites(): string[];
  addFavorite(name: string): void;
  removeFavorite(name: string): void;
  appendAuditEntry(entry: AuditEntry): void;
  applyLegacyTagMigration(preReviewed: ChordVoicing[], published: ChordVoicing[], reviews: Record<string, SavedReview>, edits: Record<string, LibraryEdit>): void;
  mirrorWorkspace(): Promise<void>;
  exportBackup(): string;
  readQuarantineReport(): { quarantine: QuarantinedChord[]; report: MigrationReport | null };
}

const KEYS = {
  preReviewed: "chord-vault-approved-voicings", published: "chord-vault-published-voicings",
  publicLibrary: "chord-vault-public-library", publishedKeys: "chord-vault-final-approved-keys",
  edits: "chord-vault-library-edits", reviews: "chord-vault-reviews", rejected: "chord-vault-rejected-shapes",
  later: "chord-vault-review-later", audit: "chord-vault-audit-log", favorites: "chord-vault-saved",
  candidates: "chord-vault-active-queue", reviewIndex: "chord-vault-review-index",
  persisted: `chord-vault-persisted-v${CHORD_SCHEMA_VERSION}`, backup: `chord-vault-migration-backup-v${CHORD_SCHEMA_VERSION}`,
  report: `chord-vault-migration-report-v${CHORD_SCHEMA_VERSION}`, quarantine: `chord-vault-quarantine-v${CHORD_SCHEMA_VERSION}`,
  staged: `chord-vault-staged-write-v${CHORD_SCHEMA_VERSION}`,
} as const;

function blankWorkspace(): RepositoryWorkspace {
  return { preReviewed: [], published: [], publicLibrary: null, publishedKeys: [], libraryEdits: {}, savedReviews: {}, rejectedShapes: [], reviewLater: [], auditLog: [], favorites: [], candidates: [], reviewIndex: 0 };
}

export class LocalStorageChordRepository implements ChordRepository {
  private readonly local: StoragePort;
  private readonly session: StoragePort;
  constructor(local: StoragePort, session: StoragePort = local) { this.local = local; this.session = session; this.ensureMigrated(); }

  private parse<T>(storage: StoragePort, key: string, fallback: T): T {
    const raw = storage.getItem(key); if (raw === null) return fallback;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) { this.quarantine(key, raw, parsed.issues); return fallback; }
    return parsed.value as T;
  }

  private quarantine(source: string, raw: unknown, issues: Array<{ path: string; message: string }>): void {
    const existing = this.parseQuarantine(); existing.push({ source, index: 0, raw, issues });
    try { this.local.setItem(KEYS.quarantine, JSON.stringify(existing)); } catch { /* Preserve page initialization even if diagnostics cannot be written. */ }
  }

  private parseQuarantine(): QuarantinedChord[] {
    const raw = this.local.getItem(KEYS.quarantine); if (!raw) return [];
    const parsed = safeParseJson(raw); return parsed.ok && Array.isArray(parsed.value) ? parsed.value as QuarantinedChord[] : [];
  }

  private validatedLegacy(key: string, status: "pre-reviewed" | "published"): ChordVoicing[] {
    const raw = this.parse<unknown[]>(this.local, key, []); if (!Array.isArray(raw)) { this.quarantine(key, raw, [{ path: "$", message: "must be an array" }]); return []; }
    const result = migrateChordRecords(raw.map((value) => ({ source: key, workflowStatus: status, value })));
    for (const item of result.quarantine) this.quarantine(item.source, item.raw, item.issues);
    return result.records.map(hydratePersistedChord);
  }

  private ensureMigrated(): void {
    const existing = this.local.getItem(KEYS.persisted);
    if (existing !== null) {
      const parsed = safeParseJson(existing);
      if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null || !("schemaVersion" in parsed.value) || parsed.value.schemaVersion !== CHORD_SCHEMA_VERSION) this.quarantine(KEYS.persisted, existing, [{ path: "schemaVersion", message: "unsupported or corrupt envelope" }]);
      return;
    }
    if (this.local.getItem(KEYS.backup) === null) this.local.setItem(KEYS.backup, JSON.stringify({ approved: this.local.getItem(KEYS.preReviewed), published: this.local.getItem(KEYS.published) }));
    const pre = this.parse<unknown[]>(this.local, KEYS.preReviewed, []); const pub = this.parse<unknown[]>(this.local, KEYS.published, []);
    const result = migrateChordRecords([
      ...(Array.isArray(pre) ? pre : []).map((value) => ({ source: KEYS.preReviewed, workflowStatus: "pre-reviewed" as const, value })),
      ...(Array.isArray(pub) ? pub : []).map((value) => ({ source: KEYS.published, workflowStatus: "published" as const, value })),
    ]);
    this.local.setItem(KEYS.persisted, migrationEnvelope(result)); this.local.setItem(KEYS.report, JSON.stringify(result.report)); this.local.setItem(KEYS.quarantine, JSON.stringify(result.quarantine));
  }

  loadWorkspace(): RepositoryWorkspace {
    const workspace = blankWorkspace();
    workspace.preReviewed = this.validatedLegacy(KEYS.preReviewed, "pre-reviewed"); workspace.published = this.validatedLegacy(KEYS.published, "published");
    workspace.publicLibrary = this.parse(this.local, KEYS.publicLibrary, null); workspace.publishedKeys = this.parse(this.local, KEYS.publishedKeys, []);
    workspace.libraryEdits = this.parse(this.local, KEYS.edits, {}); workspace.savedReviews = this.parse(this.local, KEYS.reviews, {});
    workspace.rejectedShapes = this.parse(this.local, KEYS.rejected, []); workspace.reviewLater = this.parse(this.local, KEYS.later, []);
    workspace.auditLog = this.parse(this.local, KEYS.audit, []); workspace.favorites = this.parse(this.local, KEYS.favorites, []);
    workspace.candidates = this.parse(this.session, KEYS.candidates, []); workspace.reviewIndex = Number(this.local.getItem(KEYS.reviewIndex) ?? 0) || 0;
    return workspace;
  }

  private validateWorkspace(workspace: RepositoryWorkspace): PersistedChordRecordV1[] {
    const records = [...workspace.preReviewed.map((v) => persistChordVoicing(v, "pre-reviewed")), ...workspace.published.map((v) => persistChordVoicing(v, "published"))];
    for (const record of records) { const result = validatePersistedChord(record); if (!result.ok) throw new ChordRepositoryError("SCHEMA_VALIDATION", "Chord validation failed.", result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")); }
    return records;
  }

  private commit(next: RepositoryWorkspace): void {
    const records = this.validateWorkspace(next); const before = this.snapshotRaw();
    const writes: Array<[StoragePort, string, string]> = [
      [this.local, KEYS.preReviewed, JSON.stringify(next.preReviewed)], [this.local, KEYS.published, JSON.stringify(next.published)],
      [this.local, KEYS.publishedKeys, JSON.stringify(next.publishedKeys)], [this.local, KEYS.edits, JSON.stringify(next.libraryEdits)],
      [this.local, KEYS.reviews, JSON.stringify(next.savedReviews)], [this.local, KEYS.rejected, JSON.stringify(next.rejectedShapes)],
      [this.local, KEYS.later, JSON.stringify(next.reviewLater)], [this.local, KEYS.audit, JSON.stringify(next.auditLog)],
      [this.local, KEYS.favorites, JSON.stringify(next.favorites)], [this.session, KEYS.candidates, JSON.stringify(next.candidates)],
      [this.local, KEYS.reviewIndex, String(next.reviewIndex)], [this.local, KEYS.persisted, JSON.stringify({ schemaVersion: CHORD_SCHEMA_VERSION, records, quarantine: this.parseQuarantine() })],
    ];
    if (next.publicLibrary !== null) writes.push([this.local, KEYS.publicLibrary, JSON.stringify(next.publicLibrary)]);
    try { this.local.setItem(KEYS.staged, JSON.stringify(before)); for (const [storage, key, value] of writes) storage.setItem(key, value); this.local.removeItem(KEYS.staged); }
    catch (error) {
      try { this.restoreRaw(before); this.local.removeItem(KEYS.staged); }
      catch (rollback) { throw new ChordRepositoryError("ROLLBACK_FAILURE", "Chord data could not be restored.", String(rollback)); }
      throw new ChordRepositoryError("FAILED_WRITE", "Chord data could not be saved.", String(error));
    }
  }

  private snapshotRaw(): Record<string, string | null> { const result: Record<string, string | null> = {}; for (const key of Object.values(KEYS)) result[key] = (key === KEYS.candidates ? this.session : this.local).getItem(key); return result; }
  private restoreRaw(snapshot: Record<string, string | null>): void { for (const [key, value] of Object.entries(snapshot)) { const storage = key === KEYS.candidates ? this.session : this.local; if (value === null) storage.removeItem(key); else storage.setItem(key, value); } }
  private mutate(change: (workspace: RepositoryWorkspace) => void): void { const next = this.loadWorkspace(); change(next); this.commit(next); }

  listPublishedVoicings(): ChordVoicing[] { return this.loadWorkspace().published; }
  listPreReviewedVoicings(): ChordVoicing[] { return this.loadWorkspace().preReviewed; }
  listReviewCandidates(): ChordVoicing[] { return this.loadWorkspace().candidates; }
  getVoicingById(id: string): ChordVoicing | undefined { const w = this.loadWorkspace(); return [...w.preReviewed, ...w.published, ...w.candidates].find((v) => v.id === id); }
  saveCandidateQueue(candidates: ChordVoicing[], reviewIndex: number): void { this.mutate((w) => { w.candidates = candidates; w.reviewIndex = reviewIndex; }); }
  savePublicLibrary(items: PublicLibraryItem[]): void { this.mutate((w) => { w.publicLibrary = items; }); }
  saveReview(id: string, review: SavedReview): void { this.mutate((w) => { w.savedReviews[id] = review; }); }
  importPreReviewed(voicings: ChordVoicing[]): void { this.mutate((w) => { const keys = new Set(w.preReviewed.map(exactVoicingKey)); for (const voicing of voicings) { const key = exactVoicingKey(voicing); if (!keys.has(key)) { keys.add(key); w.preReviewed.push(voicing); } } }); }
  updateEditorialFields(id: string, edit: LibraryEdit): void { this.mutate((w) => { w.libraryEdits[id] = { ...w.libraryEdits[id], ...edit }; for (const record of [...w.preReviewed, ...w.published]) if (record.id === id) { if (edit.difficulty !== undefined) record.difficulty = edit.difficulty as ChordVoicing["difficulty"]; if (edit.descriptorTags) record.descriptorTags = [...edit.descriptorTags]; } }); }
  moveToPreReviewed(voicing: ChordVoicing): void { this.mutate((w) => { if ([...w.preReviewed, ...w.published].some((v) => exactVoicingKey(v) === exactVoicingKey(voicing) && v.id !== voicing.id)) throw new ChordRepositoryError("DUPLICATE_CONFLICT", "Duplicate voicing."); voicing.approvalStatus = "approved"; w.preReviewed = [...w.preReviewed.filter((v) => v.id !== voicing.id), voicing]; w.candidates = w.candidates.filter((v) => v.id !== voicing.id); }); }
  publishVoicing(voicing: ChordVoicing): void { this.mutate((w) => { const duplicate = w.published.find((v) => exactVoicingKey(v) === exactVoicingKey(voicing) && v.id !== voicing.id); if (duplicate) throw new ChordRepositoryError("DUPLICATE_CONFLICT", "Duplicate voicing."); voicing.approvalStatus = "approved"; w.preReviewed = w.preReviewed.filter((v) => v.id !== voicing.id); w.published = [...w.published.filter((v) => v.id !== voicing.id), voicing]; w.publishedKeys = [...new Set([...w.publishedKeys, voicing.id])]; }); }
  approvePublicVoicing(id: string): void { this.mutate((w) => { w.publishedKeys = [...new Set([...w.publishedKeys, id])]; }); }
  rejectVoicing(voicing: ChordVoicing): void { this.mutate((w) => { w.rejectedShapes = [...new Set([...w.rejectedShapes, exactVoicingKey(voicing)])]; delete w.savedReviews[voicing.id]; w.preReviewed = w.preReviewed.filter((v) => v.id !== voicing.id); w.candidates = w.candidates.filter((v) => v.id !== voicing.id); }); }
  restoreRejectedVoicing(voicing: ChordVoicing): void { this.mutate((w) => { w.rejectedShapes = w.rejectedShapes.filter((key) => key !== exactVoicingKey(voicing)); w.candidates.push(voicing); }); }
  markReviewLater(ids: string[]): void { this.mutate((w) => { w.reviewLater = [...new Set([...w.reviewLater, ...ids])]; }); }
  replacePublishedVoicing(replacedId: string, replacement: ChordVoicing): void { this.mutate((w) => { if (!w.published.some((v) => v.id === replacedId) && !w.publishedKeys.includes(replacedId)) throw new ChordRepositoryError("MISSING_RECORD", "Published chord not found."); w.published = w.published.filter((v) => v.id !== replacedId); w.publishedKeys = w.publishedKeys.filter((id) => id !== replacedId); w.preReviewed = w.preReviewed.filter((v) => v.id !== replacement.id); if (!w.publicLibrary?.some((item) => item.key === replacement.id)) w.published.push(replacement); w.publishedKeys.push(replacement.id); }); }
  mergeVoicings(targetId: string, source: ChordVoicing): void { this.mutate((w) => { const target = w.published.find((v) => v.id === targetId); const tags = [...new Set([...(target?.descriptorTags ?? w.libraryEdits[targetId]?.descriptorTags ?? []), ...(source.descriptorTags ?? []), ...source.moodTags, ...source.genreTags])]; if (target) { target.descriptorTags = tags; target.description ||= source.description; } else if (w.publicLibrary?.some((v) => v.key === targetId)) w.libraryEdits[targetId] = { ...w.libraryEdits[targetId], descriptorTags: tags }; else throw new ChordRepositoryError("MISSING_RECORD", "Merge target not found."); }); }
  listFavorites(): string[] { return this.loadWorkspace().favorites; }
  addFavorite(name: string): void { this.mutate((w) => { w.favorites = [...new Set([...w.favorites, name])]; }); }
  removeFavorite(name: string): void { this.mutate((w) => { w.favorites = w.favorites.filter((item) => item !== name); }); }
  appendAuditEntry(entry: AuditEntry): void { this.mutate((w) => { w.auditLog = [entry, ...w.auditLog].slice(0, 100); }); }
  applyLegacyTagMigration(preReviewed: ChordVoicing[], published: ChordVoicing[], reviews: Record<string, SavedReview>, edits: Record<string, LibraryEdit>): void { this.mutate((w) => { w.preReviewed = preReviewed; w.published = published; w.savedReviews = reviews; w.libraryEdits = edits; }); }
  async mirrorWorkspace(): Promise<void> {
    if (!("indexedDB" in globalThis)) return;
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("chord-vault-workspace", 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots"); };
      request.onerror = () => resolve(); request.onsuccess = () => {
        const transaction = request.result.transaction("snapshots", "readwrite"); transaction.objectStore("snapshots").put({ version: CHORD_SCHEMA_VERSION, savedAt: new Date().toISOString(), ...this.loadWorkspace() }, "current");
        transaction.oncomplete = () => { request.result.close(); resolve(); }; transaction.onerror = () => resolve();
      };
    });
  }
  exportBackup(): string { return JSON.stringify({ version: CHORD_SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...this.loadWorkspace() }, null, 2); }
  readQuarantineReport(): { quarantine: QuarantinedChord[]; report: MigrationReport | null } { return { quarantine: this.parseQuarantine(), report: this.parse(this.local, KEYS.report, null) }; }
}
