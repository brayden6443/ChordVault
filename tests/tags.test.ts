import assert from "node:assert/strict";
import test from "node:test";
import { normalizedDescriptorTags, REVIEW_TAGS } from "../src/chords/tags.ts";

test("legacy mood tags normalize to the current vocabulary", () => {
  assert.deepEqual(normalizedDescriptorTags(["Blues", "Jazz", "Aggressive", "Essential"]), ["Bluesy", "Jazzy", "Essential"]);
  assert.ok(REVIEW_TAGS.includes("Nostalgic"));
  assert.ok(REVIEW_TAGS.includes("Serious"));
  assert.ok(!REVIEW_TAGS.includes("Aggressive"));
});
