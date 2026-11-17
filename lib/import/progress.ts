import type { ImportJob, ImportPhase } from "./types";

const ORDER: ImportPhase[] = ["professions", "recipes", "items", "materials", "enrich"];

/**
 * Porcentagem estimada (0-100). As APIs não informam o total de registros; por isso as fases
 * paginadas usam como referência o total de uma importação concluída anterior, quando existe.
 * Fases de materiais/enriquecimento usam o tamanho real da fila.
 */
export function computeProgress(job: ImportJob, previous?: { itemsFound: number; recipesFound: number } | null): number {
  if (job.status === "completed" || job.phase === "done") return 100;

  const enabled = ORDER.filter((phase) =>
    phase === "enrich" ? job.enrichWithForeverDb : job.targets[phase as keyof ImportJob["targets"]],
  );
  if (enabled.length === 0) return 0;

  const index = enabled.indexOf(job.phase);
  if (index < 0) return 0;

  let fraction = 0;
  if (job.phase === "materials" && job.materialsSeeded) {
    fraction = job.queueTotal > 0 ? 1 - job.queue.length / job.queueTotal : 1;
  } else if (job.phase === "enrich" && job.enrichSeeded) {
    fraction = job.enrichTotal > 0 ? 1 - job.enrichQueue.length / job.enrichTotal : 1;
  } else if (job.phase === "recipes" && previous?.recipesFound) {
    fraction = Math.min(0.95, job.counters.recipesFound / previous.recipesFound);
  } else if (job.phase === "items" && previous?.itemsFound) {
    fraction = Math.min(0.95, job.counters.itemsFound / previous.itemsFound);
  }

  return Math.min(99, Math.max(0, Math.round(((index + fraction) / enabled.length) * 100)));
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
