import type { ChordVoicing } from "./types.ts";

export function slugifyChordPart(value: string): string {
  return value
    .replaceAll("♯", "-sharp-")
    .replaceAll("#", "-sharp-")
    .replaceAll("♭", "-flat-")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function legacyChordSlug(chordName: string, id: string): string {
  return `${slugifyChordPart(chordName)}-${slugifyChordPart(id)}`;
}

function isBasicMajor(chord: ChordVoicing): boolean {
  return chord.chordQuality === "major" && slugifyChordPart(chord.chordName) === slugifyChordPart(chord.root);
}

function isBasicMinor(chord: ChordVoicing): boolean {
  return chord.chordQuality === "minor" && slugifyChordPart(chord.chordName) === `${slugifyChordPart(chord.root)}m`;
}

function shapeDescriptor(chord: ChordVoicing): string {
  if (chord.category === "Essential Open") return "open";
  if (chord.category === "Essential Barre") return "barre";
  if (chord.openStringCount > 0) return "open";
  if (chord.possibleBarres.length > 0) return "barre";
  if (chord.movable) return "movable";
  const fretted = chord.fretPositions.filter((fret): fret is number => fret !== null && fret > 0);
  return fretted.length ? `fret-${Math.min(...fretted)}` : "variation";
}

export function semanticChordSlug(chord: ChordVoicing): string {
  const name = isBasicMajor(chord)
    ? `${slugifyChordPart(chord.root)}-major`
    : isBasicMinor(chord)
      ? `${slugifyChordPart(chord.root)}-minor`
      : slugifyChordPart(chord.chordName);
  const essentialShape = chord.category === "Essential Open" || chord.category === "Essential Barre";
  return essentialShape ? `${name}-${shapeDescriptor(chord)}` : name;
}

export function publicSlugMap(chords: ChordVoicing[]): Map<string, string> {
  const bases = new Map<string, ChordVoicing[]>();
  for (const chord of chords) {
    const base = semanticChordSlug(chord);
    bases.set(base, [...bases.get(base) ?? [], chord]);
  }
  const result = new Map<string, string>(); const used = new Set<string>();
  for (const chord of [...chords].sort((left, right) => left.id.localeCompare(right.id))) {
    const base = semanticChordSlug(chord); const peers = bases.get(base) ?? [];
    const described = peers.length > 1 ? `${base}-${shapeDescriptor(chord)}` : base;
    let candidate = described; let variation = 2;
    while (used.has(candidate)) { candidate = `${described}-variation-${variation}`; variation += 1; }
    used.add(candidate); result.set(chord.id, candidate);
  }
  return result;
}

export function withPublicSlugs(chords: ChordVoicing[]): ChordVoicing[] {
  const slugs = publicSlugMap(chords);
  return chords.map((chord) => ({ ...chord, slug: slugs.get(chord.id) ?? semanticChordSlug(chord) }));
}
