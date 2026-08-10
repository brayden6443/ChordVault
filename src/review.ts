import { APPROVED_C_PROFILE, rankWithCurationProfile } from "./chords/curation.ts";
import { buildReviewQueue, canApproveVoicing, findVoicingDuplicate } from "./chords/repository.ts";
import { CANONICAL_VOICINGS } from "./chords/canonical.ts";
import { generateBatch, generateVoicings } from "./chords/generator.ts";
import { bassPitch, intervalLabel, intervalsRelativeToRoot, inversionForPitches, pitchesForVoicing } from "./chords/theory.ts";
import { fretSpanFor } from "./chords/playability.ts";
import { exactVoicingKey } from "./chords/identity.ts";
import { createChordRepository, repositoryConfiguration } from "./chords/repository-composition.ts";
import { HostedReviewClient, type HostedReviewWorkspace } from "./chords/hosted-review-client.ts";
import { applyEnrichmentImport, previewEnrichmentImport } from "./chords/hosted-import.ts";
import { CHORD_SCHEMA_VERSION, hydratePersistedChord, persistChordVoicing, safeParseJson, validatePersistedChord, type PersistedChordRecordV1 } from "./chords/persisted.ts";
import type { EnrichmentPreview } from "./chords/enrichment.ts";
import { generatorRecipes, recipeById, recipeIdFromChordName } from "./chords/recipes.ts";
import { STANDARD_TUNING, type ApprovalStatus, type ChordVoicing } from "./chords/types.ts";
import { MOOD_TAGS, STYLE_TAGS, STRUCTURAL_TAGS, normalizedDescriptorTags, normalizedMoodTags, normalizedStyleTags, type MoodTag, type StyleTag } from "./chords/tags.ts";
import { importRecordCandidate, parseCsvObjects } from "./chords/csv-import.ts";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const RECIPES = generatorRecipes();
const repositoryConfig = repositoryConfiguration(import.meta.env);
const { repository: chordRepository, capabilities: repositoryCapabilities } = await createChordRepository({ localStorage, sessionStorage, env: import.meta.env });
const initialWorkspace = chordRepository.loadWorkspace();
const hostedReview = repositoryCapabilities.backend === "hosted" ? new HostedReviewClient(repositoryConfig.apiBase) : null;

const savedReviews = repositoryCapabilities.backend === "hosted" ? {} : initialWorkspace.savedReviews;
let approvedVault: ChordVoicing[] = repositoryCapabilities.backend === "hosted" ? [] : initialWorkspace.preReviewed;
let publishedVault: ChordVoicing[] = repositoryCapabilities.backend === "hosted" ? [] : initialWorkspace.published;
let rejectedVault: ChordVoicing[] = [];
let hostedWorkspace: HostedReviewWorkspace | null = null;
let hostedWorkspaceLoadError = "";
if (repositoryCapabilities.backend === "hosted") {
  try {
    hostedWorkspace = await hostedReview!.loadWorkspace();
    approvedVault = hostedWorkspace.preReviewed; publishedVault = hostedWorkspace.published; rejectedVault = hostedWorkspace.rejected;
  } catch (error) { hostedWorkspaceLoadError = error instanceof Error ? error.message : "Hosted administrator records could not be loaded."; }
}
interface LibraryItem { key: string; name: string; root?: string; chordQuality?: string; difficulty: number; descriptorTags: string[]; moods: MoodTag[]; styles: StyleTag[]; frets?: number[]; fingers?: string[]; source: "Main Vault" | "Pre-reviewed" | "Unapproved"; }
let finalApprovedKeys = new Set<string>(publishedVault.map((record) => record.id));
const fallbackPublicLibrary: LibraryItem[] = CANONICAL_VOICINGS.map((voicing) => ({
  key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality, difficulty: voicing.difficulty, source: "Main Vault",
  frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
  descriptorTags: [voicing.displayPriority === 1 ? "Essential" : "", voicing.category === "Essential Open" ? "Open" : "Barre", voicing.movable ? "Movable" : ""].filter(Boolean),
  moods: [], styles: [],
}));
let publicLibrary: LibraryItem[] = (repositoryCapabilities.backend === "hosted" ? publishedVault.map((voicing) => ({
  key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality, difficulty: voicing.difficulty, source: "Main Vault" as const,
  frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
  descriptorTags: voicing.descriptorTags ?? [], moods: voicing.moodTags, styles: voicing.genreTags,
})) : (initialWorkspace.publicLibrary ?? fallbackPublicLibrary))
  .map((item) => ({ ...item, moods: normalizedMoodTags(item.moods ?? item.descriptorTags), styles: normalizedStyleTags(item.styles ?? item.descriptorTags), descriptorTags: normalizedDescriptorTags(item.descriptorTags), source: finalApprovedKeys.has(item.key) ? "Main Vault" : "Unapproved" }));
const libraryEdits = repositoryCapabilities.backend === "hosted" ? {} : initialWorkspace.libraryEdits;

async function refreshHostedWorkspace(): Promise<void> {
  if (!hostedReview) return;
  hostedWorkspace = await hostedReview.loadWorkspace();
  approvedVault = hostedWorkspace.preReviewed;
  publishedVault = hostedWorkspace.published;
  rejectedVault = hostedWorkspace.rejected;
  finalApprovedKeys = new Set(publishedVault.map((record) => record.id));
  publicLibrary = publishedVault.map((voicing) => ({
    key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality, difficulty: voicing.difficulty, source: "Main Vault",
    frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
    descriptorTags: normalizedDescriptorTags(voicing.descriptorTags ?? []), moods: normalizedMoodTags(voicing.moodTags), styles: normalizedStyleTags(voicing.genreTags),
  }));
}
function migrateLegacyTags(): void {
  const migrateVoicing = (voicing: ChordVoicing) => {
    const legacy = voicing.descriptorTags ?? [];
    return { ...voicing, moodTags: normalizedMoodTags([...voicing.moodTags, ...legacy]), genreTags: normalizedStyleTags([...voicing.genreTags, ...legacy]), descriptorTags: normalizedDescriptorTags(legacy) };
  };
  approvedVault = approvedVault.map(migrateVoicing);
  publishedVault = publishedVault.map(migrateVoicing);
  Object.values(savedReviews).forEach((review) => {
    const legacy = review.descriptorTags ?? [];
    review.moodTags = normalizedMoodTags([...review.moodTags, ...legacy]); review.genreTags = normalizedStyleTags([...review.genreTags, ...legacy]); review.descriptorTags = normalizedDescriptorTags(legacy);
  });
  Object.values(libraryEdits).forEach((edit) => { const legacy = edit.descriptorTags ?? []; edit.moods = normalizedMoodTags(edit.moods ?? legacy); edit.styles = normalizedStyleTags(edit.styles ?? legacy); if (edit.descriptorTags) edit.descriptorTags = normalizedDescriptorTags(edit.descriptorTags); });
  chordRepository.applyLegacyTagMigration(approvedVault, publishedVault, savedReviews, libraryEdits);
}
if (repositoryCapabilities.mutations) migrateLegacyTags();
let activeLibrarySource = "All";
let libraryPage = 0;
let candidates: ChordVoicing[] = [];
let currentIndex = repositoryCapabilities.backend === "hosted" ? 0 : initialWorkspace.reviewIndex;
const rejectedShapes = new Set<string>(repositoryCapabilities.backend === "hosted" ? [] : initialWorkspace.rejectedShapes);
const reviewLater = new Set<string>(initialWorkspace.reviewLater);
const auditLog = repositoryCapabilities.backend === "hosted" ? [] : initialWorkspace.auditLog;
const selectedLibraryKeys = new Set<string>();
let undoAction: (() => void) | null = null;
let audioContext: AudioContext | null = null;
let activeSources: OscillatorNode[] = [];

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rootSelect = byId<HTMLSelectElement>("rootSelect");
const recipeSelect = byId<HTMLSelectElement>("recipeSelect");
const retainInput = byId<HTMLInputElement>("retainInput");
const reviewCard = byId<HTMLElement>("reviewCard");
const batchStatus = byId<HTMLElement>("batchStatus");
if (!repositoryCapabilities.mutations) batchStatus.textContent = "This browser workspace remains read-only for hosted records. Authorized hosted changes use the protected administrator API.";
if (hostedWorkspaceLoadError) batchStatus.textContent = hostedWorkspaceLoadError;

candidates = repositoryCapabilities.backend === "hosted" ? [] : initialWorkspace.candidates;

function persistQueue(): void {
  if (repositoryCapabilities.backend !== "hosted") chordRepository.saveCandidateQueue(candidates, currentIndex);
}
function audit(action: string, chord: string): void {
  if (repositoryCapabilities.backend === "hosted") { batchStatus.textContent ||= `${action}: ${chord}`; return; }
  auditLog.unshift({ at: new Date().toISOString(), action, chord }); auditLog.splice(100);
  chordRepository.appendAuditEntry(auditLog[0]); void chordRepository.mirrorWorkspace(); renderAudit();
}
function setUndo(action: () => void): void { undoAction = action; byId<HTMLButtonElement>("undoAction").disabled = false; }

rootSelect.innerHTML = ROOTS.map((root) => `<option>${root}</option>`).join("");
recipeSelect.innerHTML = RECIPES.map((recipe) => `<option value="${recipe.id}">${recipe.label}</option>`).join("");

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function applySaved(voicing: ChordVoicing): ChordVoicing {
  return savedReviews[voicing.id] ? { ...voicing, ...savedReviews[voicing.id] } : voicing;
}

function saveCurrent(voicing: ChordVoicing): void {
  savedReviews[voicing.id] = {
    approvalStatus: voicing.approvalStatus,
    chordName: voicing.chordName,
    moodTags: voicing.moodTags,
    genreTags: voicing.genreTags,
    description: voicing.description,
    difficulty: voicing.difficulty,
    descriptorTags: voicing.descriptorTags,
  };
  chordRepository.saveReview(voicing.id, savedReviews[voicing.id]);
}

function diagram(voicing: ChordVoicing): string {
  const xs = [32, 70, 108, 146, 184, 222];
  const fretted = voicing.fretPositions.filter((fret): fret is number => fret !== null && fret > 0);
  const minimum = Math.min(...fretted, 1);
  const baseFret = minimum > 4 ? minimum : 1;
  const top = 46;
  const rowHeight = 36;
  const grid = [0, 1, 2, 3, 4, 5].map((row) => `<line class="grid-line${row === 0 && baseFret === 1 ? " nut" : ""}" x1="32" y1="${top + row * rowHeight}" x2="222" y2="${top + row * rowHeight}"/>`).join("")
    + xs.map((x) => `<line class="grid-line" x1="${x}" y1="${top}" x2="${x}" y2="${top + rowHeight * 5}"/>`).join("");
  const fretLabels = [0, 1, 2, 3, 4].map((row) => `<text class="label" x="244" y="${top + row * rowHeight + 23}">${baseFret + row}</text>`).join("");
  const marks = voicing.fretPositions.map((fret, index) => {
    if (fret === null) return `<text class="marker" x="${xs[index]}" y="30">×</text>`;
    if (fret === 0) return `<circle class="grid-line" fill="none" cx="${xs[index]}" cy="25" r="8"/>`;
    const row = fret - baseFret;
    if (row < 0 || row > 4) return "";
    const finger = voicing.fingerPositions?.[index] ?? "";
    const y = top + row * rowHeight + rowHeight / 2;
    return `<circle class="finger" cx="${xs[index]}" cy="${y}" r="12"/><text class="finger-text" x="${xs[index]}" y="${y + 4}">${finger}</text>`;
  }).join("");
  const labels = ["E", "A", "D", "G", "B", "e"].map((label, index) => `<text class="label" x="${xs[index]}" y="248">${label}</text>`).join("");
  return `<svg class="review-diagram" viewBox="0 0 270 260" role="img" aria-label="${escapeHtml(voicing.chordName)} guitar chord diagram">${grid}${fretLabels}${marks}${labels}</svg>`;
}

function updateCounts(): void {
  for (const status of ["pending", "approved", "rejected"] as ApprovalStatus[]) {
    const count = hostedReview && status === "approved" ? approvedVault.length
      : hostedReview && status === "rejected" ? rejectedVault.length
        : candidates.filter((candidate) => candidate.approvalStatus === status).length;
    byId(`${status}Count`).textContent = String(count);
  }
  byId("positionCount").textContent = candidates.length ? `${currentIndex + 1} / ${candidates.length}` : "0 / 0";
}

function render(): void {
  updateCounts();
  const voicing = candidates[currentIndex];
  if (!voicing) {
    reviewCard.innerHTML = `<div class="review-empty"><h2>No candidates yet</h2><p>Generate one chord or a complete 12-root batch to begin reviewing.</p></div>`;
    return;
  }
  const checks = [
    [voicing.intervals.length >= 2, "Defining tones calculated"], [Boolean(voicing.fingerPositions?.some(Boolean)), "Fingering assigned"],
    [voicing.fretSpan <= 4, "Playable fret span"], [voicing.difficulty >= 1, "Difficulty reviewed"],
    [Boolean(voicing.descriptorTags?.length || voicing.moodTags.length || voicing.genreTags.length), "Descriptors reviewed"],
  ] as Array<[boolean, string]>;
  reviewCard.innerHTML = `<div class="candidate-layout">
    <div class="candidate-visual"><h2>${escapeHtml(voicing.chordName)}</h2><p>${escapeHtml(voicing.tuning.name)}</p>${diagram(voicing)}</div>
    <div class="candidate-details">
      <div class="detail-grid">
        <div><span>Notes</span><strong>${voicing.notes.join(" · ")}</strong></div>
        <div><span>Intervals</span><strong>${voicing.intervals.map(intervalLabel).join(" · ")}</strong></div>
        <div><span>Bass</span><strong>${voicing.bassNote}</strong></div>
        <div><span>Inversion</span><strong>${voicing.inversion}</strong></div>
        <div><span>Frets</span><strong>${voicing.fretPositions.map((fret) => fret ?? "×").join(" · ")}</strong></div>
        <div><span>Difficulty</span><strong>${voicing.difficulty} / 5</strong></div>
      </div>
      <div class="editor-grid">
        <label class="editor-field">Chord name<input id="editName" value="${escapeHtml(voicing.chordName)}" /></label>
        <label class="editor-field">Mood tags, comma separated<input id="editMood" value="${escapeHtml(voicing.moodTags.join(", "))}" /></label>
        <label class="editor-field">Genre tags, comma separated<input id="editGenre" value="${escapeHtml(voicing.genreTags.join(", "))}" /></label>
        <label class="editor-field">Difficulty level<select id="editDifficulty">${[1,2,3,4,5].map((level) => `<option value="${level}"${level === voicing.difficulty ? " selected" : ""}>${level} / 5</option>`).join("")}</select></label>
        <label class="editor-field">Description<textarea id="editDescription">${escapeHtml(voicing.description)}</textarea></label>
      </div>
      <div class="approval-checklist"><span>Approval checklist</span>${checks.map(([passed, label]) => `<div class="${passed ? "passed" : "warning"}">${passed ? "✓" : "!"} ${label}</div>`).join("")}</div>
      <div class="review-decisions">
        <button class="edit-button" id="saveEdit" type="button">Save edits</button>
        <button class="approve-button" data-status="approved" type="button">Approve</button>
        <button class="reject-button" data-status="rejected" type="button">Reject</button>
        <button class="edit-button" id="reviewLaterCandidate" type="button">Review later</button>
      </div>
      <div class="queue-nav"><button id="previousCandidate" type="button">Previous</button><button id="playCandidate" type="button">Play chord</button><button id="nextCandidate" type="button">Next</button></div>
    </div>
  </div>`;
  byId("saveEdit").addEventListener("click", () => {
    voicing.chordName = byId<HTMLInputElement>("editName").value.trim() || voicing.chordName;
    voicing.moodTags = normalizedMoodTags(splitTags(byId<HTMLInputElement>("editMood").value));
    voicing.genreTags = normalizedStyleTags(splitTags(byId<HTMLInputElement>("editGenre").value));
    voicing.difficulty = Number(byId<HTMLSelectElement>("editDifficulty").value) as 1 | 2 | 3 | 4 | 5;
    voicing.description = byId<HTMLTextAreaElement>("editDescription").value.trim();
    saveCurrent(voicing); render();
  });
  reviewCard.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.status === "rejected") {
      const removed = voicing;
      if (hostedReview && hostedWorkspace?.records.some((record) => record.id === voicing.id)) {
        await hostedReview.reject(voicing.id); await refreshHostedWorkspace();
      } else if (!hostedReview) { rejectedShapes.add(exactVoicingKey(voicing)); chordRepository.rejectVoicing(voicing); }
      delete savedReviews[voicing.id];
      if (!hostedReview) approvedVault = approvedVault.filter((approved) => approved.id !== voicing.id);
      candidates.splice(currentIndex, 1);
      currentIndex = Math.min(currentIndex, Math.max(0, candidates.length - 1));
      batchStatus.textContent = `${voicing.chordName} was rejected and deleted from the review queue.`;
      audit("Rejected permanently", voicing.chordName); persistQueue();
      if (!hostedReview) setUndo(() => { rejectedShapes.delete(exactVoicingKey(removed)); candidates.splice(currentIndex, 0, removed); chordRepository.restoreRejectedVoicing(removed); persistQueue(); render(); });
      render();
      return;
    }
    if (button.dataset.status === "approved") {
      const guard = canApproveVoicing(voicing, [...CANONICAL_VOICINGS, ...approvedVault]);
      if (!guard.allowed) { batchStatus.textContent = guard.reason!; candidates.splice(currentIndex, 1); currentIndex = Math.min(currentIndex, candidates.length - 1); render(); return; }
    }
    if (!hostedReview) voicing.approvalStatus = button.dataset.status as ApprovalStatus;
    if (button.dataset.status === "approved") {
      if (hostedReview) { await hostedReview.preReview(voicing); await refreshHostedWorkspace(); }
      else { approvedVault = [...approvedVault.filter((approved) => approved.id !== voicing.id), voicing]; chordRepository.moveToPreReviewed(voicing); }
    }
    if (!hostedReview) saveCurrent(voicing); advance(1);
    audit("Moved to Pre-reviewed", voicing.chordName); persistQueue();
  }));
  byId("reviewLaterCandidate").addEventListener("click", () => { reviewLater.add(voicing.id); chordRepository.markReviewLater([voicing.id]); audit("Saved for later", voicing.chordName); advance(1); });
  byId("previousCandidate").addEventListener("click", () => advance(-1));
  byId("nextCandidate").addEventListener("click", () => advance(1));
  byId("playCandidate").addEventListener("click", () => play(voicing));
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function importedQuality(name: string, supplied?: unknown): string {
  if (typeof supplied === "string" && recipeById(supplied)) return recipeById(supplied)!.id;
  return recipeIdFromChordName(name);
}

function importedArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" ? value.split(/[ ,]+/).map((part) => part.trim()).filter(Boolean) : [];
}

function importHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}

function normalizeImportedVoicing(raw: Record<string, unknown>, index: number): ChordVoicing {
  const candidate = importRecordCandidate(raw, index);
  if ("schemaVersion" in candidate) {
    const validated = validatePersistedChord(candidate);
    if (!validated.ok) throw new Error(`Row ${index + 1}: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    return hydratePersistedChord({ ...validated.value, workflowStatus: "pre-reviewed" });
  }
  const chordName = String(raw.chordName ?? raw.name ?? "").trim();
  const root = String(raw.root ?? chordName.match(/^[A-G](?:#|b)?/)?.[0] ?? "").trim();
  if (!chordName || !root) throw new Error(`Row ${index + 1}: chord name or root is missing`);
  if (typeof raw.tuning === "object" && raw.tuning && "id" in raw.tuning && (raw.tuning as { id: string }).id !== STANDARD_TUNING.id) throw new Error(`Row ${index + 1}: unsupported tuning`);
  if (typeof raw.tuning === "string" && raw.tuning && raw.tuning !== STANDARD_TUNING.id) throw new Error(`Row ${index + 1}: unsupported tuning`);
  const rawFrets = Array.isArray(raw.fretPositions) ? raw.fretPositions : String(raw.fretPositions ?? "").split(/[ ,]+/).filter(Boolean);
  const fretPositions = rawFrets.map((value) => String(value).toLowerCase() === "x" || value === null || Number(value) < 0 ? null : Number(value));
  if (fretPositions.length !== 6 || fretPositions.some((fret) => fret !== null && (!Number.isInteger(fret) || fret < 0))) throw new Error(`Row ${index + 1}: invalid six-string fret pattern`);
  const chordQuality = importedQuality(chordName, raw.chordQuality);
  const recipe = recipeById(chordQuality);
  if (!recipe) throw new Error(`Row ${index + 1}: unknown chord recipe`);
  const fingers = Array.isArray(raw.fingerPositions) ? raw.fingerPositions : String(raw.fingerPositions ?? "").split(" ");
  const fingerPositions = fretPositions.map((fret, stringIndex) => fret && Number(fingers[stringIndex]) ? Number(fingers[stringIndex]) : null);
  const shapeKey = `${STANDARD_TUNING.id}|${root}|${chordQuality}|${fretPositions.map((fret) => fret ?? "x").join("-")}`;
  const legacyTags = importedArray(raw.descriptorTags);
  const descriptorTags = normalizedDescriptorTags(legacyTags);
  const moods = normalizedMoodTags([...importedArray(raw.moods), ...importedArray(raw.moodTags), ...legacyTags]);
  const styles = normalizedStyleTags([...importedArray(raw.styles), ...importedArray(raw.genreTags), ...legacyTags]);
  const persisted: PersistedChordRecordV1 = {
    schemaVersion: CHORD_SCHEMA_VERSION, id: String(raw.id || `imported_${importHash(shapeKey)}`), root,
    recipeId: recipe.id as PersistedChordRecordV1["recipeId"], tuning: STANDARD_TUNING, fretPositions, fingerPositions,
    displayNameOverride: chordName === `${root}${recipe.suffix}` ? undefined : chordName,
    description: String(raw.description ?? ""), difficulty: Math.max(1, Math.min(5, Number(raw.difficulty) || 3)) as 1 | 2 | 3 | 4 | 5,
    tags: descriptorTags, moods, styles, workflowStatus: "pre-reviewed", provenance: { source: "Imported file" },
  };
  const validated = validatePersistedChord(persisted);
  if (!validated.ok) throw new Error(`Row ${index + 1}: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  const hydrated = hydratePersistedChord(validated.value);
  if (recipe.requiredIntervals.filter((tone) => !recipe.permittedOmissions.includes(tone)).some((tone) => !hydrated.intervals.includes(tone))) throw new Error(`Row ${index + 1}: fingering does not produce ${chordName}`);
  return hydrated;
}

async function importApprovedFile(file: File): Promise<void> {
  const importStatus = byId("importStatus");
  try {
    const text = await file.text();
    const json = file.name.toLowerCase().endsWith(".csv") ? null : safeParseJson(text);
    if (json && !json.ok) throw new Error(json.issues[0].message);
    const parsed = file.name.toLowerCase().endsWith(".csv") ? parseCsvObjects(text) : json!.value as Record<string, unknown> | Record<string, unknown>[];
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.voicings) ? parsed.voicings : [parsed];
    if (repositoryCapabilities.backend === "hosted") {
      pendingImportRecords = records.map((raw, index) => {
        try {
          const candidate = importRecordCandidate(raw, index);
          return "schemaVersion" in candidate ? candidate : persistChordVoicing(normalizeImportedVoicing(raw, index), "pre-reviewed");
        } catch (error) { return { id: typeof raw.id === "string" ? raw.id : "", __importError: error instanceof Error ? error.message : `Row ${index + 1}: invalid record` }; }
      });
      const result = await previewEnrichmentImport(repositoryConfig.apiBase, pendingImportRecords);
      renderImportPreview(result.preview); importStatus.textContent = `${file.name}: preview ready. Nothing has been written yet.`; return;
    }
    const existingKeys = new Set(approvedVault.map(exactVoicingKey));
    let imported = 0; let duplicates = 0; let invalid = 0; const invalidReasons: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      try {
        const voicing = normalizeImportedVoicing(records[index], index);
        const key = exactVoicingKey(voicing);
        if (existingKeys.has(key)) { duplicates += 1; continue; }
        existingKeys.add(key); approvedVault.push(voicing); imported += 1;
      } catch (error) { invalid += 1; invalidReasons.push(error instanceof Error ? error.message : `Row ${index + 1}: invalid record`); }
    }
    chordRepository.importPreReviewed(approvedVault);
    const reasonSummary = invalidReasons.length ? ` ${invalidReasons.slice(0, 5).join(" | ")}${invalidReasons.length > 5 ? ` | +${invalidReasons.length - 5} more` : ""}` : "";
    importStatus.textContent = `${file.name}: ${imported} imported to Pre-reviewed, ${duplicates} duplicate, ${invalid} invalid.${reasonSummary}`;
    renderLibraryEditor();
  } catch (error) {
    importStatus.textContent = `Import failed: ${error instanceof Error ? error.message : "invalid file"}`;
  }
}

let pendingImportRecords: unknown[] = [];
const importPreview = byId("importPreview");
const importPreviewCounts = byId("importPreviewCounts");
const importPreviewRows = byId("importPreviewRows");
const applyImport = byId<HTMLButtonElement>("applyImport");
function renderImportPreview(preview: EnrichmentPreview): void {
  importPreview.hidden = false;
  importPreviewCounts.innerHTML = Object.entries(preview.counts).map(([label, count]) => `<span>${escapeHtml(label)}: ${count}</span>`).join("");
  const notable = preview.rows.filter((row) => row.classification !== "unchanged");
  importPreviewRows.innerHTML = notable.length ? notable.map((row) => `<li><strong>${escapeHtml(row.classification)}</strong> ${escapeHtml(row.id || `Row ${row.index + 1}`)}${row.changedFields.length ? ` - ${escapeHtml(row.changedFields.join(", "))}` : ""}${row.reasons.length ? ` - ${escapeHtml(row.reasons.join("; "))}` : ""}</li>`).join("") : "<li>Every record is unchanged.</li>";
  applyImport.disabled = preview.counts.new + preview.counts.update === 0;
  applyImport.textContent = `Apply ${preview.counts.new + preview.counts.update} changes`;
}

applyImport.addEventListener("click", async () => {
  applyImport.disabled = true; const importStatus = byId("importStatus"); importStatus.textContent = "Applying approved import changes...";
  try {
    const result = await applyEnrichmentImport(repositoryConfig.apiBase, pendingImportRecords); renderImportPreview(result.report.preview);
    if (hostedReview) { await refreshHostedWorkspace(); renderLibraryEditor(); renderCoverage(); }
    importStatus.textContent = `Applied ${result.report.applied.new} new chord${result.report.applied.new === 1 ? "" : "s"} and ${result.report.applied.updated} enrichment update${result.report.applied.updated === 1 ? "" : "s"}. Conflicts and invalid rows were not changed.`;
    pendingImportRecords = [];
  } catch (error) { importStatus.textContent = `Import failed: ${error instanceof Error ? error.message : "hosted import failed"}`; applyImport.disabled = false; }
});

const importFile = byId<HTMLInputElement>("importFile");
const importDropZone = byId("importDropZone");
importFile.addEventListener("change", () => { if (importFile.files?.[0]) void importApprovedFile(importFile.files[0]); });
for (const eventName of ["dragenter", "dragover"]) importDropZone.addEventListener(eventName, (event) => { event.preventDefault(); importDropZone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) importDropZone.addEventListener(eventName, (event) => { event.preventDefault(); importDropZone.classList.remove("dragging"); });
importDropZone.addEventListener("drop", (event) => { const file = (event as DragEvent).dataTransfer?.files[0]; if (file) void importApprovedFile(file); });
importDropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); importFile.click(); } });

function advance(direction: number): void {
  if (!candidates.length) return;
  currentIndex = (currentIndex + direction + candidates.length) % candidates.length;
  persistQueue(); render();
}

async function play(voicing: ChordVoicing): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  activeSources.forEach((source) => { try { source.stop(); } catch { /* The source may already be stopped. */ } });
  activeSources = [];
  voicing.fretPositions.forEach((fret, index) => {
    if (fret === null) return;
    const oscillator = audioContext!.createOscillator();
    const gain = audioContext!.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((voicing.tuning.strings[index].midi + fret - 69) / 12);
    gain.gain.setValueAtTime(0, audioContext!.currentTime);
    gain.gain.linearRampToValueAtTime(0.055, audioContext!.currentTime + index * 0.035 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext!.currentTime + 1.8);
    oscillator.connect(gain).connect(audioContext!.destination);
    oscillator.start(audioContext!.currentTime + index * 0.035);
    oscillator.stop(audioContext!.currentTime + 1.85);
    activeSources.push(oscillator);
  });
}

function recipe() { return RECIPES.find((item) => item.id === recipeSelect.value)!; }
function resultLimit(): number { return Math.max(10, Math.min(500, Number(retainInput.value) || 100)); }
function presetConfig(): { maxFretSpan: number; maxFrettedNotes: number; maxInternalMutedStrings: number; fretMin?: number; fretMax?: number; allowOpen?: boolean; minPlayedStrings?: number } {
  const preset = byId<HTMLSelectElement>("presetSelect").value;
  if (preset === "beginner") return { maxFretSpan: 3, maxFrettedNotes: 4, maxInternalMutedStrings: 0, fretMax: 5 };
  if (preset === "open") return { maxFretSpan: 4, maxFrettedNotes: 4, maxInternalMutedStrings: 1, fretMax: 7, allowOpen: true };
  if (preset === "jazz") return { maxFretSpan: 4, maxFrettedNotes: 4, maxInternalMutedStrings: 1, minPlayedStrings: 3 };
  if (preset === "movable") return { maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1, fretMin: 1, allowOpen: false };
  if (preset === "upper") return { maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1, fretMin: 5, fretMax: 12 };
  return { maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1 };
}
function retainReviewable(voicings: ChordVoicing[]): ChordVoicing[] { return voicings.filter((voicing) => !rejectedShapes.has(exactVoicingKey(voicing))); }
function rankWithDecisions(voicings: ChordVoicing[]): ChordVoicing[] {
  const decisions = [...approvedVault, ...publishedVault]; if (decisions.length < 5) return voicings;
  const frequency = (value: string) => decisions.filter((item) => `${item.fretSpan}|${item.openStringCount}|${item.difficulty}|${item.inversion}` === value).length / decisions.length;
  return [...voicings].sort((left, right) => {
    const preference = (item: ChordVoicing) => frequency(`${item.fretSpan}|${item.openStringCount}|${item.difficulty}|${item.inversion}`) * 20;
    return (right.qualityScore + preference(right)) - (left.qualityScore + preference(left));
  });
}

byId("generateOne").addEventListener("click", () => {
  const selected = recipe();
  const preset = presetConfig();
  batchStatus.textContent = "Generating candidates…";
  const generated = rankWithDecisions(rankWithCurationProfile(generateVoicings({
    tuning: STANDARD_TUNING, chordName: `${rootSelect.value}${selected.suffix}`, chordQuality: selected.id, root: rootSelect.value,
    requiredTones: [...selected.requiredIntervals], optionalTones: [...selected.optionalIntervals],
    ...preset,
    maxRawCandidates: 50_000, maxResults: resultLimit(), allowOmitFifth: true,
  }), APPROVED_C_PROFILE)).map(applySaved);
  const filtered = buildReviewQueue(generated, approvedVault, { qualityThreshold: 45 });
  candidates = retainReviewable(filtered.queue);
  currentIndex = 0;
  batchStatus.textContent = `${candidates.length} retained. Removed: ${exclusionSummary(filtered.excluded)}.`;
  persistQueue(); audit("Generated queue", `${rootSelect.value}${selected.suffix}`); render();
});

byId("generateBatch").addEventListener("click", async () => {
  const selected = recipe();
  const preset = presetConfig();
  batchStatus.textContent = "Generating and ranking thousands of raw candidates…";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const batch = generateBatch(ROOTS.map((root) => ({
    chordName: `${root}${selected.suffix}`, chordQuality: selected.id, root,
    requiredTones: [...selected.requiredIntervals], optionalTones: [...selected.optionalIntervals],
  })), {
    tuning: STANDARD_TUNING, ...preset,
    maxRawCandidates: 50_000, maxResults: resultLimit(), allowOmitFifth: true,
  }, resultLimit() * ROOTS.length);
  const ranked = rankWithDecisions(rankWithCurationProfile(batch.retained, APPROVED_C_PROFILE)).map(applySaved);
  const filtered = buildReviewQueue(ranked, approvedVault, { qualityThreshold: 45 });
  candidates = retainReviewable(filtered.queue);
  currentIndex = 0;
  const removed = Object.values(filtered.excluded).reduce((total, count) => total + count, 0);
  batchStatus.textContent = `${batch.rawCandidateCount.toLocaleString()} checked; ${candidates.length.toLocaleString()} retained; ${removed.toLocaleString()} removed (${exclusionSummary(filtered.excluded)}).`;
  persistQueue(); audit("Generated 12-root batch", selected.label); render();
});

function download(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exclusionSummary(counts: ReturnType<typeof buildReviewQueue>["excluded"]): string {
  return `canonical open ${counts.canonicalOpen}, canonical barre ${counts.canonicalBarre}, exact approved ${counts.exactApproved}, near approved ${counts.nearApproved}, below threshold ${counts.belowQualityThreshold}`;
}

const libraryGrid = byId("libraryEditorGrid");
const librarySourceTabs = byId("librarySourceTabs");
const libraryPrevious = byId<HTMLButtonElement>("libraryPrevious");
const libraryNext = byId<HTMLButtonElement>("libraryNext");
const libraryPageStatus = byId("libraryPageStatus");

function approvedLibraryItems(): LibraryItem[] {
  return approvedVault.map((voicing) => ({
    key: voicing.id, name: voicing.chordName, difficulty: voicing.difficulty, source: "Pre-reviewed",
    frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
    descriptorTags: normalizedDescriptorTags(voicing.descriptorTags ?? []), moods: normalizedMoodTags(voicing.moodTags), styles: normalizedStyleTags(voicing.genreTags),
  }));
}

function allLibraryItems(): LibraryItem[] {
  const items = [...publicLibrary, ...approvedLibraryItems()];
  if (activeLibrarySource === "All") return items;
  if (activeLibrarySource === "Review later") return items.filter((item) => reviewLater.has(item.key));
  if (activeLibrarySource === "Needs attention") return items.filter((item) => {
    const edited = editedLibraryItem(item); const fretted = (item.frets ?? []).filter((fret) => fret > 0);
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    return !item.fingers?.some(Boolean) || !edited.descriptorTags.length || span > 4 || edited.difficulty < 1;
  });
  return items.filter((item) => item.source === activeLibrarySource);
}

function editedLibraryItem(item: LibraryItem): LibraryItem {
  const edit = libraryEdits[item.key];
  return { ...item, difficulty: edit?.difficulty ?? item.difficulty, descriptorTags: normalizedDescriptorTags(edit?.descriptorTags ?? item.descriptorTags), moods: normalizedMoodTags(edit?.moods ?? item.moods), styles: normalizedStyleTags(edit?.styles ?? item.styles) };
}

function tagVocabulary(): string[] {
  return [...STRUCTURAL_TAGS, ...MOOD_TAGS, ...STYLE_TAGS];
}

function persistLibraryEdit(item: LibraryItem, update: { difficulty?: number; descriptorTags?: string[]; moods?: MoodTag[]; styles?: StyleTag[] }): void {
  libraryEdits[item.key] = { ...libraryEdits[item.key], ...update };
  if (!hostedReview) chordRepository.updateEditorialFields(item.key, update);
  const approved = approvedVault.find((voicing) => voicing.id === item.key);
  if (approved) {
    if (update.difficulty !== undefined) approved.difficulty = update.difficulty as 1 | 2 | 3 | 4 | 5;
    if (update.descriptorTags) approved.descriptorTags = update.descriptorTags;
    if (update.moods) approved.moodTags = update.moods;
    if (update.styles) approved.genreTags = update.styles;
  }
}

async function saveLibraryEdit(item: LibraryItem, card: HTMLElement): Promise<void> {
  const button = card.querySelector<HTMLButtonElement>(".library-save-button");
  const status = card.querySelector<HTMLElement>(".library-save-status");
  if (!button || !status) return;
  button.disabled = true;
  status.textContent = "Saving...";
  try {
    const edited = editedLibraryItem(item);
    const changes = { difficulty: edited.difficulty, tags: edited.descriptorTags, moods: edited.moods, styles: edited.styles };
    if (hostedReview) {
      if (item.source === "Main Vault") await hostedReview.edit(item.key, changes);
      else await hostedReview.editPreReviewed(item.key, changes);
      delete libraryEdits[item.key];
      await refreshHostedWorkspace();
      status.textContent = item.source === "Main Vault" ? "Saved to Main Vault" : "Saved to Pre-reviewed";
      renderLibraryEditor(); renderCoverage();
    } else if (item.source === "Main Vault") {
      status.textContent = "Saved to Main Vault";
    } else {
      status.textContent = "Saved in workspace";
    }
  } catch {
    status.textContent = "Could not save. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function libraryDiagram(item: LibraryItem): string {
  if (!item.frets?.length) return `<p class="library-chart-unavailable">Chart unavailable</p>`;
  const xs = [24, 48, 72, 96, 120, 144];
  const played = item.frets.filter((fret) => fret > 0);
  const baseFret = Math.max(...played, 1) > 5 ? Math.min(...played) : 1;
  const higher = baseFret > 1;
  const strings = xs.map((x) => `<line x1="${x}" y1="34" x2="${x}" y2="159" class="grid-line"/>`).join("");
  const fretLines = [34, 59, 84, 109, 134, 159].map((y, index) => `<line x1="24" y1="${y}" x2="144" y2="${y}" class="grid-line${index === 0 && !higher ? " nut" : ""}"/>`).join("");
  const marks = item.frets.map((fret, index) => fret < 0
    ? `<text x="${xs[index]}" y="22" class="marker">×</text>`
    : fret === 0 ? `<circle cx="${xs[index]}" cy="16" r="5" class="grid-line" fill="none"/>`
      : `<circle cx="${xs[index]}" cy="${46.5 + (fret - baseFret) * 25}" r="9" class="finger"/><text x="${xs[index]}" y="${50 + (fret - baseFret) * 25}" class="finger-text">${item.fingers?.[index] ?? ""}</text>`).join("");
  const labels = ["E", "A", "D", "G", "B", "e"].map((label, index) => `<text x="${xs[index]}" y="184" class="label">${label}</text>`).join("");
  return `<svg class="library-chord-diagram review-diagram" viewBox="0 0 184 190" role="img" aria-label="${escapeHtml(item.name)} chord diagram">${fretLines}${strings}${marks}${labels}</svg>`;
}

const emptyScore = { harmonicCompleteness: 0, playability: 0, usefulBass: 0, openStrings: 0, extensions: 0, uniqueness: 0, fretSpanPenalty: 0, muddyIntervalPenalty: 0, duplicateNotePenalty: 0 };

function libraryItemVoicing(item: LibraryItem): ChordVoicing {
  const frets = (item.frets ?? []).map((fret) => fret < 0 ? null : fret);
  const root = item.root ?? item.name.match(/^[A-G](?:#|b)?/)?.[0] ?? "C";
  const pitches = pitchesForVoicing(STANDARD_TUNING, frets);
  const bass = bassPitch(pitches);
  return {
    id: item.key, slug: item.key, chordName: item.name, chordQuality: item.chordQuality ?? importedQuality(item.name), root,
    tuning: STANDARD_TUNING, fretPositions: frets, fingerPositions: (item.fingers ?? []).map((finger) => Number(finger) || null),
    notes: pitches.map((pitch) => pitch.note), intervals: intervalsRelativeToRoot(pitches, root), bassNote: bass?.note ?? "",
    inversion: inversionForPitches(pitches, root), alternateNames: [], fretSpan: fretSpanFor(frets),
    openStringCount: frets.filter((fret) => fret === 0).length, difficulty: item.difficulty as 1 | 2 | 3 | 4 | 5,
    moodTags: item.moods, genreTags: item.styles, descriptorTags: item.descriptorTags, description: "", qualityScore: 0,
    scoreBreakdown: emptyScore, approvalStatus: "approved", possibleBarres: [],
  };
}

function mainVaultVoicings(): ChordVoicing[] {
  if (hostedReview) return [...publishedVault];
  const items = publicLibrary.filter((item) => finalApprovedKeys.has(item.key)).map((item) =>
    CANONICAL_VOICINGS.find((voicing) => voicing.id === item.key) ?? libraryItemVoicing(editedLibraryItem(item)));
  return [...items, ...publishedVault];
}

function duplicateCard(label: string, voicing: ChordVoicing): string {
  const item: LibraryItem = { key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality,
    difficulty: voicing.difficulty, descriptorTags: voicing.descriptorTags ?? [], moods: voicing.moodTags, styles: voicing.genreTags,
    frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""), source: "Main Vault" };
  return `<article class="duplicate-card"><span>${label}</span><h3>${escapeHtml(voicing.chordName)}</h3>${libraryDiagram(item)}
    <dl><div><dt>Frets</dt><dd>${voicing.fretPositions.map((fret) => fret ?? "x").join(" · ")}</dd></div><div><dt>Notes</dt><dd>${voicing.notes.join(" · ")}</dd></div><div><dt>Inversion</dt><dd>${escapeHtml(voicing.inversion)}</dd></div><div><dt>Difficulty</dt><dd>${voicing.difficulty} / 5</dd></div></dl></article>`;
}

const duplicateDialog = byId<HTMLDialogElement>("duplicateDialog");
let pendingDuplicatePublish: (() => Promise<void>) | null = null;
let pendingDuplicatePair: { candidate: ChordVoicing; match: ChordVoicing; status: PersistedChordRecordV1["workflowStatus"] } | null = null;

async function hostedDuplicate(candidate: ChordVoicing): Promise<{ match: ChordVoicing; similarity: number; exact: boolean; status: PersistedChordRecordV1["workflowStatus"] } | null> {
  const response = await fetch("/api/admin/chords/duplicate", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(persistChordVoicing(candidate, "pre-reviewed")) });
  const payload = await response.json() as { duplicate?: { record: PersistedChordRecordV1; similarity: number; exact: boolean } | null; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Duplicate check failed with status ${response.status}`);
  return payload.duplicate ? { match: hydratePersistedChord(payload.duplicate.record), similarity: payload.duplicate.similarity, exact: payload.duplicate.exact, status: payload.duplicate.record.workflowStatus } : null;
}

async function requestPublish(candidate: ChordVoicing, publish: () => Promise<void>): Promise<void> {
  const localDuplicate = findVoicingDuplicate(candidate, mainVaultVoicings());
  const duplicate = repositoryCapabilities.backend === "hosted"
    ? await hostedDuplicate(candidate)
    : localDuplicate ? { ...localDuplicate, status: "published" as const } : null;
  if (!duplicate) { await publish(); return; }
  pendingDuplicatePublish = publish;
  pendingDuplicatePair = { candidate, match: duplicate.match, status: duplicate.status };
  byId("duplicateSummary").textContent = duplicate.exact
    ? "These fret positions already exist in the Main Vault. Compare them before continuing."
    : `This voicing is ${duplicate.similarity}% similar to one in the Main Vault. Compare them before continuing.`;
  byId("duplicateComparison").innerHTML = duplicateCard("Chord being approved", candidate) + duplicateCard("Existing Main Vault chord", duplicate.match);
  duplicateDialog.showModal();
}

function closeDuplicateDialog(): void { pendingDuplicatePublish = null; pendingDuplicatePair = null; duplicateDialog.close(); }
byId("closeDuplicate").addEventListener("click", closeDuplicateDialog);
byId("keepExisting").addEventListener("click", async () => {
  const pair = pendingDuplicatePair;
  try {
    if (pair && hostedReview && pair.status !== "published") {
      if (pair.status === "rejected") await hostedReview.restore(pair.match.id);
      await hostedReview.publish(pair.match); await refreshHostedWorkspace();
      batchStatus.textContent = `${pair.match.chordName} was restored to the Main Vault.`;
    }
    closeDuplicateDialog(); renderLibraryEditor(); renderCoverage();
  } catch (error) { batchStatus.textContent = error instanceof Error ? error.message : "Could not resolve duplicate."; }
});
byId("publishDuplicate").addEventListener("click", () => { const publish = pendingDuplicatePublish; pendingDuplicatePublish = null; duplicateDialog.close(); void publish?.(); });
byId("mergeDuplicate").addEventListener("click", async () => {
  const pair = pendingDuplicatePair; if (!pair) return;
  const mergedTags = [...new Set([...(pair.match.descriptorTags ?? []), ...(pair.candidate.descriptorTags ?? [])])];
  const mergedMoods = [...new Set([...pair.match.moodTags, ...pair.candidate.moodTags])];
  const mergedStyles = [...new Set([...pair.match.genreTags, ...pair.candidate.genreTags])];
  try {
    if (hostedReview) { await hostedReview.merge(pair.match.id, pair.candidate); await refreshHostedWorkspace(); }
    else {
      const published = publishedVault.find((item) => item.id === pair.match.id);
      if (published) { published.descriptorTags = mergedTags; published.moodTags = mergedMoods; published.genreTags = mergedStyles; published.description ||= pair.candidate.description; }
      else libraryEdits[pair.match.id] = { ...libraryEdits[pair.match.id], descriptorTags: mergedTags, moods: mergedMoods, styles: mergedStyles };
      chordRepository.mergeVoicings(pair.match.id, pair.candidate);
    }
    audit("Merged duplicate metadata", pair.candidate.chordName); closeDuplicateDialog(); renderLibraryEditor(); renderCoverage();
  } catch (error) { batchStatus.textContent = error instanceof Error ? error.message : "Could not merge duplicate."; }
});
byId("replaceDuplicate").addEventListener("click", async () => {
  const pair = pendingDuplicatePair; const publish = pendingDuplicatePublish; if (!pair || !publish) return;
  try {
    if (hostedReview) { await hostedReview.replace(pair.match.id, pair.candidate); await refreshHostedWorkspace(); }
    else { chordRepository.replacePublishedVoicing(pair.match.id, pair.candidate); await publish(); }
    pendingDuplicatePublish = null; pendingDuplicatePair = null; duplicateDialog.close(); audit("Replaced duplicate", pair.candidate.chordName); renderLibraryEditor(); renderCoverage();
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message) && repositoryCapabilities.backend === "hosted") {
      closeDuplicateDialog(); await publish();
    } else batchStatus.textContent = error instanceof Error ? error.message : "Could not replace duplicate.";
  }
});
duplicateDialog.addEventListener("cancel", () => { pendingDuplicatePublish = null; });

function renderLibraryEditor(): void {
  const items = allLibraryItems();
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  if (libraryPage >= pageCount) libraryPage = pageCount - 1;
  const visible = items.slice(libraryPage * pageSize, libraryPage * pageSize + pageSize).map(editedLibraryItem);
  libraryGrid.innerHTML = visible.length ? visible.map((item) => {
    const encodedKey = encodeURIComponent(item.key);
    const tagEditor = (label: string, kind: "descriptorTags" | "moods" | "styles", values: readonly string[], vocabulary: readonly string[]) => {
      const addable = vocabulary.filter((tag) => !values.includes(tag));
      return `<div class="editable-tag-group"><span class="editable-tag-label">${label}</span><div class="editable-tags">${values.map((tag) => `<button class="editable-tag" type="button" data-tag-kind="${kind}" data-remove-tag="${encodeURIComponent(tag)}" aria-label="Remove ${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><b>×</b></button>`).join("")}
      <button class="add-tag-button" data-tag-kind="${kind}" type="button" aria-label="Add ${label.toLowerCase()} tag to ${escapeHtml(item.name)}">+</button>
      <select class="tag-picker" data-tag-kind="${kind}" aria-label="Choose ${label.toLowerCase()} tag" hidden><option value="">Choose tag</option>${addable.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}</select></div></div>`;
    };
    return `<article class="library-edit-card" data-library-key="${encodedKey}" data-library-source="${item.source}">
      <div class="library-edit-card-header"><div><label class="library-select"><input type="checkbox" class="library-select-box"${selectedLibraryKeys.has(item.key) ? " checked" : ""}/> Select</label><span class="library-source-label">${item.source}</span><h3>${escapeHtml(item.name)}</h3></div>
      <select class="library-difficulty" aria-label="Difficulty for ${escapeHtml(item.name)}">${[1,2,3,4,5].map((level) => `<option value="${level}"${level === item.difficulty ? " selected" : ""}>${level} / 5</option>`).join("")}</select></div>
      ${libraryDiagram(item)}
      <div class="editable-tag-groups">${tagEditor("Chord type", "descriptorTags", item.descriptorTags, STRUCTURAL_TAGS)}${tagEditor("Mood", "moods", item.moods, MOOD_TAGS)}${tagEditor("Style", "styles", item.styles, STYLE_TAGS)}</div>
      <div class="library-card-actions"><button class="library-play-button" type="button" aria-label="Play ${escapeHtml(item.name)} chord">Play chord</button><button class="library-save-button" type="button">Save changes</button></div>
      <span class="library-save-status" role="status" aria-live="polite"></span>
      ${item.source === "Pre-reviewed" || item.source === "Unapproved" ? `<button class="final-approve-button" type="button">Final approve <span>+</span></button>` : `<span class="published-label">Already in Main Vault</span>`}
    </article>`;
  }).join("") : `<p class="library-empty">No chords are available in this view.</p>`;
  libraryPageStatus.textContent = `Page ${libraryPage + 1} of ${pageCount}`;
  libraryPrevious.disabled = libraryPage === 0;
  libraryNext.disabled = libraryPage >= pageCount - 1;
}

function itemForCard(card: HTMLElement): LibraryItem | undefined {
  const key = decodeURIComponent(card.dataset.libraryKey ?? "");
  const source = card.dataset.librarySource;
  return allLibraryItems().find((item) => item.key === key && item.source === source);
}

libraryGrid.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const card = target.closest<HTMLElement>("[data-library-key]");
  if (!card) return;
  const item = itemForCard(card);
  if (!item) return;
  if (target instanceof HTMLInputElement && target.classList.contains("library-select-box")) { if (target.checked) selectedLibraryKeys.add(item.key); else selectedLibraryKeys.delete(item.key); return; }
  if (target.classList.contains("library-difficulty")) persistLibraryEdit(item, { difficulty: Number(target.value) });
  if (target.classList.contains("tag-picker") && target.value) {
    const edited = editedLibraryItem(item);
    const kind = target.dataset.tagKind;
    if (kind === "moods") persistLibraryEdit(item, { moods: normalizedMoodTags([...edited.moods, target.value]) });
    else if (kind === "styles") persistLibraryEdit(item, { styles: normalizedStyleTags([...edited.styles, target.value]) });
    else persistLibraryEdit(item, { descriptorTags: normalizedDescriptorTags([...edited.descriptorTags, target.value]) });
    renderLibraryEditor();
    const updatedCard = [...libraryGrid.querySelectorAll<HTMLElement>("[data-library-key]")].find((candidate) => decodeURIComponent(candidate.dataset.libraryKey ?? "") === item.key);
    const updatedPicker = updatedCard?.querySelector<HTMLSelectElement>(`.tag-picker[data-tag-kind="${kind}"]`);
    if (updatedPicker) { updatedPicker.hidden = false; updatedPicker.focus(); }
  }
});

libraryGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  const card = button.closest<HTMLElement>("[data-library-key]");
  if (!card) return;
  const item = itemForCard(card);
  if (!item) return;
  if (button.classList.contains("add-tag-button")) {
    const picker = card.querySelector<HTMLSelectElement>(`.tag-picker[data-tag-kind="${button.dataset.tagKind}"]`)!;
    picker.hidden = !picker.hidden;
    if (!picker.hidden) picker.focus();
  }
  if (button.classList.contains("library-play-button")) {
    void play(libraryItemVoicing(editedLibraryItem(item)));
    return;
  }
  if (button.classList.contains("library-save-button")) {
    void saveLibraryEdit(item, card);
    return;
  }
  if (button.dataset.removeTag) {
    const remove = decodeURIComponent(button.dataset.removeTag);
    const edited = editedLibraryItem(item);
    if (button.dataset.tagKind === "moods") persistLibraryEdit(item, { moods: edited.moods.filter((tag) => tag !== remove) });
    else if (button.dataset.tagKind === "styles") persistLibraryEdit(item, { styles: edited.styles.filter((tag) => tag !== remove) });
    else persistLibraryEdit(item, { descriptorTags: edited.descriptorTags.filter((tag) => tag !== remove) });
    renderLibraryEditor();
  }
  if (button.classList.contains("final-approve-button")) {
    const status = card.querySelector<HTMLElement>(".library-save-status");
    button.disabled = true; button.textContent = "Publishing..."; if (status) status.textContent = "Checking for duplicates...";
    if (item.source === "Unapproved") {
      const candidate = libraryItemVoicing(editedLibraryItem(item));
      void requestPublish(candidate, async () => {
        if (hostedReview) { await hostedReview.preReview(candidate); await hostedReview.publish(candidate); await refreshHostedWorkspace(); }
        else chordRepository.approvePublicVoicing(item.key);
        finalApprovedKeys.add(item.key);
        const stored = publicLibrary.find((publicItem) => publicItem.key === item.key);
        if (stored) stored.source = "Main Vault";
        batchStatus.textContent = `${item.name} was moved to the Main Vault. Refresh the public page to view it.`;
        audit("Final approved", item.name); renderLibraryEditor(); renderCoverage();
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not publish chord.";
        batchStatus.textContent = message; if (status) status.textContent = message; button.disabled = false; button.textContent = "Final approve +";
      });
      return;
    }
    const voicing = approvedVault.find((approved) => approved.id === item.key);
    if (!voicing) return;
    const edited = editedLibraryItem(item);
    voicing.difficulty = edited.difficulty as 1 | 2 | 3 | 4 | 5;
    voicing.descriptorTags = edited.descriptorTags;
    voicing.moodTags = edited.moods;
    voicing.genreTags = edited.styles;
    void requestPublish(voicing, async () => {
      let publishedVoicing = voicing;
      if (hostedReview) { await hostedReview.publish(voicing); await refreshHostedWorkspace(); publishedVoicing = publishedVault.find((item) => item.id === voicing.id) ?? voicing; }
      else chordRepository.publishVoicing(voicing);
      if (!hostedReview) publishedVoicing.approvalStatus = "approved";
      if (!hostedReview) {
        publishedVault = [...publishedVault.filter((published) => published.id !== publishedVoicing.id), publishedVoicing];
        finalApprovedKeys.add(publishedVoicing.id);
        approvedVault = approvedVault.filter((approved) => approved.id !== publishedVoicing.id);
      }
      batchStatus.textContent = `${publishedVoicing.chordName} was published to the Main Vault. Refresh the public page to view it.`;
      audit("Final approved", publishedVoicing.chordName); renderLibraryEditor(); renderCoverage();
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Could not publish chord.";
      batchStatus.textContent = message; if (status) status.textContent = message; button.disabled = false; button.textContent = "Final approve +";
    });
  }
});

librarySourceTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-library-source]");
  if (!button) return;
  activeLibrarySource = button.dataset.librarySource!; libraryPage = 0;
  librarySourceTabs.querySelectorAll<HTMLButtonElement>("[data-library-source]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderLibraryEditor();
});
libraryPrevious.addEventListener("click", () => { libraryPage = Math.max(0, libraryPage - 1); renderLibraryEditor(); });
libraryNext.addEventListener("click", () => { libraryPage += 1; renderLibraryEditor(); });
renderLibraryEditor();

function renderCoverage(): void {
  const roots = ROOTS; const qualities = ["major", "minor", "dom7", "maj7", "min7"];
  const main = mainVaultVoicings();
  byId("coverageBody").innerHTML = roots.map((root) => {
    const count = (predicate: (voicing: ChordVoicing) => boolean) => main.filter((voicing) => voicing.root === root && predicate(voicing)).length;
    const cells = qualities.map((quality) => count((voicing) => voicing.chordQuality === quality));
    const sus = count((voicing) => voicing.chordQuality === "sus2" || voicing.chordQuality === "sus4");
    const extensions = count((voicing) => ![...qualities, "sus2", "sus4"].includes(voicing.chordQuality ?? ""));
    return `<tr><th>${root}</th>${[...cells, sus, extensions].map((value) => `<td class="${value ? "covered" : "missing"}">${value}</td>`).join("")}</tr>`;
  }).join("");
}
function renderAudit(): void { const target = document.getElementById("auditList"); if (target) target.innerHTML = auditLog.slice(0, 12).map((entry) => `<li><strong>${escapeHtml(entry.action)}</strong> ${escapeHtml(entry.chord)} <time>${new Date(entry.at).toLocaleString()}</time></li>`).join("") || "<li>No activity yet.</li>"; }

const bulkTag = byId<HTMLSelectElement>("bulkTag");
bulkTag.innerHTML += tagVocabulary().map((tag) => `<option>${escapeHtml(tag)}</option>`).join("");
byId<HTMLInputElement>("selectVisible").addEventListener("change", (event) => { const checked = (event.target as HTMLInputElement).checked; libraryGrid.querySelectorAll<HTMLInputElement>(".library-select-box").forEach((box) => { box.checked = checked; const card = box.closest<HTMLElement>("[data-library-key]"); if (!card) return; const key = decodeURIComponent(card.dataset.libraryKey!); if (checked) selectedLibraryKeys.add(key); else selectedLibraryKeys.delete(key); }); });
byId<HTMLSelectElement>("bulkDifficulty").addEventListener("change", (event) => { const level = Number((event.target as HTMLSelectElement).value); if (!level) return; [...publicLibrary, ...approvedLibraryItems()].filter((item) => selectedLibraryKeys.has(item.key)).forEach((item) => persistLibraryEdit(item, { difficulty: level })); audit("Bulk difficulty edit", `${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
bulkTag.addEventListener("change", () => { if (!bulkTag.value) return; [...publicLibrary, ...approvedLibraryItems()].filter((item) => selectedLibraryKeys.has(item.key)).forEach((item) => { const edited = editedLibraryItem(item); if (normalizedMoodTags([bulkTag.value]).length) persistLibraryEdit(item, { moods: normalizedMoodTags([...edited.moods, bulkTag.value]) }); else if (normalizedStyleTags([bulkTag.value]).length) persistLibraryEdit(item, { styles: normalizedStyleTags([...edited.styles, bulkTag.value]) }); else persistLibraryEdit(item, { descriptorTags: normalizedDescriptorTags([...edited.descriptorTags, bulkTag.value]) }); }); audit("Bulk tag added", `${bulkTag.value} to ${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
byId("bulkLater").addEventListener("click", () => { selectedLibraryKeys.forEach((key) => reviewLater.add(key)); chordRepository.markReviewLater([...selectedLibraryKeys]); audit("Bulk saved for later", `${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
byId("bulkApprove").addEventListener("click", () => { const first = libraryGrid.querySelector<HTMLButtonElement>("[data-library-key] .library-select-box:checked")?.closest<HTMLElement>("[data-library-key]")?.querySelector<HTMLButtonElement>(".final-approve-button"); if (first) { batchStatus.textContent = "Approving selected chords one at a time so duplicate checks are preserved."; first.click(); } });

byId("undoAction").addEventListener("click", () => { const action = undoAction; undoAction = null; byId<HTMLButtonElement>("undoAction").disabled = true; action?.(); audit("Undid last action", "workspace"); });
byId("backupWorkflow").addEventListener("click", () => {
  if (!hostedReview) { download(chordRepository.exportBackup(), `chord-vault-workspace-${new Date().toISOString().slice(0,10)}.json`, "application/json"); return; }
  void fetch(`${repositoryConfig.apiBase.replace(/\/$/, "")}/admin/chords/export?format=json`, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(async (response) => { if (!response.ok) throw new Error(`Backup failed with status ${response.status}`); download(await response.text(), `chord-vault-export-${new Date().toISOString().slice(0,10)}.json`, "application/json"); })
    .catch((error: unknown) => { batchStatus.textContent = error instanceof Error ? error.message : "Could not export the hosted chord library."; });
});
document.addEventListener("keydown", (event) => { if ((event.target as HTMLElement).matches("input,textarea,select") || duplicateDialog.open) return; const key = event.key.toLowerCase(); if (key === "a") reviewCard.querySelector<HTMLButtonElement>('[data-status="approved"]')?.click(); if (key === "r") reviewCard.querySelector<HTMLButtonElement>('[data-status="rejected"]')?.click(); if (key === "l") document.getElementById("reviewLaterCandidate")?.click(); if (key === "arrowleft") advance(-1); if (key === "arrowright") advance(1); if (key === " ") { event.preventDefault(); document.getElementById("playCandidate")?.click(); } });
renderCoverage(); renderAudit(); render();

const themeToggle = byId("themeToggle");
function updateThemeLabel(): void { themeToggle.textContent = document.documentElement.dataset.theme === "light" ? "☾ Dark" : "☼ Light"; }
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("chord-vault-theme", next); updateThemeLabel();
});
updateThemeLabel();
