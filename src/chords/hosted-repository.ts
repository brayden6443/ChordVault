import { ChordRepositoryError, type AuditEntry, type ChordRepository, type PublicLibraryItem, type RepositoryWorkspace, type SavedReview } from "./chord-repository.ts";
import { hydratePersistedChord, validatePersistedChord } from "./persisted.ts";
import { withPublicSlugs } from "./slug.ts";
import type { MigrationReport, QuarantinedChord } from "./migration.ts";
import type { ChordVoicing } from "./types.ts";

export interface RepositoryCapabilities { backend: "local" | "hosted"; mutations: boolean; loadError?: string }

export class HostedReadChordRepository implements ChordRepository {
  readonly capabilities: RepositoryCapabilities;
  private readonly published: ChordVoicing[];
  private readonly local: ChordRepository;
  constructor(local: ChordRepository, records: unknown[], loadError?: string) {
    const published: ChordVoicing[] = [];
    for (const raw of records) { const result = validatePersistedChord(raw); if (!result.ok || result.value.workflowStatus !== "published") throw new ChordRepositoryError("SCHEMA_VALIDATION", "Hosted chord response failed validation."); published.push(hydratePersistedChord(result.value)); }
    this.local = local; this.published = withPublicSlugs(published); this.capabilities = { backend: "hosted", mutations: false, loadError };
  }
  private disabled(): never { throw new ChordRepositoryError("FAILED_WRITE", "Hosted publishing is disabled until administrator authentication is installed."); }
  loadWorkspace(): RepositoryWorkspace { const workspace = this.local.loadWorkspace(); return { ...workspace, published: [...this.published], publishedKeys: this.published.map((record) => record.id), preReviewed: [] }; }
  listPublishedVoicings(): ChordVoicing[] { return [...this.published]; }
  listPreReviewedVoicings(): ChordVoicing[] { return []; }
  listReviewCandidates(): ChordVoicing[] { return this.local.listReviewCandidates(); }
  getVoicingById(id: string): ChordVoicing | undefined { return this.published.find((record) => record.id === id) ?? this.local.getVoicingById(id); }
  saveCandidateQueue(candidates: ChordVoicing[], reviewIndex: number): void { this.local.saveCandidateQueue(candidates, reviewIndex); }
  savePublicLibrary(items: PublicLibraryItem[]): void { this.local.savePublicLibrary(items); }
  saveReview(id: string, review: SavedReview): void { this.local.saveReview(id, review); }
  importPreReviewed(): void { this.disabled(); }
  updateEditorialFields(id: string, edit: Parameters<ChordRepository["updateEditorialFields"]>[1]): void { this.local.updateEditorialFields(id, edit); }
  moveToPreReviewed(): void { this.disabled(); }
  publishVoicing(): void { this.disabled(); }
  approvePublicVoicing(): void { this.disabled(); }
  rejectVoicing(): void { this.disabled(); }
  restoreRejectedVoicing(): void { this.disabled(); }
  markReviewLater(ids: string[]): void { this.local.markReviewLater(ids); }
  replacePublishedVoicing(): void { this.disabled(); }
  mergeVoicings(): void { this.disabled(); }
  listFavorites(): string[] { return this.local.listFavorites(); }
  addFavorite(name: string): void { this.local.addFavorite(name); }
  removeFavorite(name: string): void { this.local.removeFavorite(name); }
  appendAuditEntry(entry: AuditEntry): void { this.local.appendAuditEntry(entry); }
  applyLegacyTagMigration(): void { this.disabled(); }
  mirrorWorkspace(): Promise<void> { return this.local.mirrorWorkspace(); }
  exportBackup(): string { const local = JSON.parse(this.local.exportBackup()) as Record<string, unknown>; return JSON.stringify({ ...local, hostedPublished: this.published }, null, 2); }
  readQuarantineReport(): { quarantine: QuarantinedChord[]; report: MigrationReport | null } { return this.local.readQuarantineReport(); }
}

export async function loadHostedPublished(apiBase: string, fetcher: typeof fetch = fetch): Promise<unknown[]> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}/chords/published`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new ChordRepositoryError("CORRUPT_STORAGE", "Hosted chord service is unavailable.");
  const body = await response.json() as { records?: unknown[] }; if (!Array.isArray(body.records)) throw new ChordRepositoryError("CORRUPT_STORAGE", "Hosted chord response is malformed."); return body.records;
}
