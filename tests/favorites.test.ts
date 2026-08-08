import assert from "node:assert/strict";
import test from "node:test";
import { resolveFavoriteIds } from "../src/chords/favorites.ts";

const chords = [
  { id: "a-barre", name: "A", category: "Essential Barre" },
  { id: "a-open", name: "A", category: "Essential Open" },
  { id: "am-open", name: "Am", category: "Essential Open" },
];

test("legacy name favorites resolve to one open voicing while id favorites remain exact", () => {
  assert.deepEqual(resolveFavoriteIds(["A"], chords), ["a-open"]);
  assert.deepEqual(resolveFavoriteIds(["a-barre"], chords), ["a-barre"]);
});
