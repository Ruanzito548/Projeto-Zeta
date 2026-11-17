import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportBusyError, resumeImport, runSlice, startImport, type EngineDeps } from "../../lib/import/engine";
import { MemoryImportStore } from "../../lib/import/store";
import type { ImportJob, ItemDoc, RecipeDoc } from "../../lib/import/types";
import { defaultData, FakeWf, item, recipe } from "./fakes";

function setup(wf = new FakeWf()) {
  const store = new MemoryImportStore();
  let n = 0;
  const deps: EngineDeps = { store, wf, newId: () => `id-${(n += 1)}` };
  return { store, wf, deps };
}

async function runAll(deps: EngineDeps, jobId: string): Promise<ImportJob> {
  let job: ImportJob;
  do {
    ({ job } = await runSlice(deps, jobId, 5_000));
  } while (job.status === "running");
  return job;
}

async function fullImport(deps: EngineDeps, mode: "initial" | "incremental" | "sync" = "initial") {
  const job = await startImport(deps, { mode });
  return runAll(deps, job.id);
}

describe("importação completa", () => {
  it("percorre todas as páginas de profissões, receitas e itens", async () => {
    const { store, wf, deps } = setup();
    const job = await fullImport(deps);

    assert.equal(job.status, "completed");
    assert.equal(store.data.professions.size, 2);
    assert.equal(store.data.recipes.size, 3); // 2 páginas
    assert.equal(job.counters.itemsFound, 3);
    assert.equal(job.counters.recipesFound, 3);
    // Cursores devem ser enviados com o dataset do respectivo recurso.
    assert.ok(wf.pageCalls.includes("recipes:gamedata-recipes-v1:c2"));
    assert.ok(wf.pageCalls.includes("items:gamedata-items-v1:c2"));
  });

  it("guarda a receita com materiais, produto, quantidade e profissão", async () => {
    const { store, deps } = setup();
    await fullImport(deps);

    const coif = store.data.recipes.get("9961") as unknown as RecipeDoc;
    assert.deepEqual(coif.reagents, [{ itemId: 3860, quantity: 10 }]);
    assert.deepEqual(coif.product, { itemId: 7931, quantity: 1 });
    assert.equal(coif.professionSlug, "blacksmithing");
    assert.equal(coif.skill?.yellow, 100);
    assert.equal(coif.requiredSkill, null); // a fonte não publica "orange"; não inventamos
    assert.ok(store.data.edges.has("9961_reagent_3860"));
    assert.ok(store.data.edges.has("9961_product_7931"));
  });

  it("importa materiais ausentes do corpus pelo ID e usa o ID original como chave", async () => {
    const { store, deps } = setup();
    const job = await fullImport(deps);

    const ore = store.data.items.get("3858") as unknown as ItemDoc;
    assert.equal(ore.id, 3858);
    assert.equal(ore.discoveredAs, "material");
    assert.equal(ore.category, "Trade Goods");
    assert.ok(store.data.items.has("2770"));
    assert.equal(job.counters.materialsFetched, 2);
    assert.equal(job.counters.materialsIdentified, 3); // 3858, 3860, 2770
  });

  it("não confunde itens com o mesmo nome", async () => {
    const wf = new FakeWf({ ...defaultData(), items: [item(1, "Linen Cloth"), item(2, "Linen Cloth")], recipes: [], hidden: [] });
    const { store, deps } = setup(wf);
    await fullImport(deps);
    assert.equal(store.data.items.size, 2);
  });

  it("recursão: receitas dos materiais revelam novos materiais e ciclos não travam", async () => {
    const wf = new FakeWf({
      professions: defaultData().professions,
      items: [item(1, "A")],
      // A <- B ; B <- C ; C <- A (ciclo). B e C só existem por ID.
      hidden: [item(2, "B"), item(3, "C")],
      recipes: [recipe(100, [1, 1], [[2, 1]]), recipe(101, [2, 1], [[3, 1]]), recipe(102, [3, 1], [[1, 1]])],
    });
    const { store, deps } = setup(wf);
    const job = await fullImport(deps);

    assert.equal(job.status, "completed");
    assert.deepEqual([...store.data.items.keys()].sort(), ["1", "2", "3"]);
  });

  it("itens ausentes na fonte são registrados e não derrubam a importação", async () => {
    const wf = new FakeWf({ ...defaultData(), hidden: [] });
    const { store, deps } = setup(wf);
    const job = await fullImport(deps);

    assert.equal(job.status, "completed");
    assert.ok(job.counters.skipped >= 2);
    assert.ok((await store.listLogs(job.id, 50)).some((entry) => entry.level === "warn"));
  });
});

describe("idempotência e atualização", () => {
  it("repetir a importação não duplica nem regrava registros", async () => {
    const { store, deps } = setup();
    await fullImport(deps);
    const sizes = Object.values(store.data).map((m) => m.size);
    const writes = store.writes;

    const second = await fullImport(deps, "incremental");

    assert.deepEqual(Object.values(store.data).map((m) => m.size), sizes);
    assert.equal(store.writes, writes);
    assert.equal(second.counters.itemsImported + second.counters.recipesImported, 0);
    assert.ok(second.counters.skipped > 0);
  });

  it("incremental grava apenas o que mudou ou é novo", async () => {
    const { store, wf, deps } = setup();
    await fullImport(deps);
    const writes = store.writes;

    wf.data.items[0] = item(3860, "Mithril Bar (renamed)");
    wf.data.items.push(item(9999, "Brand New"));
    const job = await fullImport(deps, "incremental");

    assert.equal(job.counters.itemsUpdated, 1);
    assert.equal(job.counters.itemsImported, 1);
    assert.equal(store.writes, writes + 2);
    assert.equal((store.data.items.get("3860") as unknown as ItemDoc).name, "Mithril Bar (renamed)");
  });

  it("preserva campos personalizados e nunca toca coleções de preço", async () => {
    const { store, wf, deps } = setup();
    await fullImport(deps);
    store.data.items.set("3860", { ...store.data.items.get("3860")!, customNote: "meu preço alvo", foreverdbJson: "{}" });

    wf.data.items[0] = item(3860, "Mithril Bar v2");
    await fullImport(deps, "incremental");

    const doc = store.data.items.get("3860")!;
    assert.equal(doc.name, "Mithril Bar v2");
    assert.equal(doc.customNote, "meu preço alvo");
    assert.equal(doc.foreverdbJson, "{}");
    assert.ok(!("auctionPrice" in doc) && !("marketPrice" in doc));
    assert.deepEqual(Object.keys(store.data).sort(), ["edges", "items", "professions", "recipes"]);
  });

  it("sync detecta registros órfãos sem excluí-los", async () => {
    const { store, wf, deps } = setup();
    await fullImport(deps);

    wf.data.items = wf.data.items.filter((entry) => entry.id !== 2840);
    const job = await fullImport(deps, "sync");

    assert.equal(job.counters.orphans, 1);
    assert.ok(store.data.items.has("2840"));
  });
});

describe("checkpoint, retomada e concorrência", () => {
  it("falha parcial pausa o job e a retomada continua sem refazer páginas anteriores", async () => {
    const { store, wf, deps } = setup();
    wf.failOnce = { kind: "recipes", cursor: "c2" };

    const started = await startImport(deps, { mode: "initial" });
    const paused = (await runSlice(deps, started.id, 5_000)).job;

    assert.equal(paused.status, "paused");
    assert.equal(paused.phase, "recipes");
    assert.equal(paused.cursor, "c2");
    assert.equal(paused.counters.errors, 1);
    assert.equal(store.data.recipes.size, 2);

    const callsBefore = wf.pageCalls.filter((call) => call.startsWith("recipes:") && call.endsWith(":-")).length;
    await resumeImport(deps, started.id);
    const done = await runAll(deps, started.id);

    assert.equal(done.status, "completed");
    assert.equal(store.data.recipes.size, 3);
    assert.equal(wf.pageCalls.filter((call) => call.startsWith("recipes:") && call.endsWith(":-")).length, callsBefore);
    assert.equal(done.counters.recipesImported, 3);
  });

  it("mantém o dataset fixado mesmo que o manifest mude durante a importação", async () => {
    const { wf, deps } = setup();
    const job = await startImport(deps, { mode: "initial" });
    await runSlice(deps, job.id, 0);

    wf.datasets = { items: "gamedata-items-v2", recipes: "gamedata-recipes-v2", professions: "gamedata-prof-v2" };
    const stillPinned = await store(deps).getJob(job.id);
    assert.equal(stillPinned?.datasets.items, "gamedata-items-v1");
  });

  it("apenas uma importação executa por vez", async () => {
    const { store: memory, deps } = setup();
    const job = await startImport(deps, { mode: "initial" });

    await memory.acquireLock("outro-processo", 60_000);
    assert.equal((await runSlice(deps, job.id)).busy, true);
    await assert.rejects(() => startImport(deps, { mode: "initial" }), ImportBusyError);
  });

  it("respeita os alvos selecionados", async () => {
    const { store: memory, deps } = setup();
    const job = await startImport(deps, {
      mode: "initial",
      targets: { professions: false, recipes: false, items: true, materials: false },
    });
    await runAll(deps, job.id);

    assert.equal(memory.data.recipes.size, 0);
    assert.equal(memory.data.items.size, 3);
  });
});

function store(deps: EngineDeps) {
  return deps.store;
}
