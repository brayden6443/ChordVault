import { migrateChordRecords, type QuarantinedChord } from "./migration.ts";
import { persistChordVoicing, type PersistedChordRecordV1 } from "./persisted.ts";
import type { ChordVoicing } from "./types.ts";
import type { EnrichmentPreview } from "./enrichment.ts";

export interface PreparedHostedImport {
  backup: string;
  records: PersistedChordRecordV1[];
  quarantine: QuarantinedChord[];
  report: { validated: number; skipped: number; quarantined: number; failed: number; diagnostics: string[] };
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function prepareHostedImport(raw: unknown): PreparedHostedImport {
  const backup = JSON.stringify(raw, null, 2); const inputs: Array<{ source: string; workflowStatus: "pre-reviewed" | "published"; value: unknown }> = [];
  if (object(raw) && (Array.isArray(raw.preReviewed) || Array.isArray(raw.approvedVault))) for (const value of (raw.preReviewed ?? raw.approvedVault) as unknown[]) inputs.push({ source: "local backup pre-reviewed", workflowStatus: "pre-reviewed", value });
  if (object(raw) && (Array.isArray(raw.published) || Array.isArray(raw.publishedVault))) for (const value of (raw.published ?? raw.publishedVault) as unknown[]) inputs.push({ source: "local backup published", workflowStatus: "published", value });
  if (!inputs.length && Array.isArray(raw)) for (const value of raw) inputs.push({ source: "import array", workflowStatus: "pre-reviewed", value });
  const migration = migrateChordRecords(inputs, true);
  return { backup, records: migration.records, quarantine: migration.quarantine, report: { validated: migration.records.length, skipped: migration.report.skipped, quarantined: migration.report.quarantined, failed: migration.report.failed, diagnostics: migration.report.diagnostics } };
}

export async function uploadPreparedImport(prepared: PreparedHostedImport, options: { apiBase: string; dryRun: boolean; fetcher?: typeof fetch }): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch; const response = await fetcher(`${options.apiBase.replace(/\/$/, "")}/admin/chords/import`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ records: prepared.records, dryRun: options.dryRun }) });
  const result = await response.json(); if (!response.ok) throw new Error("Hosted import was rejected. No local data was changed."); return result;
}

export function preparedPreReviewedImport(voicings: ChordVoicing[]): PreparedHostedImport {
  const records = voicings.map((voicing) => persistChordVoicing(voicing, "pre-reviewed"));
  return { backup: JSON.stringify(records, null, 2), records, quarantine: [], report: { validated: records.length, skipped: 0, quarantined: 0, failed: 0, diagnostics: [] } };
}

async function enrichmentRequest<T>(apiBase: string, action: "preview" | "apply", records: unknown[], fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}/admin/chords/enrichment/${action}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ records }) });
  const result = await response.json() as T; if (!response.ok) throw new Error(`Hosted enrichment ${action} was rejected.`); return result;
}

export function previewEnrichmentImport(apiBase: string, records: unknown[], fetcher?: typeof fetch): Promise<{ preview: EnrichmentPreview }> { return enrichmentRequest(apiBase, "preview", records, fetcher); }
export function applyEnrichmentImport(apiBase: string, records: unknown[], fetcher?: typeof fetch): Promise<{ report: { preview: EnrichmentPreview; applied: { new: number; updated: number } } }> { return enrichmentRequest(apiBase, "apply", records, fetcher); }

export async function backupThenUpload<T>(prepared: PreparedHostedImport, saveBackup: (contents: string) => Promise<void>, upload: () => Promise<T>): Promise<T> { await saveBackup(prepared.backup); return upload(); }
