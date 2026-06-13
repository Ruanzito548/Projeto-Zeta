"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ArrowDown, ArrowRight, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  computeDashboardRows,
  applyCalculatedReagentPrices,
} from "@/lib/modules/pricing-engine";
import {
  loadSnapshot,
  loadSnapshotFromCloud,
  saveSnapshot,
  saveSnapshotToCloud,
} from "@/lib/modules/storage";
import { VERSION_REAGENT_SEEDS } from "@/lib/modules/catalog";
import type { ImportedCraftItem, ModuleSnapshot, PriceSource, ReagentEntry } from "@/lib/modules/types";
import { DEFAULT_SNAPSHOT } from "@/lib/modules/types";
import type { WowVersion } from "@/lib/wow/versions";

const TABS = ["dashboard", "import", "reagents"] as const;

type TabId = (typeof TABS)[number];

type TsmResponse = {
  results?: Array<{ name: string; itemId: number | null; price: number; ok: boolean }>;
  error?: string;
};

const SOURCE_OPTIONS: Array<{ value: PriceSource; label: string }> = [
  { value: "MATERIA_PRIMA", label: "Materia prima" },
  { value: "CRAFTING", label: "Crafting" },
  { value: "NPC", label: "NPC" },
];

function wowheadItemUrl(version: WowVersion, itemId: number): string {
  const base = version === "retail" ? "https://www.wowhead.com" : "https://www.wowhead.com/tbc";
  return `${base}/item=${itemId}`;
}

function mergePriceEntries(existing: ReagentEntry[], incoming: ReagentEntry[]): ReagentEntry[] {
  const byId = new Map<number, ReagentEntry>();

  for (const entry of existing) {
    byId.set(entry.itemId, entry);
  }

  for (const entry of incoming) {
    const prev = byId.get(entry.itemId);

    if (!prev) {
      byId.set(entry.itemId, entry);
      continue;
    }

    byId.set(entry.itemId, {
      ...entry,
      tsmPrice: prev.tsmPrice > 0 ? prev.tsmPrice : entry.tsmPrice,
      calculatedPrice: prev.calculatedPrice ?? entry.calculatedPrice,
      source: prev.source || entry.source,
      priceSource: prev.priceSource,
      fixedPrice: prev.fixedPrice,
      recipe: prev.recipe.length > 0 ? prev.recipe : entry.recipe,
      updatedAt: new Date().toISOString(),
    });
  }

  return Array.from(byId.values());
}

function toTrackedPriceEntries(item: ImportedCraftItem, version: WowVersion): ReagentEntry[] {
  const baseEntry: ReagentEntry = {
    itemId: item.itemId,
    name: item.name,
    icon: item.icon,
    quality: item.quality,
    wowheadUrl: item.wowheadUrl || wowheadItemUrl(version, item.itemId),
    source: "Item importado para analise de lucro.",
    priceSource: item.recipe.length > 0 ? "CRAFTING" : "MATERIA_PRIMA",
    fixedPrice: null,
    tsmPrice: item.auctionPrice,
    calculatedPrice: null,
    recipe: item.recipe,
    updatedAt: new Date().toISOString(),
  };

  const disenchantEntries: ReagentEntry[] = item.disenchant.map((entry) => ({
    itemId: entry.itemId,
    name: entry.name,
    icon: entry.icon,
    quality: "uncommon",
    wowheadUrl: wowheadItemUrl(version, entry.itemId),
    source: `Resultado de disenchant de ${item.name}.`,
    priceSource: "MATERIA_PRIMA",
    fixedPrice: null,
    tsmPrice: 0,
    calculatedPrice: null,
    recipe: [],
    updatedAt: new Date().toISOString(),
  }));

  return [baseEntry, ...disenchantEntries];
}

function formatMoney(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const gold = Math.floor(normalized / 10000);
  const silver = Math.floor((normalized % 10000) / 100);
  const copper = normalized % 100;
  return `${gold}g ${silver}s ${copper}c`;
}

function formatSignedMoney(value: number): string {
  return `${value < 0 ? "-" : ""}${formatMoney(Math.abs(value))}`;
}

function getScenarioUnitPrice(reagent: ReagentEntry | undefined, multiplier: number): number {
  if (!reagent) {
    return 0;
  }

  const basePrice = reagent.fixedPrice && reagent.fixedPrice > 0
    ? reagent.fixedPrice
    : (reagent.calculatedPrice ?? reagent.tsmPrice ?? 0);

  if (reagent.fixedPrice && reagent.fixedPrice > 0) {
    return basePrice;
  }

  return basePrice * multiplier;
}

function buildCraftScenarioTotals(craft: ImportedCraftItem, reagents: ReagentEntry[]) {
  return craft.recipe.reduce(
    (accumulator, component) => {
      const reagent = reagents.find((entry) => entry.itemId === component.itemId);
      const baseUnit = getScenarioUnitPrice(reagent, 1);
      const lowUnit = getScenarioUnitPrice(reagent, 0.75);
      const highUnit = getScenarioUnitPrice(reagent, 1.25);

      return {
        base: accumulator.base + baseUnit * component.quantity,
        low: accumulator.low + lowUnit * component.quantity,
        high: accumulator.high + highUnit * component.quantity,
      };
    },
    { base: 0, low: 0, high: 0 },
  );
}

function buildExpectedDisenchantValue(craft: ImportedCraftItem, priceById: Map<number, number>): number {
  return craft.disenchant.reduce((total, row) => {
    const price = priceById.get(row.itemId) ?? 0;
    const averageQty = (row.min + row.max) / 2;
    return total + price * averageQty * row.chance;
  }, 0);
}

function getReagentBasePrice(reagent: ReagentEntry | undefined): number {
  if (!reagent) {
    return 0;
  }

  return reagent.fixedPrice && reagent.fixedPrice > 0
    ? reagent.fixedPrice
    : (reagent.calculatedPrice ?? reagent.tsmPrice ?? 0);
}

function emptySnapshot(version: WowVersion): ModuleSnapshot {
  return DEFAULT_SNAPSHOT(version);
}

function defaultSeedCleanupKey(version: WowVersion): string {
  return `lootmaster-v2-seed-cleaned-${version}`;
}

function removeDefaultSeedReagents(snapshot: ModuleSnapshot): ModuleSnapshot {
  const seedIds = new Set(VERSION_REAGENT_SEEDS[snapshot.version] ?? []);
  const reagents = snapshot.reagents.filter((entry) => !seedIds.has(entry.itemId));

  if (reagents.length === snapshot.reagents.length) {
    return snapshot;
  }

  return {
    ...snapshot,
    reagents: applyCalculatedReagentPrices(reagents),
  };
}

function hasSnapshotData(snapshot: ModuleSnapshot): boolean {
  return snapshot.reagents.length > 0 || snapshot.crafts.length > 0;
}

function tabLabel(tab: TabId): string {
  if (tab === "dashboard") {
    return "Dashboard";
  }

  if (tab === "import") {
    return "Importar Item";
  }

  return "Precos";
}

export function WowVersionWorkspace({ version }: { version: WowVersion }) {
  const [activeTab, setActiveTab] = useState<TabId>("reagents");
  const [snapshot, setSnapshot] = useState<ModuleSnapshot>(() => emptySnapshot(version));
  const [query, setQuery] = useState("");
  const [importInput, setImportInput] = useState("");
  const [importReagentInput, setImportReagentInput] = useState("");
  const [importingItem, setImportingItem] = useState(false);
  const [importingReagent, setImportingReagent] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [expandedCraftIds, setExpandedCraftIds] = useState<Record<number, boolean>>({});
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Record<string, boolean>>({});
  const [appDataContent, setAppDataContent] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`lootmaster-appdata-content-${version}`) ?? "";
  });
  const [appDataFileName, setAppDataFileName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(`lootmaster-appdata-filename-${version}`) ?? "";
  });

  useEffect(() => {
    let cancelled = false;

    setStorageReady(false);
    const local = loadSnapshot(version);
    const cleanupKey = defaultSeedCleanupKey(version);
    const cleanupApplied = window.localStorage.getItem(cleanupKey) === "1";

    // Fast path: if browser cache already has data, hydrate from local only.
    if (hasSnapshotData(local)) {
      const hydratedLocal = cleanupApplied ? local : removeDefaultSeedReagents(local);

      if (!cleanupApplied) {
        window.localStorage.setItem(cleanupKey, "1");
      }

      setSnapshot(hydratedLocal);
      setStorageReady(true);

      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const cloud = await loadSnapshotFromCloud(version);

      if (cancelled) {
        return;
      }

      let hydrated = cloud && (cloud.crafts.length > 0 || cloud.reagents.length > 0) ? cloud : local;

      if (!cleanupApplied) {
        hydrated = removeDefaultSeedReagents(hydrated);
        window.localStorage.setItem(cleanupKey, "1");
      }

      setSnapshot(hydrated);

      setStorageReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    saveSnapshot(snapshot);
    void saveSnapshotToCloud(snapshot);
  }, [snapshot, storageReady]);

  const filteredReagents = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return snapshot.reagents;
    }

    return snapshot.reagents.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(normalized) ||
        String(entry.itemId).includes(normalized)
      );
    });
  }, [query, snapshot.reagents]);

  const dashboardRows = useMemo(
    () => computeDashboardRows(snapshot.crafts, snapshot.reagents),
    [snapshot.crafts, snapshot.reagents],
  );

  const reagentById = useMemo(
    () => new Map(snapshot.reagents.map((entry) => [entry.itemId, entry])),
    [snapshot.reagents],
  );

  function renderRecipeChain(
    craftId: number,
    component: ImportedCraftItem["recipe"][number],
    depth = 0,
    path = `${craftId}:${component.itemId}`,
  ) {
    const reagent = reagentById.get(component.itemId);
    const hasCraftChain = reagent?.priceSource === "CRAFTING" && reagent.recipe.length > 0;
    const isFixed = Boolean(reagent?.fixedPrice && reagent.fixedPrice > 0);
    const baseUnit = getReagentBasePrice(reagent);
    const lowUnit = isFixed ? baseUnit : baseUnit * 0.75;
    const highUnit = isFixed ? baseUnit : baseUnit * 1.25;
    const expanded = Boolean(expandedRecipeIds[path]);

    return (
      <div key={path} className="space-y-2">
        <div
          className="flex items-center justify-between rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3"
          style={{ marginLeft: `${depth * 14}px` }}
        >
          <div className="flex items-center gap-3">
            <img
              src={reagent?.icon ?? "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg"}
              alt={component.name}
              className="h-8 w-8 rounded-md border border-[rgba(69,190,95,0.22)]"
            />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                {hasCraftChain ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7"
                    onClick={() =>
                      setExpandedRecipeIds((prev) => ({
                        ...prev,
                        [path]: !expanded,
                      }))
                    }
                  >
                    {expanded ? <ArrowDown className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  </Button>
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[#4a8a4a]">
                    •
                  </span>
                )}
                <span className="block text-[#e8ffeb]">
                  {component.quantity}x {component.name}
                </span>
              </div>
              <span className="ml-9 text-xs text-[#b8e6b8]">
                Base {formatMoney(baseUnit * component.quantity)}
                {isFixed ? " | Fixo" : ` | -25% ${formatMoney(lowUnit * component.quantity)} | +25% ${formatMoney(highUnit * component.quantity)}`}
                {hasCraftChain ? " | Crafting" : ""}
              </span>
            </div>
          </div>
          <span className="font-semibold text-[#b8e6b8]">{formatMoney(component.quantity * baseUnit)}</span>
        </div>

        {hasCraftChain && expanded ? (
          <div className="space-y-2">
            {reagent.recipe.map((nestedComponent) =>
              renderRecipeChain(craftId, nestedComponent, depth + 1, `${path}:${nestedComponent.itemId}`),
            )}
          </div>
        ) : null}
      </div>
    );
  }

  async function importItem() {
    if (!importInput.trim()) {
      toast.error("Informe URL do Wowhead ou Item ID.");
      return;
    }

    setImportingItem(true);

    try {
      const response = await fetch("/api/wow/import-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          query: importInput,
        }),
      });

      const data = (await response.json()) as { item?: ImportedCraftItem; error?: string };

      if (!response.ok || !data.item) {
        throw new Error(data.error ?? "Nao foi possivel importar item.");
      }

      const base = data.item;
      const missing = base.recipe.filter(
        (row) => !snapshot.reagents.some((reagent) => reagent.itemId === row.itemId),
      );

      let importedReagents: ReagentEntry[] = [];

      if (missing.length > 0) {
        const imported = await Promise.all(
          missing.map(async (row) => {
            const reagentResponse = await fetch(
              `/api/wow/reagent?version=${version}&itemId=${row.itemId}`,
              { cache: "no-store" },
            );

            if (!reagentResponse.ok) {
              return null;
            }

            const payload = (await reagentResponse.json()) as {
              reagent?: ReagentEntry;
            };

            return payload.reagent ?? null;
          }),
        );

        importedReagents = imported.filter((entry): entry is ReagentEntry => Boolean(entry));
      }

      setSnapshot((prev) => {
        const uniqueReagents = mergePriceEntries(prev.reagents, [
          ...importedReagents,
          ...toTrackedPriceEntries(base, version),
        ]);

        const nextCrafts = [
          ...prev.crafts.filter((item) => item.itemId !== base.itemId),
          {
            ...base,
            updatedAt: new Date().toISOString(),
          },
        ];

        return {
          ...prev,
          crafts: nextCrafts,
          reagents: applyCalculatedReagentPrices([...uniqueReagents]),
        };
      });

      setImportInput("");
      setActiveTab("dashboard");
      toast.success("Item importado e salvo com sucesso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado ao importar item.");
    } finally {
      setImportingItem(false);
    }
  }

  async function importReagent() {
    if (!importReagentInput.trim()) {
      toast.error("Informe URL do Wowhead ou Item ID do reagente.");
      return;
    }

    setImportingReagent(true);

    try {
      const response = await fetch("/api/wow/reagent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          query: importReagentInput,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Reagente nao encontrado no Wowhead.");
      }

      const payload = (await response.json()) as { reagent?: ReagentEntry };

      if (!payload.reagent) {
        throw new Error("Falha ao processar reagente.");
      }

      const newReagent = payload.reagent;
      let alreadyExists = false;
      setSnapshot((prev) => {
        if (prev.reagents.some((entry) => entry.itemId === newReagent.itemId)) {
          alreadyExists = true;
          return prev;
        }

        const updatedReagents = [...prev.reagents, newReagent];
        return {
          ...prev,
          reagents: applyCalculatedReagentPrices(updatedReagents),
        };
      });

      if (alreadyExists) {
        toast.error("Este reagente já está na lista.");
        return;
      }

      setImportReagentInput("");
      toast.success(`Reagente "${newReagent.name}" adicionado aos preços.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado ao importar reagente.");
    } finally {
      setImportingReagent(false);
    }
  }

  async function refreshTsmPrices() {
    if (snapshot.reagents.length === 0) {
      toast.error("Nao ha reagentes cadastrados para atualizar.");
      return;
    }

    setSyncingPrices(true);

    try {
      const names = snapshot.reagents.map((entry) => entry.name);
      const response = await fetch("/tsm-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          names,
          appDataContent: appDataContent.trim() ? appDataContent : undefined,
        }),
      });

      const data = (await response.json()) as TsmResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao atualizar precos via TSM.");
      }

      const byName = new Map<string, number>();
      const byId = new Map<number, number>();

      for (const row of data.results ?? []) {
        if (!row.ok || row.price <= 0) {
          continue;
        }

        byName.set(row.name.trim().toLowerCase(), row.price);

        if (typeof row.itemId === "number") {
          byId.set(row.itemId, row.price);
        }
      }

      setSnapshot((prev) => {
        const updatedReagents = prev.reagents.map((entry) => {
          const byItemId = byId.get(entry.itemId);
          const byLowerName = byName.get(entry.name.trim().toLowerCase());
          const tsmPrice = byItemId ?? byLowerName ?? entry.tsmPrice;

          return {
            ...entry,
            tsmPrice,
            updatedAt: new Date().toISOString(),
          };
        });

        const updatedCrafts = prev.crafts.map((craft) => {
          const price = byId.get(craft.itemId) ?? byName.get(craft.name.trim().toLowerCase()) ?? craft.auctionPrice;
          return {
            ...craft,
            auctionPrice: price,
            updatedAt: new Date().toISOString(),
          };
        });

        return {
          ...prev,
          reagents: applyCalculatedReagentPrices(updatedReagents),
          crafts: updatedCrafts,
          lastTsmSyncAt: new Date().toISOString(),
        };
      });

      toast.success("Precos atualizados via TSM.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar precos.");
    } finally {
      setSyncingPrices(false);
    }
  }

  async function onSelectTsmAppData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setAppDataContent(content);
      setAppDataFileName(file.name);
      window.localStorage.setItem(`lootmaster-appdata-content-${version}`, content);
      window.localStorage.setItem(`lootmaster-appdata-filename-${version}`, file.name);
      toast.success("AppData.lua carregado e salvo para esta versao.");
    } catch {
      toast.error("Nao foi possivel ler o arquivo AppData.lua.");
    }
  }

  function updatePriceSource(itemId: number, source: PriceSource) {
    setSnapshot((prev) => {
      const nextReagents = prev.reagents.map<ReagentEntry>((entry) => {
        if (entry.itemId !== itemId) {
          return entry;
        }

        return {
          ...entry,
          priceSource: source,
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...prev,
        reagents: applyCalculatedReagentPrices(nextReagents),
      };
    });
  }

  function addFixedPrice(itemId: number, itemName: string, currentValue: number | null) {
    const raw = window.prompt(
      `Informe o preco fixo (em copper) para ${itemName}:`,
      currentValue && currentValue > 0 ? String(currentValue) : "",
    );

    if (raw === null) {
      return;
    }

    const parsed = Number(raw.trim());

    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Informe um valor numerico maior que zero.");
      return;
    }

    setSnapshot((prev) => {
      const nextReagents = prev.reagents.map<ReagentEntry>((entry) => {
        if (entry.itemId !== itemId) {
          return entry;
        }

        return {
          ...entry,
          fixedPrice: Math.round(parsed),
          priceSource: "NPC" as const,
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...prev,
        reagents: applyCalculatedReagentPrices(nextReagents),
      };
    });

    toast.success("Preco fixo adicionado com sucesso.");
  }

  function removeCraftItem(itemId: number, itemName: string) {
    const confirmed = window.confirm(`Excluir ${itemName} do Dashboard?`);

    if (!confirmed) {
      return;
    }

    setSnapshot((prev) => ({
      ...prev,
      crafts: prev.crafts.filter((craft) => craft.itemId !== itemId),
    }));

    setExpandedCraftIds((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    toast.success("Item removido do Dashboard.");
  }

  return (
    <div className="space-y-7">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[rgba(69,190,95,0.2)] bg-[linear-gradient(145deg,rgba(6,15,17,0.92),rgba(4,10,16,0.95))]">
          <CardTitle className="text-xl md:text-2xl">Central de Operacoes da Expansao</CardTitle>
          <p className="text-sm text-[#b8e6b8]">
            Navegacao modular para analise financeira, importacao de itens e catalogo de reagentes.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 md:grid-cols-3">
            {TABS.map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab ? "default" : "secondary"}
                size="default"
                onClick={() => setActiveTab(tab)}
                className={
                  activeTab === tab
                    ? "h-12 justify-center text-sm uppercase tracking-[0.16em]"
                    : "h-12 justify-center border-[rgba(69,190,95,0.2)] text-sm uppercase tracking-[0.16em]"
                }
              >
                {tabLabel(tab)}
              </Button>
            ))}
          </div>

          <p className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] px-4 py-3 text-sm text-[#b8e6b8]">
            Estrutura visual premium com foco em legibilidade de margem, decisao rapida e escala para novos modulos.
          </p>
        </CardContent>
      </Card>

      {activeTab === "reagents" ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-[rgba(69,190,95,0.2)] bg-[linear-gradient(180deg,rgba(42,112,58,0.22),rgba(3,8,4,0.97))]">
            <CardTitle className="text-2xl">Catalogo de Precos</CardTitle>
            <p className="text-sm text-[#b8e6b8]">Gestao de reagentes com fontes de custo, valor fixo e rastreio por item.</p>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={refreshTsmPrices} disabled={syncingPrices} className="h-11">
                <RefreshCw className="mr-2 h-4 w-4" />
                {syncingPrices ? "Atualizando..." : "Atualizar precos via TSM"}
              </Button>
              <label className="cursor-pointer rounded-xl border border-[rgba(69,190,95,0.28)] bg-[linear-gradient(180deg,rgba(9,18,21,0.95),rgba(4,10,16,0.96))] px-4 py-2.5 text-sm font-medium text-[#e8ffeb] shadow-[0_0_0_1px_rgba(34,197,94,0.18)_inset] hover:border-[rgba(158,255,138,0.4)]">
                Enviar AppData.lua desta versao
                <input
                  type="file"
                  accept=".lua,text/plain"
                  className="hidden"
                  onChange={onSelectTsmAppData}
                />
              </label>
              <Badge variant="info" className="h-8">
                Ultima atualizacao: {snapshot.lastTsmSyncAt ? new Date(snapshot.lastTsmSyncAt).toLocaleString() : "nunca"}
              </Badge>
            </div>

            <p className="text-sm text-[#4a8a4a]">
              {appDataFileName
                ? `Arquivo ativo nesta versao: ${appDataFileName}`
                : "Sem AppData.lua manual: sera usado o caminho padrao do servidor."}
            </p>

            <div className="space-y-3 rounded-2xl border border-[rgba(69,190,95,0.25)] bg-[linear-gradient(180deg,rgba(10,40,15,0.5),rgba(3,8,4,0.7))] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
              <p className="text-base font-semibold text-[#e8ffeb]">Adicionar Reagente Manual</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={importReagentInput}
                  onChange={(event) => setImportReagentInput(event.target.value)}
                  placeholder="URL do Wowhead ou Item ID"
                  className="flex-1"
                />
                <Button onClick={importReagent} disabled={importingReagent} size="default" className="sm:w-44">
                  {importingReagent ? "Importando..." : "Importar"}
                </Button>
              </div>
              <p className="text-sm text-[#4a8a4a]">
                Adicione reagentes manualmente para rastrear preços adicionais além do catálogo automático.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#d4ffcc]0/55" />
              <Input
                className="pl-10"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar por nome ou item ID"
              />
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[rgba(69,190,95,0.22)] bg-[rgba(3,8,4,0.55)]">
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="bg-[linear-gradient(180deg,rgba(20,60,25,0.98),rgba(3,8,4,0.99))] text-xs uppercase tracking-[0.11em] text-[#a8ff9f]/90">
                  <tr>
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Qualidade</th>
                    <th className="px-4 py-3 text-left">Fonte</th>
                    <th className="px-4 py-3 text-left">Origem</th>
                    <th className="px-4 py-3 text-left">Preco TSM</th>
                    <th className="px-4 py-3 text-left">Preco Calculado</th>
                    <th className="px-4 py-3 text-left">Valor Fixado</th>
                    <th className="px-4 py-3 text-left">Acao</th>
                    <th className="px-4 py-3 text-left">Wowhead</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReagents.map((entry) => (
                    <tr key={entry.itemId} className="border-t border-[rgba(69,190,95,0.2)] transition-colors hover:bg-[rgba(120,220,140,0.06)]">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <img src={entry.icon} alt={entry.name} className="h-10 w-10 rounded-lg border border-[rgba(69,190,95,0.28)]" />
                          <span className="font-semibold text-[#d4ffcc]">{entry.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-medium text-[#e8ffeb]">{entry.itemId}</td>
                      <td className="px-4 py-4 capitalize text-[#b8e6b8]">{entry.quality}</td>
                      <td className="px-4 py-4">
                        <Select
                          value={entry.priceSource}
                          onChange={(event) => updatePriceSource(entry.itemId, event.target.value as PriceSource)}
                          className="h-10 min-w-[170px]"
                        >
                          {SOURCE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="max-w-sm px-4 py-4 text-[#b8e6b8]">{entry.source}</td>
                      <td className="px-4 py-4 font-medium text-[#b8e6b8]">{formatMoney(entry.tsmPrice)}</td>
                      <td className="px-4 py-4">
                        {entry.calculatedPrice === null ? (
                          <span className="text-[#3a6a3a]">-</span>
                        ) : (
                          <span className="font-semibold text-[#9eff8a]">{formatMoney(entry.calculatedPrice)}</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {entry.fixedPrice && entry.fixedPrice > 0 ? (
                          <span className="font-semibold text-[#a8ff9f]">{formatMoney(entry.fixedPrice)}</span>
                        ) : (
                          <span className="text-[#3a6a3a]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Button
                          size="default"
                          variant="secondary"
                          onClick={() => addFixedPrice(entry.itemId, entry.name, entry.fixedPrice)}
                          className="h-10"
                        >
                          Adicionar preco fixo
                        </Button>
                      </td>
                      <td className="px-4 py-4">
                        <a
                          href={entry.wowheadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex rounded-lg border border-[rgba(69,190,95,0.25)] bg-[rgba(120,220,140,0.12)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-[#a8ff9f] hover:border-[rgba(158,255,138,0.45)] hover:text-[#e8ffeb]"
                        >
                          Abrir
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredReagents.length === 0 ? (
                    <tr>
                      <td className="px-4 py-12 text-center text-base text-[#4a8a4a]" colSpan={10}>
                        Nenhum item encontrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "import" ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-[rgba(69,190,95,0.2)] bg-[linear-gradient(180deg,rgba(42,112,58,0.22),rgba(3,8,4,0.97))]">
            <CardTitle className="text-2xl">Importar Item</CardTitle>
            <p className="text-sm text-[#b8e6b8]">Entrada manual por URL ou Item ID com captura automatica de dados economicos.</p>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <Input
              value={importInput}
              onChange={(event) => setImportInput(event.target.value)}
              placeholder="URL do Wowhead ou Item ID"
              className="h-12"
            />
            <Button onClick={importItem} disabled={importingItem} className="h-12 w-full sm:w-auto">
              {importingItem ? "Importando..." : "Importar e Salvar"}
            </Button>
            <p className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] px-4 py-3 text-sm text-[#b8e6b8]">
              A importacao busca automaticamente nome, icone, qualidade, receita, quantidade produzida,
              profissao e dados de disenchant quando existirem.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "dashboard" ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-[rgba(69,190,95,0.2)] bg-[linear-gradient(180deg,rgba(42,112,58,0.22),rgba(3,8,4,0.97))]">
            <CardTitle className="text-2xl">Dashboard Financeiro</CardTitle>
            <p className="text-sm text-[#b8e6b8]">Painel premium de margem por craft, venda e disenchant com comparativo de melhor opcao.</p>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="overflow-x-auto rounded-2xl border border-[rgba(69,190,95,0.22)] bg-[rgba(3,8,4,0.55)]">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-[linear-gradient(180deg,rgba(20,60,25,0.98),rgba(3,8,4,0.99))] text-xs uppercase tracking-[0.11em] text-[#a8ff9f]/90">
                  <tr>
                    <th className="px-4 py-3 text-left"></th>
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-4 py-3 text-left">Profissao</th>
                    <th className="px-4 py-3 text-left">Custo Craft</th>
                    <th className="px-4 py-3 text-left">Venda Leilao</th>
                    <th className="px-4 py-3 text-left">Venda NPC</th>
                    <th className="px-4 py-3 text-left">Lucro Leilao</th>
                    <th className="px-4 py-3 text-left">Lucro Disenchant</th>
                    <th className="px-4 py-3 text-left">Lucro NPC</th>
                    <th className="px-4 py-3 text-left">Melhor</th>
                    <th className="px-4 py-3 text-left">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardRows.map((row) => {
                    const expanded = Boolean(expandedCraftIds[row.itemId]);
                    const craft = snapshot.crafts.find((item) => item.itemId === row.itemId);
                    const priceById = new Map(
                      snapshot.reagents.map((entry) => [entry.itemId, entry.calculatedPrice ?? entry.tsmPrice]),
                    );
                    const scenarioTotals = craft ? buildCraftScenarioTotals(craft, snapshot.reagents) : { base: 0, low: 0, high: 0 };
                    const disenchantValue = craft ? buildExpectedDisenchantValue(craft, priceById) : 0;
                    const auctionProfitMinus25 = craft ? craft.auctionPrice - scenarioTotals.low : 0;
                    const auctionProfitPlus25 = craft ? craft.auctionPrice - scenarioTotals.high : 0;
                    const disenchantProfitMinus25 = craft ? disenchantValue - scenarioTotals.low : 0;
                    const disenchantProfitPlus25 = craft ? disenchantValue - scenarioTotals.high : 0;
                    const npcProfitMinus25 = craft ? craft.vendorPrice - scenarioTotals.low : 0;
                    const npcProfitPlus25 = craft ? craft.vendorPrice - scenarioTotals.high : 0;

                    return (
                      <>
                        <tr key={row.itemId} className="border-t border-[rgba(69,190,95,0.2)] transition-colors hover:bg-[rgba(120,220,140,0.06)]">
                          <td className="px-4 py-4">
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              onClick={() =>
                                setExpandedCraftIds((prev) => ({
                                  ...prev,
                                  [row.itemId]: !expanded,
                                }))
                              }
                              className="h-9 w-9"
                            >
                              {expanded ? <ArrowDown className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                            </Button>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <img src={row.icon} alt={row.name} className="h-11 w-11 rounded-lg border border-[rgba(69,190,95,0.28)]" />
                              <span className="font-semibold text-[#d4ffcc]">{row.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-[#b8e6b8]">{row.profession}</td>
                          <td className="px-4 py-4 font-semibold text-[#b8e6b8]">{formatMoney(row.craftCost)}</td>
                          <td className="px-4 py-4 font-medium text-[#e8ffeb]">{formatMoney(row.auctionPrice)}</td>
                          <td className="px-4 py-4 font-medium text-[#b8e6b8]">{formatMoney(row.vendorPrice)}</td>
                          <td className={`px-4 py-4 font-semibold ${row.auctionProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            {formatMoney(Math.max(0, row.auctionProfit))}
                          </td>
                          <td className={`px-4 py-4 font-semibold ${row.disenchantProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            {formatMoney(Math.max(0, row.disenchantProfit))}
                          </td>
                          <td className={`px-4 py-4 font-semibold ${row.npcProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            {formatMoney(Math.max(0, row.npcProfit))}
                          </td>
                          <td className="px-4 py-4">
                            <Badge variant={row.bestOption === "AUCTION" ? "success" : row.bestOption === "DISENCHANT" ? "info" : "warning"}>
                              {row.bestOption}
                            </Badge>
                          </td>
                          <td className="px-4 py-4">
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => removeCraftItem(row.itemId, row.name)}
                              className="inline-flex items-center gap-1.5"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </Button>
                          </td>
                        </tr>
                        {expanded && craft ? (
                          <tr key={`expanded-${row.itemId}`} className="border-t border-[rgba(69,190,95,0.2)] bg-[linear-gradient(180deg,rgba(4,12,16,0.88),rgba(4,9,14,0.92))]">
                            <td colSpan={11} className="px-6 py-6">
                              <div className="mb-5 grid gap-3 md:grid-cols-4">
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Custo craft</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatMoney(scenarioTotals.base)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes -25%: {formatMoney(scenarioTotals.low)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes +25%: {formatMoney(scenarioTotals.high)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro leilão</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(craft.auctionPrice - scenarioTotals.base)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes -25%: {formatSignedMoney(auctionProfitMinus25)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes +25%: {formatSignedMoney(auctionProfitPlus25)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro disenchant</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(row.disenchantProfit)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes -25%: {formatSignedMoney(disenchantProfitMinus25)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes +25%: {formatSignedMoney(disenchantProfitPlus25)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro NPC</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(row.npcProfit)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes -25%: {formatSignedMoney(npcProfitMinus25)}</p>
                                  <p className="text-sm text-[#b8e6b8]">Reagentes +25%: {formatSignedMoney(npcProfitPlus25)}</p>
                                </div>
                              </div>

                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#a8ff9f]">Receita</p>
                                  <div className="space-y-3">
                                    {craft.recipe.map((component) => renderRecipeChain(craft.itemId, component))}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#b8e6b8]">Disenchant</p>
                                  <div className="space-y-3">
                                    {craft.disenchant.length === 0 ? (
                                      <p className="text-sm text-[#4a8a4a]">Sem dados de disenchant.</p>
                                    ) : (
                                      craft.disenchant.map((entry) => (
                                        <div key={`${craft.itemId}-${entry.itemId}`} className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                          <div className="flex items-center gap-3">
                                            <img src={entry.icon} alt={entry.name} className="h-8 w-8 rounded-md border border-[rgba(69,190,95,0.2)]" />
                                            <span className="text-[#e8ffeb]">{entry.name}</span>
                                          </div>
                                          <p className="mt-1.5 text-xs text-[#b8e6b8]">
                                            Chance: {(entry.chance * 100).toFixed(2)}% | Quantidade: {entry.min} - {entry.max}
                                          </p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    );
                  })}
                  {dashboardRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-12 text-center text-base text-[#4a8a4a]">
                        Nenhum item importado ainda. Use a aba Importar Item.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
