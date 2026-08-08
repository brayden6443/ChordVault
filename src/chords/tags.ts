export const MOOD_TAGS = ["Dreamy", "Ethereal", "Warm", "Bright", "Dark", "Melancholic", "Tense", "Nostalgic"] as const;
export const STYLE_TAGS = ["Jazz", "Neo Soul", "Ambient", "Math Rock", "Metal", "Blues", "Cinematic", "Indie"] as const;
export const STRUCTURAL_TAGS = ["Essential", "Open", "Barre", "Movable"] as const;

export type MoodTag = (typeof MOOD_TAGS)[number];
export type StyleTag = (typeof STYLE_TAGS)[number];

// Kept as an export for older callers while they migrate to the separate lists.
export const REVIEW_TAGS: string[] = [...MOOD_TAGS, ...STYLE_TAGS];

const MOOD_REPLACEMENTS: Record<string, MoodTag> = {
  Dreamy: "Dreamy",
  Ethereal: "Ethereal",
  Warm: "Warm",
  Bright: "Bright",
  Dark: "Dark",
  Melancholic: "Melancholic",
  Tense: "Tense",
  Nostalgic: "Nostalgic",
};

const STYLE_REPLACEMENTS: Record<string, StyleTag> = {
  Jazz: "Jazz",
  Jazzy: "Jazz",
  "Neo Soul": "Neo Soul",
  "Neo soul": "Neo Soul",
  Ambient: "Ambient",
  "Math Rock": "Math Rock",
  "Math rock": "Math Rock",
  Progressive: "Math Rock",
  Metal: "Metal",
  Blues: "Blues",
  Bluesy: "Blues",
  Cinematic: "Cinematic",
  Indie: "Indie",
};

const STRUCTURAL_REPLACEMENTS: Record<string, (typeof STRUCTURAL_TAGS)[number]> = {
  Essential: "Essential",
  Open: "Open",
  Barre: "Barre",
  Movable: "Movable",
  "A-shape barre": "Barre",
  "E-shape barre": "Barre",
};

function normalizedFromMap<T extends string>(tags: readonly string[], replacements: Record<string, T>): T[] {
  return [...new Set(tags.map((tag) => replacements[tag.trim()]).filter((tag): tag is T => Boolean(tag)))];
}

export function normalizedMoodTags(tags: readonly string[]): MoodTag[] {
  return normalizedFromMap(tags, MOOD_REPLACEMENTS);
}

export function normalizedStyleTags(tags: readonly string[]): StyleTag[] {
  return normalizedFromMap(tags, STYLE_REPLACEMENTS);
}

export function normalizedDescriptorTags(tags: readonly string[]): string[] {
  return normalizedFromMap(tags, STRUCTURAL_REPLACEMENTS);
}

export function splitLegacyTags(tags: readonly string[]): { tags: string[]; moods: MoodTag[]; styles: StyleTag[] } {
  return {
    tags: normalizedDescriptorTags(tags),
    moods: normalizedMoodTags(tags),
    styles: normalizedStyleTags(tags),
  };
}
