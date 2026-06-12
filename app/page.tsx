"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Archive, CheckCircle2, Copy, Heart, Lock, LockOpen, Plus, Search, Sparkles, Star, Trash2, WandSparkles } from "lucide-react";
import { Toaster, toast } from "sonner";

import {
  CRAFT_TAGS,
  PROFESSIONS,
  type CraftItem,
  type CraftTag,
  type DisenchantLine,
} from "@/lib/app-types";
import { computeCraftMetrics, formatCopper } from "@/lib/profit-engine";
import { useAppStore } from "@/lib/app-store";
import { auth, isFirebaseConfigured } from "@/lib/firebase";
import { nowIso, uid } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type SortKey = "name" | "profession" | "roi" | "profit";

type CraftEditorState = {
  id?: string;
  name: string;
  iconUrl: string;
  profession: CraftItem["profession"];
  requiredProfessionLevel: number;
  quantityProduced: number;
  saleValue: number;
  reagents: Array<{ id: string; reagentId: string; quantity: number }>;
  disenchantTable: DisenchantLine[];
  tags: CraftTag[];
};

const initialEditor: CraftEditorState = {
  name: "",
  iconUrl: "",
  profession: "Enchanting",
  requiredProfessionLevel: 1,
  quantityProduced: 1,
  saleValue: 0,
  reagents: [{ id: uid("creag"), reagentId: "", quantity: 1 }],
  disenchantTable: [
    {
      id: uid("de"),
      materialName: "",
      chancePercent: 0,
      minQuantity: 1,
      maxQuantity: 1,
      materialPrice: 0,
    },
  ],
  tags: [],
};

function statClass(roi: number) {
  if (roi > 0) {
    return "text-emerald-300";
  }

  if (roi < 0) {
    return "text-rose-300";
  }

  return "text-slate-300";
}

function profitClass(value: number) {
  if (value > 0) {
    return "text-emerald-300";
  }

  if (value < 0) {
    return "text-rose-300";
  }

  return "text-slate-300";
}

function asName(slug: string): string {
  return slug.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Page() {
  const store = useAppStore();

  const {
    hydrated,
    init,
    reagents,
    crafts,
    history,
    production,
    settings,
    search,
    selectedProfession,
    showFavoritesOnly,
    showArchived,
    setSearch,
    setSelectedProfession,
    setShowFavoritesOnly,
    setShowArchived,
    setSettings,
    createReagent,
    updateReagentPrice,
    setReagentPriceLocked,
    setReagentIcon,
    setReagentCraftRecipe,
    createCraft,
    updateCraft,
    duplicateCraft,
    deleteCraft,
    archiveCraft,
    toggleFavoriteCraft,
    addTag,
    removeTag,
    setProductionLine,
    removeProductionLine,
  } = store;

  const [activeTab, setActiveTab] = useState("dashboard");
  const [editor, setEditor] = useState<CraftEditorState>(initialEditor);
  const [reagentSearch, setReagentSearch] = useState("");
  const [wowheadQuery, setWowheadQuery] = useState("");
  const [loadingWowhead, setLoadingWowhead] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [librarySort, setLibrarySort] = useState<SortKey>("profit");
  const [libraryRoiMin, setLibraryRoiMin] = useState("");
  const [libraryProfitMin, setLibraryProfitMin] = useState("");
  const [newReagentName, setNewReagentName] = useState("");
  const [newReagentPrice, setNewReagentPrice] = useState("");
  const [newReagentProfession, setNewReagentProfession] = useState<CraftItem["profession"]>("Enchanting");
  const [updatingAH, setUpdatingAH] = useState(false);
  const [ahUpdateProgress, setAhUpdateProgress] = useState("");
  const [updatingTSM, setUpdatingTSM] = useState(false);
  const [tsmUpdateProgress, setTsmUpdateProgress] = useState("");
  const [tsmAppDataContent, setTsmAppDataContent] = useState("");
  const [tsmAppDataFileName, setTsmAppDataFileName] = useState("");
  const [recentlyUpdatedReagentId, setRecentlyUpdatedReagentId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const tsmSessionStorageKey = useMemo(
    () => `tsm-appdata:${authUser?.uid ?? "guest"}`,
    [authUser?.uid],
  );

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      await init(user?.uid ?? "guest");
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [init]);

  useEffect(() => {
    if (typeof window === "undefined" || !authReady) {
      return;
    }

    try {
      const cached = window.sessionStorage.getItem(tsmSessionStorageKey);

      if (!cached) {
        setTsmAppDataContent("");
        setTsmAppDataFileName("");
        return;
      }

      const parsed = JSON.parse(cached) as { fileName?: string; content?: string };

      setTsmAppDataContent(parsed.content ?? "");
      setTsmAppDataFileName(parsed.fileName ?? "");
    } catch {
      setTsmAppDataContent("");
      setTsmAppDataFileName("");
    }
  }, [authReady, tsmSessionStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !authReady) {
      return;
    }

    if (!tsmAppDataContent.trim()) {
      window.sessionStorage.removeItem(tsmSessionStorageKey);
      return;
    }

    window.sessionStorage.setItem(
      tsmSessionStorageKey,
      JSON.stringify({
        fileName: tsmAppDataFileName,
        content: tsmAppDataContent,
      }),
    );
  }, [authReady, tsmAppDataContent, tsmAppDataFileName, tsmSessionStorageKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const knownNames = new Set(reagents.map((row) => row.name.trim().toLowerCase()));
    const pending = new Map<string, number>();

    for (const craft of crafts) {
      for (const line of craft.disenchantTable) {
        const materialName = line.materialName.trim();

        if (!materialName) {
          continue;
        }

        const key = materialName.toLowerCase();

        if (knownNames.has(key)) {
          continue;
        }

        const price = Math.max(0, Number(line.materialPrice) || 0);
        const current = pending.get(materialName) ?? 0;
        pending.set(materialName, Math.max(current, price));
      }
    }

    for (const [name, price] of pending) {
      createReagent({
        name,
        iconUrl: "",
        profession: "Enchanting",
        currentPrice: price,
      });
    }
  }, [crafts, createReagent, hydrated, reagents]);

  function updateReagentPriceWithFeedback(reagentId: string, price: number) {
    updateReagentPrice(reagentId, price);
    setRecentlyUpdatedReagentId(reagentId);

    window.setTimeout(() => {
      setRecentlyUpdatedReagentId((current) => (current === reagentId ? null : current));
    }, 1500);
  }

  const reagentPriceInfo = useMemo(() => {
    const byId = new Map(reagents.map((row) => [row.id, row]));
    const memo = new Map<string, { auctionPrice: number; craftPrice: number | null; effectivePrice: number }>();

    function resolvePrice(
      reagentId: string,
      trail: Set<string>,
    ): { auctionPrice: number; craftPrice: number | null; effectivePrice: number } {
      const cached = memo.get(reagentId);

      if (cached) {
        return cached;
      }

      const reagent = byId.get(reagentId);

      if (!reagent) {
        const empty = { auctionPrice: 0, craftPrice: null, effectivePrice: 0 };
        memo.set(reagentId, empty);
        return empty;
      }

      const auctionPrice = Math.max(0, Number(reagent.currentPrice) || 0);

      if (!reagent.craftFromReagentId || trail.has(reagentId)) {
        const onlyAuction = { auctionPrice, craftPrice: null, effectivePrice: auctionPrice };
        memo.set(reagentId, onlyAuction);
        return onlyAuction;
      }

      const nextTrail = new Set(trail);
      nextTrail.add(reagentId);

      const base = resolvePrice(reagent.craftFromReagentId, nextTrail);
      const quantity = Math.max(1, Number(reagent.craftFromQuantity) || 1);
      const craftPrice = base.effectivePrice > 0 ? base.effectivePrice * quantity : null;
      const effectivePrice =
        craftPrice && craftPrice > 0
          ? auctionPrice > 0
            ? Math.min(auctionPrice, craftPrice)
            : craftPrice
          : auctionPrice;

      const value = { auctionPrice, craftPrice, effectivePrice };
      memo.set(reagentId, value);
      return value;
    }

    for (const row of reagents) {
      resolvePrice(row.id, new Set());
    }

    return memo;
  }, [reagents]);

  const effectiveReagents = useMemo(() => {
    return reagents.map((row) => ({
      ...row,
      currentPrice: reagentPriceInfo.get(row.id)?.effectivePrice ?? row.currentPrice,
    }));
  }, [reagentPriceInfo, reagents]);

  const craftRows = useMemo(() => {
    return crafts.map((craft) => {
      const metrics = computeCraftMetrics(craft, effectiveReagents, settings);
      return { craft, metrics };
    });
  }, [crafts, effectiveReagents, settings]);

  const filteredCraftRows = useMemo(() => {
    const bySearch = search.trim().toLowerCase();

    const rows = craftRows.filter(({ craft, metrics }) => {
      if (!showArchived && craft.archived) {
        return false;
      }

      if (showFavoritesOnly && !craft.favorite) {
        return false;
      }

      if (selectedProfession !== "ALL" && craft.profession !== selectedProfession) {
        return false;
      }

      if (bySearch.length > 0) {
        const inName = craft.name.toLowerCase().includes(bySearch);
        const inTags = craft.tags.some((tag) => tag.toLowerCase().includes(bySearch));

        if (!inName && !inTags) {
          return false;
        }
      }

      if (libraryRoiMin.trim()) {
        const minRoi = Number(libraryRoiMin);

        if (Number.isFinite(minRoi) && Math.max(metrics.saleRoi, metrics.disenchantRoi) < minRoi) {
          return false;
        }
      }

      if (libraryProfitMin.trim()) {
        const minProfit = Number(libraryProfitMin);

        if (
          Number.isFinite(minProfit) &&
          Math.max(metrics.saleProfit, metrics.disenchantProfit) < minProfit
        ) {
          return false;
        }
      }

      return true;
    });

    return [...rows].sort((a, b) => {
      if (librarySort === "name") {
        return a.craft.name.localeCompare(b.craft.name);
      }

      if (librarySort === "profession") {
        return a.craft.profession.localeCompare(b.craft.profession);
      }

      if (librarySort === "roi") {
        return (
          Math.max(b.metrics.saleRoi, b.metrics.disenchantRoi) -
          Math.max(a.metrics.saleRoi, a.metrics.disenchantRoi)
        );
      }

      return (
        Math.max(b.metrics.saleProfit, b.metrics.disenchantProfit) -
        Math.max(a.metrics.saleProfit, a.metrics.disenchantProfit)
      );
    });
  }, [
    craftRows,
    libraryProfitMin,
    libraryRoiMin,
    librarySort,
    search,
    selectedProfession,
    showArchived,
    showFavoritesOnly,
  ]);

  const dashboard = useMemo(() => {
    const totalCrafts = craftRows.length;

    if (totalCrafts === 0) {
      return {
        totalCrafts: 0,
        bestRoi: 0,
        bestProfit: 0,
        avgProfit: 0,
        avgRoi: 0,
        totalInvested: 0,
        potentialSale: 0,
      };
    }

    const bestRoi = Math.max(
      ...craftRows.map((row) => Math.max(row.metrics.saleRoi, row.metrics.disenchantRoi)),
    );
    const bestProfit = Math.max(
      ...craftRows.map((row) => Math.max(row.metrics.saleProfit, row.metrics.disenchantProfit)),
    );
    const avgProfit =
      craftRows.reduce(
        (sum, row) => sum + Math.max(row.metrics.saleProfit, row.metrics.disenchantProfit),
        0,
      ) / totalCrafts;
    const avgRoi =
      craftRows.reduce(
        (sum, row) => sum + Math.max(row.metrics.saleRoi, row.metrics.disenchantRoi),
        0,
      ) / totalCrafts;
    const totalInvested = craftRows.reduce((sum, row) => sum + row.metrics.totalReagentCost, 0);
    const potentialSale = craftRows.reduce((sum, row) => sum + row.craft.saleValue, 0);

    return {
      totalCrafts,
      bestRoi,
      bestProfit,
      avgProfit,
      avgRoi,
      totalInvested,
      potentialSale,
    };
  }, [craftRows]);

  const byProfessionChart = useMemo(() => {
    const map = new Map<string, { roi: number; profit: number; count: number }>();

    for (const row of craftRows) {
      const current = map.get(row.craft.profession) ?? { roi: 0, profit: 0, count: 0 };
      map.set(row.craft.profession, {
        roi: current.roi + Math.max(row.metrics.saleRoi, row.metrics.disenchantRoi),
        profit: current.profit + Math.max(row.metrics.saleProfit, row.metrics.disenchantProfit),
        count: current.count + 1,
      });
    }

    return [...map.entries()].map(([profession, value]) => ({
      profession,
      roi: value.count > 0 ? value.roi / value.count : 0,
      profit: value.profit,
    }));
  }, [craftRows]);

  const topCrafts = useMemo(() => {
    return [...craftRows]
      .sort(
        (a, b) =>
          Math.max(b.metrics.saleProfit, b.metrics.disenchantProfit) -
          Math.max(a.metrics.saleProfit, a.metrics.disenchantProfit),
      )
      .slice(0, 10)
      .map((row) => ({
        name: row.craft.name,
        lucro: Math.max(row.metrics.saleProfit, row.metrics.disenchantProfit),
      }));
  }, [craftRows]);

  const reagentEvolution = useMemo(() => {
    const priceEntries = history
      .filter((row) => row.type === "REAGENT_PRICE")
      .slice(0, 25)
      .reverse();

    return priceEntries.map((row, index) => ({
      index: index + 1,
      valor: row.message.length,
    }));
  }, [history]);

  const frequentReagents = useMemo(() => {
    return [...reagents].sort((a, b) => b.usageCount - a.usageCount).slice(0, 8);
  }, [reagents]);

  const autoCompleteReagents = useMemo(() => {
    const term = reagentSearch.trim().toLowerCase();

    if (!term) {
      return frequentReagents;
    }

    return reagents
      .filter((row) => row.name.toLowerCase().includes(term))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 8);
  }, [frequentReagents, reagents, reagentSearch]);

  const unlockedReagents = useMemo(() => {
    return reagents.filter((row) => !row.priceLocked);
  }, [reagents]);

  const productionSummary = useMemo(() => {
    const reagentNeeded = new Map<string, number>();
    let totalCost = 0;
    let totalSaleProfit = 0;
    let totalDeProfit = 0;

    for (const line of production) {
      const craft = crafts.find((row) => row.id === line.craftId);

      if (!craft) {
        continue;
      }

      const metrics = computeCraftMetrics(craft, effectiveReagents, settings);

      totalCost += metrics.totalReagentCost * line.quantity;
      totalSaleProfit += metrics.saleProfit * line.quantity;
      totalDeProfit += metrics.disenchantProfit * line.quantity;

      for (const reagentLine of craft.reagents) {
        const current = reagentNeeded.get(reagentLine.reagentId) ?? 0;
        reagentNeeded.set(reagentLine.reagentId, current + reagentLine.quantity * line.quantity);
      }
    }

    const reagentRows = [...reagentNeeded.entries()].map(([reagentId, quantity]) => {
      const reagent = reagents.find((row) => row.id === reagentId);

      return {
        reagentId,
        name: reagent?.name ?? "Desconhecido",
        iconUrl: reagent?.iconUrl ?? "",
        quantity,
      };
    });

    const roi = totalCost > 0 ? (Math.max(totalSaleProfit, totalDeProfit) / totalCost) * 100 : 0;

    return {
      reagentRows,
      totalCost,
      totalSaleProfit,
      totalDeProfit,
      roi,
    };
  }, [crafts, effectiveReagents, production, reagents, settings]);

  function resetEditor() {
    setEditor({
      ...initialEditor,
      reagents: [{ id: uid("creag"), reagentId: "", quantity: 1 }],
      disenchantTable: [
        {
          id: uid("de"),
          materialName: "",
          chancePercent: 0,
          minQuantity: 1,
          maxQuantity: 1,
          materialPrice: 0,
        },
      ],
    });
  }

  function startEdit(craft: CraftItem) {
    setActiveTab("crafts");
    setEditor({
      id: craft.id,
      name: craft.name,
      iconUrl: craft.iconUrl ?? "",
      profession: craft.profession,
      requiredProfessionLevel: craft.requiredProfessionLevel,
      quantityProduced: craft.quantityProduced,
      saleValue: craft.saleValue,
      reagents: craft.reagents.map((row) => ({ ...row })),
      disenchantTable: craft.disenchantTable.map((row) => ({ ...row })),
      tags: [...craft.tags],
    });
  }

  function submitEditor() {
    if (!editor.name.trim()) {
      toast.error("Informe o nome do item.");
      return;
    }

    const normalizedReagents = editor.reagents.filter((row) => row.reagentId && row.quantity > 0);

    if (normalizedReagents.length === 0) {
      toast.error("Adicione ao menos um reagente.");
      return;
    }

    const normalizedDE = editor.disenchantTable.filter((row) => row.materialName.trim());

    // Sync disenchant material prices to reagent database.
    for (const deLine of normalizedDE) {
      const materialName = deLine.materialName.trim();

      if (!materialName) continue;

      const materialPrice = Math.max(0, Number(deLine.materialPrice) || 0);
      const existing = reagents.find(
        (r) => r.name.toLowerCase() === materialName.toLowerCase(),
      );

      if (existing) {
        if (materialPrice > 0 && !existing.priceLocked) {
          updateReagentPriceWithFeedback(existing.id, materialPrice);
        }
      } else {
        createReagent({
          name: materialName,
          iconUrl: "",
          profession: "Enchanting",
          currentPrice: materialPrice,
        });
      }
    }

    if (editor.id) {
      updateCraft(editor.id, {
        name: editor.name,
        iconUrl: editor.iconUrl,
        profession: editor.profession,
        requiredProfessionLevel: editor.requiredProfessionLevel,
        quantityProduced: editor.quantityProduced,
        saleValue: editor.saleValue,
        reagents: normalizedReagents,
        disenchantTable: normalizedDE,
        tags: editor.tags,
      });
      toast.success("Craft atualizado.");
    } else {
      createCraft({
        name: editor.name,
        iconUrl: editor.iconUrl,
        profession: editor.profession,
        requiredProfessionLevel: editor.requiredProfessionLevel,
        quantityProduced: editor.quantityProduced,
        saleValue: editor.saleValue,
        reagents: normalizedReagents,
        disenchantTable: normalizedDE,
        tags: editor.tags,
      });
      toast.success("Craft cadastrado.");
    }

    resetEditor();
  }

  function addReagentToEditor(reagentId: string) {
    if (!reagentId) {
      return;
    }

    setEditor((prev) => ({
      ...prev,
      reagents: [...prev.reagents, { id: uid("creag"), reagentId, quantity: 1 }],
    }));
  }

  async function importFromWowhead() {
    const query = wowheadQuery.trim() || editor.name.trim();

    if (!query) {
      toast.error("Informe o ID ou URL do item no Wowhead.");
      return;
    }

    setLoadingWowhead(true);

    try {
      const res = await fetch(`/wowhead?query=${encodeURIComponent(query)}`);
      const payload = (await res.json()) as {
        error?: string;
        itemName?: string;
        iconUrl?: string;
        quantityPerCraft?: number;
        reagents?: Array<{ name: string; quantity: number; unitPrice: number; iconUrl?: string }>;
        disenchantTable?: Array<DisenchantLine & { iconUrl?: string }>;
      };

      if (!res.ok) {
        throw new Error(payload.error ?? "Nao foi possivel importar do Wowhead.");
      }

      const reagentLines: Array<{ id: string; reagentId: string; quantity: number }> = [];

      for (const row of payload.reagents ?? []) {
        let reagent = reagents.find((item) => item.name.toLowerCase() === row.name.toLowerCase());

        if (!reagent) {
          const id = createReagent({
            name: row.name,
            iconUrl: row.iconUrl ?? "",
            profession: "Any",
            currentPrice: row.unitPrice,
          });
          reagent = {
            id,
            name: row.name,
            iconUrl: row.iconUrl ?? "",
            profession: "Any",
            currentPrice: row.unitPrice,
            priceLocked: false,
            updatedAt: nowIso(),
            usageCount: 0,
          };
        } else if (row.unitPrice > 0 && reagent.currentPrice <= 0 && !reagent.priceLocked) {
          updateReagentPriceWithFeedback(reagent.id, row.unitPrice);
        }

        if ((!reagent.iconUrl || reagent.iconUrl.trim().length === 0) && row.iconUrl) {
          setReagentIcon(reagent.id, row.iconUrl);
        }

        reagentLines.push({ id: uid("creag"), reagentId: reagent.id, quantity: row.quantity });
      }

      setEditor((prev) => ({
        ...prev,
        name: payload.itemName ?? prev.name,
        iconUrl: payload.iconUrl ?? prev.iconUrl,
        quantityProduced:
          typeof payload.quantityPerCraft === "number" && payload.quantityPerCraft > 0
            ? payload.quantityPerCraft
            : prev.quantityProduced,
        reagents: reagentLines.length > 0 ? reagentLines : prev.reagents,
        disenchantTable:
          payload.disenchantTable && payload.disenchantTable.length > 0
            ? payload.disenchantTable.map((line) => {
                // If Wowhead returned a price use it; otherwise fall back to
                // the price already stored in the reagents database.
                const storedPrice =
                  reagents.find(
                    (r) => r.name.toLowerCase() === line.materialName.toLowerCase(),
                  )?.currentPrice ?? 0;
                return {
                  ...line,
                  id: uid("de"),
                  materialPrice: line.materialPrice > 0 ? line.materialPrice : storedPrice,
                };
              })
            : prev.disenchantTable,
      }));

      // Sync disenchant material prices to reagent database.
      for (const deLine of payload.disenchantTable ?? []) {
        const materialName = deLine.materialName.trim();

        if (!materialName) continue;

        const materialPrice = Math.max(0, Number(deLine.materialPrice) || 0);
        const existing = reagents.find(
          (r) => r.name.toLowerCase() === materialName.toLowerCase(),
        );

        if (existing) {
          if (materialPrice > 0 && !existing.priceLocked) {
            updateReagentPriceWithFeedback(existing.id, materialPrice);
          }

          if ((!existing.iconUrl || existing.iconUrl.trim().length === 0) && deLine.iconUrl) {
            setReagentIcon(existing.id, deLine.iconUrl);
          }
        } else {
          createReagent({
            name: materialName,
            iconUrl: deLine.iconUrl ?? "",
            profession: "Enchanting",
            currentPrice: materialPrice,
          });
        }
      }

      toast.success("Item importado do Wowhead.");
      setWowheadQuery("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao importar Wowhead.");
    } finally {
      setLoadingWowhead(false);
    }
  }

  function createQuickReagent() {
    const term = reagentSearch.trim();

    if (!term) {
      return;
    }

    const exists = reagents.find((row) => row.name.toLowerCase() === term.toLowerCase());

    if (exists) {
      addReagentToEditor(exists.id);
      return;
    }

    const id = createReagent({
      name: asName(term),
      iconUrl: "",
      profession: "Any",
      currentPrice: 0,
    });

    addReagentToEditor(id);
    setReagentSearch("");
    toast.success("Reagente cadastrado.");
  }

  async function loginWithGoogle() {
    if (!auth) {
      setAuthError("Firebase nao configurado.");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Falha no login Google.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function onSelectTsmAppData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setTsmAppDataContent(content);
      setTsmAppDataFileName(file.name);
      setTsmUpdateProgress(`Arquivo carregado: ${file.name}.`);
      toast.success("AppData.lua carregado para a sincronizacao.");
    } catch {
      toast.error("Nao foi possivel ler o arquivo AppData.lua.");
    }
  }

  async function logout() {
    if (!auth) {
      return;
    }

    try {
      await signOut(auth);
      toast.success("Sessao encerrada.");
    } catch {
      toast.error("Nao foi possivel sair.");
    }
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
        <div className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>Configure o Firebase para autenticar usuarios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              <p>Defina estas variaveis em um arquivo .env.local e reinicie o app:</p>
              <p>NEXT_PUBLIC_FIREBASE_API_KEY</p>
              <p>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN</p>
              <p>NEXT_PUBLIC_FIREBASE_PROJECT_ID</p>
              <p>NEXT_PUBLIC_FIREBASE_APP_ID</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!authReady) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
        <div className="mx-auto max-w-7xl space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#172554_0%,#020617_45%,#020617_100%)] p-4 text-slate-100">
        <Toaster richColors position="top-right" />
        <div className="mx-auto max-w-md pt-12">
          <Card className="border-amber-400/25 bg-slate-900/80">
            <CardHeader>
              <CardTitle>Entrar com Google</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-300">Use sua conta Google para acessar seu espaco pessoal.</p>
              {authError ? <p className="text-sm text-rose-300">{authError}</p> : null}
              <Button onClick={loginWithGoogle} disabled={authSubmitting}>
                {authSubmitting ? "Processando..." : "Entrar com Google"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
        <div className="mx-auto max-w-7xl space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#172554_0%,#020617_45%,#020617_100%)] text-slate-100">
      <Toaster richColors position="top-right" />
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 md:px-6 md:py-6">
        <Card className="border-amber-400/25 bg-slate-900/80">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">World of Warcraft TBC</p>
                <h1 className="text-2xl font-semibold text-amber-100">Craft Profit Suite</h1>
                <p className="text-sm text-slate-300">
                  Plataforma de analise de craft, disenchant e Auction House em nivel SaaS.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={logout}>
                  Sair ({authUser.email ?? "usuario"})
                </Button>
                <Button variant="secondary" onClick={() => setActiveTab("crafts")}>
                  <Plus className="mr-2 h-4 w-4" /> Novo Craft
                </Button>
                <Button onClick={() => setActiveTab("dashboard")}>
                  <Sparkles className="mr-2 h-4 w-4" /> Painel
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-2 rounded-xl border border-amber-500/20 bg-slate-950/40 p-2 md:grid-cols-6">
          {[
            ["dashboard", "Dashboard"],
            ["crafts", "Crafts"],
            ["library", "Biblioteca"],
            ["production", "Producao"],
            ["reagents", "Reagentes"],
            ["history", "Historico"],
          ].map(([id, label]) => (
            <Button
              key={id}
              variant={activeTab === id ? "default" : "ghost"}
              className="w-full"
              onClick={() => setActiveTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {activeTab === "dashboard" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card><CardHeader><CardTitle>Total de Crafts</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{dashboard.totalCrafts}</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Melhor ROI</CardTitle></CardHeader><CardContent><p className={statClass(dashboard.bestRoi) + " text-2xl font-semibold"}>{dashboard.bestRoi.toFixed(2)}%</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Melhor Lucro</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-emerald-300">{formatCopper(dashboard.bestProfit, settings)}</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Lucro Medio</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{formatCopper(dashboard.avgProfit, settings)}</p></CardContent></Card>
              <Card><CardHeader><CardTitle>ROI Medio</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{dashboard.avgRoi.toFixed(2)}%</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Total Investido</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{formatCopper(dashboard.totalInvested, settings)}</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Venda Potencial</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{formatCopper(dashboard.potentialSale, settings)}</p></CardContent></Card>
              <Card><CardHeader><CardTitle>Favoritos</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{crafts.filter((row) => row.favorite).length}</p></CardContent></Card>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>ROI por Profissao</CardTitle></CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byProfessionChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="profession" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                      <Bar dataKey="roi" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Lucro por Profissao</CardTitle></CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byProfessionChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="profession" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                      <Bar dataKey="profit" fill="#10b981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Top 10 Crafts</CardTitle></CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topCrafts} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis type="number" stroke="#94a3b8" />
                      <YAxis dataKey="name" type="category" width={130} stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                      <Bar dataKey="lucro" fill="#22c55e" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Evolucao de Precos (proxy)</CardTitle></CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={reagentEvolution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="index" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                      <Area type="monotone" dataKey="valor" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}

        {activeTab === "crafts" ? (
          <Card>
            <CardHeader>
              <CardTitle>{editor.id ? "Editar Craft" : "Novo Craft"}</CardTitle>
              <p className="text-sm text-slate-300">Layout produtivo em 3 colunas com preenchimento acelerado e importacao Wowhead.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 rounded-lg border border-slate-700/60 bg-slate-950/50 p-3 md:grid-cols-[1fr_auto]">
                <Input
                  placeholder="ID/URL do Wowhead ou nome"
                  value={wowheadQuery}
                  onChange={(event) => setWowheadQuery(event.target.value)}
                />
                <Button variant="secondary" onClick={importFromWowhead} disabled={loadingWowhead}>
                  <WandSparkles className="mr-2 h-4 w-4" /> {loadingWowhead ? "Importando..." : "Importar Wowhead"}
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <Card className="h-full">
                  <CardHeader><CardTitle>Item</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="Nome do item"
                      value={editor.name}
                      onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                    />
                    <Input
                      placeholder="URL do icone"
                      value={editor.iconUrl}
                      onChange={(event) => setEditor((prev) => ({ ...prev, iconUrl: event.target.value }))}
                    />
                    <Select
                      value={editor.profession}
                      onChange={(event) =>
                        setEditor((prev) => ({ ...prev, profession: event.target.value as CraftItem["profession"] }))
                      }
                    >
                      {PROFESSIONS.map((profession) => (
                        <option key={profession} value={profession}>{profession}</option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Nivel requerido"
                      value={editor.requiredProfessionLevel}
                      onChange={(event) =>
                        setEditor((prev) => ({
                          ...prev,
                          requiredProfessionLevel: Math.max(1, Number(event.target.value) || 1),
                        }))
                      }
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder="Qtd produzida"
                      value={editor.quantityProduced}
                      onChange={(event) =>
                        setEditor((prev) => ({ ...prev, quantityProduced: Math.max(1, Number(event.target.value) || 1) }))
                      }
                    />
                    <Input
                      type="number"
                      min={0}
                      placeholder="Valor de venda (cobre)"
                      value={editor.saleValue}
                      onChange={(event) =>
                        setEditor((prev) => ({ ...prev, saleValue: Math.max(0, Number(event.target.value) || 0) }))
                      }
                    />
                    <p className="text-xs text-amber-200">Valor de venda: {formatCopper(editor.saleValue, settings)}</p>

                    <div className="flex flex-wrap gap-1">
                      {CRAFT_TAGS.map((tag) => {
                        const active = editor.tags.includes(tag);
                        return (
                          <Button
                            key={tag}
                            size="sm"
                            variant={active ? "default" : "ghost"}
                            onClick={() =>
                              setEditor((prev) => ({
                                ...prev,
                                tags: active
                                  ? prev.tags.filter((value) => value !== tag)
                                  : [...prev.tags, tag],
                              }))
                            }
                          >
                            {tag}
                          </Button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card className="h-full">
                  <CardHeader><CardTitle>Reagentes</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <Input
                        placeholder="Buscar reagente..."
                        value={reagentSearch}
                        onChange={(event) => setReagentSearch(event.target.value)}
                      />
                      <Button variant="secondary" onClick={createQuickReagent}>
                        <Plus className="mr-1 h-4 w-4" /> Cadastrar
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const first = autoCompleteReagents[0];

                          if (first) {
                            addReagentToEditor(first.id);
                          }
                        }}
                      >
                        Usar 1o
                      </Button>
                    </div>

                    <div className="max-h-24 overflow-auto rounded-md border border-slate-700/70 p-2">
                      <div className="flex flex-wrap gap-1">
                        {autoCompleteReagents.map((row) => (
                          <Button key={row.id} size="sm" variant="ghost" onClick={() => addReagentToEditor(row.id)}>
                            {row.iconUrl ? (
                              <Image
                                src={row.iconUrl}
                                alt={row.name}
                                width={14}
                                height={14}
                                className="mr-1 h-3.5 w-3.5 rounded-sm object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="mr-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-slate-700 text-[9px] font-semibold text-slate-200">
                                {row.name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            {row.name}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {editor.reagents.map((line, index) => {
                        const reagent = reagents.find((row) => row.id === line.reagentId);

                        return (
                          <div key={line.id} className="grid gap-2 md:grid-cols-[1.4fr_0.8fr_auto]">
                            <Select
                              value={line.reagentId}
                              onChange={(event) => {
                                const value = event.target.value;
                                setEditor((prev) => ({
                                  ...prev,
                                  reagents: prev.reagents.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, reagentId: value } : row,
                                  ),
                                }));
                              }}
                            >
                              <option value="">Selecione reagente</option>
                              {reagents.map((row) => (
                                <option key={row.id} value={row.id}>{row.name}</option>
                              ))}
                            </Select>
                            <Input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(event) => {
                                const value = Math.max(1, Number(event.target.value) || 1);
                                setEditor((prev) => ({
                                  ...prev,
                                  reagents: prev.reagents.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, quantity: value } : row,
                                  ),
                                }));
                              }}
                            />
                            <Button
                              variant="danger"
                              onClick={() =>
                                setEditor((prev) => ({
                                  ...prev,
                                  reagents: prev.reagents.filter((_, rowIndex) => rowIndex !== index),
                                }))
                              }
                            >
                              Remover
                            </Button>
                            {reagent ? (
                              <p className="md:col-span-3 text-xs text-slate-400">
                                Preco usado: {formatCopper(reagentPriceInfo.get(reagent.id)?.effectivePrice ?? reagent.currentPrice, settings)} | Custo linha: {formatCopper((reagentPriceInfo.get(reagent.id)?.effectivePrice ?? reagent.currentPrice) * line.quantity, settings)}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <Button variant="secondary" onClick={() => setEditor((prev) => ({ ...prev, reagents: [...prev.reagents, { id: uid("creag"), reagentId: "", quantity: 1 }] }))}>
                      <Plus className="mr-1 h-4 w-4" /> Adicionar Reagente
                    </Button>
                  </CardContent>
                </Card>

                <Card className="h-full">
                  <CardHeader><CardTitle>Disenchant</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {editor.disenchantTable.map((line, index) => (
                      <div key={line.id} className="space-y-2 rounded-lg border border-slate-700/70 p-2">
                        <Input
                          placeholder="Material"
                          value={line.materialName}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEditor((prev) => ({
                              ...prev,
                              disenchantTable: prev.disenchantTable.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, materialName: value } : row,
                              ),
                            }));
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            placeholder="Chance %"
                            value={line.chancePercent}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              setEditor((prev) => ({
                                ...prev,
                                disenchantTable: prev.disenchantTable.map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, chancePercent: value } : row,
                                ),
                              }));
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Preco"
                            value={line.materialPrice}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              setEditor((prev) => ({
                                ...prev,
                                disenchantTable: prev.disenchantTable.map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, materialPrice: value } : row,
                                ),
                              }));
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Min"
                            value={line.minQuantity}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              setEditor((prev) => ({
                                ...prev,
                                disenchantTable: prev.disenchantTable.map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, minQuantity: value } : row,
                                ),
                              }));
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={line.maxQuantity}
                            onChange={(event) => {
                              const value = Math.max(0, Number(event.target.value) || 0);
                              setEditor((prev) => ({
                                ...prev,
                                disenchantTable: prev.disenchantTable.map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, maxQuantity: value } : row,
                                ),
                              }));
                            }}
                          />
                        </div>
                        <p className="text-xs text-amber-200">Preco material: {formatCopper(line.materialPrice, settings)}</p>
                        <Button
                          variant="danger"
                          onClick={() =>
                            setEditor((prev) => ({
                              ...prev,
                              disenchantTable: prev.disenchantTable.filter((_, rowIndex) => rowIndex !== index),
                            }))
                          }
                        >
                          Remover linha
                        </Button>
                      </div>
                    ))}

                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEditor((prev) => ({
                          ...prev,
                          disenchantTable: [
                            ...prev.disenchantTable,
                            {
                              id: uid("de"),
                              materialName: "",
                              chancePercent: 0,
                              minQuantity: 1,
                              maxQuantity: 1,
                              materialPrice: 0,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" /> Adicionar DE
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={submitEditor}>{editor.id ? "Atualizar Craft" : "Salvar Craft"}</Button>
                <Button variant="secondary" onClick={resetEditor}>Limpar Form</Button>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  AH Fee %
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    max={100}
                    value={settings.auctionFeePercent}
                    onChange={(event) => setSettings({ auctionFeePercent: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "library" ? (
          <Card>
            <CardHeader>
              <CardTitle>Biblioteca de Crafts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-6">
                <div className="md:col-span-2 relative">
                  <Search className="pointer-events-none absolute left-2 top-3 h-4 w-4 text-slate-500" />
                  <Input className="pl-8" placeholder="Buscar craft..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={selectedProfession} onChange={(event) => setSelectedProfession(event.target.value)}>
                  <option value="ALL">Todas profissoes</option>
                  {PROFESSIONS.map((profession) => (
                    <option key={profession} value={profession}>{profession}</option>
                  ))}
                </Select>
                <Select value={librarySort} onChange={(event) => setLibrarySort(event.target.value as SortKey)}>
                  <option value="profit">Ordenar: Lucro</option>
                  <option value="roi">Ordenar: ROI</option>
                  <option value="name">Ordenar: Nome</option>
                  <option value="profession">Ordenar: Profissao</option>
                </Select>
                <Input placeholder="ROI minimo %" value={libraryRoiMin} onChange={(e) => setLibraryRoiMin(e.target.value)} />
                <Input placeholder="Lucro minimo (cobre)" value={libraryProfitMin} onChange={(e) => setLibraryProfitMin(e.target.value)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant={showFavoritesOnly ? "default" : "ghost"} onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}>
                  <Star className="mr-1 h-4 w-4" /> Favoritos
                </Button>
                <Button variant={showArchived ? "default" : "ghost"} onClick={() => setShowArchived(!showArchived)}>
                  <Archive className="mr-1 h-4 w-4" /> Mostrar Arquivados
                </Button>
              </div>

              <div className="overflow-auto rounded-md border border-slate-700/70">
                <table className="w-full min-w-[1320px] text-sm">
                  <thead className="bg-slate-900/80 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Craft</th>
                      <th className="px-3 py-2 text-left">Profissao</th>
                      <th className="px-3 py-2 text-left">Custo Craft</th>
                      <th className="px-3 py-2 text-left">Lucro Destaque</th>
                      <th className="px-3 py-2 text-left">ROI</th>
                      <th className="px-3 py-2 text-left">Lucro Venda</th>
                      <th className="px-3 py-2 text-left">Lucro DE</th>
                      <th className="px-3 py-2 text-left">Valor Total DE</th>
                      <th className="px-3 py-2 text-left">Tags</th>
                      <th className="px-3 py-2 text-left">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCraftRows.map(({ craft, metrics }) => {
                      const bestProfit = Math.max(metrics.saleProfit, metrics.disenchantProfit);
                      const bestRoi = Math.max(metrics.saleRoi, metrics.disenchantRoi);
                      const bestSource = metrics.saleProfit >= metrics.disenchantProfit ? "Venda" : "DE";

                      return (
                      <tr key={craft.id} className="border-t border-slate-700/60">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {craft.iconUrl ? (
                              <Image
                                src={craft.iconUrl}
                                alt={craft.name}
                                width={32}
                                height={32}
                                className="h-8 w-8 rounded-md object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-md bg-slate-800" />
                            )}
                            <div>
                              <p className="font-medium text-slate-100">{craft.name}</p>
                              <p className="text-xs text-slate-400">Nivel {craft.requiredProfessionLevel}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">{craft.profession}</td>
                        <td className="px-3 py-2 text-amber-200">{formatCopper(metrics.totalReagentCost, settings)}</td>
                        <td className="px-3 py-2">
                          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1">
                            <p className={"text-sm font-semibold " + profitClass(bestProfit)}>{formatCopper(bestProfit, settings)}</p>
                            <p className={"text-xs font-semibold " + statClass(bestRoi)}>{bestRoi.toFixed(2)}%</p>
                            <p className="text-[11px] text-slate-300">Origem: {bestSource}</p>
                          </div>
                        </td>
                        <td className={"px-3 py-2 font-semibold " + statClass(bestRoi)}>
                          {bestRoi.toFixed(2)}%
                        </td>
                        <td className={"px-3 py-2 " + profitClass(metrics.saleProfit)}>{formatCopper(metrics.saleProfit, settings)}</td>
                        <td className={"px-3 py-2 " + profitClass(metrics.disenchantProfit)}>{formatCopper(metrics.disenchantProfit, settings)}</td>
                        <td className="px-3 py-2 text-cyan-200">{formatCopper(metrics.disenchantExpectedValue, settings)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {craft.tags.map((tag) => (
                              <Badge key={tag} variant="info">{tag}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(craft)}>Editar</Button>
                            <Button size="sm" variant="ghost" onClick={() => duplicateCraft(craft.id)}><Copy className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => toggleFavoriteCraft(craft.id)}>
                              <Heart className={craft.favorite ? "h-4 w-4 text-rose-400" : "h-4 w-4"} />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => archiveCraft(craft.id, !craft.archived)}>
                              <Archive className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(craft.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {CRAFT_TAGS.map((tag) => {
                              const active = craft.tags.includes(tag);
                              return (
                                <Button
                                  key={tag}
                                  size="sm"
                                  variant={active ? "default" : "ghost"}
                                  onClick={() => (active ? removeTag(craft.id, tag) : addTag(craft.id, tag))}
                                >
                                  {tag}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "production" ? (
          <Card>
            <CardHeader><CardTitle>Lista de Producao</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
                <div className="space-y-2 rounded-lg border border-slate-700/70 p-3">
                  <h3 className="font-semibold text-amber-100">Selecionar Crafts</h3>
                  {craftRows.map(({ craft, metrics }) => {
                    const line = production.find((row) => row.craftId === craft.id);
                    const quantity = line?.quantity ?? 1;
                    const bestUnitProfit = Math.max(metrics.saleProfit, metrics.disenchantProfit);
                    const bestTotalProfit = bestUnitProfit * quantity;
                    const bestRoi = Math.max(metrics.saleRoi, metrics.disenchantRoi);

                    return (
                      <div key={craft.id} className="grid items-center gap-2 rounded-md border border-slate-700/60 p-2 md:grid-cols-[1fr_220px_120px_auto]">
                        <div>
                          <p>{craft.name}</p>
                          <p className="text-xs text-slate-400">Quantidade: {quantity}</p>
                        </div>
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-emerald-300/90">Lucro</p>
                          <p className="text-sm font-semibold text-emerald-200">{formatCopper(bestTotalProfit, settings)}</p>
                          <p className={"text-xs font-semibold " + statClass(bestRoi)}>{bestRoi.toFixed(2)}%</p>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          value={quantity}
                          onChange={(event) => setProductionLine(craft.id, Number(event.target.value) || 1)}
                        />
                        {line ? (
                          <Button variant="danger" onClick={() => removeProductionLine(craft.id)}>
                            Remover
                          </Button>
                        ) : (
                          <Button variant="secondary" onClick={() => setProductionLine(craft.id, 1)}>
                            Adicionar
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2 rounded-lg border border-slate-700/70 p-3">
                  <h3 className="font-semibold text-amber-100">Resumo de Producao</h3>
                  <p>Total reagentes distintos: {productionSummary.reagentRows.length}</p>
                  <p>Custo total: {formatCopper(productionSummary.totalCost, settings)}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-300/90">Lucro total (Venda)</p>
                      <p className="text-base font-semibold text-emerald-200">{formatCopper(productionSummary.totalSaleProfit, settings)}</p>
                    </div>
                    <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-sky-300/90">Lucro total (DE)</p>
                      <p className="text-base font-semibold text-sky-200">{formatCopper(productionSummary.totalDeProfit, settings)}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-amber-300/90">ROI final</p>
                    <p className={"text-base font-semibold " + statClass(productionSummary.roi)}>{productionSummary.roi.toFixed(2)}%</p>
                  </div>
                  <div className="mt-2 space-y-1 rounded-md border border-slate-700/60 p-2">
                    {productionSummary.reagentRows.map((row) => (
                      <p key={row.reagentId} className="flex items-center gap-2 text-sm text-slate-300">
                        {row.iconUrl ? (
                          <Image
                            src={row.iconUrl}
                            alt={row.name}
                            width={16}
                            height={16}
                            className="h-4 w-4 rounded-sm object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-slate-700 text-[10px] font-semibold text-slate-200">
                            {row.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        {row.name}: {row.quantity}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "reagents" ? (
          <Card>
            <CardHeader><CardTitle>Base de Reagentes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-300">Atualizacao em massa: altere preco e todos os crafts sao recalculados automaticamente.</p>

              <div className="grid gap-2 rounded-lg border border-amber-500/20 bg-slate-950/50 p-3 md:grid-cols-[1fr_1fr_140px_auto]">
                <Input
                  placeholder="Nome do reagente (ex: Strange Dust)"
                  value={newReagentName}
                  onChange={(e) => setNewReagentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const name = newReagentName.trim();
                      if (!name) return;
                      const exists = reagents.find((r) => r.name.toLowerCase() === name.toLowerCase());
                      if (exists) { toast.error("Reagente ja cadastrado."); return; }
                      createReagent({ name, iconUrl: "", profession: newReagentProfession, currentPrice: Number(newReagentPrice) || 0 });
                      toast.success(`${name} cadastrado.`);
                      setNewReagentName("");
                      setNewReagentPrice("");
                    }
                  }}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Preco inicial (cobre)"
                  value={newReagentPrice}
                  onChange={(e) => setNewReagentPrice(e.target.value)}
                />
                <Select
                  value={newReagentProfession}
                  onChange={(e) => setNewReagentProfession(e.target.value as CraftItem["profession"])}
                >
                  {PROFESSIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
                <Button
                  onClick={() => {
                    const name = newReagentName.trim();
                    if (!name) { toast.error("Informe o nome do reagente."); return; }
                    const exists = reagents.find((r) => r.name.toLowerCase() === name.toLowerCase());
                    if (exists) { toast.error("Reagente ja cadastrado."); return; }
                    createReagent({ name, iconUrl: "", profession: newReagentProfession, currentPrice: Number(newReagentPrice) || 0 });
                    toast.success(`${name} cadastrado.`);
                    setNewReagentName("");
                    setNewReagentPrice("");
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> Cadastrar
                </Button>
                <p className="text-xs text-amber-200 md:col-span-4">
                  Preco inicial: {formatCopper(Math.max(0, Number(newReagentPrice) || 0), settings)}
                </p>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-slate-950/50 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-sky-200">Atualizar precos via Auction House</p>
                  <p className="text-xs text-slate-400">
                    {ahUpdateProgress || `Busca o preco atual de ${unlockedReagents.length} reagentes livres na AH.`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={updatingAH || unlockedReagents.length === 0}
                  onClick={async () => {
                    if (unlockedReagents.length === 0) return;
                    setUpdatingAH(true);
                    setAhUpdateProgress("Buscando precos...");
                    try {
                      const res = await fetch("/tsm-bulk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ names: unlockedReagents.map((r) => r.name) }),
                      });
                      const data = (await res.json()) as {
                        results?: Array<{ name: string; price: number; ok: boolean }>;
                        error?: string;
                      };
                      if (!res.ok) throw new Error(data.error ?? "Erro ao buscar precos.");
                      let updated = 0;
                      for (const row of data.results ?? []) {
                        if (!row.ok) continue;
                        const reagent = unlockedReagents.find(
                          (r) => r.name.toLowerCase() === row.name.toLowerCase(),
                        );
                        if (reagent) { updateReagentPriceWithFeedback(reagent.id, row.price); updated++; }
                      }
                      const lockedCount = reagents.length - unlockedReagents.length;
                      setAhUpdateProgress(`${updated} de ${unlockedReagents.length} precos atualizados${lockedCount > 0 ? ` (${lockedCount} fixos ignorados)` : ""}.`);
                      toast.success(`${updated} reagentes atualizados via AH.`);
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "Erro desconhecido.";
                      setAhUpdateProgress(msg);
                      toast.error(msg);
                    } finally {
                      setUpdatingAH(false);
                    }
                  }}
                >
                  {updatingAH ? "Atualizando..." : "Atualizar via AH"}
                </Button>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-slate-950/50 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-200">Atualizar precos via TSM App local</p>
                  <p className="text-xs text-slate-400">
                    {tsmUpdateProgress || `Le o AppData.lua e atualiza ${unlockedReagents.length} reagentes livres (fixados sao ignorados).`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">
                      Enviar AppData.lua
                      <input
                        type="file"
                        accept=".lua,text/plain"
                        className="hidden"
                        onChange={onSelectTsmAppData}
                      />
                    </label>
                    {tsmAppDataFileName ? (
                      <span className="text-xs text-emerald-300">Arquivo: {tsmAppDataFileName}</span>
                    ) : (
                      <span className="text-xs text-slate-500">No deploy, envie o arquivo manualmente.</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  disabled={updatingTSM || unlockedReagents.length === 0}
                  onClick={async () => {
                    if (unlockedReagents.length === 0) return;

                    const isHostedRuntime =
                      typeof window !== "undefined" &&
                      !["localhost", "127.0.0.1"].includes(window.location.hostname);

                    if (isHostedRuntime && !tsmAppDataContent.trim()) {
                      const warning = "No deploy, envie o AppData.lua antes de sincronizar o TSM local.";
                      setTsmUpdateProgress(warning);
                      toast.error(warning);
                      return;
                    }

                    setUpdatingTSM(true);
                    setTsmUpdateProgress("Lendo dados locais do TSM...");

                    try {
                      const res = await fetch("/tsm-local", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          names: unlockedReagents.map((r) => r.name),
                          appDataContent: tsmAppDataContent || undefined,
                        }),
                      });

                      const data = (await res.json()) as {
                        results?: Array<{ name: string; itemId: number | null; price: number; ok: boolean }>;
                        sourcePath?: string;
                        error?: string;
                      };

                      if (!res.ok) {
                        throw new Error(data.error ?? "Erro ao ler TSM local.");
                      }

                      let updated = 0;

                      for (const row of data.results ?? []) {
                        if (!row.ok || row.price <= 0) continue;

                        const reagent = unlockedReagents.find(
                          (r) => r.name.toLowerCase() === row.name.toLowerCase(),
                        );

                        if (!reagent) continue;

                        updateReagentPriceWithFeedback(reagent.id, row.price);
                        updated += 1;
                      }

                      setTsmUpdateProgress(
                        `${updated} de ${unlockedReagents.length} precos atualizados${reagents.length > unlockedReagents.length ? ` (${reagents.length - unlockedReagents.length} fixos ignorados)` : ""}${data.sourcePath ? ` (${data.sourcePath})` : ""}.`,
                      );
                      toast.success(`${updated} reagentes atualizados via TSM local.`);
                    } catch (err) {
                      const message = err instanceof Error ? err.message : "Erro desconhecido.";
                      setTsmUpdateProgress(message);
                      toast.error(message);
                    } finally {
                      setUpdatingTSM(false);
                    }
                  }}
                >
                  {updatingTSM ? "Sincronizando..." : "Atualizar via TSM local"}
                </Button>
              </div>

              <div className="overflow-auto rounded-md border border-slate-700/70">
                <table className="w-full min-w-[1260px] text-sm">
                  <thead className="bg-slate-900/80 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Reagente</th>
                      <th className="px-3 py-2 text-left">Profissao</th>
                      <th className="px-3 py-2 text-left">Formula craft</th>
                      <th className="px-3 py-2 text-left">Preco craft</th>
                      <th className="px-3 py-2 text-left">Fixar preco</th>
                      <th className="px-3 py-2 text-left">Preco leilao</th>
                      <th className="px-3 py-2 text-left">Preco usado</th>
                      <th className="px-3 py-2 text-left">Atualizado</th>
                      <th className="px-3 py-2 text-left">Uso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reagents.map((row) => {
                      const info = reagentPriceInfo.get(row.id);
                      const recipeReagent = row.craftFromReagentId
                        ? reagents.find((candidate) => candidate.id === row.craftFromReagentId)
                        : null;

                      return (
                      <tr key={row.id} className="border-t border-slate-700/60">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {row.iconUrl ? (
                              <Image
                                src={row.iconUrl}
                                alt={row.name}
                                width={20}
                                height={20}
                                className="h-5 w-5 rounded-sm object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-slate-700 text-[10px] font-semibold text-slate-200">
                                {row.name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span>{row.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.profession}</td>
                        <td className="px-3 py-2">
                          <div className="grid gap-1 md:grid-cols-[1fr_84px]">
                            <Select
                              value={row.craftFromReagentId ?? ""}
                              onChange={(event) =>
                                setReagentCraftRecipe(
                                  row.id,
                                  event.target.value,
                                  row.craftFromQuantity ?? 1,
                                )
                              }
                            >
                              <option value="">Sem receita</option>
                              {reagents
                                .filter((candidate) => candidate.id !== row.id)
                                .map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                ))}
                            </Select>
                            <Input
                              type="number"
                              min={1}
                              value={row.craftFromQuantity ?? 1}
                              onChange={(event) =>
                                setReagentCraftRecipe(
                                  row.id,
                                  row.craftFromReagentId ?? "",
                                  Math.max(1, Number(event.target.value) || 1),
                                )
                              }
                            />
                          </div>
                          {recipeReagent ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {row.craftFromQuantity ?? 1}x {recipeReagent.name}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-500">Sem formula</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {info?.craftPrice && info.craftPrice > 0 ? (
                            <span className="text-sky-200">{formatCopper(info.craftPrice, settings)}</span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant={row.priceLocked ? "default" : "ghost"}
                            onClick={() => setReagentPriceLocked(row.id, !row.priceLocked)}
                          >
                            {row.priceLocked ? <Lock className="mr-1 h-4 w-4" /> : <LockOpen className="mr-1 h-4 w-4" />}
                            {row.priceLocked ? "Fixado" : "Livre"}
                          </Button>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={row.currentPrice}
                            onChange={(event) => updateReagentPriceWithFeedback(row.id, Number(event.target.value) || 0)}
                          />
                          <p className="mt-1 text-xs text-amber-200">{formatCopper(row.currentPrice, settings)}</p>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <p className="font-medium text-emerald-200">
                            {formatCopper(info?.effectivePrice ?? row.currentPrice, settings)}
                          </p>
                          <p className="text-slate-400">
                            {info?.craftPrice && info.craftPrice > 0 && info.effectivePrice === info.craftPrice
                              ? "Origem: Craft"
                              : "Origem: Leilao"}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          <div className="flex items-center gap-2">
                            <span>{new Date(row.updatedAt).toLocaleString("pt-BR")}</span>
                            {recentlyUpdatedReagentId === row.id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <CheckCircle2 className="h-4 w-4" />
                                Atualizado
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.usageCount}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "history" ? (
          <Card>
            <CardHeader><CardTitle>Historico de Alteracoes</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {history.length === 0 ? <p className="text-slate-400">Sem alteracoes ainda.</p> : null}
                {history.slice(0, 80).map((row) => (
                  <div key={row.id} className="rounded-md border border-slate-700/70 p-2">
                    <p className="text-sm font-medium text-slate-100">{row.message}</p>
                    <p className="text-xs text-slate-400">{row.type} | {new Date(row.createdAt).toLocaleString("pt-BR")}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar exclusao</DialogTitle>
            <DialogDescription>
              Esta acao remove o craft permanentemente da base local.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirmDelete) {
                  return;
                }

                deleteCraft(confirmDelete);
                setConfirmDelete(null);
                toast.success("Craft excluido.");
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
