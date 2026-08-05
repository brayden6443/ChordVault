export function slugifyChordPart(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function chordSlug(chordName: string, id: string): string {
  return `${slugifyChordPart(chordName)}-${slugifyChordPart(id)}`;
}
