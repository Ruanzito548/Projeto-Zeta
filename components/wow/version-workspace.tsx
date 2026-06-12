"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  computeDashboardRows,
  applyCalculatedReagentPrices,
} from "@/lib/modules/pricing-engine";
import { loadSnapshot, saveSnapshot } from "@/lib/modules/storage";
import type { ImportedCraftItem, ModuleSnapshot, ReagentEntry } from "@/lib/modules/types";
import { DEFAULT_SNAPSHOT } from "@/lib/modules/types";
import type { WowVersion } from "@/lib/wow/versions";

const TABS = ["dashboard", "import", "reagents"] as const;

type TabId = (typeof TABS)[number];

type TsmResponse = {
  results?: Array<{ name: string; itemId: number | null; price: number; ok: boolean }>;
  error?: string;
};

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

function tabLabel(tab: TabId): string {
  if (tab === "dashboard") {
    return "Dashboard";
  }

  if (tab === "import") {
    return "Importar Item";
  }

  return "Reagentes";
}

export function WowVersionWorkspace({ version }: { version: WowVersion }) {
  const [activeTab, setActiveTab] = useState<TabId>("reagents");
  const [snapshot, setSnapshot] = useState<ModuleSnapshot>(() => emptySnapshot(version));
  const [query, setQuery] = useState("");
  const [importInput, setImportInput] = useState("");
  const [loadingReagents, setLoadingReagents] = useState(false);
  const [importingItem, setImportingItem] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [expandedCraftIds, setExpandedCraftIds] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const next = loadSnapshot(version);
    setSnapshot(next);
  }, [version]);

  useEffect(() => {
    saveSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    async function bootstrapReagents() {
      if (snapshot.reagents.length > 0 || loadingReagents) {
        return;
      }

      setLoadingReagents(true);
      try {
        const response = await fetch(`/api/wow/reagents?version=${version}`, { cache: "no-store" });
        const data = (await response.json()) as { reagents?: ReagentEntry[]; error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? "Falha ao importar reagentes.");
        }

        setSnapshot((prev) => ({
          ...prev,
          version,
          reagents: applyCalculatedReagentPrices(data.reagents ?? []),
        }));

        toast.success("Reagentes importados automaticamente do Wowhead.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao carregar reagentes.");
      } finally {
        setLoadingReagents(false);
      }
    }

    void bootstrapReagents();
  }, [version, snapshot.reagents.length, loadingReagents]);

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

      const uniqueReagents = [
        ...snapshot.reagents,
        ...importedReagents.filter(
          (candidate) => !snapshot.reagents.some((existing) => existing.itemId === candidate.itemId),
        ),
      ];

      setSnapshot((prev) => {
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
          reagents: applyCalculatedReagentPrices(uniqueReagents),
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
        body: JSON.stringify({ names }),
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
            <CardTitle>Reagentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={refreshTsmPrices} disabled={syncingPrices || loadingReagents}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {syncingPrices ? "Atualizando..." : "Atualizar precos via TSM"}
              </Button>
              <Badge variant="info">
                Ultima atualizacao: {snapshot.lastTsmSyncAt ? new Date(snapshot.lastTsmSyncAt).toLocaleString() : "nunca"}
              </Badge>
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
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-950/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Qualidade</th>
                    <th className="px-3 py-2 text-left">Fonte</th>
                    <th className="px-3 py-2 text-left">Preco TSM</th>
                    <th className="px-3 py-2 text-left">Preco Calculado</th>
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
                        <a href={entry.wowheadUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline">
                          Abrir
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredReagents.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-slate-400" colSpan={7}>
                        Nenhum reagente encontrado.
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
                  </tr>
                </thead>
                <tbody>
                  {dashboardRows.map((row) => {
                    const expanded = Boolean(expandedCraftIds[row.itemId]);
                    const craft = snapshot.crafts.find((item) => item.itemId === row.itemId);

                    return (
                      <>
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
                        </tr>
                        {expanded && craft ? (
                          <tr className="border-t border-amber-500/10 bg-slate-950/40">
                            <td colSpan={10} className="px-5 py-4">
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
                        ) : null}
                      </>
                    );
                  })}
                  {dashboardRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
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
