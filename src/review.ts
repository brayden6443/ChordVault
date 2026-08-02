import { approvedCsv, approvedJson } from "./chords/export.ts";
import { APPROVED_C_PROFILE, rankWithCurationProfile } from "./chords/curation.ts";
import { buildReviewQueue, canApproveVoicing, findVoicingDuplicate } from "./chords/repository.ts";
import { CANONICAL_VOICINGS } from "./chords/canonical.ts";
import { generateBatch, generateVoicings } from "./chords/generator.ts";
import { bassPitch, intervalLabel, intervalsRelativeToRoot, inversionForPitches, pitchesForVoicing } from "./chords/theory.ts";
import { fretSpanFor } from "./chords/playability.ts";
import { exactVoicingKey } from "./chords/identity.ts";
import { STANDARD_TUNING, type ApprovalStatus, type ChordVoicing } from "./chords/types.ts";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const RECIPES = [
  { id: "major", label: "Major", suffix: "", requiredTones: [0, 4, 7], optionalTones: [] },
  { id: "minor", label: "Minor", suffix: "m", requiredTones: [0, 3, 7], optionalTones: [] },
  { id: "sus2", label: "Suspended 2", suffix: "sus2", requiredTones: [0, 2, 7], optionalTones: [] },
  { id: "sus4", label: "Suspended 4", suffix: "sus4", requiredTones: [0, 5, 7], optionalTones: [] },
  { id: "maj7", label: "Major 7", suffix: "maj7", requiredTones: [0, 4, 11], optionalTones: [7] },
  { id: "dom7", label: "Dominant 7", suffix: "7", requiredTones: [0, 4, 10], optionalTones: [7] },
  { id: "min7", label: "Minor 7", suffix: "m7", requiredTones: [0, 3, 10], optionalTones: [7] },
  { id: "maj9", label: "Major 9", suffix: "maj9", requiredTones: [0, 4, 11], optionalTones: [2, 7] },
  { id: "min11", label: "Minor 11", suffix: "m11", requiredTones: [0, 3, 10], optionalTones: [2, 5, 7] },
];

type SavedReview = Pick<ChordVoicing, "approvalStatus" | "chordName" | "moodTags" | "genreTags" | "description" | "difficulty" | "descriptorTags">;
const savedReviews: Record<string, SavedReview> = JSON.parse(localStorage.getItem("chord-vault-reviews") ?? "{}");
let approvedVault: ChordVoicing[] = JSON.parse(localStorage.getItem("chord-vault-approved-voicings") ?? "[]");
let publishedVault: ChordVoicing[] = JSON.parse(localStorage.getItem("chord-vault-published-voicings") ?? "[]");
interface LibraryItem { key: string; name: string; root?: string; chordQuality?: string; difficulty: number; descriptorTags: string[]; frets?: number[]; fingers?: string[]; source: "Main Vault" | "Pre-reviewed" | "Unapproved"; }
const finalApprovedKeys = new Set<string>(JSON.parse(localStorage.getItem("chord-vault-final-approved-keys") ?? "[]"));
const fallbackPublicLibrary: LibraryItem[] = CANONICAL_VOICINGS.map((voicing) => ({
  key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality, difficulty: voicing.difficulty, source: "Main Vault",
  frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
  descriptorTags: [voicing.displayPriority === 1 ? "Essential" : "", voicing.category === "Essential Open" ? "Open" : "Barre", voicing.movable ? "Movable" : ""].filter(Boolean),
}));
const publicLibrary: LibraryItem[] = (JSON.parse(localStorage.getItem("chord-vault-public-library") ?? "null") ?? fallbackPublicLibrary)
  .map((item: LibraryItem) => ({ ...item, source: finalApprovedKeys.has(item.key) ? "Main Vault" : "Unapproved" }));
const libraryEdits: Record<string, { difficulty?: number; descriptorTags?: string[] }> = JSON.parse(localStorage.getItem("chord-vault-library-edits") ?? "{}");
let activeLibrarySource = "All";
let libraryPage = 0;
let candidates: ChordVoicing[] = [];
let currentIndex = Number(localStorage.getItem("chord-vault-review-index") ?? 0);
const rejectedShapes = new Set<string>(JSON.parse(localStorage.getItem("chord-vault-rejected-shapes") ?? "[]"));
const reviewLater = new Set<string>(JSON.parse(localStorage.getItem("chord-vault-review-later") ?? "[]"));
const auditLog: Array<{ at: string; action: string; chord: string }> = JSON.parse(localStorage.getItem("chord-vault-audit-log") ?? "[]");
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

try { candidates = JSON.parse(sessionStorage.getItem("chord-vault-active-queue") ?? "[]"); } catch { candidates = []; }

function persistQueue(): void {
  sessionStorage.setItem("chord-vault-active-queue", JSON.stringify(candidates));
  localStorage.setItem("chord-vault-review-index", String(currentIndex));
}
function audit(action: string, chord: string): void {
  auditLog.unshift({ at: new Date().toISOString(), action, chord }); auditLog.splice(100);
  localStorage.setItem("chord-vault-audit-log", JSON.stringify(auditLog)); void mirrorWorkspaceToDatabase(); renderAudit();
}
function setUndo(action: () => void): void { undoAction = action; byId<HTMLButtonElement>("undoAction").disabled = false; }
function mirrorWorkspaceToDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.open("chord-vault-workspace", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots"); };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const transaction = request.result.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put({ version: 1, savedAt: new Date().toISOString(), approvedVault, publishedVault, finalApprovedKeys: [...finalApprovedKeys], rejectedShapes: [...rejectedShapes], reviewLater: [...reviewLater], auditLog, libraryEdits }, "current");
      transaction.oncomplete = () => { request.result.close(); resolve(); }; transaction.onerror = () => resolve();
    };
  });
}

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
  localStorage.setItem("chord-vault-reviews", JSON.stringify(savedReviews));
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
    byId(`${status}Count`).textContent = String(candidates.filter((candidate) => candidate.approvalStatus === status).length);
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
      <div class="score-line"><span>Profile-adjusted score</span><strong>${voicing.qualityScore}</strong></div>
      <div class="detail-grid">
        <div><span>Notes</span><strong>${voicing.notes.join(" · ")}</strong></div>
        <div><span>Intervals</span><strong>${voicing.intervals.map(intervalLabel).join(" · ")}</strong></div>
        <div><span>Bass</span><strong>${voicing.bassNote}</strong></div>
        <div><span>Inversion</span><strong>${voicing.inversion}</strong></div>
        <div><span>Frets</span><strong>${voicing.fretPositions.map((fret) => fret ?? "×").join(" · ")}</strong></div>
        <div><span>Difficulty</span><strong>${voicing.difficulty} / 5</strong></div>
        <div><span>Theory score</span><strong>${voicing.generatorQualityScore ?? voicing.qualityScore}</strong></div>
        <div><span>C taste fit</span><strong>${voicing.curationFitScore ?? 0} / 100</strong></div>
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
    voicing.moodTags = splitTags(byId<HTMLInputElement>("editMood").value);
    voicing.genreTags = splitTags(byId<HTMLInputElement>("editGenre").value);
    voicing.difficulty = Number(byId<HTMLSelectElement>("editDifficulty").value) as 1 | 2 | 3 | 4 | 5;
    voicing.description = byId<HTMLTextAreaElement>("editDescription").value.trim();
    saveCurrent(voicing); render();
  });
  reviewCard.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.status === "rejected") {
      const removed = voicing;
      rejectedShapes.add(exactVoicingKey(voicing)); localStorage.setItem("chord-vault-rejected-shapes", JSON.stringify([...rejectedShapes]));
      delete savedReviews[voicing.id];
      approvedVault = approvedVault.filter((approved) => approved.id !== voicing.id);
      localStorage.setItem("chord-vault-reviews", JSON.stringify(savedReviews));
      localStorage.setItem("chord-vault-approved-voicings", JSON.stringify(approvedVault));
      candidates.splice(currentIndex, 1);
      currentIndex = Math.min(currentIndex, Math.max(0, candidates.length - 1));
      batchStatus.textContent = `${voicing.chordName} was rejected and deleted from the review queue.`;
      audit("Rejected permanently", voicing.chordName); persistQueue();
      setUndo(() => { rejectedShapes.delete(exactVoicingKey(removed)); candidates.splice(currentIndex, 0, removed); localStorage.setItem("chord-vault-rejected-shapes", JSON.stringify([...rejectedShapes])); persistQueue(); render(); });
      render();
      return;
    }
    if (button.dataset.status === "approved") {
      const guard = canApproveVoicing(voicing, [...CANONICAL_VOICINGS, ...approvedVault]);
      if (!guard.allowed) { batchStatus.textContent = guard.reason!; candidates.splice(currentIndex, 1); currentIndex = Math.min(currentIndex, candidates.length - 1); render(); return; }
    }
    voicing.approvalStatus = button.dataset.status as ApprovalStatus;
    if (voicing.approvalStatus === "approved") {
      approvedVault = [...approvedVault.filter((approved) => approved.id !== voicing.id), voicing];
      localStorage.setItem("chord-vault-approved-voicings", JSON.stringify(approvedVault));
    }
    saveCurrent(voicing); advance(1);
    audit("Moved to Pre-reviewed", voicing.chordName); persistQueue();
  }));
  byId("reviewLaterCandidate").addEventListener("click", () => { reviewLater.add(voicing.id); localStorage.setItem("chord-vault-review-later", JSON.stringify([...reviewLater])); audit("Saved for later", voicing.chordName); advance(1); });
  byId("previousCandidate").addEventListener("click", () => advance(-1));
  byId("nextCandidate").addEventListener("click", () => advance(1));
  byId("playCandidate").addEventListener("click", () => play(voicing));
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCsvObjects(text: string): Record<string, unknown>[] {
  const [headers, ...rows] = csvRows(text);
  if (!headers) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function importedQuality(name: string, supplied?: unknown): string {
  if (typeof supplied === "string" && supplied) return supplied;
  const lower = name.toLowerCase();
  if (lower.includes("maj9")) return "maj9"; if (lower.includes("m11")) return "min11";
  if (lower.includes("m9")) return "min9"; if (lower.includes("maj7")) return "maj7";
  if (lower.includes("m7")) return "min7"; if (lower.includes("sus2")) return "sus2";
  if (lower.includes("sus4")) return "sus4"; if (lower.includes("7")) return "dom7";
  return /^[A-G](?:#|b)?m(?!aj)/.test(name) ? "minor" : "major";
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
  const chordName = String(raw.chordName ?? raw.name ?? "").trim();
  const root = String(raw.root ?? chordName.match(/^[A-G](?:#|b)?/)?.[0] ?? "").trim();
  if (!chordName || !root) throw new Error(`Row ${index + 1}: chord name or root is missing`);
  if (typeof raw.tuning === "object" && raw.tuning && "id" in raw.tuning && (raw.tuning as { id: string }).id !== STANDARD_TUNING.id) throw new Error(`Row ${index + 1}: unsupported tuning`);
  if (typeof raw.tuning === "string" && raw.tuning && raw.tuning !== STANDARD_TUNING.id) throw new Error(`Row ${index + 1}: unsupported tuning`);
  const rawFrets = Array.isArray(raw.fretPositions) ? raw.fretPositions : String(raw.fretPositions ?? "").split(/[ ,]+/).filter(Boolean);
  const fretPositions = rawFrets.map((value) => String(value).toLowerCase() === "x" || value === null || Number(value) < 0 ? null : Number(value));
  if (fretPositions.length !== 6 || fretPositions.some((fret) => fret !== null && (!Number.isInteger(fret) || fret < 0))) throw new Error(`Row ${index + 1}: invalid six-string fret pattern`);
  const chordQuality = importedQuality(chordName, raw.chordQuality);
  const pitches = pitchesForVoicing(STANDARD_TUNING, fretPositions);
  const intervals = intervalsRelativeToRoot(pitches, root);
  const recipe = RECIPES.find((item) => item.id === chordQuality);
  if (recipe && recipe.requiredTones.filter((tone) => tone !== 7).some((tone) => !intervals.includes(tone))) throw new Error(`Row ${index + 1}: fingering does not produce ${chordName}`);
  const bass = bassPitch(pitches);
  const fingers = Array.isArray(raw.fingerPositions) ? raw.fingerPositions : String(raw.fingerPositions ?? "").split(" ");
  const fingerPositions = fretPositions.map((fret, stringIndex) => fret && Number(fingers[stringIndex]) ? Number(fingers[stringIndex]) : null);
  const shapeKey = `${STANDARD_TUNING.id}|${root}|${chordQuality}|${fretPositions.map((fret) => fret ?? "x").join("-")}`;
  const zeroBreakdown = { harmonicCompleteness: 0, playability: 0, usefulBass: 0, openStrings: 0, extensions: 0, uniqueness: 0, fretSpanPenalty: 0, muddyIntervalPenalty: 0, duplicateNotePenalty: 0 };
  return {
    id: String(raw.id || `imported_${importHash(shapeKey)}`), slug: String(raw.slug || `${chordName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${importHash(shapeKey)}`),
    chordName, chordQuality, root, tuning: STANDARD_TUNING, fretPositions, fingerPositions,
    notes: pitches.map((pitch) => pitch.note), intervals, bassNote: bass?.note ?? "", inversion: inversionForPitches(pitches, root), alternateNames: [],
    fretSpan: fretSpanFor(fretPositions), openStringCount: fretPositions.filter((fret) => fret === 0).length,
    difficulty: Math.max(1, Math.min(5, Number(raw.difficulty) || 3)) as 1 | 2 | 3 | 4 | 5,
    moodTags: importedArray(raw.moodTags), genreTags: importedArray(raw.genreTags), descriptorTags: importedArray(raw.descriptorTags),
    description: String(raw.description ?? ""), qualityScore: Number(raw.qualityScore) || 0,
    scoreBreakdown: typeof raw.scoreBreakdown === "object" && raw.scoreBreakdown ? raw.scoreBreakdown as ChordVoicing["scoreBreakdown"] : zeroBreakdown,
    approvalStatus: "approved", possibleBarres: [],
  };
}

async function importApprovedFile(file: File): Promise<void> {
  const importStatus = byId("importStatus");
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".csv") ? parseCsvObjects(text) : JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.voicings) ? parsed.voicings : [parsed];
    const existingKeys = new Set(approvedVault.map(exactVoicingKey));
    let imported = 0; let duplicates = 0; let invalid = 0;
    for (let index = 0; index < records.length; index += 1) {
      try {
        const voicing = normalizeImportedVoicing(records[index], index);
        const key = exactVoicingKey(voicing);
        if (existingKeys.has(key)) { duplicates += 1; continue; }
        existingKeys.add(key); approvedVault.push(voicing); imported += 1;
      } catch { invalid += 1; }
    }
    localStorage.setItem("chord-vault-approved-voicings", JSON.stringify(approvedVault));
    importStatus.textContent = `${file.name}: ${imported} imported to Pre-reviewed, ${duplicates} duplicate, ${invalid} invalid.`;
    renderLibraryEditor();
  } catch (error) {
    importStatus.textContent = `Import failed: ${error instanceof Error ? error.message : "invalid file"}`;
  }
}

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
  activeSources.forEach((source) => { try { source.stop(); } catch {} });
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
    requiredTones: selected.requiredTones, optionalTones: selected.optionalTones,
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
    requiredTones: selected.requiredTones, optionalTones: selected.optionalTones,
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
byId("exportJson").addEventListener("click", () => download(approvedJson(approvedVault), "chord-vault-approved.json", "application/json"));
byId("exportCsv").addEventListener("click", () => download(approvedCsv(approvedVault), "chord-vault-approved.csv", "text/csv"));

const libraryGrid = byId("libraryEditorGrid");
const librarySourceTabs = byId("librarySourceTabs");
const libraryPrevious = byId<HTMLButtonElement>("libraryPrevious");
const libraryNext = byId<HTMLButtonElement>("libraryNext");
const libraryPageStatus = byId("libraryPageStatus");

function approvedLibraryItems(): LibraryItem[] {
  return approvedVault.map((voicing) => ({
    key: voicing.id, name: voicing.chordName, difficulty: voicing.difficulty, source: "Pre-reviewed",
    frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""),
    descriptorTags: voicing.descriptorTags ?? [...new Set([...voicing.moodTags, ...voicing.genreTags])],
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
  return { ...item, difficulty: edit?.difficulty ?? item.difficulty, descriptorTags: edit?.descriptorTags ?? item.descriptorTags };
}

function tagVocabulary(): string[] {
  return [...new Set([
    "Essential", "Open", "Barre", "Movable", "Dreamy", "Dark", "Warm", "Tense", "Ambient", "Jazz", "Neo soul", "Funk",
    ...[...publicLibrary, ...approvedLibraryItems()].flatMap((item) => editedLibraryItem(item).descriptorTags),
  ])].sort((left, right) => left.localeCompare(right));
}

function persistLibraryEdit(item: LibraryItem, update: { difficulty?: number; descriptorTags?: string[] }): void {
  libraryEdits[item.key] = { ...libraryEdits[item.key], ...update };
  localStorage.setItem("chord-vault-library-edits", JSON.stringify(libraryEdits));
  const approved = approvedVault.find((voicing) => voicing.id === item.key);
  if (approved) {
    if (update.difficulty !== undefined) approved.difficulty = update.difficulty as 1 | 2 | 3 | 4 | 5;
    if (update.descriptorTags) approved.descriptorTags = update.descriptorTags;
    localStorage.setItem("chord-vault-approved-voicings", JSON.stringify(approvedVault));
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
    moodTags: [], genreTags: [], descriptorTags: item.descriptorTags, description: "", qualityScore: 0,
    scoreBreakdown: emptyScore, approvalStatus: "approved", possibleBarres: [],
  };
}

function mainVaultVoicings(): ChordVoicing[] {
  const items = publicLibrary.filter((item) => finalApprovedKeys.has(item.key)).map((item) =>
    CANONICAL_VOICINGS.find((voicing) => voicing.id === item.key) ?? libraryItemVoicing(editedLibraryItem(item)));
  return [...items, ...publishedVault];
}

function duplicateCard(label: string, voicing: ChordVoicing): string {
  const item: LibraryItem = { key: voicing.id, name: voicing.chordName, root: voicing.root, chordQuality: voicing.chordQuality,
    difficulty: voicing.difficulty, descriptorTags: voicing.descriptorTags ?? [...voicing.moodTags, ...voicing.genreTags],
    frets: voicing.fretPositions.map((fret) => fret ?? -1), fingers: (voicing.fingerPositions ?? []).map((finger) => finger ? String(finger) : ""), source: "Main Vault" };
  return `<article class="duplicate-card"><span>${label}</span><h3>${escapeHtml(voicing.chordName)}</h3>${libraryDiagram(item)}
    <dl><div><dt>Frets</dt><dd>${voicing.fretPositions.map((fret) => fret ?? "x").join(" · ")}</dd></div><div><dt>Notes</dt><dd>${voicing.notes.join(" · ")}</dd></div><div><dt>Inversion</dt><dd>${escapeHtml(voicing.inversion)}</dd></div><div><dt>Difficulty</dt><dd>${voicing.difficulty} / 5</dd></div></dl></article>`;
}

const duplicateDialog = byId<HTMLDialogElement>("duplicateDialog");
let pendingDuplicatePublish: (() => void) | null = null;
let pendingDuplicatePair: { candidate: ChordVoicing; match: ChordVoicing } | null = null;
function requestPublish(candidate: ChordVoicing, publish: () => void): void {
  const duplicate = findVoicingDuplicate(candidate, mainVaultVoicings());
  if (!duplicate) { publish(); return; }
  pendingDuplicatePublish = publish;
  pendingDuplicatePair = { candidate, match: duplicate.match };
  byId("duplicateSummary").textContent = duplicate.exact
    ? "These fret positions already exist in the Main Vault. Compare them before continuing."
    : `This voicing is ${duplicate.similarity}% similar to one in the Main Vault. Compare them before continuing.`;
  byId("duplicateComparison").innerHTML = duplicateCard("Chord being approved", candidate) + duplicateCard("Existing Main Vault chord", duplicate.match);
  duplicateDialog.showModal();
}

function closeDuplicateDialog(): void { pendingDuplicatePublish = null; pendingDuplicatePair = null; duplicateDialog.close(); }
byId("closeDuplicate").addEventListener("click", closeDuplicateDialog);
byId("keepExisting").addEventListener("click", closeDuplicateDialog);
byId("publishDuplicate").addEventListener("click", () => { const publish = pendingDuplicatePublish; pendingDuplicatePublish = null; duplicateDialog.close(); publish?.(); });
byId("mergeDuplicate").addEventListener("click", () => {
  const pair = pendingDuplicatePair; if (!pair) return;
  const mergedTags = [...new Set([...(pair.match.descriptorTags ?? []), ...(pair.candidate.descriptorTags ?? []), ...pair.candidate.moodTags, ...pair.candidate.genreTags])];
  const published = publishedVault.find((item) => item.id === pair.match.id);
  if (published) { published.descriptorTags = mergedTags; published.description ||= pair.candidate.description; localStorage.setItem("chord-vault-published-voicings", JSON.stringify(publishedVault)); }
  else { libraryEdits[pair.match.id] = { ...libraryEdits[pair.match.id], descriptorTags: mergedTags }; localStorage.setItem("chord-vault-library-edits", JSON.stringify(libraryEdits)); }
  audit("Merged duplicate metadata", pair.candidate.chordName); closeDuplicateDialog(); renderLibraryEditor();
});
byId("replaceDuplicate").addEventListener("click", () => {
  const pair = pendingDuplicatePair; const publish = pendingDuplicatePublish; if (!pair || !publish) return;
  publishedVault = publishedVault.filter((item) => item.id !== pair.match.id); finalApprovedKeys.delete(pair.match.id);
  const publicMatch = publicLibrary.find((item) => item.key === pair.match.id); if (publicMatch) publicMatch.source = "Unapproved";
  localStorage.setItem("chord-vault-published-voicings", JSON.stringify(publishedVault)); localStorage.setItem("chord-vault-final-approved-keys", JSON.stringify([...finalApprovedKeys]));
  pendingDuplicatePublish = null; pendingDuplicatePair = null; duplicateDialog.close(); publish(); audit("Replaced duplicate", pair.candidate.chordName);
});
duplicateDialog.addEventListener("cancel", () => { pendingDuplicatePublish = null; });

function renderLibraryEditor(): void {
  const items = allLibraryItems();
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  if (libraryPage >= pageCount) libraryPage = pageCount - 1;
  const visible = items.slice(libraryPage * pageSize, libraryPage * pageSize + pageSize).map(editedLibraryItem);
  const vocabulary = tagVocabulary();
  libraryGrid.innerHTML = visible.length ? visible.map((item) => {
    const encodedKey = encodeURIComponent(item.key);
    const addable = vocabulary.filter((tag) => !item.descriptorTags.includes(tag));
    return `<article class="library-edit-card" data-library-key="${encodedKey}" data-library-source="${item.source}">
      <div class="library-edit-card-header"><div><label class="library-select"><input type="checkbox" class="library-select-box"${selectedLibraryKeys.has(item.key) ? " checked" : ""}/> Select</label><span class="library-source-label">${item.source}</span><h3>${escapeHtml(item.name)}</h3></div>
      <select class="library-difficulty" aria-label="Difficulty for ${escapeHtml(item.name)}">${[1,2,3,4,5].map((level) => `<option value="${level}"${level === item.difficulty ? " selected" : ""}>${level} / 5</option>`).join("")}</select></div>
      ${libraryDiagram(item)}
      <div class="editable-tags">${item.descriptorTags.map((tag) => `<button class="editable-tag" type="button" data-remove-tag="${encodeURIComponent(tag)}" aria-label="Remove ${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><b>×</b></button>`).join("")}
      <button class="add-tag-button" type="button" aria-label="Add descriptor to ${escapeHtml(item.name)}">+</button>
      <select class="tag-picker" aria-label="Choose descriptor" hidden><option value="">Choose tag</option>${addable.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}</select></div>
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
  const target = event.target as HTMLSelectElement;
  const card = target.closest<HTMLElement>("[data-library-key]");
  if (!card) return;
  const item = itemForCard(card);
  if (!item) return;
  if (target.classList.contains("library-select-box")) { target.checked ? selectedLibraryKeys.add(item.key) : selectedLibraryKeys.delete(item.key); return; }
  if (target.classList.contains("library-difficulty")) persistLibraryEdit(item, { difficulty: Number(target.value) });
  if (target.classList.contains("tag-picker") && target.value) {
    const edited = editedLibraryItem(item);
    persistLibraryEdit(item, { descriptorTags: [...new Set([...edited.descriptorTags, target.value])] });
    renderLibraryEditor();
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
    const picker = card.querySelector<HTMLSelectElement>(".tag-picker")!;
    picker.hidden = !picker.hidden;
    if (!picker.hidden) picker.focus();
  }
  if (button.dataset.removeTag) {
    const remove = decodeURIComponent(button.dataset.removeTag);
    persistLibraryEdit(item, { descriptorTags: editedLibraryItem(item).descriptorTags.filter((tag) => tag !== remove) });
    renderLibraryEditor();
  }
  if (button.classList.contains("final-approve-button")) {
    if (item.source === "Unapproved") {
      const candidate = libraryItemVoicing(editedLibraryItem(item));
      requestPublish(candidate, () => {
        finalApprovedKeys.add(item.key);
        localStorage.setItem("chord-vault-final-approved-keys", JSON.stringify([...finalApprovedKeys]));
        const stored = publicLibrary.find((publicItem) => publicItem.key === item.key);
        if (stored) stored.source = "Main Vault";
        batchStatus.textContent = `${item.name} was moved to the Main Vault. Refresh the public page to view it.`;
        audit("Final approved", item.name); renderLibraryEditor(); renderCoverage();
      });
      return;
    }
    const voicing = approvedVault.find((approved) => approved.id === item.key);
    if (!voicing) return;
    const edited = editedLibraryItem(item);
    voicing.difficulty = edited.difficulty as 1 | 2 | 3 | 4 | 5;
    voicing.descriptorTags = edited.descriptorTags;
    requestPublish(voicing, () => {
      voicing.approvalStatus = "approved";
      publishedVault = [...publishedVault.filter((published) => published.id !== voicing.id), voicing];
      finalApprovedKeys.add(voicing.id);
      approvedVault = approvedVault.filter((approved) => approved.id !== voicing.id);
      localStorage.setItem("chord-vault-published-voicings", JSON.stringify(publishedVault));
      localStorage.setItem("chord-vault-final-approved-keys", JSON.stringify([...finalApprovedKeys]));
      localStorage.setItem("chord-vault-approved-voicings", JSON.stringify(approvedVault));
      batchStatus.textContent = `${voicing.chordName} was published to the Main Vault. Refresh the public page to view it.`;
      audit("Final approved", voicing.chordName); renderLibraryEditor(); renderCoverage();
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
byId<HTMLInputElement>("selectVisible").addEventListener("change", (event) => { const checked = (event.target as HTMLInputElement).checked; libraryGrid.querySelectorAll<HTMLInputElement>(".library-select-box").forEach((box) => { box.checked = checked; const card = box.closest<HTMLElement>("[data-library-key]"); if (card) checked ? selectedLibraryKeys.add(decodeURIComponent(card.dataset.libraryKey!)) : selectedLibraryKeys.delete(decodeURIComponent(card.dataset.libraryKey!)); }); });
byId<HTMLSelectElement>("bulkDifficulty").addEventListener("change", (event) => { const level = Number((event.target as HTMLSelectElement).value); if (!level) return; [...publicLibrary, ...approvedLibraryItems()].filter((item) => selectedLibraryKeys.has(item.key)).forEach((item) => persistLibraryEdit(item, { difficulty: level })); audit("Bulk difficulty edit", `${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
bulkTag.addEventListener("change", () => { if (!bulkTag.value) return; [...publicLibrary, ...approvedLibraryItems()].filter((item) => selectedLibraryKeys.has(item.key)).forEach((item) => persistLibraryEdit(item, { descriptorTags: [...new Set([...editedLibraryItem(item).descriptorTags, bulkTag.value])] })); audit("Bulk tag added", `${bulkTag.value} to ${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
byId("bulkLater").addEventListener("click", () => { selectedLibraryKeys.forEach((key) => reviewLater.add(key)); localStorage.setItem("chord-vault-review-later", JSON.stringify([...reviewLater])); audit("Bulk saved for later", `${selectedLibraryKeys.size} chords`); renderLibraryEditor(); });
byId("bulkApprove").addEventListener("click", () => { const first = libraryGrid.querySelector<HTMLButtonElement>("[data-library-key] .library-select-box:checked")?.closest<HTMLElement>("[data-library-key]")?.querySelector<HTMLButtonElement>(".final-approve-button"); if (first) { batchStatus.textContent = "Approving selected chords one at a time so duplicate checks are preserved."; first.click(); } });

byId("undoAction").addEventListener("click", () => { const action = undoAction; undoAction = null; byId<HTMLButtonElement>("undoAction").disabled = true; action?.(); audit("Undid last action", "workspace"); });
byId("backupWorkflow").addEventListener("click", () => download(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), approvedVault, publishedVault, finalApprovedKeys: [...finalApprovedKeys], rejectedShapes: [...rejectedShapes], reviewLater: [...reviewLater], auditLog, libraryEdits }, null, 2), `chord-vault-workspace-${new Date().toISOString().slice(0,10)}.json`, "application/json"));
document.addEventListener("keydown", (event) => { if ((event.target as HTMLElement).matches("input,textarea,select") || duplicateDialog.open) return; const key = event.key.toLowerCase(); if (key === "a") reviewCard.querySelector<HTMLButtonElement>('[data-status="approved"]')?.click(); if (key === "r") reviewCard.querySelector<HTMLButtonElement>('[data-status="rejected"]')?.click(); if (key === "l") document.getElementById("reviewLaterCandidate")?.click(); if (key === "arrowleft") advance(-1); if (key === "arrowright") advance(1); if (key === " ") { event.preventDefault(); document.getElementById("playCandidate")?.click(); } });
renderCoverage(); renderAudit(); render();

const themeToggle = byId("themeToggle");
function updateThemeLabel(): void { themeToggle.textContent = document.documentElement.dataset.theme === "light" ? "☾ Dark" : "☼ Light"; }
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("chord-vault-theme", next); updateThemeLabel();
});
updateThemeLabel();
