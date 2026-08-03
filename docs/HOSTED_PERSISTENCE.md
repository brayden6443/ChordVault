# Hosted persistence operations

Chord Vault uses Cloudflare D1 through the Worker in `worker/index.ts`. Browser code never receives a D1 credential, binding, Access audience, or administrator allowlist. Public reads are anonymous and published-only. Review assets and administrator APIs require a verified Cloudflare Access identity.

## Configuration

- Worker binding `DB`: the D1 database. Replace the placeholder `database_id` in `wrangler.jsonc` after creating the production database.
- Worker variable `ALLOW_ADMIN_MUTATIONS`: remains `false` in committed production configuration. Set it to `true` only after Access is configured and verified; it is a second operational lock, not authentication.
- Worker secret `ACCESS_TEAM_DOMAIN`: the full HTTPS Cloudflare Access team domain.
- Worker secret `ACCESS_AUD`: the self-hosted Access application's Audience (AUD) tag.
- Worker secret `ADMIN_EMAILS`: a comma-separated, exact email allowlist. Keep the Access policy and this list aligned.
- Client variable `VITE_CHORD_REPOSITORY`: `local` or `hosted`.
- Client variable `VITE_CHORD_API_BASE`: defaults to `/api`.
- Wrangler credentials such as `CLOUDFLARE_API_TOKEN` belong in the operator environment, never `.env` or browser code.

`.dev.vars`, `.env`, `.env.*`, and `.wrangler/` are ignored. Example files contain placeholders only.

## Local database and Worker

```text
npm run db:migrate:local
npm run db:status:local
npm run build
npx wrangler dev
```

Wrangler creates the isolated local D1 state beneath ignored `.wrangler/`. Migration `0001_initial_schema.sql` is applied in filename order and recorded by Wrangler in `d1_migrations`. Startup code never applies schema changes.

Use `.dev.vars` placeholders for isolated local testing only. Without valid Access configuration the private route fails closed; without `ALLOW_ADMIN_MUTATIONS=true`, authenticated mutation endpoints return `404`.

## Cloudflare Access setup

1. In Cloudflare Zero Trust, add a self-hosted Access application covering the deployed hostname paths `/review`, `/review/*`, and `/api/admin/*`.
2. Add an Allow policy containing only the intended administrator email addresses. Do not use a Bypass policy for these paths.
3. Copy the application Audience (AUD) tag and team domain into encrypted Worker secrets named `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`.
4. Store the same exact administrator emails as the encrypted `ADMIN_EMAILS` Worker secret.
5. Verify an anonymous request is blocked, an authenticated non-admin is denied, and an allowlisted administrator can load `/review.html` and `/api/admin/session`.
6. Only after those checks, set `ALLOW_ADMIN_MUTATIONS=true` as a Worker variable and verify one reversible edit. Do not place any of these values in Vite variables or client JavaScript.

Cloudflare Access controls session duration in its application policy. Expired, revoked, wrongly issued, wrongly signed, or non-allowlisted sessions fail closed in the Worker. The review-page logout link goes to the application-domain `/cdn-cgi/access/logout` endpoint.

## Production database and migrations

Create the database once:

```text
npx wrangler d1 create chord-vault
```

Copy the returned database ID into the server-only `wrangler.jsonc` D1 binding. Before every production migration:

```text
npx wrangler d1 export chord-vault --remote --output backups/chord-vault-before-YYYYMMDD.sql
npx wrangler d1 migrations list chord-vault --remote
npm run db:migrate:production
npx wrangler d1 migrations list chord-vault --remote
```

Only deploy after migrations succeed:

```text
npm run verify
npx wrangler deploy
```

A failed migration stops the Wrangler command. Do not deploy code requiring it. Prefer a corrective forward migration. A destructive migration must include specific recovery notes and a fresh export before it is approved.

## Backup and recovery

- Database export: `npx wrangler d1 export chord-vault --remote --output <file.sql>`.
- Local repository export: use **Backup workspace** on the review page.
- Import backup: `npm run hosted:import` always writes a timestamped, exclusive-create copy before it contacts the API.
- Failed import: retry the same input safely after correcting the reported records; stable IDs and identical records are skipped. Local browser data is never changed.
- Failed migration: do not deploy. Prefer a forward repair. If restoration is required, follow Cloudflare’s current D1 restore procedure using the verified pre-migration backup; restoration overwrites current database state and must be explicitly approved.
- Deployment verification fallback: rebuild with `VITE_CHORD_REPOSITORY=local`. This is explicit and never an automatic fallback from a hosted write.

## Local-to-hosted import

First export the local workspace from the review page. Validation-only mode creates a backup and prints the report:

```text
npm run hosted:import -- --input chord-vault-workspace.json
```

Dry-run against an isolated local Worker:

```text
npm run hosted:import -- --input chord-vault-workspace.json --api http://127.0.0.1:8787/api
```

Apply only after reviewing both reports:

```text
npm run hosted:import -- --input chord-vault-workspace.json --api http://127.0.0.1:8787/api --apply
```

The tool validates and recalculates every record, preserves valid stable IDs, reports validation failures, creates the backup before upload, and never deletes local data. Production import remains unavailable while `ALLOW_ADMIN_MUTATIONS=false`.

## API exposure after Step 5

Public:

- `GET /api/chords/published`
- `GET /api/chords/:id` (published records only)

Authenticated administrator reads (write flag not required):

- `GET /api/admin/session`
- `GET /api/admin/chords/pre-reviewed`
- `GET /api/admin/audit`
- `GET /api/admin/backups`
- `GET /api/admin/quarantine`

Authenticated administrator mutations (also require `ALLOW_ADMIN_MUTATIONS=true`):

- `POST /api/admin/chords/import`
- `POST /api/admin/chords/:id/pre-review`
- `POST /api/admin/chords/:id/publish`
- `POST /api/admin/chords/:id/reject`
- `POST /api/admin/chords/:id/replace`
- `POST /api/admin/chords/:id/merge`
- `POST /api/admin/chords/:id/edit`

`GET /api/admin/logout` redirects to Cloudflare Access logout and exposes no private data.

These restrictions are deliberately server-side. A hidden page, client flag, Access header without signature verification, or `noindex` is not treated as security.
