var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/auth.ts
var keyCache = /* @__PURE__ */ new Map();
var decoder = new TextDecoder();
function normalizeTeamDomain(value) {
  const withScheme = /^https:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" || url.pathname !== "/") throw new Error("Invalid Access team domain");
  return url.origin;
}
__name(normalizeTeamDomain, "normalizeTeamDomain");
function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(decodeBase64Url, "decodeBase64Url");
function decodeJson(value) {
  return JSON.parse(decoder.decode(decodeBase64Url(value)));
}
__name(decodeJson, "decodeJson");
async function signingKeys(teamDomain, fetcher, now) {
  const endpoint = `${teamDomain}/cdn-cgi/access/certs`;
  const cached = keyCache.get(endpoint);
  if (cached && cached.expiresAt > now) return cached.keys;
  const response = await fetcher(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Access signing keys unavailable");
  const value = await response.json();
  if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error("Access signing keys invalid");
  keyCache.set(endpoint, { expiresAt: now + 5 * 60, keys: value.keys });
  return value.keys;
}
__name(signingKeys, "signingKeys");
function tokenFrom(request) {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) return assertion;
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}
__name(tokenFrom, "tokenFrom");
async function authenticateAdmin(request, env, options = {}) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED" };
  const token = tokenFrom(request);
  if (!token) return { ok: false, status: 401, code: "AUTH_REQUIRED" };
  try {
    const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token");
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token");
    const now = Math.floor((options.now?.() ?? Date.now()) / 1e3);
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (claims.iss !== teamDomain || !audiences.includes(env.ACCESS_AUD) || !claims.exp || claims.exp <= now || claims.nbf !== void 0 && claims.nbf > now) throw new Error("Invalid claims");
    if (!claims.email || !claims.sub) throw new Error("Missing identity");
    const keys = await signingKeys(teamDomain, options.fetcher ?? fetch, now);
    const jwk = keys.find((key2) => key2.kid === header.kid && key2.kty === "RSA" && (!key2.alg || key2.alg === "RS256"));
    if (!jwk) throw new Error("Unknown signing key");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = decodeBase64Url(parts[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature.buffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) throw new Error("Invalid signature");
    const email = claims.email.trim().toLowerCase();
    const allowed = new Set(env.ADMIN_EMAILS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (!allowed.has(email)) return { ok: false, status: 403, code: "AUTH_FORBIDDEN" };
    return { ok: true, principal: { email, subject: claims.sub, expiresAt: claims.exp } };
  } catch {
    return { ok: false, status: 401, code: "AUTH_INVALID" };
  }
}
__name(authenticateAdmin, "authenticateAdmin");

// src/chords/theory.ts
var SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var FLAT_TO_SHARP = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#"
};
function normalizeInterval(interval) {
  return (interval % 12 + 12) % 12;
}
__name(normalizeInterval, "normalizeInterval");
function pitchClassFromName(note) {
  const withoutOctave = note.replace(/-?\d+$/, "");
  const normalized = FLAT_TO_SHARP[withoutOctave] ?? withoutOctave;
  const result = SHARP_NOTE_NAMES.indexOf(normalized);
  if (result < 0) throw new Error(`Unknown note name: ${note}`);
  return result;
}
__name(pitchClassFromName, "pitchClassFromName");
function pitchClassName(pitchClass) {
  return SHARP_NOTE_NAMES[normalizeInterval(pitchClass)];
}
__name(pitchClassName, "pitchClassName");
function pitchFromTuningAndFret(openMidi, fret) {
  if (!Number.isInteger(fret) || fret < 0) throw new Error("Fret must be a non-negative integer");
  const midi = openMidi + fret;
  return {
    stringIndex: -1,
    fret,
    midi,
    pitchClass: normalizeInterval(midi),
    note: pitchClassName(midi)
  };
}
__name(pitchFromTuningAndFret, "pitchFromTuningAndFret");
function pitchesForVoicing(tuning, frets) {
  if (frets.length !== tuning.strings.length) throw new Error("Fret positions must match the tuning's string count");
  return frets.flatMap((fret, stringIndex) => {
    if (fret === null) return [];
    return [{ ...pitchFromTuningAndFret(tuning.strings[stringIndex].midi, fret), stringIndex }];
  });
}
__name(pitchesForVoicing, "pitchesForVoicing");
function intervalsRelativeToRoot(pitches, root) {
  const rootPitchClass = pitchClassFromName(root);
  return pitches.map((pitch) => normalizeInterval(pitch.pitchClass - rootPitchClass));
}
__name(intervalsRelativeToRoot, "intervalsRelativeToRoot");
function uniqueIntervals(intervals) {
  return [...new Set(intervals.map(normalizeInterval))].sort((a, b) => a - b);
}
__name(uniqueIntervals, "uniqueIntervals");
function chordToneCoverage(intervals, requestedTones) {
  const present = new Set(intervals.map(normalizeInterval));
  const requested = [...new Set(requestedTones.map(normalizeInterval))];
  if (requested.length === 0) return 1;
  return requested.filter((tone) => present.has(tone)).length / requested.length;
}
__name(chordToneCoverage, "chordToneCoverage");
function bassPitch(pitches) {
  return pitches.length ? pitches.reduce((lowest, pitch) => pitch.midi < lowest.midi ? pitch : lowest) : null;
}
__name(bassPitch, "bassPitch");
function inversionForPitches(pitches, root) {
  const bass = bassPitch(pitches);
  if (!bass) return "No bass";
  const interval = normalizeInterval(bass.pitchClass - pitchClassFromName(root));
  if (interval === 0) return "Root position";
  if (interval === 3 || interval === 4) return "1st inversion";
  if (interval === 7) return "2nd inversion";
  if (interval === 10 || interval === 11) return "3rd inversion";
  return `${pitchClassName(bass.pitchClass)} in bass`;
}
__name(inversionForPitches, "inversionForPitches");
var RELIABLE_CHORD_NAMES = {
  "0,4,7": "",
  "0,3,7": "m",
  "0,4,7,11": "maj7",
  "0,4,7,10": "7",
  "0,3,7,10": "m7",
  "0,3,6,10": "m7b5",
  "0,3,6,9": "dim7",
  "0,2,7": "sus2",
  "0,5,7": "sus4",
  "0,4,8": "aug",
  "0,3,6": "dim"
};
function reliableAlternateChordNames(root, intervals, currentName = "") {
  const suffix = RELIABLE_CHORD_NAMES[uniqueIntervals(intervals).join(",")];
  if (suffix === void 0) return [];
  const name = `${pitchClassName(pitchClassFromName(root))}${suffix}`;
  return name === currentName ? [] : [name];
}
__name(reliableAlternateChordNames, "reliableAlternateChordNames");

// src/chords/identity.ts
function normalizeFret(value) {
  if (value === null || value === void 0 || value === -1 || String(value).toLowerCase() === "x") return "x";
  const fret = Number(value);
  if (!Number.isInteger(fret) || fret < 0) throw new Error(`Invalid fret value: ${value}`);
  return String(fret);
}
__name(normalizeFret, "normalizeFret");
function normalizedFretPattern(frets) {
  return frets.map(normalizeFret).join("-");
}
__name(normalizedFretPattern, "normalizedFretPattern");
function exactVoicingKey(voicing) {
  const inferredQuality = voicing.chordName.replace(voicing.root, "") || "major";
  const quality = (voicing.chordQuality ?? inferredQuality).toLowerCase();
  return [voicing.tuning.id.toLowerCase(), voicing.root.toLowerCase(), quality, normalizedFretPattern(voicing.fretPositions)].join("|");
}
__name(exactVoicingKey, "exactVoicingKey");

// src/chords/playability.ts
function fretSpanFor(frets) {
  const fretted = frets.filter((fret) => fret !== null && fret > 0);
  return fretted.length < 2 ? 0 : Math.max(...fretted) - Math.min(...fretted);
}
__name(fretSpanFor, "fretSpanFor");
function findPossibleBarres(frets) {
  const result = [];
  const usedFrets = [...new Set(frets.filter((fret) => fret !== null && fret > 0))];
  for (const fret of usedFrets) {
    const indices = frets.flatMap((value, index) => value === fret ? [index] : []);
    if (indices.length < 2) continue;
    const fromString = Math.min(...indices);
    const toString = Math.max(...indices);
    const canBarre = frets.slice(fromString, toString + 1).every((value) => value === null || value === 0 || value >= fret);
    if (canBarre) result.push({ fret, fromString, toString });
  }
  return result;
}
__name(findPossibleBarres, "findPossibleBarres");
function internalMutedStringCount(frets) {
  const played = frets.flatMap((fret, index) => fret === null ? [] : [index]);
  if (played.length < 2) return 0;
  const first = Math.min(...played);
  const last = Math.max(...played);
  return frets.slice(first, last + 1).filter((fret) => fret === null).length;
}
__name(internalMutedStringCount, "internalMutedStringCount");
function analyzePlayability(frets, config) {
  const reasons = [];
  const fretted = frets.filter((fret) => fret !== null && fret > 0);
  const span = fretSpanFor(frets);
  const barres = findPossibleBarres(frets);
  const internalMutes = internalMutedStringCount(frets);
  const maxSpan = config.maxFretSpan ?? 4;
  const maxFretted = config.maxFrettedNotes ?? 5;
  const maxInternalMutes = config.maxInternalMutedStrings ?? 1;
  const maxAdjacentStretch = config.maxAdjacentStretch ?? 4;
  const minPlayedStrings = config.minPlayedStrings ?? 3;
  if (frets.filter((fret) => fret !== null).length < minPlayedStrings) reasons.push("Too few played strings");
  if (span > maxSpan) reasons.push(`Fret span exceeds ${maxSpan}`);
  if (fretted.length > maxFretted) reasons.push(`More than ${maxFretted} fretted notes`);
  if (internalMutes > maxInternalMutes) reasons.push("Too many internal muted strings");
  for (let index = 1; index < frets.length; index += 1) {
    const previous = frets[index - 1];
    const current = frets[index];
    if (previous && current && Math.abs(previous - current) > maxAdjacentStretch) {
      reasons.push("Impossible adjacent-string stretch");
      break;
    }
  }
  const pitches = pitchesForVoicing(config.tuning, frets);
  const intervals = intervalsRelativeToRoot(pitches, config.root);
  const present = new Set(intervals);
  const required = config.requiredTones.filter((tone) => !(config.allowOmitFifth && tone % 12 === 7));
  const missing = required.filter((tone) => !present.has((tone % 12 + 12) % 12));
  if (missing.length) reasons.push(`Missing required tones: ${missing.join(", ")}`);
  const barreSavings = barres.reduce((total, barre) => total + Math.max(0, frets.slice(barre.fromString, barre.toString + 1).filter((fret) => fret === barre.fret).length - 1), 0);
  const estimatedFingerCount = Math.max(0, fretted.length - barreSavings);
  if (estimatedFingerCount > 4) reasons.push("Requires more than four fingers");
  const effort = span + estimatedFingerCount + internalMutes + (Math.max(...fretted, 0) >= 9 ? 1 : 0);
  const difficulty = Math.min(5, Math.max(1, Math.ceil(effort / 2)));
  return {
    valid: reasons.length === 0,
    reasons,
    fretSpan: span,
    frettedNoteCount: fretted.length,
    openStringCount: frets.filter((fret) => fret === 0).length,
    internalMutedStringCount: internalMutes,
    possibleBarres: barres,
    estimatedFingerCount,
    difficulty
  };
}
__name(analyzePlayability, "analyzePlayability");

// src/chords/recipes.ts
var CHORD_RECIPES = [
  { id: "major", label: "Major", suffix: "", family: "Triad", requiredIntervals: [0, 4, 7], optionalIntervals: [], permittedOmissions: [7], aliases: ["maj", "major-triad"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "minor", label: "Minor", suffix: "m", family: "Triad", requiredIntervals: [0, 3, 7], optionalIntervals: [], permittedOmissions: [7], aliases: ["min", "minor-triad", "m"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "sus2", label: "Suspended 2", suffix: "sus2", family: "Sus", requiredIntervals: [0, 2, 7], optionalIntervals: [], permittedOmissions: [], aliases: ["suspended2"], publicQualityFamily: "Neither", generatorAvailable: true, canonicalSupport: { open: true, barre: false } },
  { id: "sus4", label: "Suspended 4", suffix: "sus4", family: "Sus", requiredIntervals: [0, 5, 7], optionalIntervals: [], permittedOmissions: [], aliases: ["sus", "suspended4"], publicQualityFamily: "Neither", generatorAvailable: true, canonicalSupport: { open: true, barre: false } },
  { id: "dom7", label: "Dominant 7", suffix: "7", family: "7th", requiredIntervals: [0, 4, 10], optionalIntervals: [7], permittedOmissions: [7], aliases: ["dominant7", "7"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "maj7", label: "Major 7", suffix: "maj7", family: "7th", requiredIntervals: [0, 4, 11], optionalIntervals: [7], permittedOmissions: [7], aliases: ["major7"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "min7", label: "Minor 7", suffix: "m7", family: "7th", requiredIntervals: [0, 3, 10], optionalIntervals: [7], permittedOmissions: [7], aliases: ["minor7", "m7"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: true } },
  { id: "maj9", label: "Major 9", suffix: "maj9", family: "9th", requiredIntervals: [0, 4, 11], optionalIntervals: [2, 7], permittedOmissions: [7], aliases: ["major9"], publicQualityFamily: "Major", generatorAvailable: true, canonicalSupport: { open: false, barre: false } },
  { id: "min9", label: "Minor 9", suffix: "m9", family: "9th", requiredIntervals: [0, 3, 10], optionalIntervals: [2, 7], permittedOmissions: [7], aliases: ["minor9", "m9"], publicQualityFamily: "Minor", generatorAvailable: false, canonicalSupport: { open: true, barre: false } },
  { id: "min11", label: "Minor 11", suffix: "m11", family: "11th", requiredIntervals: [0, 3, 10], optionalIntervals: [2, 5, 7], permittedOmissions: [7], aliases: ["minor11", "m11"], publicQualityFamily: "Minor", generatorAvailable: true, canonicalSupport: { open: true, barre: false } }
];
var recipeLookup = /* @__PURE__ */ new Map();
for (const recipe of CHORD_RECIPES) {
  recipeLookup.set(recipe.id.toLowerCase(), recipe);
  for (const alias of recipe.aliases) recipeLookup.set(alias.toLowerCase(), recipe);
}
function recipeById(id) {
  return recipeLookup.get(id.trim().toLowerCase());
}
__name(recipeById, "recipeById");
function requireRecipe(id) {
  const recipe = recipeById(id);
  if (!recipe) throw new Error(`Unknown chord recipe: ${id}`);
  return recipe;
}
__name(requireRecipe, "requireRecipe");

// src/chords/scoring.ts
function scoreVoicing(pitches, intervals, analysis, config) {
  const allTones = [...config.requiredTones, ...config.optionalTones ?? []];
  const scoreRequiredTones = config.allowOmitFifth ? config.requiredTones.filter((tone) => normalizeInterval(tone) !== 7) : config.requiredTones;
  const requiredCoverage = chordToneCoverage(intervals, scoreRequiredTones);
  const totalCoverage = chordToneCoverage(intervals, allTones);
  const uniquePitchClasses = new Set(pitches.map((pitch) => pitch.pitchClass));
  const bassInterval = pitches.length ? normalizeInterval(pitches.reduce((a, b) => a.midi < b.midi ? a : b).pitchClass - pitchClassFromName(config.root)) : -1;
  const extensionSet = new Set((config.optionalTones ?? []).filter((tone) => ![0, 3, 4, 7, 10, 11].includes(normalizeInterval(tone))).map(normalizeInterval));
  const presentExtensions = [...extensionSet].filter((tone) => intervals.map(normalizeInterval).includes(tone)).length;
  let muddyPairs = 0;
  const lowPitches = pitches.filter((pitch) => pitch.midi < 52).sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < lowPitches.length; i += 1) {
    if (lowPitches[i].midi - lowPitches[i - 1].midi <= 2) muddyPairs += 1;
  }
  const duplicateCount = Math.max(0, pitches.length - uniquePitchClasses.size - 1);
  const breakdown = {
    harmonicCompleteness: Math.round(25 * requiredCoverage),
    playability: Math.max(0, 25 - analysis.fretSpan * 2 - Math.max(0, analysis.estimatedFingerCount - 3) * 3 - analysis.internalMutedStringCount * 2),
    usefulBass: bassInterval === 0 ? 10 : [3, 4, 7, 10, 11].includes(bassInterval) ? 7 : 3,
    openStrings: Math.min(8, analysis.openStringCount * 3),
    extensions: extensionSet.size ? Math.round(8 * (presentExtensions / extensionSet.size)) : Math.round(8 * totalCoverage),
    uniqueness: Math.min(8, Math.max(0, uniquePitchClasses.size - 2) * 3),
    fretSpanPenalty: analysis.fretSpan > 3 ? (analysis.fretSpan - 3) * 3 : 0,
    muddyIntervalPenalty: muddyPairs * 5,
    duplicateNotePenalty: duplicateCount * 2
  };
  const positive = breakdown.harmonicCompleteness + breakdown.playability + breakdown.usefulBass + breakdown.openStrings + breakdown.extensions + breakdown.uniqueness;
  const negative = breakdown.fretSpanPenalty + breakdown.muddyIntervalPenalty + breakdown.duplicateNotePenalty;
  return { score: Math.max(0, Math.min(100, Math.round(positive - negative))), breakdown };
}
__name(scoreVoicing, "scoreVoicing");

// src/chords/persisted.ts
var CHORD_SCHEMA_VERSION = 1;
var DIFFICULTY_MIN = 1;
var DIFFICULTY_MAX = 5;
var WORKFLOW_STATUSES = /* @__PURE__ */ new Set(["pending", "pre-reviewed", "published", "rejected"]);
var CATEGORIES = /* @__PURE__ */ new Set(["Essential Open", "Essential Barre", "Other Approved"]);
var SHAPE_FAMILIES = /* @__PURE__ */ new Set(["Open C shape", "Open A shape", "Open G shape", "Open E shape", "Open D shape", "E-shape barre", "A-shape barre", "CAGED movable shape", "Partial barre", "Shell voicing"]);
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isObject, "isObject");
function validateString(value, path, issues, optional = false) {
  if (optional && value === void 0) return false;
  if (typeof value !== "string" || value.trim() === "") issues.push({ path, message: "must be a non-empty string" });
  return typeof value === "string" && value.trim() !== "";
}
__name(validateString, "validateString");
function validateTuning(value, issues) {
  if (!isObject(value)) {
    issues.push({ path: "tuning", message: "must be an object" });
    return false;
  }
  validateString(value.id, "tuning.id", issues);
  validateString(value.name, "tuning.name", issues);
  if (!Array.isArray(value.strings) || value.strings.length !== 6) {
    issues.push({ path: "tuning.strings", message: "must contain exactly six strings" });
    return false;
  }
  value.strings.forEach((entry, index) => {
    if (!isObject(entry)) {
      issues.push({ path: `tuning.strings[${index}]`, message: "must be an object" });
      return;
    }
    validateString(entry.note, `tuning.strings[${index}].note`, issues);
    if (!Number.isInteger(entry.midi) || Number(entry.midi) < 0 || Number(entry.midi) > 127) issues.push({ path: `tuning.strings[${index}].midi`, message: "must be a MIDI integer from 0 to 127" });
  });
  return true;
}
__name(validateTuning, "validateTuning");
function validatePositions(value, path, issues, fingers = false) {
  if (!Array.isArray(value) || value.length !== 6) {
    issues.push({ path, message: "must contain exactly six string positions" });
    return false;
  }
  value.forEach((position, index) => {
    const valid = position === null || Number.isInteger(position) && Number(position) >= (fingers ? 1 : 0) && Number(position) <= (fingers ? 4 : 24);
    if (!valid) issues.push({ path: `${path}[${index}]`, message: fingers ? "must be null or a finger number from 1 to 4" : "must be null or a fret integer from 0 to 24" });
  });
  return true;
}
__name(validatePositions, "validatePositions");
function validatePersistedChord(value) {
  const issues = [];
  if (!isObject(value)) return { ok: false, issues: [{ path: "$", message: "record must be an object" }] };
  if (value.schemaVersion !== CHORD_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: value.schemaVersion === void 0 ? "is required" : `unsupported schema version: ${String(value.schemaVersion)}` });
  validateString(value.id, "id", issues);
  validateString(value.root, "root", issues);
  if (typeof value.root === "string") {
    try {
      pitchClassFromName(value.root);
    } catch {
      issues.push({ path: "root", message: "must be a recognized pitch class" });
    }
  }
  if (typeof value.recipeId !== "string" || !recipeById(value.recipeId) || recipeById(value.recipeId)?.id !== value.recipeId) issues.push({ path: "recipeId", message: "must be a canonical registered recipe id" });
  validateTuning(value.tuning, issues);
  validatePositions(value.fretPositions, "fretPositions", issues);
  if (value.fingerPositions !== void 0) validatePositions(value.fingerPositions, "fingerPositions", issues, true);
  if (value.displayNameOverride !== void 0) validateString(value.displayNameOverride, "displayNameOverride", issues);
  if (typeof value.description !== "string") issues.push({ path: "description", message: "must be a string" });
  if (!Number.isInteger(value.difficulty) || Number(value.difficulty) < DIFFICULTY_MIN || Number(value.difficulty) > DIFFICULTY_MAX) issues.push({ path: "difficulty", message: "must be an integer from 1 to 5" });
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) issues.push({ path: "tags", message: "must be an array of non-empty strings" });
  if (typeof value.workflowStatus !== "string" || !WORKFLOW_STATUSES.has(value.workflowStatus)) issues.push({ path: "workflowStatus", message: "must be pending, pre-reviewed, published, or rejected" });
  if (!isObject(value.provenance)) issues.push({ path: "provenance", message: "must be an object" });
  else validateString(value.provenance.source, "provenance.source", issues);
  if (value.catalog !== void 0) {
    if (!isObject(value.catalog)) issues.push({ path: "catalog", message: "must be an object" });
    else {
      if (typeof value.catalog.canonical !== "boolean") issues.push({ path: "catalog.canonical", message: "must be boolean" });
      if (typeof value.catalog.essential !== "boolean") issues.push({ path: "catalog.essential", message: "must be boolean" });
      if (value.catalog.category !== void 0 && !CATEGORIES.has(value.catalog.category)) issues.push({ path: "catalog.category", message: "is not a recognized category" });
      if (value.catalog.displayPriority !== void 0 && (!Number.isInteger(value.catalog.displayPriority) || Number(value.catalog.displayPriority) < 0)) issues.push({ path: "catalog.displayPriority", message: "must be a non-negative integer" });
      if (value.catalog.canonical === true && value.catalog.essential !== true) issues.push({ path: "catalog.essential", message: "canonical records must be essential" });
      if (value.catalog.canonical === true && value.catalog.category !== "Essential Open" && value.catalog.category !== "Essential Barre") issues.push({ path: "catalog.category", message: "canonical records must use an essential category" });
      if (value.catalog.shapeFamily !== void 0 && (typeof value.catalog.shapeFamily !== "string" || !SHAPE_FAMILIES.has(value.catalog.shapeFamily))) issues.push({ path: "catalog.shapeFamily", message: "is not a recognized shape family" });
      if (value.catalog.movable !== void 0 && typeof value.catalog.movable !== "boolean") issues.push({ path: "catalog.movable", message: "must be boolean" });
      if (value.catalog.baseShapeRoot !== void 0) validateString(value.catalog.baseShapeRoot, "catalog.baseShapeRoot", issues);
      if (value.catalog.applicableRoots !== void 0 && (!Array.isArray(value.catalog.applicableRoots) || value.catalog.applicableRoots.some((root) => typeof root !== "string"))) issues.push({ path: "catalog.applicableRoots", message: "must be an array of roots" });
    }
  }
  if (issues.length) return { ok: false, issues };
  const record = value;
  return { ok: true, value: { ...record, tags: [...new Set(record.tags.map((tag) => tag.trim()))] }, issues: [] };
}
__name(validatePersistedChord, "validatePersistedChord");
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
__name(slugify, "slugify");
function hydratePersistedChord(record) {
  const validated = validatePersistedChord(record);
  if (!validated.ok) throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  const value = validated.value;
  const recipe = requireRecipe(value.recipeId);
  const root = pitchClassName(pitchClassFromName(value.root));
  const chordName = value.displayNameOverride ?? `${root}${recipe.suffix}`;
  const pitches = pitchesForVoicing(value.tuning, value.fretPositions);
  const intervals = intervalsRelativeToRoot(pitches, root);
  const analysis = analyzePlayability(value.fretPositions, { tuning: value.tuning, chordName, chordQuality: recipe.id, root, requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals], fretMin: 0, fretMax: 24, maxFretSpan: 24, maxFrettedNotes: 6, maxInternalMutedStrings: 6, maxAdjacentStretch: 24, minPlayedStrings: 1, allowOmitFifth: recipe.permittedOmissions.includes(7) });
  const scored = scoreVoicing(pitches, intervals, analysis, { tuning: value.tuning, chordName, chordQuality: recipe.id, root, requiredTones: [...recipe.requiredIntervals], optionalTones: [...recipe.optionalIntervals] });
  const bass = bassPitch(pitches);
  const catalog = value.catalog;
  return {
    id: value.id,
    slug: `${slugify(chordName)}-${slugify(value.id)}`,
    chordName,
    chordQuality: recipe.id,
    root,
    tuning: value.tuning,
    fretPositions: [...value.fretPositions],
    fingerPositions: value.fingerPositions ? [...value.fingerPositions] : void 0,
    notes: pitches.map((pitch) => pitch.note),
    intervals,
    bassNote: bass?.note ?? "",
    inversion: inversionForPitches(pitches, root),
    alternateNames: reliableAlternateChordNames(root, intervals, chordName),
    fretSpan: analysis.fretSpan,
    openStringCount: analysis.openStringCount,
    difficulty: value.difficulty,
    moodTags: [...value.tags],
    genreTags: [],
    descriptorTags: [...value.tags],
    description: value.description,
    qualityScore: scored.score,
    scoreBreakdown: scored.breakdown,
    approvalStatus: value.workflowStatus === "pending" ? "pending" : value.workflowStatus === "rejected" ? "rejected" : "approved",
    possibleBarres: analysis.possibleBarres,
    shapeFamily: catalog?.shapeFamily,
    category: catalog?.category,
    source: value.provenance.source,
    isCanonical: catalog?.canonical,
    isEssential: catalog?.essential,
    displayPriority: catalog?.displayPriority,
    movable: catalog?.movable,
    baseShapeRoot: catalog?.baseShapeRoot,
    applicableRoots: catalog?.applicableRoots
  };
}
__name(hydratePersistedChord, "hydratePersistedChord");

// worker/d1-repository.ts
var HostedDataError = class extends Error {
  static {
    __name(this, "HostedDataError");
  }
  code;
  constructor(code, message) {
    super(message);
    this.name = "HostedDataError";
    this.code = code;
  }
};
function parseRow(row) {
  let raw;
  try {
    raw = JSON.parse(row.record_json);
  } catch {
    throw new HostedDataError("INVALID_RECORD", "Stored chord JSON is malformed.");
  }
  const validation = validatePersistedChord(raw);
  if (!validation.ok) {
    const unknown = validation.issues.some((issue) => issue.path === "schemaVersion");
    throw new HostedDataError(unknown ? "UNKNOWN_VERSION" : "INVALID_RECORD", "Stored chord failed schema validation.");
  }
  hydratePersistedChord(validation.value);
  return validation.value;
}
__name(parseRow, "parseRow");
function slug(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
__name(slug, "slug");
var D1ChordStore = class {
  static {
    __name(this, "D1ChordStore");
  }
  db;
  constructor(db) {
    this.db = db;
  }
  async list(status) {
    const result = await this.db.prepare("SELECT id, schema_version, record_json FROM chord_voicings WHERE workflow_status = ?1 ORDER BY updated_at DESC, id ASC").bind(status).all();
    if (!result.success) throw new HostedDataError("DATABASE", "Chord query failed.");
    return result.results.map(parseRow);
  }
  async get(id) {
    const row = await this.db.prepare("SELECT id, schema_version, record_json FROM chord_voicings WHERE id = ?1").bind(id).first();
    return row ? parseRow(row) : null;
  }
  validated(value, status) {
    const result = validatePersistedChord(value);
    if (!result.ok) {
      const unknown = result.issues.some((issue) => issue.path === "schemaVersion" && issue.message.includes("unsupported"));
      throw new HostedDataError(unknown ? "UNKNOWN_VERSION" : "INVALID_RECORD", "Chord payload failed validation.");
    }
    const record = { ...result.value, workflowStatus: status };
    hydratePersistedChord(record);
    return record;
  }
  upsert(record) {
    return this.db.prepare(`INSERT INTO chord_voicings (id,schema_version,root,recipe_id,tuning_json,frets_json,fingers_json,display_name_override,description,difficulty,workflow_status,catalog_json,provenance_json,record_json,updated_at,published_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,CURRENT_TIMESTAMP,CASE WHEN ?11='published' THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,root=excluded.root,recipe_id=excluded.recipe_id,tuning_json=excluded.tuning_json,frets_json=excluded.frets_json,fingers_json=excluded.fingers_json,display_name_override=excluded.display_name_override,description=excluded.description,difficulty=excluded.difficulty,workflow_status=excluded.workflow_status,catalog_json=excluded.catalog_json,provenance_json=excluded.provenance_json,record_json=excluded.record_json,updated_at=CURRENT_TIMESTAMP,published_at=CASE WHEN excluded.workflow_status='published' THEN COALESCE(chord_voicings.published_at,CURRENT_TIMESTAMP) ELSE chord_voicings.published_at END`).bind(record.id, record.schemaVersion, record.root, record.recipeId, JSON.stringify(record.tuning), JSON.stringify(record.fretPositions), record.fingerPositions ? JSON.stringify(record.fingerPositions) : null, record.displayNameOverride ?? null, record.description, record.difficulty, record.workflowStatus, record.catalog ? JSON.stringify(record.catalog) : null, JSON.stringify(record.provenance), JSON.stringify(record));
  }
  tagStatements(record) {
    const statements = [this.db.prepare("DELETE FROM chord_voicing_tags WHERE chord_voicing_id = ?1").bind(record.id)];
    for (const label of record.tags) {
      statements.push(this.db.prepare("INSERT INTO tags (slug,label,category) VALUES (?1,?2,'descriptor') ON CONFLICT(slug) DO UPDATE SET label=excluded.label").bind(slug(label), label));
      statements.push(this.db.prepare("INSERT OR IGNORE INTO chord_voicing_tags (chord_voicing_id,tag_id) SELECT ?1,id FROM tags WHERE slug=?2").bind(record.id, slug(label)));
    }
    return statements;
  }
  audit(id, action, actor, metadata = {}) {
    return this.db.prepare("INSERT INTO admin_audit_log (chord_voicing_id,action,actor_identifier,metadata_json) VALUES (?1,?2,?3,?4)").bind(id, action, actor, JSON.stringify(metadata));
  }
  async atomic(statements) {
    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) throw new HostedDataError("DATABASE", "Atomic chord operation failed.");
  }
  async preReview(value, actor = "system") {
    const record = this.validated(value, "pre-reviewed");
    await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, "Moved to pre-reviewed", actor)]);
    return record;
  }
  async publish(value, actor = "system") {
    const record = this.validated(value, "published");
    const hydrated = hydratePersistedChord(record);
    const published = await this.list("published");
    if (published.some((item) => item.id !== record.id && exactVoicingKey(hydratePersistedChord(item)) === exactVoicingKey(hydrated))) throw new HostedDataError("DUPLICATE", "An equivalent voicing is already published.");
    await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, "Published", actor)]);
    return record;
  }
  async reject(id, actor = "system") {
    const current = await this.get(id);
    if (!current) throw new HostedDataError("NOT_FOUND", "Chord not found.");
    const record = { ...current, workflowStatus: "rejected" };
    await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(id, "Rejected", actor)]);
  }
  async replace(replacedId, value, actor = "system") {
    const old = await this.get(replacedId);
    if (!old) throw new HostedDataError("NOT_FOUND", "Replacement target not found.");
    const replacement = this.validated(value, "published");
    const rejected = { ...old, workflowStatus: "rejected" };
    await this.atomic([this.upsert(rejected), this.upsert(replacement), ...this.tagStatements(replacement), this.audit(replacement.id, "Replaced chord", actor, { replacedId })]);
    return replacement;
  }
  async merge(targetId, value, actor = "system") {
    const target = await this.get(targetId);
    if (!target) throw new HostedDataError("NOT_FOUND", "Merge target not found.");
    const source = this.validated(value, target.workflowStatus);
    const merged = { ...target, description: target.description || source.description, tags: [.../* @__PURE__ */ new Set([...target.tags, ...source.tags])] };
    await this.atomic([this.upsert(merged), ...this.tagStatements(merged), this.audit(targetId, "Merged chord metadata", actor, { sourceId: source.id })]);
    return merged;
  }
  async edit(id, value, actor = "system") {
    const current = await this.get(id);
    if (!current) throw new HostedDataError("NOT_FOUND", "Chord not found.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HostedDataError("INVALID_RECORD", "Editorial changes must be an object.");
    const changes = value;
    const edited = this.validated({
      ...current,
      ...Object.hasOwn(changes, "description") ? { description: changes.description } : {},
      ...Object.hasOwn(changes, "difficulty") ? { difficulty: changes.difficulty } : {},
      ...Object.hasOwn(changes, "tags") ? { tags: changes.tags } : {},
      ...Object.hasOwn(changes, "displayNameOverride") ? { displayNameOverride: changes.displayNameOverride } : {},
      ...Object.hasOwn(changes, "fingerPositions") ? { fingerPositions: changes.fingerPositions } : {},
      ...Object.hasOwn(changes, "catalog") ? { catalog: changes.catalog } : {}
    }, current.workflowStatus);
    await this.atomic([this.upsert(edited), ...this.tagStatements(edited), this.audit(id, "Edited chord metadata", actor)]);
    return edited;
  }
  async auditLog() {
    const result = await this.db.prepare("SELECT id,chord_voicing_id,action,actor_identifier,metadata_json,created_at FROM admin_audit_log ORDER BY id DESC LIMIT 500").all();
    return result.results;
  }
  async quarantine() {
    const result = await this.db.prepare("SELECT id,source,raw_json,issues_json,created_at FROM quarantined_records ORDER BY id DESC LIMIT 500").all();
    return result.results;
  }
  async importRecords(values, dryRun, actor = "system") {
    const report = { inserted: 0, updated: 0, skipped: 0, duplicate: 0, quarantined: 0, failed: 0, diagnostics: [] };
    for (const value of values) {
      try {
        const validation = validatePersistedChord(value);
        if (!validation.ok) {
          report.quarantined += 1;
          report.diagnostics.push(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
          continue;
        }
        const record = validation.value;
        hydratePersistedChord(record);
        const existing = await this.get(record.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(record)) {
          report.skipped += 1;
          continue;
        }
        const sameShape = (await this.list(record.workflowStatus)).some((item) => item.id !== record.id && exactVoicingKey(hydratePersistedChord(item)) === exactVoicingKey(hydratePersistedChord(record)));
        if (sameShape) {
          report.duplicate += 1;
          continue;
        }
        if (existing) report.updated += 1;
        else report.inserted += 1;
        if (!dryRun) await this.atomic([this.upsert(record), ...this.tagStatements(record), this.audit(record.id, existing ? "Imported update" : "Imported insert", actor)]);
      } catch (error) {
        report.failed += 1;
        report.diagnostics.push(error instanceof Error ? error.message : "Import failure");
      }
    }
    return report;
  }
};

// worker/index.ts
var defaultDependencies = { authenticate: authenticateAdmin };
var securityHeaders = { "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
function json(value, status = 200, isPublic = false) {
  return Response.json(value, { status, headers: { ...securityHeaders, "Cache-Control": isPublic && status === 200 ? "public, max-age=60" : "no-store", ...isPublic ? {} : { Vary: "Cf-Access-Jwt-Assertion, Cookie" } } });
}
__name(json, "json");
function errorResponse(error) {
  if (error instanceof HostedDataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "DUPLICATE" ? 409 : error.code === "DATABASE" ? 503 : 400;
    return json({ error: { code: error.code, message: status === 503 ? "The chord service is temporarily unavailable." : error.message } }, status);
  }
  return json({ error: { code: "INTERNAL", message: "The chord service could not complete the request." } }, 500);
}
__name(errorResponse, "errorResponse");
function authFailure(result) {
  const messages = {
    AUTH_REQUIRED: "Administrator authentication is required.",
    AUTH_INVALID: "The administrator session is invalid or expired.",
    AUTH_FORBIDDEN: "This identity is not authorized as an administrator.",
    AUTH_NOT_CONFIGURED: "Administrator authentication is not configured."
  };
  return json({ error: { code: result.code, message: messages[result.code] } }, result.status);
}
__name(authFailure, "authFailure");
async function requireAdmin(request, env, dependencies) {
  const result = await dependencies.authenticate(request, env);
  console.log("AUTH RESULT:", JSON.stringify(result));
  return result.ok ? result.principal : authFailure(result);
}
__name(requireAdmin, "requireAdmin");
async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HostedDataError("INVALID_RECORD", "Request body must be valid JSON.");
  }
}
__name(body, "body");
function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}
__name(sameOrigin, "sameOrigin");
function withPrivateHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cf-Access-Jwt-Assertion, Cookie");
  Object.entries(securityHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
__name(withPrivateHeaders, "withPrivateHeaders");
async function handleApi(request, env, dependencies = defaultDependencies) {
  const url = new URL(request.url);
  const path = url.pathname;
  const store = new D1ChordStore(env.DB);
  if (!sameOrigin(request, url)) return json({ error: { code: "ORIGIN_DENIED", message: "Cross-origin requests are not allowed." } }, 403);
  try {
    if (request.method === "GET" && path === "/api/chords/published") return json({ records: await store.list("published") }, 200, true);
    const chordMatch = path.match(/^\/api\/chords\/([^/]+)$/);
    if (request.method === "GET" && chordMatch) {
      const record = await store.get(decodeURIComponent(chordMatch[1]));
      return record?.workflowStatus === "published" ? json({ record }, 200, true) : json({ error: { code: "NOT_FOUND", message: "Chord not found." } }, 404);
    }
    if (request.method === "GET" && path === "/api/admin/logout") return Response.redirect(new URL("/cdn-cgi/access/logout", url.origin), 302);
    if (!path.startsWith("/api/admin/")) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;
    console.log("ADMIN PRINCIPAL:", JSON.stringify(principal));
    if (request.method === "GET" && path === "/api/admin/session") return json({ administrator: { email: principal.email }, expiresAt: principal.expiresAt });
    if (request.method === "GET" && path === "/api/admin/chords/pre-reviewed") return json({ records: await store.list("pre-reviewed") });
    if (request.method === "GET" && path === "/api/admin/audit") return json({ entries: await store.auditLog() });
    if (request.method === "GET" && path === "/api/admin/quarantine") return json({ records: await store.quarantine() });
    if (request.method === "GET" && path === "/api/admin/backups") return json({ records: [...await store.list("pre-reviewed"), ...await store.list("published"), ...await store.list("rejected")] });
    if (!adminEnabled(env)) return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    if (request.method === "POST" && path === "/api/admin/chords/import") {
      const value2 = await body(request);
      return json({ report: await store.importRecords(Array.isArray(value2.records) ? value2.records : [], value2.dryRun === true, principal.email) });
    }
    const operation = path.match(/^\/api\/admin\/chords\/([^/]+)\/(pre-review|publish|reject|replace|merge|edit)$/);
    if (!operation || request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
    const id = decodeURIComponent(operation[1]);
    const action = operation[2];
    if (action === "reject") {
      await store.reject(id, principal.email);
      return json({ ok: true });
    }
    const value = await body(request);
    if (action === "pre-review") return json({ record: await store.preReview(value, principal.email) });
    if (action === "publish") return json({ record: await store.publish(value, principal.email) });
    if (action === "replace") return json({ record: await store.replace(id, value, principal.email) });
    if (action === "edit") return json({ record: await store.edit(id, value, principal.email) });
    return json({ record: await store.merge(id, value, principal.email) });
  } catch (error) {
    console.log("ERROR:", error instanceof Error ? error.stack : error);
    return errorResponse(error);
  }
}
__name(handleApi, "handleApi");
function adminEnabled(env) {
  return env.ALLOW_ADMIN_MUTATIONS === "true";
}
__name(adminEnabled, "adminEnabled");
function isReviewPath(path) {
  return path === "/review" || path === "/review/" || path === "/review.html";
}
__name(isReviewPath, "isReviewPath");
async function handleRequest(request, env, dependencies = defaultDependencies) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, dependencies);
  if (isReviewPath(url.pathname)) {
    const principal = await requireAdmin(request, env, dependencies);
    if (principal instanceof Response) return principal;
    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    const assetRequest = url.pathname === "/review.html" ? request : new Request(new URL("/review.html", url), request);
    return withPrivateHeaders(await env.ASSETS.fetch(assetRequest));
  }
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}
__name(handleRequest, "handleRequest");
var index_default = { fetch: handleRequest };
export {
  index_default as default,
  handleApi,
  handleRequest
};
//# sourceMappingURL=index.js.map
