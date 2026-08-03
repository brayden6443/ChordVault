import assert from "node:assert/strict";
import test from "node:test";
import { LocalStorageChordRepository, ChordRepositoryError, type StoragePort } from "../src/chords/chord-repository.ts";
import { CANONICAL_VOICINGS } from "../src/chords/canonical.ts";
import type { ChordVoicing } from "../src/chords/types.ts";

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, string>();
  writesUntilFailure: number | null = null;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.writesUntilFailure === 0) { this.writesUntilFailure = null; throw new Error("simulated quota failure"); } if (this.writesUntilFailure !== null) this.writesUntilFailure -= 1; this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const cMajor = CANONICAL_VOICINGS.find((voicing) => voicing.chordName === "C" && voicing.category === "Essential Open")!;
const dMajor = CANONICAL_VOICINGS.find((voicing) => voicing.chordName === "D" && voicing.category === "Essential Open")!;
const clone = (voicing: ChordVoicing, id: string): ChordVoicing => ({ ...voicing, id, slug: id, fretPositions: [...voicing.fretPositions], notes: [...voicing.notes], intervals: [...voicing.intervals], moodTags: [...voicing.moodTags], genreTags: [...voicing.genreTags], possibleBarres: [...voicing.possibleBarres] });

test("loads and migrates valid legacy records without exposing storage keys to callers", () => {
  const local = new MemoryStorage(); local.setItem("chord-vault-published-voicings", JSON.stringify([cMajor]));
  const repository = new LocalStorageChordRepository(local);
  assert.equal(repository.listPublishedVoicings()[0].chordName, "C");
  assert.equal(repository.loadWorkspace().publishedKeys.length, 0);
  assert.equal("keys" in repository, false);
});

test("malformed storage does not crash and is quarantined", () => {
  const local = new MemoryStorage(); local.setItem("chord-vault-approved-voicings", "{broken");
  const repository = new LocalStorageChordRepository(local);
  assert.deepEqual(repository.listPreReviewedVoicings(), []);
  assert.ok(repository.readQuarantineReport().quarantine.length >= 1);
});

test("pre-review writes are idempotent and duplicate shapes conflict", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage());
  const first = clone(cMajor, "candidate-c"); repository.moveToPreReviewed(first); repository.moveToPreReviewed(first);
  assert.equal(repository.listPreReviewedVoicings().length, 1);
  assert.equal(repository.listPreReviewedVoicings()[0].approvalStatus, "approved");
  assert.throws(() => repository.moveToPreReviewed(clone(cMajor, "candidate-c-copy")), (error) => error instanceof ChordRepositoryError && error.code === "DUPLICATE_CONFLICT");
});

test("publishing coherently moves a chord out of pre-reviewed and into published", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage()); const chord = clone(cMajor, "publish-c");
  repository.moveToPreReviewed(chord); repository.publishVoicing(chord);
  assert.deepEqual(repository.listPreReviewedVoicings(), []);
  assert.equal(repository.listPublishedVoicings()[0].id, chord.id);
  assert.deepEqual(repository.loadWorkspace().publishedKeys, [chord.id]);
});

test("rejection removes the candidate and pre-reviewed record while retaining its shape decision", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage()); const chord = clone(cMajor, "reject-c");
  repository.saveCandidateQueue([chord], 0); repository.moveToPreReviewed(chord); repository.rejectVoicing(chord);
  const workspace = repository.loadWorkspace();
  assert.equal(workspace.preReviewed.length, 0); assert.equal(workspace.candidates.length, 0); assert.equal(workspace.rejectedShapes.length, 1);
});

test("replacement removes the old published record and publishes the replacement", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage()); const oldChord = clone(cMajor, "old-c"); const replacement = clone(dMajor, "new-d");
  repository.publishVoicing(oldChord); repository.replacePublishedVoicing(oldChord.id, replacement);
  assert.deepEqual(repository.listPublishedVoicings().map((voicing) => voicing.id), [replacement.id]);
  assert.deepEqual(repository.loadWorkspace().publishedKeys, [replacement.id]);
});

test("public reads return only published voicing records", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage()); const pre = clone(cMajor, "pre-c"); const published = clone(dMajor, "pub-d");
  repository.moveToPreReviewed(pre); repository.publishVoicing(published);
  assert.deepEqual(repository.listPublishedVoicings().map((voicing) => voicing.id), [published.id]);
});

test("a failed staged write rolls back to the exact previous state", () => {
  const local = new MemoryStorage(); const repository = new LocalStorageChordRepository(local); repository.publishVoicing(clone(cMajor, "stable-c"));
  const before = new Map(local.values); local.writesUntilFailure = 2;
  assert.throws(() => repository.publishVoicing(clone(dMajor, "failed-d")), (error) => error instanceof ChordRepositoryError && error.code === "FAILED_WRITE");
  assert.deepEqual(local.values, before);
  assert.deepEqual(repository.listPublishedVoicings().map((voicing) => voicing.id), ["stable-c"]);
});

test("favorites and audit writes are idempotent", () => {
  const repository = new LocalStorageChordRepository(new MemoryStorage());
  repository.addFavorite("C"); repository.addFavorite("C"); repository.appendAuditEntry({ at: "2026-08-03T00:00:00.000Z", action: "Test", chord: "C" });
  assert.deepEqual(repository.listFavorites(), ["C"]); assert.equal(repository.loadWorkspace().auditLog.length, 1);
  repository.removeFavorite("C"); assert.deepEqual(repository.listFavorites(), []);
});
