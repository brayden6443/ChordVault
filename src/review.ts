import { approvedCsv, approvedJson } from "./chords/export.ts";
import { APPROVED_C_PROFILE, rankWithCurationProfile } from "./chords/curation.ts";
import { generateBatch, generateVoicings } from "./chords/generator.ts";
import { intervalLabel } from "./chords/theory.ts";
import { STANDARD_TUNING, type ApprovalStatus, type ChordVoicing } from "./chords/types.ts";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const RECIPES = [
  { id: "major", label: "Major", suffix: "", requiredTones: [0, 4, 7], optionalTones: [] },
  { id: "minor", label: "Minor", suffix: "m", requiredTones: [0, 3, 7], optionalTones: [] },
  { id: "maj7", label: "Major 7", suffix: "maj7", requiredTones: [0, 4, 11], optionalTones: [7] },
  { id: "dom7", label: "Dominant 7", suffix: "7", requiredTones: [0, 4, 10], optionalTones: [7] },
  { id: "min7", label: "Minor 7", suffix: "m7", requiredTones: [0, 3, 10], optionalTones: [7] },
  { id: "maj9", label: "Major 9", suffix: "maj9", requiredTones: [0, 4, 11], optionalTones: [2, 7] },
  { id: "min11", label: "Minor 11", suffix: "m11", requiredTones: [0, 3, 10], optionalTones: [2, 5, 7] },
];

type SavedReview = Pick<ChordVoicing, "approvalStatus" | "chordName" | "moodTags" | "genreTags" | "description">;
const savedReviews: Record<string, SavedReview> = JSON.parse(localStorage.getItem("chord-vault-reviews") ?? "{}");
let candidates: ChordVoicing[] = [];
let currentIndex = 0;
let audioContext: AudioContext | null = null;
let activeSources: OscillatorNode[] = [];

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rootSelect = byId<HTMLSelectElement>("rootSelect");
const recipeSelect = byId<HTMLSelectElement>("recipeSelect");
const retainInput = byId<HTMLInputElement>("retainInput");
const reviewCard = byId<HTMLElement>("reviewCard");
const batchStatus = byId<HTMLElement>("batchStatus");

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
        <label class="editor-field">Description<textarea id="editDescription">${escapeHtml(voicing.description)}</textarea></label>
      </div>
      <div class="review-decisions">
        <button class="edit-button" id="saveEdit" type="button">Save edits</button>
        <button class="approve-button" data-status="approved" type="button">Approve</button>
        <button class="reject-button" data-status="rejected" type="button">Reject</button>
      </div>
      <div class="queue-nav"><button id="previousCandidate" type="button">Previous</button><button id="playCandidate" type="button">Play chord</button><button id="nextCandidate" type="button">Next</button></div>
    </div>
  </div>`;
  byId("saveEdit").addEventListener("click", () => {
    voicing.chordName = byId<HTMLInputElement>("editName").value.trim() || voicing.chordName;
    voicing.moodTags = splitTags(byId<HTMLInputElement>("editMood").value);
    voicing.genreTags = splitTags(byId<HTMLInputElement>("editGenre").value);
    voicing.description = byId<HTMLTextAreaElement>("editDescription").value.trim();
    saveCurrent(voicing); render();
  });
  reviewCard.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", () => {
    voicing.approvalStatus = button.dataset.status as ApprovalStatus;
    saveCurrent(voicing); advance(1);
  }));
  byId("previousCandidate").addEventListener("click", () => advance(-1));
  byId("nextCandidate").addEventListener("click", () => advance(1));
  byId("playCandidate").addEventListener("click", () => play(voicing));
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function advance(direction: number): void {
  if (!candidates.length) return;
  currentIndex = (currentIndex + direction + candidates.length) % candidates.length;
  render();
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

byId("generateOne").addEventListener("click", () => {
  const selected = recipe();
  batchStatus.textContent = "Generating candidates…";
  candidates = rankWithCurationProfile(generateVoicings({
    tuning: STANDARD_TUNING, chordName: `${rootSelect.value}${selected.suffix}`, root: rootSelect.value,
    requiredTones: selected.requiredTones, optionalTones: selected.optionalTones,
    maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1,
    maxRawCandidates: 50_000, maxResults: resultLimit(), allowOmitFifth: true,
  }), APPROVED_C_PROFILE).map(applySaved);
  currentIndex = 0;
  batchStatus.textContent = `${candidates.length} ranked candidates retained.`;
  render();
});

byId("generateBatch").addEventListener("click", async () => {
  const selected = recipe();
  batchStatus.textContent = "Generating and ranking thousands of raw candidates…";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const batch = generateBatch(ROOTS.map((root) => ({
    chordName: `${root}${selected.suffix}`, root,
    requiredTones: selected.requiredTones, optionalTones: selected.optionalTones,
  })), {
    tuning: STANDARD_TUNING, maxFretSpan: 4, maxFrettedNotes: 5, maxInternalMutedStrings: 1,
    maxRawCandidates: 50_000, maxResults: resultLimit(), allowOmitFifth: true,
  }, resultLimit() * ROOTS.length);
  candidates = rankWithCurationProfile(batch.retained, APPROVED_C_PROFILE).map(applySaved);
  currentIndex = 0;
  batchStatus.textContent = `${batch.rawCandidateCount.toLocaleString()} raw shapes checked; ${candidates.length.toLocaleString()} ranked using your ${APPROVED_C_PROFILE.sourceCount} C approvals.`;
  render();
});

function download(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
byId("exportJson").addEventListener("click", () => download(approvedJson(candidates), "chord-vault-approved.json", "application/json"));
byId("exportCsv").addEventListener("click", () => download(approvedCsv(candidates), "chord-vault-approved.csv", "text/csv"));

const themeToggle = byId("themeToggle");
function updateThemeLabel(): void { themeToggle.textContent = document.documentElement.dataset.theme === "light" ? "☾ Dark" : "☼ Light"; }
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("chord-vault-theme", next); updateThemeLabel();
});
updateThemeLabel();
