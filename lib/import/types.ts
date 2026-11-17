// Contratos reais da biblioteca de dados do Warcraft Forever
// (https://warcraftforever.com/developers/data/).

export type DatasetKind = "items" | "recipes" | "professions";

export interface WfEnvelope<T> {
  schemaVersion: number;
  dataset: string;
  locale: string;
  resource: string;
  source: { product: string; build: string; observedAt?: string; access?: string };
  coverage: string;
  data: T[];
  nextCursor?: string | null;
  missingIds?: number[];
}

export interface WfManifest {
  schemaVersion: number;
  defaultChannel: string;
  aliases?: Record<string, string>;
  channels: Record<
    string,
    { build: string; product: string; locales: string[]; datasets: Record<string, string> }
  >;
  limits: { batch: number; search: number; defaultSearch: number };
  unavailable?: Record<string, string>;
}

export interface WfItem {
  id: number;
  slug?: string;
  icon?: string | null;
  iconUrl?: string | null;
  quality?: number | null;
  class?: number | null;
  subclass?: number | null;
  slot?: number | null;
  level?: number | null;
  stack?: number | null;
  sell?: number | null;
  buy?: number | null;
  name?: string | null;
  nameLocale?: string | null;
  effects?: unknown[];
  flavor?: string | null;
  url?: string | null;
}

export interface WfRecipe {
  id: number;
  slug?: string;
  profession: number;
  category?: number | null;
  product?: { item: number; count: number } | null;
  reagents?: Array<[number, number]>;
  toolCategories?: number[];
  focus?: number | null;
  skill?: { yellow?: number; grey?: number; orange?: number; green?: number } | null;
  acquire?: number | null;
  castMs?: number | null;
  name?: string | null;
  nameLocale?: string | null;
  icon?: string | null;
  iconUrl?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface WfProfession {
  id: number;
  line?: number;
  slug: string;
  kind?: string;
  icon?: string | null;
  iconUrl?: string | null;
  categories?: Array<{ id: number; order?: number; hidden?: boolean; name?: string | null; nameLocale?: string }>;
  name?: string | null;
  nameLocale?: string | null;
  url?: string | null;
}

// ---------- Documentos persistidos (coleções wf_*) ----------

export interface SourceStamp {
  source: "warcraftforever" | "foreverdb";
  dataset: string;
  build: string;
}

export interface ItemDoc {
  id: number; // ID original do WoW Forever (identificador principal)
  name: string | null;
  nameLocale: string | null;
  locale: string;
  icon: string | null;
  iconUrl: string | null;
  quality: number | null;
  qualityName: string | null;
  category: string | null;
  subcategory: string | null;
  itemClass: number | null;
  itemSubclass: number | null;
  equipSlot: number | null;
  requiredLevel: number | null;
  description: string | null;
  stack: number | null;
  vendorSell: number | null;
  vendorBuy: number | null;
  // JSON serializado: o Firestore não aceita arrays aninhados.
  extra: { effectsJson: string | null; slug: string | null; url: string | null };
  discoveredAs: "corpus" | "material";
  sources: SourceStamp[];
  contentHash: string;
  importedAt: string;
  updatedAt: string;
}

export interface RecipeDoc {
  id: number;
  name: string | null;
  nameLocale: string | null;
  slug: string | null;
  professionId: number;
  professionSlug: string | null;
  categoryId: number | null;
  requiredSkill: number | null;
  skill: { orange?: number; yellow?: number; green?: number; grey?: number } | null;
  reagents: Array<{ itemId: number; quantity: number }>;
  product: { itemId: number; quantity: number } | null;
  toolCategories: number[];
  castMs: number | null;
  icon: string | null;
  iconUrl: string | null;
  description: string | null;
  sources: SourceStamp[];
  contentHash: string;
  importedAt: string;
  updatedAt: string;
}

export interface ProfessionDoc {
  id: number;
  slug: string;
  name: string | null;
  kind: string | null;
  icon: string | null;
  iconUrl: string | null;
  categories: Array<{ id: number; name: string | null; order: number | null; hidden: boolean }>;
  sources: SourceStamp[];
  contentHash: string;
  importedAt: string;
  updatedAt: string;
}

// Aresta receita<->item. ID determinístico: `${recipeId}_${role}_${itemId}`.
export interface RecipeEdgeDoc {
  id: string;
  recipeId: number;
  itemId: number;
  role: "reagent" | "product";
  quantity: number;
  professionId: number;
  contentHash: string;
}

export type ImportMode = "initial" | "incremental" | "sync";
export type ImportPhase = "professions" | "recipes" | "items" | "materials" | "enrich" | "done";
export type ImportStatus = "running" | "paused" | "completed" | "failed";

export interface ImportTargets {
  professions: boolean;
  recipes: boolean;
  items: boolean;
  materials: boolean;
}

export interface ImportCounters {
  itemsFound: number;
  itemsImported: number;
  itemsUpdated: number;
  recipesFound: number;
  recipesImported: number;
  recipesUpdated: number;
  professionsImported: number;
  materialsIdentified: number;
  materialsFetched: number;
  skipped: number;
  errors: number;
  orphans: number;
  requests: number;
}

export const EMPTY_COUNTERS: ImportCounters = {
  itemsFound: 0,
  itemsImported: 0,
  itemsUpdated: 0,
  recipesFound: 0,
  recipesImported: 0,
  recipesUpdated: 0,
  professionsImported: 0,
  materialsIdentified: 0,
  materialsFetched: 0,
  skipped: 0,
  errors: 0,
  orphans: 0,
  requests: 0,
};

export interface ImportJob {
  id: string;
  mode: ImportMode;
  targets: ImportTargets;
  locale: string;
  enrichWithForeverDb: boolean;
  status: ImportStatus;
  phase: ImportPhase;
  // Datasets fixados no início: cursores continuam válidos na retomada.
  datasets: { items: string; recipes: string; professions: string; build: string };
  cursor: string | null;
  materialsSeeded: boolean;
  enrichSeeded: boolean;
  queueTotal: number;
  enrichTotal: number;
  // Fila da fase de materiais (inclui a recursão sobre a cadeia de produção).
  queue: number[];
  seen: number[];
  enrichQueue: number[];
  counters: ImportCounters;
  // IDs vistos na fonte neste run (detecção de órfãos no modo sync).
  seenSourceIds: { items: number[]; recipes: number[] };
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
}

export interface ImportLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  phase: ImportPhase | "system";
  message: string;
}
