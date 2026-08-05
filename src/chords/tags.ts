export const REVIEW_TAGS: string[] = ["Bluesy", "Math rock", "Ambient", "Warm", "Bright", "Dark", "Melancholic", "Tense", "Jazzy", "Ethereal", "Nostalgic", "Serious"];
export const STRUCTURAL_TAGS: string[] = ["Essential", "Open", "Barre", "Movable"];

const TAG_REPLACEMENTS: Record<string, string> = {
  Blues: "Bluesy", Jazz: "Jazzy", Dreamy: "Ethereal", Progressive: "Math rock",
  "Neo soul": "Jazzy", Funk: "Bluesy", "A-shape barre": "Barre", "E-shape barre": "Barre",
};

export function normalizedDescriptorTags(tags: string[]): string[] {
  const allowed = new Set<string>([...STRUCTURAL_TAGS, ...REVIEW_TAGS]);
  return [...new Set(tags.map((tag) => TAG_REPLACEMENTS[tag] ?? tag).filter((tag) => allowed.has(tag)))];
}

export function normalizedMoodTags(tags: string[]): string[] {
  const moods = new Set<string>(REVIEW_TAGS);
  return normalizedDescriptorTags(tags).filter((tag) => moods.has(tag));
}
