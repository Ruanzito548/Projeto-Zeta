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
  applyCalculatedReagentPrices,
} from "@/lib/modules/pricing-engine";
import {
  loadSnapshot,
  loadSnapshotFromCloud,
  saveSnapshot,
  saveSnapshotToCloud,
} from "@/lib/modules/storage";
import { VERSION_REAGENT_SEEDS } from "@/lib/modules/catalog";
import type { DashboardRow, ImportedCraftItem, ModuleSnapshot, PriceSource, ReagentEntry } from "@/lib/modules/types";
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

const AUTO_TSM_REFRESH_MS = 1 * 60 * 1000;

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

function formatSignedPercent(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  return `${normalized < 0 ? "-" : ""}${Math.abs(normalized).toFixed(1)}%`;
}

function buildTotalCraftTimeSeconds(
  craft: ImportedCraftItem,
  reagentById: Map<number, ReagentEntry>,
  visiting = new Set<number>(),
): number {
  if (visiting.has(craft.itemId)) {
    return craft.craftTimeSeconds ?? 0;
  }

  visiting.add(craft.itemId);

  let total = craft.craftTimeSeconds ?? 0;

  for (const component of craft.recipe) {
    const reagent = reagentById.get(component.itemId);

    if (!reagent || reagent.priceSource !== "CRAFTING" || reagent.recipe.length === 0) {
      continue;
    }

    const subTime = reagent.craftTimeSeconds ?? 0;

    const subCraft: ImportedCraftItem = {
      itemId: reagent.itemId,
      wowheadUrl: reagent.wowheadUrl,
      name: reagent.name,
      icon: reagent.icon,
      quality: reagent.quality,
      profession: "Other",
      quantityProduced: 1,
      craftTimeSeconds: subTime,
      recipe: reagent.recipe,
      disenchant: [],
      auctionPrice: 0,
      vendorPrice: 0,
      isCommodity: false,
      updatedAt: reagent.updatedAt,
    };

    const subTotal = buildTotalCraftTimeSeconds(subCraft, reagentById, visiting);
    total += subTotal * component.quantity;
  }

  visiting.delete(craft.itemId);
  return total;
}

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "N/A";
  }

  if (seconds < 60) {
    return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  }

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;

  if (minutes < 60) {
    return `${minutes}m ${remaining}s`;
  }

  const hours = Math.floor(minutes / 60);
  const minutesRemainder = minutes % 60;
  return `${hours}h ${minutesRemainder}m ${remaining}s`;
}

function formatDateTime(timestamp: string | null): string {
  if (!timestamp) {
    return "nunca";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "nunca";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

function getScenarioUnitPrice(
  reagent: ReagentEntry | undefined,
  multiplier: number,
  craftingScaleById: Record<number, number>,
): number {
  if (!reagent) {
    return 0;
  }

  const basePrice = getAdjustedBasePrice(reagent, craftingScaleById);

  if (reagent.fixedPrice && reagent.fixedPrice > 0) {
    return basePrice;
  }

  return basePrice * multiplier;
}

function buildCraftScenarioTotals(
  craft: ImportedCraftItem,
  reagents: ReagentEntry[],
  craftingScaleById: Record<number, number>,
) {
  return craft.recipe.reduce(
    (accumulator, component) => {
      const reagent = reagents.find((entry) => entry.itemId === component.itemId);
      const baseUnit = getScenarioUnitPrice(reagent, 1, craftingScaleById);

      return {
        base: accumulator.base + baseUnit * component.quantity,
      };
    },
    { base: 0 },
  );
}

function buildExpectedDisenchantValue(craft: ImportedCraftItem, priceById: Map<number, number>): number {
  return craft.disenchant.reduce((total, row) => {
    const price = priceById.get(row.itemId) ?? 0;
    const averageQty = (row.min + row.max) / 2;
    return total + price * averageQty * row.chance;
  }, 0);
}

function safePrice(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function getAdjustedBasePrice(reagent: ReagentEntry | undefined, craftingScaleById: Record<number, number>): number {
  if (!reagent) {
    return 0;
  }

  if (reagent.fixedPrice && reagent.fixedPrice > 0) {
    return safePrice(reagent.fixedPrice);
  }

  const base = reagent.calculatedPrice ?? reagent.tsmPrice ?? 0;
  const scale = craftingScaleById[reagent.itemId] ?? 1;
  return safePrice(base) * scale;
}

function buildAdjustedPriceById(
  reagents: ReagentEntry[],
  craftingScaleById: Record<number, number>,
): Map<number, number> {
  const byId = new Map<number, ReagentEntry>(reagents.map((entry) => [entry.itemId, entry]));
  const memo = new Map<number, number>();

  function resolveCost(itemId: number, visiting = new Set<number>()): number {
    const cached = memo.get(itemId);
    if (typeof cached === "number") {
      return cached;
    }

    if (visiting.has(itemId)) {
      const reagent = byId.get(itemId);
      const fallback = getAdjustedBasePrice(reagent, craftingScaleById);
      memo.set(itemId, fallback);
      return fallback;
    }

    const reagent = byId.get(itemId);
    if (!reagent) {
      memo.set(itemId, 0);
      return 0;
    }

    visiting.add(itemId);

    let value = 0;

    if (reagent.fixedPrice && reagent.fixedPrice > 0) {
      value = safePrice(reagent.fixedPrice);
    } else if (reagent.priceSource === "CRAFTING") {
      const recipeCost = reagent.recipe.reduce((total, component) => {
        return total + resolveCost(component.itemId, visiting) * component.quantity;
      }, 0);

      const baseCraftValue = recipeCost > 0 ? recipeCost : safePrice(reagent.tsmPrice);
      const scale = craftingScaleById[reagent.itemId] ?? 1;
      value = baseCraftValue * scale;
    } else {
      const baseValue = reagent.calculatedPrice ?? reagent.tsmPrice ?? 0;
      const scale = craftingScaleById[reagent.itemId] ?? 1;
      value = safePrice(baseValue) * scale;
    }

    visiting.delete(itemId);

    const normalized = safePrice(value);
    memo.set(itemId, normalized);
    return normalized;
  }

  const priceById = new Map<number, number>();
  for (const reagent of reagents) {
    priceById.set(reagent.itemId, resolveCost(reagent.itemId));
  }

  return priceById;
}

function buildDashboardRowsWithCraftingScale(
  crafts: ImportedCraftItem[],
  reagents: ReagentEntry[],
  craftingScaleById: Record<number, number>,
): DashboardRow[] {
  const priceById = buildAdjustedPriceById(reagents, craftingScaleById);

  return crafts.map((craft) => {
    const craftCost = craft.recipe.reduce((total, component) => {
      const unit = priceById.get(component.itemId) ?? 0;
      return total + unit * component.quantity;
    }, 0);

    const auctionProfit = craft.auctionPrice - craftCost;
    const npcProfit = craft.vendorPrice - craftCost;
    const disenchantProfit = buildExpectedDisenchantValue(craft, priceById) - craftCost;

    let bestOption: DashboardRow["bestOption"] = "NPC";
    let winnerValue = npcProfit;

    if (disenchantProfit > winnerValue) {
      bestOption = "DISENCHANT";
      winnerValue = disenchantProfit;
    }

    if (craft.isCommodity && auctionProfit > winnerValue) {
      bestOption = "AUCTION";
    }

    return {
      itemId: craft.itemId,
      name: craft.name,
      icon: craft.icon,
      profession: craft.profession,
      craftCost,
      auctionPrice: craft.auctionPrice,
      vendorPrice: craft.vendorPrice,
      auctionProfit,
      disenchantProfit,
      npcProfit,
      bestOption,
    };
  });
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
  const [dashboardCraftingScaleById, setDashboardCraftingScaleById] = useState<Record<number, number>>({});
  const [dashboardCraftQtyById, setDashboardCraftQtyById] = useState<Record<number, number>>({});
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

  useEffect(() => {
    if (snapshot.reagents.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshTsmPrices({ silent: true });
    }, AUTO_TSM_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot.reagents, appDataContent]);

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
    () => buildDashboardRowsWithCraftingScale(snapshot.crafts, snapshot.reagents, dashboardCraftingScaleById),
    [snapshot.crafts, snapshot.reagents, dashboardCraftingScaleById],
  );

  const adjustedPriceById = useMemo(
    () => buildAdjustedPriceById(snapshot.reagents, dashboardCraftingScaleById),
    [snapshot.reagents, dashboardCraftingScaleById],
  );

  const effectiveCraftById = useMemo(
    () => new Map(snapshot.crafts.map((craft) => [craft.itemId, craft])),
    [snapshot.crafts],
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
    const currentScale = dashboardCraftingScaleById[component.itemId] ?? 1;
    const baseUnit = getAdjustedBasePrice(reagent, dashboardCraftingScaleById);
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
                Unidade {formatMoney(baseUnit)}
                {component.quantity > 1 ? ` | Total (${component.quantity}x): ${formatMoney(baseUnit * component.quantity)}` : ""}
                {isFixed ? " | Fixo" : ""}
                {!isFixed ? ` | Ajuste (${Math.round(currentScale * 100)}%)` : ""}
              </span>
              {!isFixed ? (
                <div className="ml-9 mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={50}
                    max={150}
                    step={1}
                    value={Math.round(currentScale * 100)}
                    onChange={(event) => updateDashboardReagentScale(component.itemId, Number(event.target.value) / 100)}
                    className="w-36 accent-[#9eff8a]"
                  />
                  <span className="text-[11px] text-[#a8ff9f]">{Math.round(currentScale * 100)}%</span>
                </div>
              ) : null}
              {reagent?.priceSource === "CRAFTING" ? (
                <div className="ml-9 mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-[#4a8a4a]">Tempo craft (seg):</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="0"
                    defaultValue={(reagent.craftTimeSeconds ?? 0) > 0 ? reagent.craftTimeSeconds : ""}
                    key={`reagent-time-${component.itemId}-${reagent.craftTimeSeconds}`}
                    onBlur={(event) => updateReagentCraftTime(component.itemId, event.target.value)}
                    className="h-7 w-20 rounded border border-[rgba(69,190,95,0.25)] bg-[rgba(3,8,4,0.7)] px-2 text-xs text-[#e8ffeb] placeholder-[#3a6a3a]"
                  />
                  {(reagent.craftTimeSeconds ?? 0) > 0 ? (
                    <span className="text-[11px] text-[#9eff8a]">{formatDurationSeconds(reagent.craftTimeSeconds!)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <span className="font-semibold text-[#b8e6b8]">{formatMoney(baseUnit)}</span>
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

  async function refreshTsmPrices(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);

    if (syncingPrices) {
      return;
    }

    if (snapshot.reagents.length === 0) {
      if (!silent) {
        toast.error("Nao ha reagentes cadastrados para atualizar.");
      }
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

      if (!silent) {
        toast.success("Precos atualizados via TSM.");
      }
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : "Erro ao atualizar precos.");
      }
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

  function useAutomaticTsmAppData() {
    setAppDataContent("");
    setAppDataFileName("");
    window.localStorage.removeItem(`lootmaster-appdata-content-${version}`);
    window.localStorage.removeItem(`lootmaster-appdata-filename-${version}`);
    toast.success("Modo automatico ativado. O servidor vai ler o AppData.lua local a cada atualizacao.");
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

  function updateDashboardCraftQty(itemId: number, value: number) {
    const quantity = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
    setDashboardCraftQtyById((prev) => ({
      ...prev,
      [itemId]: quantity,
    }));
  }

  function updateDashboardReagentScale(itemId: number, value: number) {
    const scale = Number.isFinite(value) ? Math.min(1.5, Math.max(0.5, value)) : 1;
    setDashboardCraftingScaleById((prev) => ({
      ...prev,
      [itemId]: scale,
    }));
  }

  function updateCraftItemTime(itemId: number, rawValue: string) {
    const parsed = Number(rawValue.trim().replace(",", "."));
    const seconds = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : undefined;
    setSnapshot((prev) => ({
      ...prev,
      crafts: prev.crafts.map((craft) =>
        craft.itemId === itemId ? { ...craft, craftTimeSeconds: seconds } : craft,
      ),
    }));
  }

  function updateReagentCraftTime(itemId: number, rawValue: string) {
    const parsed = Number(rawValue.trim().replace(",", "."));
    const seconds = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : undefined;
    setSnapshot((prev) => ({
      ...prev,
      reagents: prev.reagents.map((entry) =>
        entry.itemId === itemId ? { ...entry, craftTimeSeconds: seconds } : entry,
      ),
    }));
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

    setDashboardCraftQtyById((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    toast.success("Item removido do Dashboard.");
  }

  function removeReagent(itemId: number, itemName: string) {
    const confirmed = window.confirm(`Excluir ${itemName} de Precos?`);

    if (!confirmed) {
      return;
    }

    setSnapshot((prev) => ({
      ...prev,
      reagents: applyCalculatedReagentPrices(
        prev.reagents.filter((entry) => entry.itemId !== itemId),
      ),
    }));

    toast.success(`${itemName} removido de Precos.`);
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
              <Button onClick={() => void refreshTsmPrices()} disabled={syncingPrices} className="h-11">
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
              <Button
                onClick={useAutomaticTsmAppData}
                variant="secondary"
                className="h-11"
                disabled={!appDataFileName && !appDataContent.trim()}
              >
                Usar AppData local automatico
              </Button>
              <Badge variant="info" className="h-8">
                Ultima atualizacao: {formatDateTime(snapshot.lastTsmSyncAt)}
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
                    <th className="px-4 py-3 text-left">Excluir</th>
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
                      <td className="px-4 py-4">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => removeReagent(entry.itemId, entry.name)}
                          className="inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredReagents.length === 0 ? (
                    <tr>
                      <td className="px-4 py-12 text-center text-base text-[#4a8a4a]" colSpan={11}>
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
                    <th className="px-4 py-3 text-left">Tempo Craft</th>
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
                    const craft = effectiveCraftById.get(row.itemId);
                    const scenarioTotals = craft
                      ? buildCraftScenarioTotals(craft, snapshot.reagents, dashboardCraftingScaleById)
                      : { base: 0 };
                    const disenchantValue = craft ? buildExpectedDisenchantValue(craft, adjustedPriceById) : 0;
                    const craftQty = Math.max(1, dashboardCraftQtyById[row.itemId] ?? 1);
                    const craftTimeSeconds = craft?.craftTimeSeconds ?? 0;
                    const totalCraftTimeSeconds = craft ? buildTotalCraftTimeSeconds(craft, reagentById) : 0;
                    const simCraftTime = totalCraftTimeSeconds * craftQty;
                    const simCraftCost = scenarioTotals.base * craftQty;
                    const simAuctionRevenue = (craft?.auctionPrice ?? 0) * craftQty;
                    const simNpcRevenue = (craft?.vendorPrice ?? 0) * craftQty;
                    const simAuctionProfit = (row.auctionProfit ?? 0) * craftQty;
                    const simDisenchantProfit = (row.disenchantProfit ?? 0) * craftQty;
                    const simNpcProfit = (row.npcProfit ?? 0) * craftQty;
                    const auctionProfitPercent = row.craftCost > 0 ? (row.auctionProfit / row.craftCost) * 100 : 0;
                    const disenchantProfitPercent = row.craftCost > 0 ? (row.disenchantProfit / row.craftCost) * 100 : 0;
                    const npcProfitPercent = row.craftCost > 0 ? (row.npcProfit / row.craftCost) * 100 : 0;

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
                          <td className="px-4 py-4 font-medium text-[#b8e6b8]">
                            {craftTimeSeconds > 0 ? formatDurationSeconds(craftTimeSeconds) : <span className="text-[#3a6a3a]">-</span>}
                          </td>
                          <td className="px-4 py-4 font-semibold text-[#b8e6b8]">{formatMoney(row.craftCost)}</td>
                          <td className="px-4 py-4 font-medium text-[#e8ffeb]">{formatMoney(row.auctionPrice)}</td>
                          <td className="px-4 py-4 font-medium text-[#b8e6b8]">{formatMoney(row.vendorPrice)}</td>
                          <td className={`px-4 py-4 ${row.auctionProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            <div className="font-semibold">{formatSignedMoney(row.auctionProfit)}</div>
                            <div className="text-xs opacity-90">{formatSignedPercent(auctionProfitPercent)}</div>
                          </td>
                          <td className={`px-4 py-4 ${row.disenchantProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            <div className="font-semibold">{formatSignedMoney(row.disenchantProfit)}</div>
                            <div className="text-xs opacity-90">{formatSignedPercent(disenchantProfitPercent)}</div>
                          </td>
                          <td className={`px-4 py-4 ${row.npcProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                            <div className="font-semibold">{formatSignedMoney(row.npcProfit)}</div>
                            <div className="text-xs opacity-90">{formatSignedPercent(npcProfitPercent)}</div>
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
                            <td colSpan={12} className="px-6 py-6">
                              <div className="mb-5 rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                <div className="mb-3 flex flex-wrap items-end gap-3">
                                  <div className="space-y-1">
                                    <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Tempo por craft (seg)</p>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        placeholder="ex: 2.5"
                                        defaultValue={craftTimeSeconds > 0 ? craftTimeSeconds : ""}
                                        key={`craft-time-${row.itemId}-${craftTimeSeconds}`}
                                        onBlur={(event) => updateCraftItemTime(row.itemId, event.target.value)}
                                        className="h-9 w-28 rounded-md border border-[rgba(69,190,95,0.3)] bg-[rgba(3,8,4,0.7)] px-3 text-sm text-[#e8ffeb] placeholder-[#3a6a3a]"
                                      />
                                      {craftTimeSeconds > 0 ? (
                                        <span className="text-xs text-[#9eff8a]">{formatDurationSeconds(craftTimeSeconds)}</span>
                                      ) : null}
                                    </div>
                                    <p className="text-[11px] text-[#3a6a3a]">0 = cast imediato | cooldown ex: 86400 = 1 dia</p>
                                  </div>
                                  {totalCraftTimeSeconds > craftTimeSeconds ? (
                                    <div className="space-y-1">
                                      <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Tempo total crafting</p>
                                      <p className="text-sm font-semibold text-[#e8ffeb]">{formatDurationSeconds(totalCraftTimeSeconds)}</p>
                                      <p className="text-[11px] text-[#4a8a4a]">inclui reagentes craftados</p>
                                    </div>
                                  ) : null}
                                  <div className="space-y-1">
                                    <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Simulador de crafting</p>
                                    <label className="text-xs text-[#b8e6b8]">Quantidade</label>
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={craftQty}
                                      onChange={(event) => updateDashboardCraftQty(row.itemId, Number(event.target.value))}
                                      className="h-10 w-28 rounded-md border border-[rgba(69,190,95,0.3)] bg-[rgba(3,8,4,0.7)] px-3 text-[#e8ffeb]"
                                    />
                                  </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-7">
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Custo total</p>
                                    <p className="text-sm font-semibold text-[#e8ffeb]">{formatMoney(simCraftCost)}</p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Receita leilao</p>
                                    <p className="text-sm font-semibold text-[#e8ffeb]">{formatMoney(simAuctionRevenue)}</p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Receita NPC</p>
                                    <p className="text-sm font-semibold text-[#e8ffeb]">{formatMoney(simNpcRevenue)}</p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Lucro leilao</p>
                                    <p className={`text-sm font-semibold ${simAuctionProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                                      {formatSignedMoney(simAuctionProfit)}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Lucro disenchant</p>
                                    <p className={`text-sm font-semibold ${simDisenchantProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                                      {formatSignedMoney(simDisenchantProfit)}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Lucro NPC</p>
                                    <p className={`text-sm font-semibold ${simNpcProfit >= 0 ? "text-[#9eff8a]" : "text-[#ff9999]"}`}>
                                      {formatSignedMoney(simNpcProfit)}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(69,190,95,0.2)] bg-[rgba(120,220,140,0.06)] p-3">
                                    <p className="text-xs text-[#a8ff9f]">Tempo total</p>
                                    <p className="text-sm font-semibold text-[#e8ffeb]">{formatDurationSeconds(simCraftTime)}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="mb-5 grid gap-3 md:grid-cols-4">
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Custo craft</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatMoney(scenarioTotals.base)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro leilão</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(craft.auctionPrice - scenarioTotals.base)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro disenchant</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(row.disenchantProfit)}</p>
                                </div>
                                <div className="rounded-2xl border border-[rgba(69,190,95,0.2)] bg-[rgba(3,8,4,0.55)] p-4 shadow-[0_0_0_1px_rgba(34,197,94,0.12)_inset]">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#a8ff9f]">Lucro NPC</p>
                                  <p className="mt-2 text-sm text-[#e8ffeb]">Base: {formatSignedMoney(row.npcProfit)}</p>
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
                                          {(() => {
                                            const reagent = reagentById.get(entry.itemId);
                                            const isFixed = Boolean(reagent?.fixedPrice && reagent.fixedPrice > 0);
                                            const currentScale = dashboardCraftingScaleById[entry.itemId] ?? 1;
                                            const adjustedUnit = getAdjustedBasePrice(reagent, dashboardCraftingScaleById);

                                            return (
                                              <>
                                                <div className="flex items-center gap-3">
                                                  <img src={entry.icon} alt={entry.name} className="h-8 w-8 rounded-md border border-[rgba(69,190,95,0.2)]" />
                                                  <span className="text-[#e8ffeb]">{entry.name}</span>
                                                </div>
                                                <p className="mt-1.5 text-xs text-[#b8e6b8]">
                                                  Chance: {(entry.chance * 100).toFixed(2)}% | Quantidade: {entry.min} - {entry.max} | Preco: {formatMoney(adjustedUnit)}
                                                  {isFixed ? " | Fixo" : ` | Ajuste: ${Math.round(currentScale * 100)}%`}
                                                </p>
                                                {!isFixed ? (
                                                  <div className="mt-2 flex items-center gap-2">
                                                    <input
                                                      type="range"
                                                      min={50}
                                                      max={150}
                                                      step={1}
                                                      value={Math.round(currentScale * 100)}
                                                      onChange={(event) => updateDashboardReagentScale(entry.itemId, Number(event.target.value) / 100)}
                                                      className="w-36 accent-[#9eff8a]"
                                                    />
                                                    <span className="text-[11px] text-[#a8ff9f]">{Math.round(currentScale * 100)}%</span>
                                                  </div>
                                                ) : null}
                                              </>
                                            );
                                          })()}
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
                      <td colSpan={12} className="px-4 py-12 text-center text-base text-[#4a8a4a]">
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
