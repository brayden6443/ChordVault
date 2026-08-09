import { safeParseJson } from "./persisted.ts";

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseCsvObjects(text: string): Record<string, unknown>[] {
  const [headers, ...rows] = csvRows(text);
  if (!headers) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export function importRecordCandidate(raw: Record<string, unknown>, index: number): Record<string, unknown> {
  if (typeof raw.recordJson !== "string" || raw.recordJson.trim() === "") return raw;
  const parsed = safeParseJson(raw.recordJson);
  if (!parsed.ok) throw new Error(`Row ${index + 1}: recordJson ${parsed.issues[0].message}`);
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) throw new Error(`Row ${index + 1}: recordJson must contain a chord record object`);
  return parsed.value as Record<string, unknown>;
}
