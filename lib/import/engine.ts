import {
  normalizeItem,
  normalizeProfession,
  normalizeRecipe,
  recipeEdges,
} from "./normalize";
import type { CatalogCollection, ImportStore, StoredDoc } from "./store";
import {
  EMPTY_COUNTERS,
  type ImportJob,
  type ImportLogEntry,
  type ImportMode,
  type ImportPhase,
  type ImportTargets,
  type ItemDoc,
  type RecipeDoc,
  type SourceStamp,
} from "./types";
import { WF_BATCH_LIMIT, type WfSource } from "./wf-source";
import type { ForeverDbSource } from "./foreverdb-source";

export type WfSourceLike = Pick<WfSource, "resolveDatasets" | "page" | "getMany"> & { requests: number };
export type ForeverDbLike = Pick<ForeverDbSource, "item"> & { requests: number };

export interface EngineDeps {
  store: ImportStore;
  wf: WfSourceLike;
  foreverDb?: ForeverDbLike | null;
  now?: () => Date;
  newId?: () => string;
  lockTtlMs?: number;
  foreverDbMaxPerRun?: number;
}

export class ImportBusyError extends Error {
  constructor() {
    super("Já existe uma importação em andamento.");
    this.name = "ImportBusyError";
  }
}

export const DEFAULT_TARGETS: ImportTargets = { professions: true, recipes: true, items: true, materials: true };
const PHASE_ORDER: ImportPhase[] = ["professions", "recipes", "items", "materials", "enrich"];
const LOCK_TTL_MS = 90_000;
const ENRICH_STEP = 10;

const nowIso = (deps: EngineDeps) => (deps.now?.() ?? new Date()).toISOString();

function phaseEnabled(job: ImportJob, phase: ImportPhase): boolean {
  if (phase === "enrich") return job.enrichWithForeverDb;
  return job.targets[phase as keyof ImportTargets] ?? false;
}

function nextPhase(job: ImportJob, after: ImportPhase | null): ImportPhase {
  const start = after === null ? 0 : PHASE_ORDER.indexOf(after) + 1;
  return PHASE_ORDER.slice(start).find((phase) => phaseEnabled(job, phase)) ?? "done";
}

export async function startImport(
  deps: EngineDeps,
  input: { mode: ImportMode; targets?: Partial<ImportTargets>; locale?: string; enrichWithForeverDb?: boolean },
): Promise<ImportJob> {
  const { store, wf } = deps;
  const owner = `start-${deps.newId?.() ?? crypto.randomUUID()}`;
  if (!(await store.acquireLock(owner, 5_000))) throw new ImportBusyError();
  await store.releaseLock(owner);

  const targets: ImportTargets = { ...DEFAULT_TARGETS, ...input.targets };
  const datasets = await wf.resolveDatasets();
  const stamp = nowIso(deps);
  const enrich = Boolean(input.enrichWithForeverDb && deps.foreverDb);

  const job: ImportJob = {
    id: deps.newId?.() ?? crypto.randomUUID(),
    mode: input.mode,
    targets,
    locale: input.locale ?? "enUS",
    enrichWithForeverDb: enrich,
    status: "running",
    phase: "professions",
    datasets: {
      items: datasets.items,
      recipes: datasets.recipes,
      professions: datasets.professions,
      build: datasets.build,
    },
    cursor: null,
    materialsSeeded: false,
    enrichSeeded: false,
    queueTotal: 0,
    enrichTotal: 0,
    queue: [],
    seen: [],
    enrichQueue: [],
    counters: { ...EMPTY_COUNTERS },
    seenSourceIds: { items: [], recipes: [] },
    lastError: null,
    startedAt: stamp,
    updatedAt: stamp,
    finishedAt: null,
    elapsedMs: 0,
  };
  job.phase = nextPhase(job, null);
  if (job.phase === "done") throw new Error("Selecione ao menos um tipo de dado para importar.");

  await store.saveJob(job);
  await log(deps, job, "info", "system", `Importação iniciada (modo ${job.mode}, build ${job.datasets.build}).`);
  if (input.enrichWithForeverDb && !deps.foreverDb) {
    await log(deps, job, "warn", "system", "FOREVERDB_API_KEY não configurada: enriquecimento ForeverDB ignorado.");
  }
  return job;
}

export async function resumeImport(deps: EngineDeps, jobId: string): Promise<ImportJob> {
  const job = await deps.store.getJob(jobId);
  if (!job) throw new Error("Importação não encontrada.");
  if (job.status === "paused" || job.status === "failed") {
    job.status = "running";
    job.lastError = null;
    job.updatedAt = nowIso(deps);
    await deps.store.saveJob(job);
    await log(deps, job, "info", job.phase === "done" ? "system" : job.phase, "Importação retomada do checkpoint.");
  }
  return job;
}

/** Processa o job por até `budgetMs`, salvando checkpoint a cada passo. */
export async function runSlice(
  deps: EngineDeps,
  jobId: string,
  budgetMs = 45_000,
): Promise<{ job: ImportJob; busy: boolean }> {
  const { store } = deps;
  const job = await store.getJob(jobId);
  if (!job) throw new Error("Importação não encontrada.");
  if (job.status !== "running") return { job, busy: false };

  const owner = deps.newId?.() ?? crypto.randomUUID();
  const ttl = deps.lockTtlMs ?? LOCK_TTL_MS;
  if (!(await store.acquireLock(owner, ttl))) return { job, busy: true };

  const startedAt = Date.now();
  let professionSlugs: Map<number, string> | null = null;

  try {
    while (job.status === "running" && job.phase !== "done" && Date.now() - startedAt < budgetMs) {
      const stepStart = Date.now();
      try {
        professionSlugs = await runStep(deps, job, professionSlugs);
      } catch (error) {
        job.status = "paused";
        job.lastError = error instanceof Error ? error.message : String(error);
        job.counters.errors += 1;
        await log(deps, job, "error", job.phase, `Falha: ${job.lastError}. Retome para continuar do checkpoint.`);
      }
      job.elapsedMs += Date.now() - stepStart;
      job.counters.requests = deps.wf.requests + (deps.foreverDb?.requests ?? 0);
      job.updatedAt = nowIso(deps);
      await store.saveJob(job);
      await store.renewLock(owner, ttl);
    }

    if (job.status === "running" && job.phase === "done") {
      await finish(deps, job);
      await store.saveJob(job);
    }
  } finally {
    await store.releaseLock(owner);
  }

  return { job, busy: false };
}

async function finish(deps: EngineDeps, job: ImportJob) {
  if (job.mode === "sync") await detectOrphans(deps, job);
  job.status = "completed";
  job.finishedAt = nowIso(deps);
  await log(
    deps,
    job,
    "info",
    "system",
    `Concluído: ${job.counters.itemsImported + job.counters.recipesImported} novos, ` +
      `${job.counters.itemsUpdated + job.counters.recipesUpdated} atualizados, ${job.counters.skipped} ignorados, ` +
      `${job.counters.errors} erros.`,
  );
}

async function runStep(deps: EngineDeps, job: ImportJob, slugs: Map<number, string> | null) {
  switch (job.phase) {
    case "professions":
      await stepProfessions(deps, job);
      return slugs;
    case "recipes": {
      const map = slugs ?? (await loadProfessionSlugs(deps, job));
      await stepRecipes(deps, job, map);
      return map;
    }
    case "items":
      await stepItems(deps, job);
      return slugs;
    case "materials":
      await stepMaterials(deps, job);
      return slugs;
    case "enrich":
      await stepEnrich(deps, job);
      return slugs;
    default:
      return slugs;
  }
}

function advance(job: ImportJob) {
  job.cursor = null;
  job.phase = nextPhase(job, job.phase);
}

function stampFor(job: ImportJob, kind: "items" | "recipes" | "professions"): SourceStamp {
  return { source: "warcraftforever", dataset: job.datasets[kind], build: job.datasets.build };
}

async function log(deps: EngineDeps, job: ImportJob, level: ImportLogEntry["level"], phase: ImportLogEntry["phase"], message: string) {
  await deps.store.appendLog(job.id, { at: nowIso(deps), level, phase, message });
}

/** Grava apenas o que é novo/alterado (idempotente). Retorna contagens. */
async function upsertDiff(
  deps: EngineDeps,
  job: ImportJob,
  col: CatalogCollection,
  docs: Array<{ id: number | string; contentHash: string }>,
) {
  const hashes = await deps.store.getHashes(col, docs.map((doc) => doc.id));
  const stamp = nowIso(deps);
  const writes: StoredDoc[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const existing = hashes.get(String(doc.id));
    if (existing === undefined) {
      writes.push({ ...doc, importedAt: stamp, updatedAt: stamp });
      imported += 1;
    } else if (existing !== doc.contentHash || job.mode === "initial") {
      writes.push({ ...doc, updatedAt: stamp });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  await deps.store.upsertMany(col, writes);
  return { imported, updated, skipped };
}

async function stepProfessions(deps: EngineDeps, job: ImportJob) {
  const env = await deps.wf.page("professions", job.datasets.professions, job.locale, job.cursor);
  const stamp = stampFor(job, "professions");
  const docs = env.data.map((raw) => normalizeProfession(raw, { stamp }));
  const result = await upsertDiff(deps, job, "professions", docs);

  job.counters.professionsImported += result.imported + result.updated;
  job.counters.skipped += result.skipped;
  moveCursor(job, env.nextCursor, env.data.length);
}

function moveCursor(job: ImportJob, next: string | null | undefined, received: number) {
  if (!next || received === 0 || next === job.cursor) advance(job);
  else job.cursor = next;
}

async function loadProfessionSlugs(deps: EngineDeps, job: ImportJob) {
  const map = new Map<number, string>();
  let cursor: string | null = null;
  do {
    const env: Awaited<ReturnType<typeof deps.wf.page<"professions">>> = await deps.wf.page("professions", job.datasets.professions, job.locale, cursor);
    for (const profession of env.data) map.set(profession.id, profession.slug);
    cursor = env.nextCursor && env.data.length > 0 && env.nextCursor !== cursor ? env.nextCursor : null;
  } while (cursor);
  return map;
}

async function stepRecipes(deps: EngineDeps, job: ImportJob, slugs: Map<number, string>) {
  const env = await deps.wf.page("recipes", job.datasets.recipes, job.locale, job.cursor);
  const stamp = stampFor(job, "recipes");
  const docs = env.data.map((raw) => normalizeRecipe(raw, { stamp, professionSlugs: slugs }));

  const result = await upsertDiff(deps, job, "recipes", docs);
  await upsertDiff(deps, job, "edges", docs.flatMap((doc) => recipeEdges(doc)));

  job.counters.recipesFound += docs.length;
  job.counters.recipesImported += result.imported;
  job.counters.recipesUpdated += result.updated;
  job.counters.skipped += result.skipped;
  if (job.mode === "sync") job.seenSourceIds.recipes.push(...docs.map((doc) => doc.id));
  moveCursor(job, env.nextCursor, env.data.length);
}

async function stepItems(deps: EngineDeps, job: ImportJob) {
  const env = await deps.wf.page("items", job.datasets.items, job.locale, job.cursor);
  const stamp = stampFor(job, "items");
  const docs = env.data.map((raw) => normalizeItem(raw, { locale: job.locale, stamp, discoveredAs: "corpus" }));
  const result = await upsertDiff(deps, job, "items", docs);

  job.counters.itemsFound += docs.length;
  job.counters.itemsImported += result.imported;
  job.counters.itemsUpdated += result.updated;
  job.counters.skipped += result.skipped;
  if (job.mode === "sync") job.seenSourceIds.items.push(...docs.map((doc) => doc.id));
  moveCursor(job, env.nextCursor, env.data.length);
}

async function seedMaterials(deps: EngineDeps, job: ImportJob) {
  const reagents = new Set<number>();
  const all = new Set<number>();
  let after: string | null = null;

  for (;;) {
    const page: RecipeDoc[] = await deps.store.listPage<RecipeDoc>("recipes", after, 300);
    if (page.length === 0) break;
    for (const recipe of page) {
      for (const line of recipe.reagents) {
        reagents.add(line.itemId);
        all.add(line.itemId);
      }
      if (recipe.product) all.add(recipe.product.itemId);
    }
    after = String(page[page.length - 1].id);
  }

  const known = await deps.store.getHashes("items", [...all]);
  job.queue = [...all].filter((id) => !known.has(String(id)));
  job.queueTotal = job.queue.length;
  job.seen = [...all];
  job.counters.materialsIdentified = reagents.size;
  job.materialsSeeded = true;
  await log(
    deps,
    job,
    "info",
    "materials",
    `${reagents.size} materiais identificados; ${job.queue.length} ainda não existem no banco.`,
  );
}

async function stepMaterials(deps: EngineDeps, job: ImportJob) {
  if (!job.materialsSeeded) {
    await seedMaterials(deps, job);
    return;
  }
  if (job.queue.length === 0) {
    advance(job);
    return;
  }

  const batch = job.queue.slice(0, WF_BATCH_LIMIT);
  const env = await deps.wf.getMany("items", job.datasets.items, job.locale, batch);
  const stamp = stampFor(job, "items");
  const docs = env.data.map((raw) => normalizeItem(raw, { locale: job.locale, stamp, discoveredAs: "material" }));
  const result = await upsertDiff(deps, job, "items", docs);

  job.counters.itemsImported += result.imported;
  job.counters.itemsUpdated += result.updated;
  job.counters.skipped += result.skipped;
  job.counters.materialsFetched += docs.length;

  const missing = env.missingIds ?? batch.filter((id) => !docs.some((doc) => doc.id === id));
  if (missing.length > 0) {
    job.counters.skipped += missing.length;
    await log(deps, job, "warn", "materials", `Itens ausentes na fonte: ${missing.join(", ")}`);
  }

  // Recursão: receitas que produzem o material revelam novos materiais. `seen` evita ciclos.
  const seen = new Set(job.seen);
  const discovered: number[] = [];
  for (const doc of docs) {
    const recipeIds = await deps.store.recipeIdsByProduct(doc.id);
    for (const recipe of await deps.store.getDocs<RecipeDoc>("recipes", recipeIds)) {
      if (recipe.product?.itemId !== doc.id) continue;
      for (const line of recipe.reagents) {
        if (!seen.has(line.itemId)) {
          seen.add(line.itemId);
          discovered.push(line.itemId);
          job.counters.materialsIdentified += 1;
        }
      }
    }
  }
  if (discovered.length > 0) {
    const known = await deps.store.getHashes("items", discovered);
    const fresh = discovered.filter((id) => !known.has(String(id)));
    job.queue.push(...fresh);
    job.queueTotal += fresh.length;
  }
  job.seen = [...seen];

  job.queue = job.queue.slice(batch.length);
  if (job.queue.length === 0) advance(job);
}

async function stepEnrich(deps: EngineDeps, job: ImportJob) {
  const source = deps.foreverDb;
  if (!source) {
    advance(job);
    return;
  }

  if (!job.enrichSeeded) {
    const limit = deps.foreverDbMaxPerRun ?? 300;
    const queue: number[] = [];
    let after: string | null = null;
    while (queue.length < limit) {
      const page: Array<ItemDoc & { foreverdbJson?: string | null }> = await deps.store.listPage("items", after, 300);
      if (page.length === 0) break;
      for (const item of page) {
        if (item.foreverdbJson === undefined && queue.length < limit) queue.push(item.id);
      }
      after = String(page[page.length - 1].id);
    }
    job.enrichQueue = queue;
    job.enrichTotal = queue.length;
    job.enrichSeeded = true;
    return;
  }

  const batch = job.enrichQueue.slice(0, ENRICH_STEP);
  if (batch.length === 0) {
    advance(job);
    return;
  }

  const writes: StoredDoc[] = [];
  for (const id of batch) {
    const response = await source.item(id);
    writes.push({
      id,
      foreverdbJson: response ? JSON.stringify(response.data) : null,
      foreverdbAt: nowIso(deps),
    });
    job.enrichQueue = job.enrichQueue.filter((queued) => queued !== id);
    if (writes.length >= ENRICH_STEP) break;
  }
  await deps.store.upsertMany("items", writes);
}

async function detectOrphans(deps: EngineDeps, job: ImportJob) {
  const checks: Array<[CatalogCollection, number[], (doc: Record<string, unknown>) => boolean, boolean]> = [
    ["items", job.seenSourceIds.items, (doc) => doc.discoveredAs === "corpus", job.targets.items],
    ["recipes", job.seenSourceIds.recipes, () => true, job.targets.recipes],
  ];

  for (const [col, seenIds, isCandidate, enabled] of checks) {
    if (!enabled) continue;
    const seen = new Set(seenIds.map(String));
    const orphans: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page: Array<Record<string, unknown> & { id: number | string }> = await deps.store.listPage(col, after, 300);
      if (page.length === 0) break;
      for (const doc of page) {
        if (isCandidate(doc) && !seen.has(String(doc.id))) orphans.push(String(doc.id));
      }
      after = String(page[page.length - 1].id);
    }
    job.counters.orphans += orphans.length;
    if (orphans.length > 0) {
      await log(
        deps,
        job,
        "warn",
        "system",
        `${orphans.length} ${col} locais não aparecem mais na fonte (mantidos, nada foi excluído): ${orphans.slice(0, 20).join(", ")}`,
      );
    }
  }
}
