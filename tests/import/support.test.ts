import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapProfession, toImportedCraftItem, toReagentEntry } from "../../lib/import/adapters";
import { createStoreGraphReader, flattenBaseMaterials, resolveChain, type GraphReader } from "../../lib/import/graph";
import { backoffDelay, fetchJson, HttpError, parseRetryAfter, RateLimiter } from "../../lib/import/http";
import { computeProgress } from "../../lib/import/progress";
import { startImport, runSlice, type EngineDeps } from "../../lib/import/engine";
import { MemoryImportStore } from "../../lib/import/store";
import { WfSource } from "../../lib/import/wf-source";
import { computeDashboardRows } from "../../lib/modules/pricing-engine";
import { fetchItemPricesFromAuctionHouse } from "../../lib/modules/auctionhouse-service";
import type { ItemDoc, RecipeDoc } from "../../lib/import/types";
import { FakeWf } from "./fakes";

const noSleep = async () => undefined;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("AuctionHouse.fyi: preço de item", () => {
  it("usa o preço e a quantidade observados no mercado", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return jsonResponse({ row: [125, 50, 1_790_683_200_000] });
    }) as typeof fetch;

    try {
      const [price] = await fetchItemPricesFromAuctionHouse([2589]);
      assert.equal(requestedUrl, "https://auctionhouse.fyi/api/v1/ah/forever.pvp.horde.us/2589");
      assert.deepEqual(price, {
        itemId: 2589,
        price: 125,
        quantity: 50,
        lastUpdated: 1_790_683_200_000,
        ok: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("considera preço null como indisponível, sem transformá-lo em zero disponível", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse({ row: [null, null, 1_790_683_200_000] })) as typeof fetch;

    try {
      const [price] = await fetchItemPricesFromAuctionHouse([2589]);
      assert.equal(price.ok, false);
      assert.equal(price.price, 0);
      assert.equal(price.quantity, null);
      assert.equal(price.lastUpdated, 1_790_683_200_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("HTTP: retry, backoff, 429 e timeout", () => {
  it("repete após 429 respeitando Retry-After e depois tem sucesso", async () => {
    const delays: number[] = [];
    let calls = 0;
    const limiter = new RateLimiter(0, Date.now, async (ms) => void delays.push(ms));
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await fetchJson<{ ok: boolean }>("https://x.test/a", limiter, { fetchImpl, sleep: noSleep });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
    assert.ok(delays.some((ms) => ms >= 1_500), "a segunda tentativa deve aguardar o Retry-After");
  });

  it("aplica backoff exponencial em 5xx e desiste após maxRetries", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 503 });
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", null, { fetchImpl, sleep: async (ms) => void waits.push(ms), maxRetries: 3, baseDelayMs: 100 }),
      HttpError,
    );
    assert.equal(calls, 4);
    assert.equal(waits.length, 3);
    assert.ok(waits[2] > waits[0]);
  });

  it("trata timeout como erro retentável", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return jsonResponse({ ok: 1 });
    }) as typeof fetch;

    assert.deepEqual(await fetchJson("https://x.test/a", null, { fetchImpl, sleep: noSleep }), { ok: 1 });
    assert.equal(calls, 2);
  });

  it("não repete erros 4xx definitivos", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 404 });
    }) as typeof fetch;
    await assert.rejects(fetchJson("https://x.test/a", null, { fetchImpl, sleep: noSleep }));
    assert.equal(calls, 1);
  });

  it("rate limiter espaça requisições pelo intervalo mínimo", async () => {
    let clock = 1_000;
    const slept: number[] = [];
    const limiter = new RateLimiter(250, () => clock, async (ms) => {
      slept.push(ms);
      clock += ms;
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    assert.deepEqual(slept, [250, 250]);
  });

  it("utilitários de tempo", () => {
    assert.equal(parseRetryAfter("3"), 3000);
    assert.equal(parseRetryAfter(null), null);
    assert.ok(backoffDelay(10, 100, 1000, () => 1) <= 1000);
  });
});

describe("WfSource: contrato da API", () => {
  it("monta URLs com dataset, locale, cursor e limite; reutiliza cache", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return jsonResponse({ data: [], nextCursor: null });
    }) as unknown as typeof fetch;
    const source = new WfSource({ minIntervalMs: 0, http: { fetchImpl, sleep: noSleep } });

    await source.page("recipes", "gamedata-abc", "enUS", "CURSOR_1");
    await source.page("recipes", "gamedata-abc", "enUS", "CURSOR_1");
    await source.getMany("items", "gamedata-abc", "enUS", [3860, 3858]);

    assert.equal(urls.length, 2);
    assert.equal(
      urls[0],
      "https://warcraftforever.com/api/data/v1/gamedata-abc/enUS/recipes?query=&limit=100&cursor=CURSOR_1",
    );
    assert.equal(urls[1], "https://warcraftforever.com/api/data/v1/gamedata-abc/enUS/items?ids=3860%2C3858");
    await assert.rejects(async () => source.getMany("items", "x", "enUS", Array.from({ length: 51 }, (_, i) => i + 1)));
  });

  it("resolve datasets separados para items, recipes e professions", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        defaultChannel: "live",
        aliases: { beta: "live" },
        channels: {
          live: { build: "1.60", product: "wowf", locales: ["enUS"], datasets: { items: "i-1", recipes: "r-2", professions: "p-3" } },
        },
        limits: { batch: 50, search: 100, defaultSearch: 25 },
      })) as unknown as typeof fetch;
    const source = new WfSource({ minIntervalMs: 0, http: { fetchImpl, sleep: noSleep } });
    const resolved = await source.resolveDatasets();
    assert.deepEqual([resolved.items, resolved.recipes, resolved.professions], ["i-1", "r-2", "p-3"]);
  });
});

describe("cadeia de produção", () => {
  const items = new Map<number, ItemDoc>();
  const make = (id: number, reagents: Array<[number, number]>, produces = 1): RecipeDoc =>
    ({
      id: id * 10,
      name: `R${id}`,
      professionSlug: "blacksmithing",
      requiredSkill: null,
      reagents: reagents.map(([itemId, quantity]) => ({ itemId, quantity })),
      product: { itemId: id, quantity: produces },
    }) as unknown as RecipeDoc;

  function reader(recipes: RecipeDoc[]): GraphReader {
    return {
      async getItem(id) {
        return items.get(id) ?? ({ id, name: `Item ${id}` } as ItemDoc);
      },
      async recipesProducing(id) {
        return recipes.filter((r) => r.product?.itemId === id);
      },
    };
  }

  it("resolve a árvore completa e totaliza materiais base", async () => {
    // 3 <- 2x(2) ; 2 <- 1x(1) ; 1 não tem receita
    const chain = await resolveChain(reader([make(3, [[2, 2]]), make(2, [[1, 1]])]), 3);
    assert.equal(chain.recipe?.id, 30);
    assert.equal(chain.reagents[0].reagents[0].itemId, 1);
    assert.equal(chain.reagents[0].reagents[0].recipe, null);
    assert.deepEqual([...flattenBaseMaterials(chain, 2)], [[1, 4]]);
  });

  it("interrompe referências circulares", async () => {
    const chain = await resolveChain(reader([make(1, [[2, 1]]), make(2, [[1, 1]])]), 1);
    assert.equal(chain.reagents[0].reagents[0].circular, true);
  });

  it("lê o grafo persistido pelo importador", async () => {
    const store = new MemoryImportStore();
    const wf = new FakeWf();
    const deps: EngineDeps = { store, wf };
    const job = await startImport(deps, { mode: "initial" });
    while ((await runSlice(deps, job.id, 5_000)).job.status === "running");

    const chain = await resolveChain(createStoreGraphReader(store), 7931);
    assert.equal(chain.name, "Mithril Coif");
    assert.equal(chain.reagents[0].itemId, 3860);
    assert.equal(chain.reagents[0].reagents[0].itemId, 3858); // Mithril Ore
    assert.equal(chain.reagents[0].reagents[0].recipe, null); // nem todo material tem receita
    assert.equal(flattenBaseMaterials(chain).get(3858), 10);
  });
});

describe("compatibilidade com os cálculos existentes", () => {
  it("o catálogo alimenta computeDashboardRows sem tocar em preços de mercado", async () => {
    const store = new MemoryImportStore();
    const deps: EngineDeps = { store, wf: new FakeWf() };
    const job = await startImport(deps, { mode: "initial" });
    while ((await runSlice(deps, job.id, 5_000)).job.status === "running");

    const recipes = [...store.data.recipes.values()] as unknown as RecipeDoc[];
    const itemMap = new Map([...store.data.items.values()].map((doc) => [doc.id as number, doc as unknown as ItemDoc]));

    const craft = toImportedCraftItem(recipes.find((r) => r.id === 9961)!, itemMap)!;
    assert.equal(craft.profession, "Blacksmithing");
    assert.equal(craft.auctionPrice, 0);
    assert.equal(craft.recipe[0].quantity, 10);

    const bar = toReagentEntry(itemMap.get(3860)!, recipes.find((r) => r.id === 10097)!, itemMap);
    const ore = toReagentEntry(itemMap.get(3858)!, null, itemMap);
    assert.equal(bar.priceSource, "CRAFTING");
    assert.equal(ore.priceSource, "MATERIA_PRIMA");

    const rows = computeDashboardRows([craft], [{ ...bar }, { ...ore, tsmPrice: 100 }]);
    assert.equal(rows[0].craftCost, 1000); // 10 barras x (1 minério x 100)
    assert.equal(mapProfession("mining"), "Other");
  });

  it("calcula progresso a partir dos checkpoints", () => {
    const base = {
      targets: { professions: true, recipes: true, items: true, materials: true },
      enrichWithForeverDb: false,
      status: "running",
      phase: "materials",
      materialsSeeded: true,
      queueTotal: 10,
      queue: new Array(5).fill(1),
      counters: { itemsFound: 0, recipesFound: 0 },
    } as unknown as Parameters<typeof computeProgress>[0];
    assert.equal(computeProgress(base), Math.round(((3 + 0.5) / 4) * 100));
    assert.equal(computeProgress({ ...base, status: "completed" }), 100);
  });
});
