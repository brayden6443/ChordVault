export interface DiagramChord {
  name: string;
  frets: number[];
  fingers?: Array<string | number | null>;
}

const COMMON_PARTIAL_BARRES = new Set(["-1--1-0-2-1-1"]);

const COMMON_OPEN_FINGERS = new Map<string, string[]>([
  ["-1-3-2-0-1-0", ["", "3", "2", "", "1", ""]],
  ["-1-0-2-2-2-0", ["", "", "1", "2", "3", ""]],
  ["3-2-0-0-0-3", ["2", "1", "", "", "", "3"]],
  ["0-2-2-1-0-0", ["", "2", "3", "1", "", ""]],
  ["-1--1-0-2-3-2", ["", "", "", "1", "3", "2"]],
  ["-1-0-2-2-1-0", ["", "", "2", "3", "1", ""]],
  ["0-2-2-0-0-0", ["", "2", "3", "", "", ""]],
  ["-1--1-0-2-3-1", ["", "", "", "2", "3", "1"]],
  ["-1-0-2-2-0-0", ["", "", "1", "2", "", ""]],
  ["-1--1-0-2-3-0", ["", "", "", "1", "3", ""]],
  ["-1-0-2-2-3-0", ["", "", "1", "2", "3", ""]],
  ["0-2-2-2-0-0", ["", "1", "2", "3", "", ""]],
  ["-1--1-0-2-3-3", ["", "", "", "1", "3", "4"]],
  ["-1-0-2-0-2-0", ["", "", "1", "", "2", ""]],
  ["-1-2-1-2-0-2", ["", "2", "1", "3", "", "4"]],
  ["-1-3-2-3-1-0", ["", "3", "2", "4", "1", ""]],
  ["-1--1-0-2-1-2", ["", "", "", "2", "1", "3"]],
  ["0-2-0-1-0-0", ["", "2", "", "1", "", ""]],
  ["3-2-0-0-0-1", ["3", "2", "", "", "", "1"]],
  ["-1-0-2-1-2-0", ["", "", "2", "1", "3", ""]],
  ["-1-3-2-0-0-0", ["", "3", "2", "", "", ""]],
  ["-1--1-0-2-2-2", ["", "", "", "1", "2", "3"]],
  ["0-2-1-1-0-0", ["", "3", "1", "2", "", ""]],
  ["3-2-0-0-0-2", ["3", "2", "", "", "", "1"]],
  ["-1-0-2-0-1-0", ["", "", "2", "", "1", ""]],
  ["-1--1-0-2-1-1", ["", "", "", "2", "1", "1"]],
  ["0-2-0-0-0-0", ["", "2", "", "", "", ""]],
]);

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function displayBarre(frets: number[]): { fret: number; from: number; to: number } | null {
  const fretted = frets.filter((fret) => fret > 0);
  const commonPartialBarre = COMMON_PARTIAL_BARRES.has(frets.join("-"));
  if (fretted.length <= 4 && !commonPartialBarre) return null;
  const fret = Math.min(...fretted);
  const matching = frets.flatMap((value, index) => value === fret ? [index] : []);
  if (matching.length < 2) return null;
  const from = Math.min(...matching);
  const to = Math.max(...matching);
  const uninterrupted = frets.slice(from, to + 1).every((value) => value > 0 && value >= fret);
  return uninterrupted ? { fret, from, to } : null;
}

export function inferFingerLabels(frets: number[], provided: Array<string | number | null> = []): string[] {
  const common = COMMON_OPEN_FINGERS.get(frets.join("-"));
  if (common) return [...common];
  const result = frets.map((fret, index) => fret > 0 && provided[index] ? String(provided[index]) : "");
  const barre = displayBarre(frets);
  if (barre) for (let index = barre.from; index <= barre.to; index += 1) if (frets[index] === barre.fret) result[index] = "1";
  let nextFinger = barre ? 2 : 1;
  frets.forEach((fret, index) => {
    if (fret > 0 && !result[index]) { result[index] = String(Math.min(4, nextFinger)); nextFinger += 1; }
  });
  return result;
}

export function renderChordDiagram(chord: DiagramChord): string {
  const xs = [24, 48, 72, 96, 120, 144];
  const fingers = chord.fingers ?? [];
  const playedFrets = chord.frets.filter((fret) => fret > 0);
  const baseFret = Math.max(...playedFrets) > 5 ? Math.min(...playedFrets) : 1;
  const isHigherPosition = baseFret > 1;
  const strings = xs.map((x) => `<line x1="${x}" y1="34" x2="${x}" y2="159" class="string"/>`).join("");
  const frets = [34, 59, 84, 109, 134, 159].map((y, index) => `<line x1="24" y1="${y}" x2="144" y2="${y}" class="${index === 0 && !isHigherPosition ? "nut" : "fret"}"/>`).join("");
  const barre = displayBarre(chord.frets);
  const barreY = barre ? 46.5 + (barre.fret - baseFret) * 25 : 0;
  const barreMark = barre ? `<g><rect x="${xs[barre.from] - 9}" y="${barreY - 9}" width="${xs[barre.to] - xs[barre.from] + 18}" height="18" rx="9" class="finger-dot barre-dot"/><text x="${(xs[barre.from] + xs[barre.to]) / 2}" y="${barreY + 3.5}" class="finger-label">${fingers[barre.from] || 1}</text></g>` : "";
  const marks = chord.frets.map((fret, index) => fret < 0
    ? `<text x="${xs[index]}" y="22" class="marker">×</text>`
    : fret === 0
      ? `<circle cx="${xs[index]}" cy="16" r="5" class="open-marker"/>`
      : barre && fret === barre.fret && index >= barre.from && index <= barre.to
        ? ""
        : `<g><circle cx="${xs[index]}" cy="${46.5 + (fret - baseFret) * 25}" r="9" class="finger-dot"/><text x="${xs[index]}" y="${50 + (fret - baseFret) * 25}" class="finger-label">${fingers[index] ?? ""}</text></g>`).join("");
  const fretNumbers = isHigherPosition
    ? [0, 1, 2, 3, 4].map((index) => `<text x="169" y="${50 + index * 25}" class="fret-number">${baseFret + index}</text>`).join("")
    : [1, 2, 3, 4, 5].map((number, index) => `<text x="169" y="${50 + index * 25}" class="fret-number">${number}</text>`).join("");
  const label = `${chord.name} guitar chord diagram${isHigherPosition ? `, starting at fret ${baseFret}` : ""}${barre ? `, with a barre at fret ${barre.fret}` : ""}`;
  return `<svg class="chord-diagram" viewBox="0 0 184 190" role="img" aria-label="${escapeAttribute(label)}">${frets}${strings}${fretNumbers}${barreMark}${marks}${["E", "A", "D", "G", "B", "e"].map((string, index) => `<text x="${xs[index]}" y="184" class="string-label">${string}</text>`).join("")}</svg>`;
}
