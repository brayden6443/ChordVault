import { CANONICAL_VOICINGS } from "./canonical.ts";
import { exactVoicingKey, voicingSimilarity } from "./identity.ts";
import type { ChordVoicing, MigrationReport, ReviewExclusionCounts } from "./types.ts";

export const CATEGORY_PRIORITY = { "Essential Open": 10, "Essential Barre": 20, "Other Approved": 100 } as const;

export function sortPublicVoicings(voicings: ChordVoicing[]): ChordVoicing[] {
  return [...voicings].sort((left, right) =>
    Number(Boolean(right.isEssential)) - Number(Boolean(left.isEssential))
    || (CATEGORY_PRIORITY[left.category ?? "Other Approved"] - CATEGORY_PRIORITY[right.category ?? "Other Approved"])
    || ((left.displayPriority ?? 999) - (right.displayPriority ?? 999))
    || right.qualityScore - left.qualityScore
    || left.difficulty - right.difficulty
    || left.id.localeCompare(right.id));
}

function canonicalMetadata(source: ChordVoicing): Partial<ChordVoicing> {
  return {
    chordQuality: source.chordQuality, shapeFamily: source.shapeFamily, category: source.category,
    source: source.source, isCanonical: true, isEssential: true, displayPriority: source.displayPriority,
    movable: source.movable, baseShapeRoot: source.baseShapeRoot, applicableRoots: source.applicableRoots,
  };
}

export function seedCanonicalVoicings(existing: ChordVoicing[], dryRun = true): { voicings: ChordVoicing[]; report: MigrationReport } {
  const output = existing.map((voicing) => ({ ...voicing }));
  const byKey = new Map<string, ChordVoicing[]>();
  for (const voicing of output) {
    const key = exactVoicingKey(voicing);
    byKey.set(key, [...(byKey.get(key) ?? []), voicing]);
  }
  const report: MigrationReport = { dryRun, canonicalAdded: [], existingUpgraded: [], exactDuplicatesFlagged: [], manualReview: [], validationFailures: [] };
  for (const [key, matches] of byKey) {
    if (matches.length > 1) report.exactDuplicatesFlagged.push(`${key}: ${matches.map((match) => match.id).join(", ")}`);
  }
  for (const canonical of CANONICAL_VOICINGS) {
    const key = exactVoicingKey(canonical);
    const match = byKey.get(key)?.[0];
    if (match) {
      report.existingUpgraded.push(match.id);
      if (!dryRun) Object.assign(match, canonicalMetadata(canonical));
    } else {
      report.canonicalAdded.push(canonical.id);
      if (!dryRun) { output.push({ ...canonical }); byKey.set(key, [canonical]); }
    }
  }
  return { voicings: output, report };
}

function scopeKey(voicing: ChordVoicing): string {
  return `${voicing.tuning.id}|${voicing.root}|${voicing.chordQuality ?? ""}`;
}

export function buildReviewQueue(
  candidates: ChordVoicing[],
  approved: ChordVoicing[],
  options: { similarityThreshold?: number; qualityThreshold?: number } = {},
): { queue: ChordVoicing[]; excluded: ReviewExclusionCounts } {
  const similarityThreshold = options.similarityThreshold ?? 90;
  const qualityThreshold = options.qualityThreshold ?? 0;
  const existing = [...approved, ...CANONICAL_VOICINGS];
  const exact = new Map(existing.map((voicing) => [exactVoicingKey(voicing), voicing]));
  const scoped = new Map<string, ChordVoicing[]>();
  for (const voicing of existing) scoped.set(scopeKey(voicing), [...(scoped.get(scopeKey(voicing)) ?? []), voicing]);
  const excluded: ReviewExclusionCounts = { exactApproved: 0, nearApproved: 0, canonicalOpen: 0, canonicalBarre: 0, invalidChord: 0, failedPlayability: 0, belowQualityThreshold: 0 };
  const queue: ChordVoicing[] = [];
  const queuedKeys = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.qualityScore < qualityThreshold) { excluded.belowQualityThreshold += 1; continue; }
    const key = exactVoicingKey(candidate);
    const exactMatch = exact.get(key);
    if (exactMatch) {
      if (exactMatch.category === "Essential Open") excluded.canonicalOpen += 1;
      else if (exactMatch.category === "Essential Barre") excluded.canonicalBarre += 1;
      else excluded.exactApproved += 1;
      continue;
    }
    if (queuedKeys.has(key)) { excluded.exactApproved += 1; continue; }
    const nearMatch = (scoped.get(scopeKey(candidate)) ?? []).some((voicing) => voicingSimilarity(candidate, voicing) >= similarityThreshold);
    if (nearMatch) { excluded.nearApproved += 1; continue; }
    queuedKeys.add(key); queue.push(candidate);
  }
  return { queue, excluded };
}

export function canApproveVoicing(candidate: ChordVoicing, publicVoicings: ChordVoicing[], similarityThreshold = 90): { allowed: boolean; reason?: string } {
  const exact = publicVoicings.some((voicing) => exactVoicingKey(voicing) === exactVoicingKey(candidate));
  if (exact) return { allowed: false, reason: "This voicing is already in the Chord Vault." };
  const near = publicVoicings.some((voicing) => scopeKey(voicing) === scopeKey(candidate) && voicingSimilarity(candidate, voicing) >= similarityThreshold);
  return near ? { allowed: false, reason: "This voicing is already in the Chord Vault." } : { allowed: true };
}

export function findVoicingDuplicate(candidate: ChordVoicing, publicVoicings: ChordVoicing[], similarityThreshold = 90): { match: ChordVoicing; similarity: number; exact: boolean } | null {
  const exact = publicVoicings.find((voicing) => exactVoicingKey(voicing) === exactVoicingKey(candidate));
  if (exact) return { match: exact, similarity: 100, exact: true };
  let best: { match: ChordVoicing; similarity: number; exact: boolean } | null = null;
  for (const voicing of publicVoicings) {
    if (scopeKey(voicing) !== scopeKey(candidate)) continue;
    const similarity = voicingSimilarity(candidate, voicing);
    if (similarity >= similarityThreshold && (!best || similarity > best.similarity)) best = { match: voicing, similarity, exact: false };
  }
  return best;
}
