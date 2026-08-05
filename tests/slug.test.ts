import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import { legacyChordSlug, semanticChordSlug, withPublicSlugs } from "../src/chords/slug.ts";
import type { ChordVoicing } from "../src/chords/types.ts";

const aOpen = CANONICAL_VOICINGS.find((chord) => chord.chordName === "A" && chord.category === "Essential Open")!;
const aBarre = CANONICAL_VOICINGS.find((chord) => chord.chordName === "A" && chord.category === "Essential Barre")!;

test("basic chord shapes use semantic public slugs without internal ids", () => {
  assert.equal(semanticChordSlug(aOpen), "a-major-open");
  assert.equal(semanticChordSlug(aBarre), "a-major-barre");
  assert.doesNotMatch(semanticChordSlug(aOpen), new RegExp(aOpen.id));
});

test("named chord extensions keep compact SEO-friendly slugs", () => {
  const cmaj7 = { ...aOpen, id: "internal-record-123", chordName: "Cmaj7", chordQuality: "major7", root: "C", category: "Other Approved", isCanonical: false, isEssential: false } as ChordVoicing;
  const dm7 = { ...cmaj7, id: "internal-record-456", chordName: "Dm7", chordQuality: "minor7", root: "D" };
  assert.equal(semanticChordSlug(cmaj7), "cmaj7"); assert.equal(semanticChordSlug(dm7), "dm7");
});

test("duplicate named voicings receive deterministic variation descriptors", () => {
  const first = { ...aOpen, id: "first", chordName: "A7", chordQuality: "dominant7", category: "Other Approved", isCanonical: false, isEssential: false } as ChordVoicing;
  const second = { ...first, id: "second" };
  const slugs = withPublicSlugs([second, first]);
  assert.deepEqual(slugs.map((chord) => chord.slug), ["a7-open-variation-2", "a7-open"]);
  assert.deepEqual(withPublicSlugs([second, first]).map((chord) => chord.slug), slugs.map((chord) => chord.slug));
});

test("legacy slugs remain available as name and id aliases", () => {
  assert.equal(legacyChordSlug("A", "canonical-vckn67"), "a-canonical-vckn67");
});
