import type { ImportJob, ImportLogEntry } from "./types";

export const COLLECTIONS = {
  items: "wf_items",
  recipes: "wf_recipes",
  professions: "wf_professions",
  edges: "wf_recipe_edges",
  jobs: "wf_import_jobs",
  lock: "wf_import_lock",
} as const;

export type CatalogCollection = "items" | "recipes" | "professions" | "edges";
export type StoredDoc = { id: number | string } & Record<string, unknown>;

/**
 * Armazenamento do importador. Escreve somente nas coleções wf_* (catálogo de dados originais);
 * preços de mercado e dados de usuário vivem em outras coleções e nunca são tocados aqui.
 */
export interface ImportStore {
  getHashes(col: CatalogCollection, ids: Array<number | string>): Promise<Map<string, string>>;
  getDocs<T>(col: CatalogCollection, ids: Array<number | string>): Promise<T[]>;
  /** Merge (nunca apaga campos que o importador não conhece, ex.: personalizações). */
  upsertMany(col: CatalogCollection, docs: StoredDoc[]): Promise<void>;
  /** Paginação por ID do documento (ordem lexicográfica). */
  listPage<T>(col: CatalogCollection, afterId: string | null, limit: number): Promise<T[]>;
  recipeIdsByProduct(itemId: number): Promise<number[]>;

  getJob(id: string): Promise<ImportJob | null>;
  saveJob(job: ImportJob): Promise<void>;
  listJobs(limit: number): Promise<ImportJob[]>;
  appendLog(jobId: string, entry: ImportLogEntry): Promise<void>;
  listLogs(jobId: string, limit: number): Promise<ImportLogEntry[]>;

  acquireLock(owner: string, ttlMs: number): Promise<boolean>;
  renewLock(owner: string, ttlMs: number): Promise<void>;
  releaseLock(owner: string): Promise<void>;
}

export class MemoryImportStore implements ImportStore {
  readonly data: Record<CatalogCollection, Map<string, Record<string, unknown>>> = {
    items: new Map(),
    recipes: new Map(),
    professions: new Map(),
    edges: new Map(),
  };
  readonly jobs = new Map<string, ImportJob>();
  readonly logs = new Map<string, ImportLogEntry[]>();
  lock: { owner: string; expiresAt: number } | null = null;
  writes = 0;

  async getHashes(col: CatalogCollection, ids: Array<number | string>) {
    const out = new Map<string, string>();
    for (const id of ids) {
      const doc = this.data[col].get(String(id));
      if (doc) out.set(String(id), String(doc.contentHash ?? ""));
    }
    return out;
  }

  async getDocs<T>(col: CatalogCollection, ids: Array<number | string>) {
    return ids.flatMap((id) => {
      const doc = this.data[col].get(String(id));
      return doc ? [structuredClone(doc) as T] : [];
    });
  }

  async upsertMany(col: CatalogCollection, docs: StoredDoc[]) {
    for (const doc of docs) {
      const key = String(doc.id);
      this.data[col].set(key, { ...(this.data[col].get(key) ?? {}), ...structuredClone(doc) });
      this.writes += 1;
    }
  }

  async listPage<T>(col: CatalogCollection, afterId: string | null, limit: number) {
    return [...this.data[col].keys()]
      .sort()
      .filter((id) => afterId === null || id > afterId)
      .slice(0, limit)
      .map((id) => structuredClone(this.data[col].get(id)) as T);
  }

  async recipeIdsByProduct(itemId: number) {
    return [...this.data.edges.values()]
      .filter((edge) => edge.role === "product" && edge.itemId === itemId)
      .map((edge) => edge.recipeId as number);
  }

  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  async saveJob(job: ImportJob) {
    this.jobs.set(job.id, structuredClone(job));
  }

  async listJobs(limit: number) {
    return [...this.jobs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async appendLog(jobId: string, entry: ImportLogEntry) {
    this.logs.set(jobId, [...(this.logs.get(jobId) ?? []), entry]);
  }

  async listLogs(jobId: string, limit: number) {
    return (this.logs.get(jobId) ?? []).slice(-limit);
  }

  async acquireLock(owner: string, ttlMs: number) {
    const now = Date.now();
    if (this.lock && this.lock.expiresAt > now && this.lock.owner !== owner) return false;
    this.lock = { owner, expiresAt: now + ttlMs };
    return true;
  }

  async renewLock(owner: string, ttlMs: number) {
    if (this.lock?.owner === owner) this.lock.expiresAt = Date.now() + ttlMs;
  }

  async releaseLock(owner: string) {
    if (this.lock?.owner === owner) this.lock = null;
  }
}
