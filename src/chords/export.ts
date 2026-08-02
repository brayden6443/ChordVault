import type { ChordVoicing } from "./types.ts";

function selected(voicings: ChordVoicing[], approvedOnly: boolean): ChordVoicing[] {
  return approvedOnly ? voicings.filter((voicing) => voicing.approvalStatus === "approved") : voicings;
}

export function exportVoicingsJson(voicings: ChordVoicing[], approvedOnly = false): string {
  return JSON.stringify(selected(voicings, approvedOnly), null, 2);
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportVoicingsCsv(voicings: ChordVoicing[], approvedOnly = false): string {
  const headers = [
    "id", "slug", "chordName", "root", "tuning", "fretPositions", "fingerPositions", "notes",
    "intervals", "bassNote", "inversion", "fretSpan", "openStringCount", "difficulty",
    "moodTags", "genreTags", "description", "qualityScore", "approvalStatus",
  ];
  const rows = selected(voicings, approvedOnly).map((voicing) => [
    voicing.id, voicing.slug, voicing.chordName, voicing.root, voicing.tuning.id,
    voicing.fretPositions.map((fret) => fret ?? "x"), voicing.fingerPositions ?? [], voicing.notes,
    voicing.intervals, voicing.bassNote, voicing.inversion, voicing.fretSpan, voicing.openStringCount,
    voicing.difficulty, voicing.moodTags, voicing.genreTags, voicing.description,
    voicing.qualityScore, voicing.approvalStatus,
  ]);
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

export function approvedJson(voicings: ChordVoicing[]): string {
  return exportVoicingsJson(voicings, true);
}

export function approvedCsv(voicings: ChordVoicing[]): string {
  return exportVoicingsCsv(voicings, true);
}
