import type { MoodTag, StyleTag } from "./tags.ts";

export interface MoodStyleChord {
  moods?: readonly MoodTag[];
  styles?: readonly StyleTag[];
}

export function matchesMoodAndStyle(
  chord: MoodStyleChord,
  mood: MoodTag | "All",
  style: StyleTag | "All",
): boolean {
  return (mood === "All" || (chord.moods ?? []).includes(mood))
    && (style === "All" || (chord.styles ?? []).includes(style));
}
