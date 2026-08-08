import type { MoodTag, StyleTag } from "./tags.ts";

export interface MoodStyleChord {
  moods?: readonly MoodTag[];
  styles?: readonly StyleTag[];
}

export function matchesAnyFilter<T>(values: readonly T[], selected: ReadonlySet<T>): boolean {
  return selected.size === 0 || values.some((value) => selected.has(value));
}

export function toggleFilterValue<T>(selected: Set<T>, value: T | "All"): void {
  if (value === "All") { selected.clear(); return; }
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
}

export function matchesMoodAndStyle(
  chord: MoodStyleChord,
  mood: MoodTag | "All",
  style: StyleTag | "All",
): boolean {
  return (mood === "All" || (chord.moods ?? []).includes(mood))
    && (style === "All" || (chord.styles ?? []).includes(style));
}
