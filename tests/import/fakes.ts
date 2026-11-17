import type { WfSourceLike } from "../../lib/import/engine";
import type { WfEnvelope, WfItem, WfProfession, WfRecipe } from "../../lib/import/types";

export interface FakeData {
  professions: WfProfession[];
  recipes: WfRecipe[];
  items: WfItem[]; // corpus navegável
  hidden: WfItem[]; // existem por ID, mas não aparecem na navegação
}

export const PAGE_SIZE = 2;

export function item(id: number, name: string, extra: Partial<WfItem> = {}): WfItem {
  return { id, name, nameLocale: "enUS", quality: 1, class: 7, subclass: 7, level: 1, sell: 10, icon: `icon_${id}`, ...extra };
}

export function recipe(id: number, product: [number, number], reagents: Array<[number, number]>, extra: Partial<WfRecipe> = {}): WfRecipe {
  return {
    id,
    profession: 164,
    name: `Recipe ${id}`,
    nameLocale: "enUS",
    product: { item: product[0], count: product[1] },
    reagents,
    skill: { yellow: 100, grey: 120 },
    castMs: 3000,
    ...extra,
  };
}

export function defaultData(): FakeData {
  return {
    professions: [
      { id: 164, slug: "blacksmithing", name: "Blacksmithing", kind: "primary", categories: [{ id: 1, name: "Bars", order: 0 }] },
      { id: 186, slug: "mining", name: "Mining", kind: "primary", categories: [] },
    ],
    // Mithril Bar (3860) <- Mithril Ore (3858) fora do corpus; Mithril Coif <- 3860.
    items: [item(3860, "Mithril Bar"), item(7931, "Mithril Coif"), item(2840, "Copper Bar")],
    hidden: [item(3858, "Mithril Ore"), item(2770, "Copper Ore")],
    recipes: [
      recipe(10097, [3860, 1], [[3858, 1]]),
      recipe(9961, [7931, 1], [[3860, 10]]),
      recipe(2657, [2840, 1], [[2770, 1]]),
    ],
  };
}

export class FakeWf implements WfSourceLike {
  requests = 0;
  pageCalls: string[] = [];
  failOnce: { kind: string; cursor: string | null } | null = null;
  datasets = { items: "gamedata-items-v1", recipes: "gamedata-recipes-v1", professions: "gamedata-prof-v1" };

  constructor(public data: FakeData = defaultData()) {}

  async resolveDatasets() {
    return {
      ...this.datasets,
      build: "1.60.1.70888",
      locales: ["enUS"],
      limits: { batch: 50, search: 100, defaultSearch: 25 },
    };
  }

  private records(kind: string): Array<{ id: number }> {
    return (this.data as unknown as Record<string, Array<{ id: number }>>)[kind];
  }

  async page(kind: "items" | "recipes" | "professions", dataset: string, _locale: string, cursor: string | null) {
    this.requests += 1;
    this.pageCalls.push(`${kind}:${dataset}:${cursor ?? "-"}`);
    if (dataset !== this.datasets[kind]) throw new Error(`cursor/dataset incoerente para ${kind}: ${dataset}`);

    if (this.failOnce && this.failOnce.kind === kind && this.failOnce.cursor === cursor) {
      this.failOnce = null;
      throw new Error("HTTP 503 simulado");
    }

    const all = this.records(kind);
    const start = cursor ? Number(cursor.replace("c", "")) : 0;
    const slice = all.slice(start, start + PAGE_SIZE);
    const next = start + PAGE_SIZE < all.length ? `c${start + PAGE_SIZE}` : null;
    return { data: slice, nextCursor: next } as unknown as WfEnvelope<never>;
  }

  async getMany(kind: "items" | "recipes" | "professions", dataset: string, _locale: string, ids: number[]) {
    this.requests += 1;
    if (dataset !== this.datasets[kind]) throw new Error("dataset incorreto");
    const pool = kind === "items" ? [...this.data.items, ...this.data.hidden] : this.records(kind);
    const found = pool.filter((record) => ids.includes(record.id));
    const missingIds = ids.filter((id) => !found.some((record) => record.id === id));
    return { data: found, missingIds } as unknown as WfEnvelope<never>;
  }
}
