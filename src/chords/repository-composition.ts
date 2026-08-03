import { LocalStorageChordRepository, type ChordRepository, type StoragePort } from "./chord-repository.ts";
import { HostedReadChordRepository, loadHostedPublished, type RepositoryCapabilities } from "./hosted-repository.ts";

export type RepositoryMode = "local" | "hosted";
export interface RepositorySelection { repository: ChordRepository; capabilities: RepositoryCapabilities }
export interface RepositoryConfiguration { mode: RepositoryMode; apiBase: string }

export function repositoryConfiguration(env: Record<string, string | undefined>): RepositoryConfiguration {
  return { mode: env.VITE_CHORD_REPOSITORY === "hosted" ? "hosted" : "local", apiBase: env.VITE_CHORD_API_BASE || "/api" };
}

export async function createChordRepository(options: { localStorage: StoragePort; sessionStorage: StoragePort; env: Record<string, string | undefined>; fetcher?: typeof fetch }): Promise<RepositorySelection> {
  const local = new LocalStorageChordRepository(options.localStorage, options.sessionStorage); const config = repositoryConfiguration(options.env);
  if (config.mode === "local") return { repository: local, capabilities: { backend: "local", mutations: true } };
  try { const records = await loadHostedPublished(config.apiBase, options.fetcher); const repository = new HostedReadChordRepository(local, records); return { repository, capabilities: repository.capabilities }; }
  catch { const repository = new HostedReadChordRepository(local, [], "Published chords could not be loaded. Please try again later."); return { repository, capabilities: repository.capabilities }; }
}
