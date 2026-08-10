import { ChordRepositoryError } from "./chord-repository.ts";
import { hydratePersistedChord, persistChordVoicing, validatePersistedChord, type PersistedChordRecordV1 } from "./persisted.ts";
import type { ChordVoicing } from "./types.ts";

export interface HostedReviewWorkspace {
  records: PersistedChordRecordV1[];
  published: ChordVoicing[];
  preReviewed: ChordVoicing[];
  rejected: ChordVoicing[];
}

export class HostedReviewClient {
  private readonly apiBase: string;
  private readonly fetcher: typeof fetch;

  constructor(apiBase = "/api", fetcher: typeof fetch = fetch) {
    this.apiBase = apiBase;
    this.fetcher = fetcher;
  }

  private url(path: string): string { return `${this.apiBase.replace(/\/$/, "")}${path}`; }

  private async response<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(this.url(path), { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
    const payload = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new ChordRepositoryError("FAILED_WRITE", payload.error?.message ?? `Hosted review request failed with status ${response.status}.`);
    return payload;
  }

  async loadWorkspace(): Promise<HostedReviewWorkspace> {
    const payload = await this.response<{ records?: unknown[] }>("/admin/backups");
    if (!Array.isArray(payload.records)) throw new ChordRepositoryError("CORRUPT_STORAGE", "Hosted administrator response is malformed.");
    const records: PersistedChordRecordV1[] = [];
    for (const raw of payload.records) {
      const result = validatePersistedChord(raw);
      if (!result.ok) throw new ChordRepositoryError("SCHEMA_VALIDATION", "Hosted administrator record failed validation.");
      records.push(result.value);
    }
    const hydrated = records.map((record) => ({ record, voicing: hydratePersistedChord(record) }));
    return {
      records,
      published: hydrated.filter(({ record }) => record.workflowStatus === "published").map(({ voicing }) => voicing),
      preReviewed: hydrated.filter(({ record }) => record.workflowStatus === "pre-reviewed").map(({ voicing }) => voicing),
      rejected: hydrated.filter(({ record }) => record.workflowStatus === "rejected").map(({ voicing }) => voicing),
    };
  }

  private mutate(path: string, body?: unknown): Promise<{ record: PersistedChordRecordV1 }> {
    return this.response(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  preReview(voicing: ChordVoicing): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(voicing.id)}/pre-review`, persistChordVoicing(voicing, "pre-reviewed")); }
  publish(voicing: ChordVoicing): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(voicing.id)}/publish`, persistChordVoicing(voicing, "pre-reviewed")); }
  reject(id: string): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(id)}/reject`); }
  restore(id: string): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(id)}/restore`); }
  edit(id: string, changes: unknown): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(id)}/edit`, changes); }
  merge(targetId: string, source: ChordVoicing): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(targetId)}/merge`, persistChordVoicing(source, "pre-reviewed")); }
  replace(targetId: string, replacement: ChordVoicing): Promise<{ record: PersistedChordRecordV1 }> { return this.mutate(`/admin/chords/${encodeURIComponent(targetId)}/replace`, persistChordVoicing(replacement, "pre-reviewed")); }

  async editPreReviewed(id: string, changes: Record<string, unknown>): Promise<{ record: PersistedChordRecordV1 }> {
    const payload = await this.response<{ report: { records: PersistedChordRecordV1[] } }>("/admin/chords/enrichment/apply", { method: "POST", body: JSON.stringify({ records: [{ id, ...changes }] }) });
    const record = payload.report.records.find((item) => item.id === id);
    if (!record) throw new ChordRepositoryError("FAILED_WRITE", "The hosted edit did not return an updated chord.");
    return { record };
  }
}
