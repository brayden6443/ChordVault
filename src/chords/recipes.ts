export type RecipeFamily = "Triad" | "7th" | "Sus" | "9th" | "11th";
export type PublicQualityFamily = "Major" | "Minor" | "Neither";

export interface ChordRecipe {
  id: string;
  label: string;
  suffix: string;
  family: RecipeFamily;
  requiredIntervals: readonly number[];
  optionalIntervals: readonly number[];
  permittedOmissions: readonly number[];
  aliases: readonly string[];
  publicQualityFamily: PublicQualityFamily;
  generatorAvailable: boolean;
  canonicalSupport: { open: boolean; barre: boolean };
}

export const CHORD_RECIPES = [
  { id: "major", label: "Major", suffix: "", family: "Triad", requiredIntervals: [0, 4, 7], optionalIntervals: [], permittedOmissions: [7], aliases: ["maj", "major-triad"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "minor", label: "Minor", suffix: "m", family: "Triad", requiredIntervals: [0, 3, 7], optionalIntervals: [], permittedOmissions: [7], aliases: ["min", "minor-triad", "m"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "sus2", label: "Suspended 2", suffix: "sus2", family: "Sus", requiredIntervals: [0, 2, 7], optionalIntervals: [], permittedOmissions: [], aliases: ["suspended2"], publicQualityFamily: "Neither", generatorAvailable: true, canonicalSupport: { open: true, barre: false } },
  { id: "sus4", label: "Suspended 4", suffix: "sus4", family: "Sus", requiredIntervals: [0, 5, 7], optionalIntervals: [], permittedOmissions: [], aliases: ["sus", "suspended4"], publicQualityFamily: "Neither", generatorAvailable: true, canonicalSupport: { open: true, barre: false } },
  { id: "dom7", label: "Dominant 7", suffix: "7", family: "7th", requiredIntervals: [0, 4, 10], optionalIntervals: [7], permittedOmissions: [7], aliases: ["dominant7", "7"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "maj7", label: "Major 7", suffix: "maj7", family: "7th", requiredIntervals: [0, 4, 11], optionalIntervals: [7], permittedOmissions: [7], aliases: ["major7"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "min7", label: "Minor 7", suffix: "m7", family: "7th", requiredIntervals: [0, 3, 10], optionalIntervals: [7], permittedOmissions: [7], aliases: ["minor7", "m7"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "maj9", label: "Major 9", suffix: "maj9", family: "9th", requiredIntervals: [0, 4, 11], optionalIntervals: [2, 7], permittedOmissions: [7], aliases: ["major9"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: false, barre: false } },
  { id: "min9", label: "Minor 9", suffix: "m9", family: "9th", requiredIntervals: [0, 3, 10], optionalIntervals: [2, 7], permittedOmissions: [7], aliases: ["minor9", "m9"], publicQualityFamily: "Minor", generatorAvailable: false, canonicalSupport: { open: true, barre: false } },
  { id: "min11", label: "Minor 11", suffix: "m11", family: "11th", requiredIntervals: [0, 3, 10], optionalIntervals: [2, 5, 7], permittedOmissions: [7], aliases: ["minor11", "m11"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: false } },
] as const satisfies readonly ChordRecipe[];

export type RecipeId = (typeof CHORD_RECIPES)[number]["id"];

const recipeLookup = new Map<string, ChordRecipe>();
for (const recipe of CHORD_RECIPES) {
  recipeLookup.set(recipe.id.toLowerCase(), recipe);
  for (const alias of recipe.aliases) recipeLookup.set(alias.toLowerCase(), recipe);
}

export function recipeById(id: string): ChordRecipe | undefined {
  return recipeLookup.get(id.trim().toLowerCase());
}

export function requireRecipe(id: string): ChordRecipe {
  const recipe = recipeById(id);
  if (!recipe) throw new Error(`Unknown chord recipe: ${id}`);
  return recipe;
}

export function generatorRecipes(): ChordRecipe[] {
  return CHORD_RECIPES.filter((recipe) => recipe.generatorAvailable);
}

export function recipeIdFromChordName(name: string): RecipeId {
  const lower = name.toLowerCase();
  if (lower.includes("m11")) return "min11";
  if (lower.includes("maj9")) return "maj9";
  if (lower.includes("m9")) return "min9";
  if (lower.includes("maj7")) return "maj7";
  if (lower.includes("m7")) return "min7";
  if (lower.includes("sus2")) return "sus2";
  if (lower.includes("sus4") || lower.includes("sus")) return "sus4";
  if (lower.includes("7")) return "dom7";
  return /^[a-g](?:#|b)?m(?!aj)/i.test(name) ? "minor" : "major";
}
