import { CHORD_SCHEMA_VERSION, hydratePersistedChord, persistChordVoicing, safeParseJson, validatePersistedChord, type PersistedChordRecordV1, type PersistedWorkflowStatus, type ValidationIssue } from "./persisted.ts";
import type { ChordVoicing } from "./types.ts";

export interface QuarantinedChord { source: string; index: number; raw: unknown; issues: ValidationIssue[] }
export interface MigrationReport { dryRun: boolean; migrated: number; skipped: number; quarantined: number; failed: number; diagnostics: string[] }
export interface MigrationResult { records: PersistedChordRecordV1[]; quarantine: QuarantinedChord[]; report: MigrationReport }

export function migrateChordRecords(inputs: Array<{ source: string; workflowStatus: PersistedWorkflowStatus; value: unknown }>, dryRun = false): MigrationResult {
  const records: PersistedChordRecordV1[] = []; const quarantine: QuarantinedChord[] = [];
  const report: MigrationReport = { dryRun, migrated: 0, skipped: 0, quarantined: 0, failed: 0, diagnostics: [] };
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    try {
      const alreadyPersisted = validatePersistedChord(input.value);
      let record: PersistedChordRecordV1;
      if (alreadyPersisted.ok) { record = alreadyPersisted.value; report.skipped += 1; }
      else {
        if (!input.value || typeof input.value !== "object") { quarantine.push({ source: input.source, index, raw: input.value, issues: alreadyPersisted.issues }); report.quarantined += 1; return; }
        if ("schemaVersion" in input.value) { quarantine.push({ source: input.source, index, raw: input.value, issues: alreadyPersisted.issues }); report.quarantined += 1; return; }
        record = persistChordVoicing(input.value as ChordVoicing, input.workflowStatus);
        const validation = validatePersistedChord(record);
        if (!validation.ok) { quarantine.push({ source: input.source, index, raw: input.value, issues: validation.issues }); report.quarantined += 1; return; }
        hydratePersistedChord(validation.value); record = validation.value; report.migrated += 1;
      }
      const identity = `${record.id}|${record.workflowStatus}`;
      if (seen.has(identity)) { report.skipped += 1; return; }
      seen.add(identity); records.push(record);
    } catch (error) { report.failed += 1; report.diagnostics.push(`${input.source}[${index}]: ${error instanceof Error ? error.message : "migration failure"}`); }
  });
  return { records, quarantine, report };
}

export function migrateJsonSources(sources: Array<{ source: string; workflowStatus: PersistedWorkflowStatus; json: string }>, dryRun = false): MigrationResult {
  const inputs: Array<{ source: string; workflowStatus: PersistedWorkflowStatus; value: unknown }> = []; const earlyQuarantine: QuarantinedChord[] = [];
  for (const source of sources) {
    const parsed = safeParseJson(source.json);
    if (!parsed.ok) { earlyQuarantine.push({ source: source.source, index: 0, raw: source.json, issues: parsed.issues }); continue; }
    const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value]; values.forEach((value) => inputs.push({ source: source.source, workflowStatus: source.workflowStatus, value }));
  }
  const migrated = migrateChordRecords(inputs, dryRun); migrated.quarantine.unshift(...earlyQuarantine); migrated.report.quarantined += earlyQuarantine.length;
  return migrated;
}

export function migrationEnvelope(result: MigrationResult): string {
  return JSON.stringify({ schemaVersion: CHORD_SCHEMA_VERSION, records: result.records, quarantine: result.quarantine, report: result.report }, null, 2);
}
