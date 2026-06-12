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
  const [appDataContent, setAppDataContent] = useState("");
  const [appDataFileName, setAppDataFileName] = useState("");

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
      toast.success("AppData.lua carregado para esta versao.");
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Workspace da expansao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab ? "default" : "secondary"}
                size="sm"
                onClick={() => setActiveTab(tab)}
              >
                {tabLabel(tab)}
              </Button>
            ))}
          </div>
          <p className="text-sm text-slate-300">
            Estrutura modular pronta para novas abas sem refatorar a pagina.
          </p>
        </CardContent>
      </Card>

      {activeTab === "reagents" ? (
        <Card>
          <CardHeader>
            <CardTitle>Precos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={refreshTsmPrices} disabled={syncingPrices}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {syncingPrices ? "Atualizando..." : "Atualizar precos via TSM"}
              </Button>
              <label className="cursor-pointer rounded-md border border-amber-500/30 bg-slate-950/60 px-3 py-2 text-sm text-amber-200 hover:bg-slate-900">
                Enviar AppData.lua desta versao
                <input
                  type="file"
                  accept=".lua,text/plain"
                  className="hidden"
                  onChange={onSelectTsmAppData}
                />
              </label>
              <Badge variant="info">
                Ultima atualizacao: {snapshot.lastTsmSyncAt ? new Date(snapshot.lastTsmSyncAt).toLocaleString() : "nunca"}
              </Badge>
            </div>

            <p className="text-xs text-slate-400">
              {appDataFileName
                ? `Arquivo ativo nesta versao: ${appDataFileName}`
                : "Sem AppData.lua manual: sera usado o caminho padrao do servidor."}
            </p>

            <div className="space-y-2 rounded-md border border-amber-500/20 bg-slate-950/40 p-3">
              <p className="text-sm font-semibold text-amber-200">Adicionar Reagente Manual</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={importReagentInput}
                  onChange={(event) => setImportReagentInput(event.target.value)}
                  placeholder="URL do Wowhead ou Item ID"
                  className="flex-1"
                />
                <Button onClick={importReagent} disabled={importingReagent} size="sm">
                  {importingReagent ? "Importando..." : "Importar"}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Adicione reagentes manualmente para rastrear preços adicionais além do catálogo automático.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar por nome ou item ID"
              />
            </div>

            <div className="overflow-x-auto rounded-md border border-amber-500/20">
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="bg-slate-950/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Qualidade</th>
                    <th className="px-3 py-2 text-left">Fonte</th>
                    <th className="px-3 py-2 text-left">Origem</th>
                    <th className="px-3 py-2 text-left">Preco TSM</th>
                    <th className="px-3 py-2 text-left">Preco Calculado</th>
                    <th className="px-3 py-2 text-left">Valor Fixado</th>
                    <th className="px-3 py-2 text-left">Acao</th>
                    <th className="px-3 py-2 text-left">Wowhead</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReagents.map((entry) => (
                    <tr key={entry.itemId} className="border-t border-amber-500/10">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <img src={entry.icon} alt={entry.name} className="h-8 w-8 rounded" />
                          <span>{entry.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{entry.itemId}</td>
                      <td className="px-3 py-2 capitalize">{entry.quality}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={entry.priceSource}
                          onChange={(event) => updatePriceSource(entry.itemId, event.target.value as PriceSource)}
                          className="h-8 min-w-[160px]"
                        >
                          {SOURCE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="max-w-sm px-3 py-2 text-slate-300">{entry.source}</td>
                      <td className="px-3 py-2">{formatMoney(entry.tsmPrice)}</td>
                      <td className="px-3 py-2">
                        {entry.calculatedPrice === null ? (
                          <span className="text-slate-500">-</span>
                        ) : (
                          <span className="text-emerald-300">{formatMoney(entry.calculatedPrice)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry.fixedPrice && entry.fixedPrice > 0 ? (
                          <span className="text-amber-200">{formatMoney(entry.fixedPrice)}</span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => addFixedPrice(entry.itemId, entry.name, entry.fixedPrice)}
                        >
                          Adicionar preco fixo
                        </Button>
                      </td>
                      <td className="px-3 py-2">
                        <a href={entry.wowheadUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline">
                          Abrir
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredReagents.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-slate-400" colSpan={10}>
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
        <Card>
          <CardHeader>
            <CardTitle>Importar Item</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={importInput}
              onChange={(event) => setImportInput(event.target.value)}
              placeholder="URL do Wowhead ou Item ID"
            />
            <Button onClick={importItem} disabled={importingItem}>
              {importingItem ? "Importando..." : "Importar e Salvar"}
            </Button>
            <p className="text-sm text-slate-300">
              A importacao busca automaticamente nome, icone, qualidade, receita, quantidade produzida,
              profissao e dados de disenchant quando existirem.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "dashboard" ? (
        <Card>
          <CardHeader>
            <CardTitle>Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border border-amber-500/20">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-950/70">
                  <tr>
                    <th className="px-3 py-2 text-left"></th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Profissao</th>
                    <th className="px-3 py-2 text-left">Custo Craft</th>
                    <th className="px-3 py-2 text-left">Venda Leilao</th>
                    <th className="px-3 py-2 text-left">Venda NPC</th>
                    <th className="px-3 py-2 text-left">Lucro Leilao</th>
                    <th className="px-3 py-2 text-left">Lucro Disenchant</th>
                    <th className="px-3 py-2 text-left">Lucro NPC</th>
                    <th className="px-3 py-2 text-left">Melhor</th>
                    <th className="px-3 py-2 text-left">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardRows.map((row) => {
                    const expanded = Boolean(expandedCraftIds[row.itemId]);
                    const craft = snapshot.crafts.find((item) => item.itemId === row.itemId);

                    return (
                      <tr key={row.itemId} className="border-t border-amber-500/10">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCraftIds((prev) => ({
                                  ...prev,
                                  [row.itemId]: !expanded,
                                }))
                              }
                              className="rounded border border-amber-500/30 p-1 hover:bg-slate-800"
                            >
                              {expanded ? <ArrowDown className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <img src={row.icon} alt={row.name} className="h-8 w-8 rounded" />
                              <span>{row.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">{row.profession}</td>
                          <td className="px-3 py-2">{formatMoney(row.craftCost)}</td>
                          <td className="px-3 py-2">{formatMoney(row.auctionPrice)}</td>
                          <td className="px-3 py-2">{formatMoney(row.vendorPrice)}</td>
                          <td className="px-3 py-2">{formatMoney(Math.max(0, row.auctionProfit))}</td>
                          <td className="px-3 py-2">{formatMoney(Math.max(0, row.disenchantProfit))}</td>
                          <td className="px-3 py-2">{formatMoney(Math.max(0, row.npcProfit))}</td>
                          <td className="px-3 py-2">
                            <Badge variant={row.bestOption === "AUCTION" ? "success" : row.bestOption === "DISENCHANT" ? "info" : "warning"}>
                              {row.bestOption}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeCraftItem(row.itemId, row.name)}
                              className="inline-flex items-center gap-1 rounded border border-rose-400/30 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </button>
                          </td>
                        </tr>
                    );
                  })}
                  {dashboardRows.map((row) => {
                    const expanded = Boolean(expandedCraftIds[row.itemId]);
                    const craft = snapshot.crafts.find((item) => item.itemId === row.itemId);

                    if (!expanded || !craft) {
                      return null;
                    }

                    return (
                      <tr key={`expanded-${row.itemId}`} className="border-t border-amber-500/10 bg-slate-950/40">
                        <td colSpan={11} className="px-5 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="mb-2 text-sm font-semibold text-amber-200">Receita</p>
                              <div className="space-y-2">
                                {craft.recipe.map((component) => {
                                  const reagent = snapshot.reagents.find((entry) => entry.itemId === component.itemId);
                                  const unit = reagent?.calculatedPrice ?? reagent?.tsmPrice ?? 0;
                                  return (
                                    <div key={`${craft.itemId}-${component.itemId}`} className="flex items-center justify-between rounded border border-amber-500/15 p-2">
                                      <div className="flex items-center gap-2">
                                        <img
                                          src={reagent?.icon ?? "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg"}
                                          alt={component.name}
                                          className="h-6 w-6 rounded"
                                        />
                                        <span>{component.quantity}x {component.name}</span>
                                      </div>
                                      <span>{formatMoney(component.quantity * unit)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div>
                              <p className="mb-2 text-sm font-semibold text-amber-200">Disenchant</p>
                              <div className="space-y-2">
                                {craft.disenchant.length === 0 ? (
                                  <p className="text-sm text-slate-400">Sem dados de disenchant.</p>
                                ) : (
                                  craft.disenchant.map((entry) => (
                                    <div key={`${craft.itemId}-${entry.itemId}`} className="rounded border border-amber-500/15 p-2">
                                      <div className="flex items-center gap-2">
                                        <img src={entry.icon} alt={entry.name} className="h-6 w-6 rounded" />
                                        <span>{entry.name}</span>
                                      </div>
                                      <p className="mt-1 text-xs text-slate-300">
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
                    );
                  })}
                  {dashboardRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
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
