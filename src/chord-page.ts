import { inferFingerLabels, renderChordDiagram } from "./chords/diagram.ts";
import type { PublicChordDetails } from "./chords/public-chord.ts";

const stringNames = ["low E", "A", "D", "G", "B", "high e"];
const intervalNames = new Map<number, string>([
  [0, "Root"], [1, "♭2"], [2, "2"], [3, "♭3"], [4, "3"], [5, "4"], [6, "♭5"],
  [7, "5"], [8, "♭6"], [9, "6"], [10, "♭7"], [11, "7"],
]);

function text(value: string): Text { return document.createTextNode(value); }

function fact(term: string, value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt"); const dd = document.createElement("dd");
  dt.append(text(term)); dd.append(text(value)); fragment.append(dt, dd); return fragment;
}

function formatStrings(values: Array<number | null>, muted = "×"): string {
  return values.map((value) => value === null ? muted : String(value)).join(" · ");
}

function render(chord: PublicChordDetails): void {
  document.querySelector<HTMLElement>("#chordPageName")!.textContent = chord.chordName;
  document.querySelector<HTMLElement>("#chordDescription")!.textContent = chord.description || `A ${chord.chordName} voicing in ${chord.tuningName} tuning.`;
  const frets = chord.fretPositions.map((fret) => fret ?? -1);
  const fingers = inferFingerLabels(frets, chord.fingerPositions);
  document.querySelector<HTMLElement>("#chordDiagram")!.innerHTML = renderChordDiagram({ name: chord.chordName, frets, fingers });
  document.querySelector<HTMLElement>("#chordDiagram")!.removeAttribute("aria-hidden");

  const facts = document.querySelector<HTMLDListElement>("#chordFacts")!;
  facts.replaceChildren(
    fact("Notes", chord.notes.join(" · ")),
    fact("Intervals", chord.intervals.map((interval) => intervalNames.get(interval) ?? String(interval)).join(" · ")),
    fact("Frets", formatStrings(chord.fretPositions)),
    fact("Fingers", fingers.map((finger, index) => `${stringNames[index]}: ${finger || "—"}`).join(" · ")),
    fact("Difficulty", `${chord.difficulty} out of 5`),
    fact("Bass note", chord.bassNote || "Not available"),
    fact("Inversion", chord.inversion),
    fact("Tags", chord.tags.length ? chord.tags.join(" · ") : "No tags assigned"),
  );
}

function showNotFound(): void {
  document.querySelector<HTMLElement>("#chordDetail")!.hidden = true;
  document.querySelector<HTMLElement>("#chordNotFound")!.hidden = false;
}

function currentSlug(): string {
  const pathMatch = window.location.pathname.match(/^\/chords\/([^/]+)\/?$/);
  return pathMatch ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(window.location.search).get("slug") ?? "";
}

async function load(): Promise<void> {
  const slug = currentSlug();
  if (!slug) { showNotFound(); return; }
  try {
    const response = await fetch(`/api/chords/slug/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) { showNotFound(); return; }
    const payload = await response.json() as { chord?: PublicChordDetails };
    if (!payload.chord || payload.chord.slug !== slug) { showNotFound(); return; }
    render(payload.chord);
  } catch { showNotFound(); }
}

const themeToggle = document.querySelector<HTMLButtonElement>("#themeToggle")!;
function syncTheme(): void {
  const light = document.documentElement.dataset.theme === "light";
  themeToggle.textContent = light ? "Dark" : "Light";
  themeToggle.setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} mode`);
}
themeToggle.addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("chord-vault-theme", document.documentElement.dataset.theme);
  syncTheme();
});
syncTheme();
void load();
