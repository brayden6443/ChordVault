import { hydratePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";

export interface AiEnrichmentChordRecord extends PersistedChordRecordV1 {
  chordName: string;
  slug: string;
  quality: string;
  type: string;
  notes: string[];
  intervals: number[];
  bassNote: string;
  inversion: string;
}

export interface ChordExportBundle {
  exportedAt: string;
  recordCount: number;
  records: AiEnrichmentChordRecord[];
}

const CSV_COLUMNS: Array<keyof AiEnrichmentChordRecord | "recordJson"> = [
  "schemaVersion", "id", "chordName", "slug", "root", "recipeId", "quality", "type",
  "tuning", "fretPositions", "fingerPositions", "notes", "intervals", "bassNote", "inversion",
  "description", "tags", "moods", "styles", "difficulty", "workflowStatus", "catalog", "provenance", "recordJson",
];

function enrichmentRecord(record: PersistedChordRecordV1): AiEnrichmentChordRecord {
  const chord = hydratePersistedChord(record);
  return {
    ...record,
    chordName: chord.chordName,
    slug: chord.slug,
    quality: record.recipeId,
    type: record.catalog?.category ?? "",
    notes: [...chord.notes],
    intervals: [...chord.intervals],
    bassNote: chord.bassNote,
    inversion: chord.inversion,
  };
}

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function createChordExport(records: PersistedChordRecordV1[], now = new Date()): ChordExportBundle {
  return { exportedAt: now.toISOString(), recordCount: records.length, records: records.map(enrichmentRecord) };
}

export function chordExportJson(bundle: ChordExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function chordExportCsv(bundle: ChordExportBundle): string {
  const header = CSV_COLUMNS.join(",");
  const rows = bundle.records.map((record) => CSV_COLUMNS.map((column) =>
    csvValue(column === "recordJson" ? record : record[column])).join(","));
  return [header, ...rows].join("\r\n");
}

export function chordExportFilename(format: "csv" | "json", now = new Date()): string {
  return `chord-vault-export-${now.toISOString().slice(0, 10)}.${format}`;
}
