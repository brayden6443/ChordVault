# Chord Vault architecture and pre-launch health audit

Audit date: 2026-08-03

## Persisted chord contract (schema version 1)

`src/chords/persisted.ts` is the authoritative boundary for chord records saved by the application or accepted from imports. A saved record contains only stable source and editorial facts: its schema version, identity, root, registered recipe, full tuning, six fret positions, optional finger positions, optional display-name override, description, difficulty (1–5), tags, workflow status, catalog metadata, and provenance.

Notes, intervals, bass note, inversion, alternate names, fret span, open-string count, possible barres, playback frequencies, and quality scores are calculated when a record is hydrated. They are deliberately not authoritative persisted fields because they can be reproduced from tuning, frets, root, and recipe. This prevents stale or imported calculations from overriding deterministic music theory.

Runtime validation rejects malformed tunings and positions, unknown recipes, invalid difficulty/status values, inconsistent canonical metadata, and unknown schema versions. Invalid records are quarantined with field-level diagnostics instead of crashing a page or entering the usable collection.

`src/chords/recipes.ts` is the single recipe registry. It contains only recipes already supported by Chord Vault: major, minor, sus2, sus4, dominant 7, major 7, minor 7, major 9, minor 9, and minor 11. Generator availability and canonical open/barre coverage are explicit metadata, so a planned recipe can be added in one place and tested.

The review page performs an additive, one-time migration to `chord-vault-persisted-v1`. Before writing, it stores the untouched legacy JSON strings in `chord-vault-migration-backup-v1`. It never deletes or rewrites the old approved or published keys. Separate records retain the migration report and quarantined data. Re-running is idempotent because an existing versioned envelope is not overwritten. The pure migration functions also support dry-run reporting.

This phase does not make the new envelope the live repository and does not introduce a backend. Authentication, a hosted repository, favorites, collections, exports, and additional recipes remain later planned phases. That boundary keeps this schema work reversible and avoids abstractions those features do not yet require.

## Chord repository boundary

`src/chords/chord-repository.ts` now owns browser persistence and workflow coordination. The public and review pages use the `ChordRepository` contract instead of knowing individual chord storage keys. `LocalStorageChordRepository` is the first adapter; it continues reading and writing the existing legacy-compatible keys while also maintaining the versioned Step 2 record envelope.

Repository operations cover the workflows that exist today: candidate queues, editorial changes, movement into pre-review, publishing, rejection, review-later decisions, duplicate replacement and metadata merge, public approval keys, favorites, audit entries, backups, and quarantine reports. Theme preference remains a direct UI setting because it is not chord data.

Every chord record crossing the repository is migrated and validated through the versioned schema. Malformed legacy values fall back safely and are copied to quarantine with diagnostics. Existing migration backups are preserved and no legacy key is destructively removed.

For multi-key changes, the local adapter first validates the complete proposed workspace, stores a raw rollback snapshot, writes the compatible keys and V1 envelope, then removes the staged snapshot. If a write fails, it restores the exact previous values. This is best-effort rollback coordination over browser storage, not a true database transaction. Repository errors distinguish validation, corrupt/unknown data, duplicate conflicts, missing records, write failures, and rollback failures while exposing a safe UI message.

Favorites are routed through the repository but intentionally remain keyed by chord name. Stable favorite identity is deferred to the planned identity remediation phase so this repository step does not change current behavior.

## Executive summary

Chord Vault is a small, static, browser-only Vite application. Its deterministic music-theory and generation modules are the strongest part of the system: they are separated by responsibility and covered by 17 passing unit tests. The public vault and private review workflow are not yet production-safe because the browser is also the database and the `/review.html` page has no authentication or authorization.

The minimum responsible pre-launch work is therefore narrow:

1. establish one authoritative, validated chord repository;
2. protect all review and publishing operations with server-enforced administrator authorization;
3. make linting and TypeScript checking real build gates;
4. add a few integration tests for public filtering, approval, and audio selection.

No major visual or product rewrite is required.

## Phase 1: System map

### Framework and runtime

- Vite 7 builds two static HTML entry points. Configuration is in `vite.config.mjs`.
- The public page uses browser JavaScript in `app.js`.
- The private review page uses browser TypeScript in `src/review.ts`; Vite transpiles it but does not type-check it.
- Node's built-in test runner executes TypeScript test files directly through the current Node runtime.
- There is no application server, API, database client, service worker, or server-side rendering.
- `package.json` declares only Vite as a development dependency.

### Folder structure

| Path | Ownership |
|---|---|
| `index.html` | Public page structure and filter controls |
| `app.js` | Public chord assembly, filtering, rendering, favorites, diagrams, and audio |
| `styles.css` | Shared/public visual design |
| `review.html` | Review workspace structure |
| `src/review.ts` | Generator UI, importing, review decisions, publishing, library editing, backups, audit log, duplicate dialog, and review audio |
| `src/review.css` | Review workspace design |
| `src/chords/types.ts` | Central TypeScript domain interfaces and standard tuning |
| `src/chords/theory.ts` | Pitch, note, interval, bass, inversion, and alternate-name calculations |
| `src/chords/playability.ts` | Fret-span, muted-string, stretch, barre, and difficulty analysis |
| `src/chords/scoring.ts` | Deterministic quality scoring |
| `src/chords/generator.ts` | Candidate search, construction, deduplication, and batch generation |
| `src/chords/identity.ts` | Exact identity and similarity calculations |
| `src/chords/canonical.ts` | Hardcoded canonical open shapes and generated barre families |
| `src/chords/repository.ts` | Sorting, canonical seeding, review exclusion, and duplicate checks |
| `src/chords/curation.ts` | Preference profile and ranking adjustment |
| `src/chords/export.ts` | JSON and CSV export |
| `tests/*.test.ts` | Deterministic domain unit tests |
| `CANONICAL_MIGRATION_REPORT.md` | Historical report; it is not an executable migration |

There are no `server`, `api`, `database`, `migrations`, `auth`, or deployment-provider directories.

### Routes and pages

- `/` or `/index.html`: public chord vault.
- `/review.html`: nominally private generator and approval workspace.
- `/#how-to-read`: anchor within the public page.
- `/review.html#libraryEditorTitle`: anchor within the review page.

These are static HTML entries, not protected application routes.

### Major components

The project does not use a component framework. Components are functions and dynamically generated HTML strings.

- Public chord card and diagram: `app.js` `diagram()` and `render()`.
- Public filter engine: `app.js` `chordRoot()`, `chordQuality()`, `qualityFamily()`, `recipeFamily()`, `matchesDifficulty()`, `matchesChordType()`, and `filteredChords()`.
- Public audio: `app.js` `playChord()` and cooldown helpers.
- Review candidate card and diagram: `src/review.ts` `diagram()` and `render()`.
- Review generator: `src/review.ts` generation event handlers plus `src/chords/generator.ts`.
- Library editor: `src/review.ts` `renderLibraryEditor()` and delegated events.
- Duplicate comparison: `src/review.ts` `requestPublish()` and dialog handlers.
- Import/export: `src/review.ts` import parser/normalizer and `src/chords/export.ts`.

### Database access and persistence

There is no remote database. Persistence is browser-scoped:

- `localStorage`: published voicings, approval keys, edits, review records, rejection identities, review-later identities, audit entries, favorites, theme, and the public-library snapshot.
- `sessionStorage`: active generated candidate queue.
- IndexedDB: a single best-effort snapshot written by `mirrorWorkspaceToDatabase()` after audit events.

IndexedDB is a backup mirror, not the read source. The application starts from `localStorage`; it never restores from IndexedDB. Data is therefore tied to one browser profile and origin.

### Chord data flow

```text
Canonical specs (`canonical.ts`) ──> CanonicalVoicing[]
                                          │
Generator recipes (`review.ts`) ──> generated ChordVoicing[]
                                          │
                                     review/exclusion
                                          │
                          localStorage approved / published stores
                                          │
Public hardcoded records (`app.js`) + canonical records + published records
                                          │
                               public display model in `app.js`
                                          │
                   `chord-vault-public-library` localStorage snapshot
                                          │
                                    review library editor
```

This is not a single-source flow: the public page builds a display model and then writes a second representation back for the review page.

### Review and approval flow

1. The reviewer selects a root, recipe, and generation preset in `review.html`.
2. `src/review.ts` calls deterministic generation and ranking functions.
3. `buildReviewQueue()` excludes canonical, approved, near-duplicate, and low-scoring candidates.
4. Approving a generated candidate copies the object into `chord-vault-approved-voicings` (the Pre-reviewed collection).
5. Final approval checks current Main Vault voicings, optionally opens the duplicate comparison, then moves the record to `chord-vault-published-voicings` and adds its id to `chord-vault-final-approved-keys`.
6. The public page reads both keys on its next load and includes matching records.

No server validates, authorizes, serializes, or commits these changes.

### Search and filtering flow

There is no free-text search. `app.js` holds filter state in module variables and filters the in-memory `chords` array by mood, root, major/minor family, recipe family, difficulty, chord type, and saved-only state. The result is paginated in groups of 12. Filter definitions and quality classification are hardcoded in `app.js` rather than shared with the generator recipe definitions.

### Audio playback flow

- Both pages use one lazily created Web Audio `AudioContext` per page.
- Public audio derives frequencies while converting records into the display model, then plays the `tones` array with staggered triangle oscillators.
- Review audio calculates frequency from tuning MIDI plus fret at playback time.
- Muted strings are excluded in both flows.
- Playback stops existing oscillators before starting a new chord. The public page also applies a 500 ms cooldown.

### Authentication and authorization

None exists. `review.html` has `noindex,nofollow`, but that only asks search engines not to index it. Anyone who can reach the deployed file can open the workspace and mutate their own browser state. There is no admin identity, session, route guard, server authorization, or ownership policy.

### Scripts and migrations

Defined scripts are `dev`, `build`, `preview`, and `test`. There are no `lint` or `typecheck` scripts. There is no `tsconfig.json`.

`seedCanonicalVoicings()` is an idempotent in-memory migration helper. `CANONICAL_MIGRATION_REPORT.md` documents an earlier result, but there is no versioned migration command or persisted database migration history.

### Testing setup

Node's built-in `node:test` and `node:assert` cover theory, playability, scoring, generation, export, canonical seeding, duplicate identity, review exclusion, ordering, and the C curation profile. There is no DOM, browser, route, accessibility, storage, import-validation, or audio integration test environment.

### Deployment configuration

Only Vite's two-entry production build is configured. There is no Cloudflare, Vercel, Netlify, Docker, CI, security-header, caching, environment-variable, error-reporting, or rollback configuration in the repository. The generated `dist/` directory is ignored by Git.

## Phase 2: Coherence findings

### F-01 — Browser storage is the production database

- Severity: **critical**
- Affected files: `app.js` lines 120-150; `src/review.ts` lines 25-77 and approval handlers around lines 580-650
- Why it matters: each browser and origin has an independent vault. Clearing storage loses approvals. A deployed public visitor cannot receive the curator's local changes unless using the same storage profile.
- What could break: published chord consistency, backups, multi-device review, deployment promotion, concurrent editing, and auditability.
- Recommended correction: add one repository API backed by durable server storage; make public reads and admin writes use it. Keep local storage only for theme, unsynced drafts, and favorites.
- Must fix before launch: **yes**.

### F-02 — The private workspace is publicly reachable and client-authorized

- Severity: **critical**
- Affected files: `review.html`; `src/review.ts`; `vite.config.mjs`
- Why it matters: `noindex` is not security. All approval and replacement logic ships to every browser.
- What could break: if connected to a real database without a server authorization boundary, any visitor could publish, replace, or reject chord data.
- Recommended correction: require authenticated admin access and enforce authorization on every mutation server-side. Do not rely on hiding the URL or client checks.
- Must fix before launch: **yes**.

### F-03 — Chords have multiple disconnected representations and stores

- Severity: **high**
- Affected files: `src/chords/types.ts`; `app.js` lines 92-142; `src/review.ts` lines 24-45 and 434-500
- Why it matters: `ChordVoicing`, the untyped public chord shape, and `LibraryItem` represent the same record differently. Canonical, curated, approved, published, public snapshot, edits, and final keys are separate collections.
- What could break: a tag, difficulty, name, fingering, approval, or identity change can update one copy but not another. The IndexedDB mirror is write-only and can also become stale.
- Recommended correction: define a persisted record schema and a separate calculated view model; reference records by one stable id; model workflow status on that record or in a normalized decision table.
- Must fix before launch: **yes**, as part of F-01 rather than a separate rewrite.

### F-04 — Runtime data is trusted before validation

- Severity: **high**
- Affected files: `app.js` lines 120, 133, 141, 150; `src/review.ts` lines 25-44; import normalization around lines 267-318
- Why it matters: top-level `JSON.parse()` results are asserted by TypeScript types without runtime validation. A malformed value can crash either page during module initialization. Import validation checks six fret positions and recalculates theory, but it does not validate the complete record schema and only validates recipes it recognizes.
- What could break: public page loading, review recovery, duplicate detection, sorting, exports, and alternate-tuning records.
- Recommended correction: validate every persistence/import boundary with a versioned runtime schema; reject or quarantine invalid records; add storage recovery and migration behavior.
- Must fix before launch: **yes** for the authoritative store and public load path.

### F-05 — Recipe and quality knowledge is duplicated

- Severity: **high**
- Affected files: `src/review.ts` lines 11-22; `src/chords/canonical.ts` lines 22-27; `app.js` lines 189-245
- Why it matters: suffixes, required tones, labels, families, and supported qualities are maintained independently. `maj9` exists in the generator but not canonical `TONES`; `min9` exists canonically/publicly but not as a generator recipe.
- What could break: new recipes may generate correctly but filter incorrectly, import without harmonic validation, or appear in the wrong family.
- Recommended correction: create one recipe registry containing id, suffix, label, required/optional tones, and public filter family; import it everywhere.
- Must fix before launch: **no**, but fix before expanding recipes.

### F-06 — Public audio and favorites identify cards by chord name

- Severity: **high**
- Affected files: `app.js` lines 295-320 and public playback handler
- Why it matters: a vault intentionally contains multiple voicings with the same chord name. `chords.find(c => c.name === ...)` returns the first one, and the favorites set stores names.
- What could break: playing a later alternate voicing can sound the first voicing; saving one voicing saves or unsaves all voicings with that name.
- Recommended correction: bind play and favorite actions to the stable voicing id; calculate playback frequencies from that selected record.
- Must fix before launch: **yes** because this is user-visible core behavior.

### F-07 — `src/review.ts` is an oversized controller with business and presentation logic

- Severity: **medium**
- Affected files: `src/review.ts` (699 lines, approximately 51 KB)
- Why it matters: generation orchestration, imports, storage, audio, publishing, duplicate policy, audit, diagrams, DOM rendering, and keyboard interaction share mutable module state.
- What could break: small UI changes can affect approval persistence or duplicate decisions; isolated testing is difficult.
- Recommended correction: after the repository boundary exists, extract workflow service, import validator, persistence adapter, audio player, and diagram view. Do this incrementally without changing HTML/design.
- Must fix before launch: **no**, provided critical data and authorization boundaries are fixed first.

### F-08 — Core helper logic is duplicated

- Severity: **medium**
- Affected files: `app.js` fingering/diagram/quality helpers; `src/review.ts` diagrams and import hashing; `src/chords/generator.ts` hashing/fingering; `src/chords/canonical.ts` hashing
- Why it matters: there are three diagram renderers, multiple finger inference strategies, two hash implementations, and multiple chord-quality parsers.
- What could break: public and review diagrams or identities can disagree after a rule change.
- Recommended correction: share pure identity, recipe, fingering, diagram-model, and playback-frequency functions. Keep page-specific markup if useful.
- Must fix before launch: **no**, except stable-id playback in F-06.

### F-09 — Generated ids omit chord quality

- Severity: **medium**
- Affected files: `src/chords/generator.ts` `buildVoicing()` shape key and id generation
- Why it matters: the id hash uses tuning, root, and frets, while canonical identity also includes chord quality. The same physical shape accepted under two quality recipes can receive the same id.
- What could break: saved reviews, published replacement, library editing, and deduplication-by-id can overwrite another harmonic interpretation.
- Recommended correction: derive ids from `exactVoicingKey()` or include normalized chord quality in the stable hash; provide an id migration.
- Must fix before launch: **yes** if multiple interpretations are retained; otherwise address with the repository migration.

### F-10 — Bulk final approval does not process the selected set

- Severity: **medium**
- Affected files: `src/review.ts` line 686
- Why it matters: the handler locates the first checked card and clicks only its button. It does not continue with remaining selections.
- What could break: the interface reports a bulk operation but approves one record, leading to reviewer mistakes.
- Recommended correction: implement an explicit sequential approval state machine that pauses for duplicate decisions and resumes safely, or rename/remove the bulk claim.
- Must fix before launch: **no** if the control is disabled or clearly relabeled; otherwise **yes** as a correctness issue.

### F-11 — Difficulty has two incompatible scales

- Severity: **medium**
- Affected files: `src/chords/types.ts` difficulty 1-5; `src/review.ts` 1-5 editors; `app.js` public render and filter around lines 248-252 and 298
- Why it matters: public cards label and draw difficulty out of 4, while the persisted type and private editor allow 5.
- What could break: difficulty 5 renders as four filled marks but claims “out of 4”; advanced filtering excludes level 5.
- Recommended correction: choose one scale and migrate/validate all records and filters.
- Must fix before launch: **yes** because visible metadata is incorrect.

### F-12 — Calculated music data is persisted and can become stale

- Severity: **medium**
- Affected files: `src/chords/types.ts`; generated/imported/published objects in `src/chords/generator.ts` and `src/review.ts`
- Why it matters: notes, intervals, bass, inversion, fret span, open count, possible barres, alternate names, and score are deterministic derivatives of tuning, frets, root, recipe, and scoring version.
- What could break: editing frets/root/tuning or changing theory rules can leave stored derivatives inconsistent.
- Recommended correction: persist inputs and editorial fields; calculate derivatives on validation/read or store them only as versioned caches that are verified on write.
- Must fix before launch: **no** if server writes always recalculate and validate them.

### F-13 — Error handling and rollback are partial

- Severity: **medium**
- Affected files: `src/review.ts` storage initialization, IndexedDB mirror, final approval writes, import loop; `app.js` initialization
- Why it matters: local-storage writes are multi-step and non-transactional. IndexedDB errors are intentionally swallowed. Undo covers only the in-memory current session rejection path.
- What could break: quota errors or interrupted writes can leave published records and approval keys inconsistent. There is no restore command for exported workspace backups.
- Recommended correction: make repository writes transactional, surface failures, version backups, and add tested restore/rollback.
- Must fix before launch: **yes** for authoritative publish operations.

### F-14 — No evidence of circular module dependencies or unused installed packages

- Severity: **low / positive finding**
- Affected files: `src/chords/*`, `package.json`
- Evidence: domain dependency direction is types/theory → playability/scoring/identity → generator/canonical/repository; only Vite is declared.
- Recommendation: preserve this direction when extracting persistence.
- Must fix before launch: **no**.

### F-15 — Hardcoded musical data is appropriate but not centrally governed

- Severity: **low**
- Affected files: `src/chords/canonical.ts`, `src/chords/curation.ts`, `src/review.ts`, `app.js`
- Why it matters: canonical shapes and a curated profile are legitimate domain assets, but their version and provenance are embedded in source/comments rather than a single catalog format.
- What could break: audits and migrations become difficult as the catalog grows.
- Recommended correction: version recipe/canonical/profile data and validate it in tests; do not move it to a database merely because it is hardcoded.
- Must fix before launch: **no**.

No concrete dead code was proven by the current toolchain because no linter or coverage/dead-code analyzer is configured. No circular imports were found by manual dependency inspection. No unused dependency was found; Vite is the only declared dependency and is used.

## Phase 3: Data integrity

### Is there one chord source of truth?

No. The sources are:

1. canonical specs and generated canonical objects in `src/chords/canonical.ts`;
2. eight hand-curated display records in `app.js`;
3. Pre-reviewed objects in `chord-vault-approved-voicings`;
4. final objects in `chord-vault-published-voicings`;
5. approval membership in `chord-vault-final-approved-keys`;
6. public display snapshots in `chord-vault-public-library`;
7. difficulty/tag overlays in `chord-vault-library-edits`;
8. a write-only IndexedDB workspace snapshot.

Final approval copies a `ChordVoicing` from the approved array into the published array, removes it from the approved array, and separately writes its id into an approval-key set. It does not update one canonical record transactionally.

### Schema assessment

`ChordVoicing` is a useful normalized domain interface, but it mixes:

- identity/input: id, root, tuning, fret positions, chord quality;
- calculated values: notes, intervals, bass, inversion, spans, counts, barres, alternate names, scores;
- editorial data: name, fingers, description, tags, difficulty;
- workflow state: approval status;
- catalog classification: canonical/essential/category/priority/movable metadata.

For persistence, split these concerns or clearly mark calculated caches and their calculation version.

### Deterministic calculations

- Pitch, pitch class, intervals, coverage, bass, and inversion are deterministic in `theory.ts`.
- Playability and possible barres are deterministic in `playability.ts`.
- Scoring is deterministic in `scoring.ts`.
- Canonical identity is deterministic in `identity.ts`.
- Import code recalculates notes, intervals, bass, inversion, fret span, and open count instead of trusting imported values. This is good, but validation is incomplete for unknown recipe names and alternate tuning is rejected.

### Duplicate detection

Exact identity includes tuning id, root, quality, and normalized six-string fret pattern. Near-duplicate similarity additionally considers MIDI/pitch-class/interval overlap, played strings, bass, inversion, open character, movable shape, and span. Tests cover exact formatting equivalence, alternate tuning distinction, near duplicate exclusion, and a different inversion.

Fragile points:

- tuning identity uses only `tuning.id` in exact identity, not the tuning's MIDI definition;
- `scopeKey()` compares root and quality case-sensitively;
- generator ids use a different, less complete identity input;
- public deduplication uses name plus fret string, another identity definition.

### Status and metadata

Approval status is duplicated between the record, collection membership, and final-key set. Essential/open/barre metadata is derived in some places and stored in others. Tags are split across mood, genre, descriptor arrays, public style, and edit overlays. Sorting priority is correctly centralized for `ChordVoicing` in `repository.ts`, but `app.js` reimplements the category sort for its display model.

### Audio metadata

Frequencies should remain calculated from tuning MIDI plus fret; they should not be stored as a `tones` array. Review audio already does this. Public audio creates `tones` during its display-model conversion, which is acceptable as an ephemeral calculation but should use the stable selected id.

### Runtime validation conclusion

There is no general runtime schema for database, local-storage, IndexedDB, public snapshot, or imported data. TypeScript annotations do not validate JSON. A versioned validator at repository boundaries is required before using persisted or remote data.

## Phase 4: Scalability assessment

| Addition | Current difficulty | Reason |
|---|---|---|
| More chord recipes | Moderate | Theory/generator are extensible, but recipe metadata is duplicated in three files and import validation has a fixed list. |
| More tags | Easy to moderate | Tags are simple strings, but vocabulary is inferred from several arrays and edit overlays rather than governed centrally. |
| Additional collections | Major renovation | Workflow membership is encoded in multiple browser arrays/sets; there is no collection or repository model. |
| User favorites | Moderate | A local saved-name feature exists, but accounts and stable voicing-id favorites do not. |
| Alternate tunings | Moderate to major | Core theory and generator accept arbitrary tunings; UI, import, public string labels, canonical data, and identity assumptions are standard-tuning-oriented. |
| Progression builder | Moderate after repository fix | Playback/theory can be reused, but stable records and a persistent collection model are prerequisites. |
| Book/PDF exports | Moderate | Chord diagram data exists, but render logic is duplicated and tied to DOM strings; a shared diagram model would help. |
| Replacement audio engine | Easy to moderate | Audio is isolated to one public function and one review function, but a shared player interface and stable record selection should come first. |

Likely near-term work should optimize for recipes, tags, collections, favorites, and exports. A repository boundary, recipe registry, stable ids, and shared calculated chord view are justified; a broad framework rewrite is not.

## Phase 5: Reliability command results

Requested commands were attempted using the repository's available package runner. The local wrapper attempted an automatic dependency reconciliation and aborted because it could not prompt in a non-interactive terminal. Direct execution against the already-installed repository dependencies was then used to distinguish code results from that environment issue.

| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` equivalent | **Unavailable/fail** | `package.json` has no `lint` script and no linter dependency/configuration. The package-runner attempt also aborted during non-interactive dependency reconciliation. |
| `npm run typecheck` equivalent | **Unavailable/fail** | no `typecheck` script, TypeScript compiler dependency, or `tsconfig.json`. Vite transpilation is not type checking. |
| `npm run test` equivalent | **Pass when run directly** | 17 tests passed, 0 failed. Package-runner wrapper itself aborted before running scripts due to its non-TTY dependency check. |
| `npm run build` equivalent | **Pass when run directly** | Vite transformed 18 modules and produced both HTML entries. Review bundle was approximately 36.82 KB raw / 12.09 KB gzip. Package-runner wrapper had the same pre-script environment failure. |

No test or build warnings were emitted by the direct commands. The absence of linting and type checking is itself a failed release gate and should not be reported as passing.

## Phase 6: Minimal high-value test suite

### Already present and worth retaining

1. Fret-to-note calculation: `tests/theory.test.ts`.
2. Interval, bass, and inversion calculation: `tests/theory.test.ts`.
3. Chord/playability validation: `tests/playability.test.ts` and `tests/generator.test.ts`.
4. Canonical identity normalization and tuning distinction: `tests/canonical.test.ts`.
5. Exact and near duplicate detection: `tests/canonical.test.ts`.
6. Approved/canonical review exclusion: `tests/canonical.test.ts`.
7. Essential-first ordering: `tests/canonical.test.ts`.

### Add before launch, in priority order

1. **Repository approval transaction:** approving once creates one authoritative record; retry is idempotent; simulated failure does not leave status and membership divergent.
2. **Runtime schema tests:** valid current record, invalid fret count, malformed tuning, unknown schema version, corrupt persisted JSON, and migration from the previous version.
3. **Public stable-id audio test:** two cards with the same chord name select their own fret pattern/frequencies.
4. **Muted-string audio test:** muted positions create no oscillator and played strings preserve low-E-to-high-E order.
5. **Public filtering test:** root, quality, recipe, difficulty, type, favorites, combined filters, empty result, and pagination reset.
6. **Public smoke test:** production `index.html` loads, renders approved cards, and has no console errors.
7. **Protected review-route test:** unauthenticated access is rejected/redirected; authorized admin mutation succeeds; ordinary users cannot mutate.
8. **Import validator test:** JSON and quoted CSV, exact duplicates, invalid recipes, unsupported tunings, computed-field tampering, and partial batch reporting.
9. **Difficulty contract test:** chosen scale is identical in schema, editor, filters, labels, and rendered marks.
10. **Bulk approval test:** all selected records are processed exactly once, duplicate dialogs pause/resume safely, and partial failure is reported.

These protect business behavior. Snapshotting every card's HTML or CSS would be lower value.

## Phase 7: Security and deployment audit

### Secrets and environment variables

No secret values, `.env` files, environment-variable reads, API keys, Supabase clients, or third-party scripts were found in tracked application files. This is positive, but it reflects the absence of a backend rather than a completed secret-management design.

When adding a backend:

- browser code may receive only explicitly public client configuration;
- service-role/admin keys must remain server-side;
- secret files must be ignored and deployment secrets managed by the host;
- never put authorization logic in Vite client variables.

### Admin authorization and server validation

Neither exists. Every future publish, replace, merge, reject, import, and bulk action must be revalidated and authorized on the server. Client duplicate and theory checks are useful feedback but not a security boundary.

### Supabase and row-level security

Supabase is not present, so there are no RLS policies to inspect. If chosen later, enable RLS before exposing tables, give public users read-only access only to approved records, and restrict workflow/audit/mutation tables to authenticated administrators. Service-role keys must never ship in Vite output.

### Destructive actions

Replace/reject operations currently mutate browser storage. In a database they must use transactions, durable audit records, soft deletion or version history, confirmation, and an authorized rollback path.

### Cloudflare compatibility

The static Vite output is suitable for static hosting. The repository has no Cloudflare configuration, Functions/Workers code, routing rules, security headers, or deployment scripts. A future authenticated API must use a Cloudflare-compatible runtime if Cloudflare is the target; current browser-only Web Audio and DOM code are irrelevant to server compatibility.

### Migrations and rollback

There is no deployed schema migration or rollback mechanism. An in-memory canonical seeder and a manually downloadable browser backup are not production migrations. Adopt numbered forward migrations, pre-migration backups, idempotent data migrations, and a documented rollback/roll-forward process.

### Production errors

There is no error boundary, global error reporting, server logging, or user-visible recovery for initialization/storage failures. Import errors are summarized, while IndexedDB mirror failures are silently ignored. Add structured, non-sensitive reporting after the authoritative repository exists.

## Phase 8: Prioritized plan

### 1. Must fix before launch

1. **Authoritative validated persistence:** replace browser-local chord publishing with one transactional repository and runtime schema.
2. **Real private administration:** authenticate administrators and enforce write authorization server-side.
3. **Correct stable identity in user actions:** play and favorite by voicing id; include quality in generated stable ids and migrate existing ids.
4. **One difficulty contract:** choose 1-4 or 1-5 and make storage, editor, filtering, and public display agree.
5. **Release gates:** add working typecheck and lint commands and run them in CI with tests/build.
6. **Honest bulk approval:** make it process the full selected set safely or remove/disable the misleading control before release.

### 2. Should fix soon after launch

1. Central recipe registry shared by generator, canonical catalog, imports, and public filters.
2. Extract review persistence/workflow/import/audio responsibilities from `src/review.ts`.
3. Calculate deterministic fields at validated boundaries and version cached scoring results.
4. Share fingering, diagram-model, quality parsing, and playback-frequency helpers.
5. Add database migration, backup restore, audit retention, and production error reporting procedures.
6. Add the remaining integration tests listed above.

### 3. Safe to defer

1. A frontend framework migration.
2. General-purpose plugin systems or abstract factories.
3. Moving canonical musical constants out of source solely because they are hardcoded.
4. Optimizing the already small bundles beyond normal performance budgets.
5. Alternate-tuning UI, progressions, books/PDFs, and a new audio engine until requested.

## Incremental remediation sequence

Each step is designed to be independently committable and revertible.

### Step 1 — Establish executable quality gates

- Scope: add TypeScript configuration, lint configuration, and `lint`, `typecheck`, and aggregate verification scripts; add CI using the lockfile.
- Acceptance criteria: a clean checkout runs lint, typecheck, 17 existing tests, and production build non-interactively.
- Tests: existing suite unchanged; add a CI smoke assertion for both built HTML entries.
- Rollback: remove configuration/scripts/CI; no runtime behavior changes.

### Step 2 — Define the persisted schema and calculation boundary

- Scope: define a versioned stored chord record and runtime validator; document calculated versus editorial fields; centralize recipe definitions.
- Acceptance criteria: all current canonical, imported, and published fixtures validate; invalid data is quarantined with useful errors; theory values are recalculated.
- Tests: schema fixtures, corrupt JSON, unknown version, recipe coverage, calculation consistency.
- Rollback: validator can initially wrap existing reads without deleting old storage.

### Step 3 — Introduce a repository interface behind current UI

- Scope: one interface for list, import, review decision, publish, replace, merge, favorites, and audit; first adapter may preserve local behavior.
- Acceptance criteria: `app.js` and review workflow do not directly coordinate multiple storage keys; one operation returns one committed result.
- Tests: contract tests for idempotency, duplicate handling, transactional failure, and status transitions.
- Rollback: retain the old adapter behind the same interface until the new adapter is proven.

### Step 4 — Add durable hosted persistence and migrations

- Scope: implement the selected backend adapter, numbered migrations, backups, and rollback/roll-forward notes.
- Acceptance criteria: approved data is shared across devices; public reads return approved records only; write failures do not partially commit.
- Tests: migration fixtures, repository integration tests, transaction failure, backup restore rehearsal.
- Rollback: feature flag reads/writes back to the local adapter during deployment verification; retain pre-migration backup.

### Step 5 — Protect the review workflow

- Scope: admin authentication, protected route delivery, server-side authorization and validation for every mutation.
- Acceptance criteria: anonymous users cannot load privileged data or mutate; authorized admins can; public keys cannot bypass authorization.
- Tests: unauthenticated, unauthorized, expired-session, authorized, and forged-request cases.
- Rollback: disable admin writes while leaving public read-only vault available.

### Step 6 — Correct identity, audio, favorites, and difficulty

- Scope: migrate generated ids to full canonical identity; use id-based card actions; unify difficulty scale.
- Acceptance criteria: two same-name voicings play/save independently; muted strings are silent; difficulty is consistent everywhere.
- Tests: same-name audio/favorites, string order, muted playback, id migration, difficulty contract.
- Rollback: keep an old-id alias map and reversible data migration.

### Step 7 — Make bulk and duplicate workflows transactional

- Scope: explicit sequential batch state, pause/resume duplicate decisions, merge/replace audit, partial-failure reporting.
- Acceptance criteria: every selected chord is processed once; cancel/resume is deterministic; no silent partial approval.
- Tests: clean batch, duplicates, cancellation, retry, partial server failure.
- Rollback: disable bulk control; single-record final approval remains available.

### Step 8 — Reduce controller responsibilities

- Scope: extract storage/repository, import validation, workflow service, audio player, and diagram model one at a time while preserving markup and CSS.
- Acceptance criteria: `src/review.ts` becomes orchestration/presentation; pure modules have focused tests; visual output remains unchanged.
- Tests: move existing behavior tests alongside each extraction plus a public/review smoke test.
- Rollback: one extraction per commit makes each move independently revertible.

## Launch decision

The deterministic chord engine is suitable to build on. The product should not launch with publishing or “private” administration represented as browser-local state. After the first six remediation steps—or an equivalent smaller implementation satisfying their acceptance criteria—the architecture is reasonable for an initial release. The later cleanup can proceed after launch without blocking new product work.
