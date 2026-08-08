import assert from "node:assert/strict";
import test from "node:test";
import { matchesMoodAndStyle } from "../src/chords/filtering.ts";
import { MOOD_TAGS, STYLE_TAGS, normalizedDescriptorTags, normalizedMoodTags, normalizedStyleTags } from "../src/chords/tags.ts";

test("legacy mixed tags split into structural, mood, and style values", () => {
  const legacy = ["Essential", "Warm", "Jazzy", "Bluesy", "Math rock", "Serious"];
  assert.deepEqual(normalizedDescriptorTags(legacy), ["Essential"]);
  assert.deepEqual(normalizedMoodTags(legacy), ["Warm"]);
  assert.deepEqual(normalizedStyleTags(legacy), ["Jazz", "Blues", "Math Rock"]);
  assert.ok(MOOD_TAGS.includes("Nostalgic"));
  assert.ok(STYLE_TAGS.includes("Neo Soul"));
});

test("filters chords with multiple moods and styles independently", () => {
  const chord = { moods: ["Dreamy", "Warm"] as const, styles: ["Jazz", "Neo Soul"] as const };
  assert.equal(matchesMoodAndStyle(chord, "Dreamy", "Neo Soul"), true);
  assert.equal(matchesMoodAndStyle(chord, "Dark", "Jazz"), false);
  assert.equal(matchesMoodAndStyle(chord, "All", "Jazz"), true);
});

test("chords without mood or style tags match only unfiltered views", () => {
  assert.equal(matchesMoodAndStyle({}, "All", "All"), true);
  assert.equal(matchesMoodAndStyle({}, "Warm", "All"), false);
  assert.equal(matchesMoodAndStyle({}, "All", "Ambient"), false);
});
