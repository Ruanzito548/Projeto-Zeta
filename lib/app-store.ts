"use client";

import { create } from "zustand";
import {
  CRAFT_TAGS,
  defaultSnapshot,
  type AppSettings,
  type AppSnapshot,
  type CraftItem,
  type CraftReagentLine,
  type CraftTag,
  type DisenchantLine,
  type HistoryEntry,
  type ProductionLine,
  type Reagent,
} from "@/lib/app-types";
import { loadSnapshotByUser, saveSnapshotByUser } from "@/lib/indexeddb";
import { loadCloudSnapshotByUser, saveCloudSnapshotByUser } from "@/lib/firestore-snapshot";
import { isFirebaseConfigured } from "@/lib/firebase";
import { STARTER_REAGENTS } from "@/lib/reagent-catalog";
import { nowIso, uid } from "@/lib/utils";

type AppState = AppSnapshot & {
  hydrated: boolean;
  activeUserId: string;
  search: string;
  selectedProfession: string;
  showFavoritesOnly: boolean;
  showArchived: boolean;
  init: (userId: string) => Promise<void>;
  persist: () => Promise<void>;
  setSettings: (next: Partial<AppSettings>) => void;
  setSearch: (value: string) => void;
  setSelectedProfession: (value: string) => void;
  setShowFavoritesOnly: (value: boolean) => void;
  setShowArchived: (value: boolean) => void;
  createReagent: (payload: Omit<Reagent, "id" | "updatedAt" | "usageCount" | "priceLocked" | "craftFromReagentId" | "craftFromQuantity"> & { priceLocked?: boolean; craftFromReagentId?: string; craftFromQuantity?: number }) => string;
  deleteReagent: (id: string) => void;
  updateReagentPrice: (id: string, price: number) => void;
  setReagentPriceLocked: (id: string, locked: boolean) => void;
  setReagentIcon: (id: string, iconUrl: string) => void;
  setReagentCraftRecipe: (id: string, craftFromReagentId: string, craftFromQuantity: number) => void;
  importStarterReagents: () => number;
  touchReagentUsage: (reagentId: string) => void;
  createCraft: (payload: Omit<CraftItem, "id" | "createdAt" | "updatedAt" | "favorite" | "archived" | "tags"> & { tags?: CraftTag[] }) => string;
  updateCraft: (id: string, payload: Partial<CraftItem>) => void;
  duplicateCraft: (id: string) => void;
  deleteCraft: (id: string) => void;
  archiveCraft: (id: string, archived: boolean) => void;
  toggleFavoriteCraft: (id: string) => void;
  addTag: (id: string, tag: CraftTag) => void;
  removeTag: (id: string, tag: CraftTag) => void;
  setProductionLine: (craftId: string, quantity: number) => void;
  removeProductionLine: (craftId: string) => void;
};

function boundedTags(tags?: CraftTag[]): CraftTag[] {
  if (!tags) {
    return [];
  }

  return tags.filter((tag) => CRAFT_TAGS.includes(tag));
}

function pushHistory(history: HistoryEntry[], message: string, type: HistoryEntry["type"]): HistoryEntry[] {
  return [
    {
      id: uid("hist"),
      type,
      message,
      createdAt: nowIso(),
    },
    ...history,
  ].slice(0, 800);
}

function hasSnapshotData(snapshot: AppSnapshot): boolean {
  return (
    snapshot.reagents.length > 0 ||
    snapshot.crafts.length > 0 ||
    snapshot.production.length > 0 ||
    snapshot.history.length > 0
  );
}

function mergeStarterReagents(reagents: Reagent[]): { next: Reagent[]; addedCount: number } {
  const knownNames = new Set(reagents.map((row) => row.name.trim().toLowerCase()));
  const additions: Reagent[] = [];

  for (const row of STARTER_REAGENTS) {
    const key = row.name.trim().toLowerCase();

    if (!key || knownNames.has(key)) {
      continue;
    }

    knownNames.add(key);
    additions.push({
      id: uid("reag"),
      name: row.name,
      iconUrl: row.iconUrl,
      profession: row.profession,
      currentPrice: row.currentPrice,
      priceLocked: false,
      updatedAt: nowIso(),
      usageCount: 0,
    });
  }

  return {
    next: [...reagents, ...additions],
    addedCount: additions.length,
  };
}

function seedSnapshotIfEmpty(snapshot: AppSnapshot): { snapshot: AppSnapshot; seeded: boolean } {
  if (hasSnapshotData(snapshot)) {
    return { snapshot, seeded: false };
  }

  const seeded = mergeStarterReagents(snapshot.reagents);

  return {
    snapshot: {
      ...snapshot,
      reagents: seeded.next,
    },
    seeded: seeded.addedCount > 0,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  ...defaultSnapshot,
  hydrated: false,
  activeUserId: "guest",
  search: "",
  selectedProfession: "ALL",
  showFavoritesOnly: false,
  showArchived: false,

  init: async (userId) => {
    const resolvedUserId = userId.trim() || "guest";
    const localSnapshot = seedSnapshotIfEmpty(await loadSnapshotByUser(resolvedUserId));

    if (resolvedUserId === "guest" || !isFirebaseConfigured) {
      set({
        ...localSnapshot.snapshot,
        activeUserId: resolvedUserId,
        hydrated: true,
      });

      if (localSnapshot.seeded) {
        await saveSnapshotByUser(localSnapshot.snapshot, resolvedUserId);
      }

      return;
    }

    try {
      const cloudSnapshotRaw = await loadCloudSnapshotByUser(resolvedUserId);
      const cloudSnapshot = cloudSnapshotRaw ? seedSnapshotIfEmpty(cloudSnapshotRaw) : null;

      if (cloudSnapshot) {
        set({
          ...cloudSnapshot.snapshot,
          activeUserId: resolvedUserId,
          hydrated: true,
        });

        await saveSnapshotByUser(cloudSnapshot.snapshot, resolvedUserId);

        if (cloudSnapshot.seeded) {
          await saveCloudSnapshotByUser(cloudSnapshot.snapshot, resolvedUserId);
        }

        return;
      }

      set({
        ...localSnapshot.snapshot,
        activeUserId: resolvedUserId,
        hydrated: true,
      });

      if (hasSnapshotData(localSnapshot.snapshot)) {
        await saveCloudSnapshotByUser(localSnapshot.snapshot, resolvedUserId);
      }
    } catch {
      set({
        ...localSnapshot.snapshot,
        activeUserId: resolvedUserId,
        hydrated: true,
      });
    }
  },

  persist: async () => {
    const state = get();
    const snapshot: AppSnapshot = {
      reagents: state.reagents,
      crafts: state.crafts,
      production: state.production,
      history: state.history,
      settings: state.settings,
    };

    await saveSnapshotByUser(snapshot, state.activeUserId);

    if (state.activeUserId !== "guest" && isFirebaseConfigured) {
      try {
        await saveCloudSnapshotByUser(snapshot, state.activeUserId);
      } catch {
        // Keep local persistence resilient even if cloud write fails.
      }
    }
  },

  setSettings: (next) => {
    set((state) => ({ settings: { ...state.settings, ...next } }));
    get().persist();
  },

  setSearch: (value) => set({ search: value }),
  setSelectedProfession: (value) => set({ selectedProfession: value }),
  setShowFavoritesOnly: (value) => set({ showFavoritesOnly: value }),
  setShowArchived: (value) => set({ showArchived: value }),

  createReagent: (payload) => {
    const id = uid("reag");

    set((state) => ({
      reagents: [
        {
          id,
          ...payload,
          priceLocked: payload.priceLocked ?? false,
          craftFromReagentId: payload.craftFromReagentId || undefined,
          craftFromQuantity: Math.max(1, Number(payload.craftFromQuantity) || 1),
          updatedAt: nowIso(),
          usageCount: 0,
        },
        ...state.reagents,
      ],
      history: pushHistory(
        state.history,
        `Reagente ${payload.name} cadastrado.`,
        "CRAFT_UPDATED",
      ),
    }));

    get().persist();
    return id;
  },

  deleteReagent: (id) => {
    set((state) => {
      const target = state.reagents.find((row) => row.id === id);

      if (!target) {
        return state;
      }

      return {
        reagents: state.reagents
          .filter((row) => row.id !== id)
          .map((row) =>
            row.craftFromReagentId === id
              ? {
                  ...row,
                  craftFromReagentId: undefined,
                  craftFromQuantity: 1,
                  updatedAt: nowIso(),
                }
              : row,
          ),
        crafts: state.crafts.map((craft) => ({
          ...craft,
          reagents: craft.reagents.filter((line) => line.reagentId !== id),
          updatedAt: nowIso(),
        })),
        history: pushHistory(state.history, `Reagente ${target.name} removido.`, "CRAFT_UPDATED"),
      };
    });

    get().persist();
  },

  updateReagentPrice: (id, price) => {
    set((state) => ({
      reagents: state.reagents.map((row) =>
        row.id === id
          ? {
              ...row,
              currentPrice: Math.max(0, price),
              updatedAt: nowIso(),
            }
          : row,
      ),
      history: pushHistory(state.history, `Preco de reagente atualizado.`, "REAGENT_PRICE"),
    }));

    get().persist();
  },

  setReagentPriceLocked: (id, locked) => {
    set((state) => ({
      reagents: state.reagents.map((row) =>
        row.id === id
          ? {
              ...row,
              priceLocked: locked,
              updatedAt: nowIso(),
            }
          : row,
      ),
      history: pushHistory(
        state.history,
        locked ? "Preco de reagente fixado." : "Preco de reagente desbloqueado.",
        "CRAFT_UPDATED",
      ),
    }));

    get().persist();
  },

  setReagentIcon: (id, iconUrl) => {
    set((state) => ({
      reagents: state.reagents.map((row) =>
        row.id === id
          ? {
              ...row,
              iconUrl,
            }
          : row,
      ),
    }));

    get().persist();
  },

  setReagentCraftRecipe: (id, craftFromReagentId, craftFromQuantity) => {
    set((state) => ({
      reagents: state.reagents.map((row) =>
        row.id === id
          ? {
              ...row,
              craftFromReagentId: craftFromReagentId || undefined,
              craftFromQuantity: Math.max(1, Number(craftFromQuantity) || 1),
              updatedAt: nowIso(),
            }
          : row,
      ),
      history: pushHistory(state.history, "Regra de craft do reagente atualizada.", "CRAFT_UPDATED"),
    }));

    get().persist();
  },

  importStarterReagents: () => {
    const merged = mergeStarterReagents(get().reagents);

    if (merged.addedCount === 0) {
      return 0;
    }

    set((state) => ({
      reagents: merged.next,
      history: pushHistory(
        state.history,
        `${merged.addedCount} reagentes base importados.`,
        "CRAFT_UPDATED",
      ),
    }));

    get().persist();
    return merged.addedCount;
  },

  touchReagentUsage: (reagentId) => {
    set((state) => ({
      reagents: state.reagents.map((row) =>
        row.id === reagentId ? { ...row, usageCount: row.usageCount + 1 } : row,
      ),
    }));

    get().persist();
  },

  createCraft: (payload) => {
    const id = uid("craft");

    set((state) => ({
      crafts: [
        {
          id,
          favorite: false,
          archived: false,
          tags: boundedTags(payload.tags),
          createdAt: nowIso(),
          updatedAt: nowIso(),
          ...payload,
        },
        ...state.crafts,
      ],
      history: pushHistory(state.history, `Craft ${payload.name} criado.`, "CRAFT_CREATED"),
    }));

    payload.reagents.forEach((line) => get().touchReagentUsage(line.reagentId));
    get().persist();

    return id;
  },

  updateCraft: (id, payload) => {
    set((state) => ({
      crafts: state.crafts.map((row) => {
        if (row.id !== id) {
          return row;
        }

        return {
          ...row,
          ...payload,
          tags: payload.tags ? boundedTags(payload.tags) : row.tags,
          updatedAt: nowIso(),
        };
      }),
      history: pushHistory(state.history, `Craft atualizado.`, "CRAFT_UPDATED"),
    }));

    get().persist();
  },

  duplicateCraft: (id) => {
    const target = get().crafts.find((row) => row.id === id);

    if (!target) {
      return;
    }

    const clonedReagents: CraftReagentLine[] = target.reagents.map((row) => ({
      ...row,
      id: uid("creag"),
    }));

    const clonedDE: DisenchantLine[] = target.disenchantTable.map((row) => ({
      ...row,
      id: uid("de"),
    }));

    get().createCraft({
      ...target,
      name: `${target.name} (Copia)`,
      reagents: clonedReagents,
      disenchantTable: clonedDE,
      quantityProduced: target.quantityProduced,
      saleValue: target.saleValue,
      profession: target.profession,
      requiredProfessionLevel: target.requiredProfessionLevel,
      iconUrl: target.iconUrl,
      tags: [...target.tags],
    });
  },

  deleteCraft: (id) => {
    set((state) => ({
      crafts: state.crafts.filter((row) => row.id !== id),
      production: state.production.filter((row) => row.craftId !== id),
      history: pushHistory(state.history, "Craft removido.", "CRAFT_DELETED"),
    }));

    get().persist();
  },

  archiveCraft: (id, archived) => {
    set((state) => ({
      crafts: state.crafts.map((row) => (row.id === id ? { ...row, archived, updatedAt: nowIso() } : row)),
      history: pushHistory(state.history, archived ? "Craft arquivado." : "Craft desarquivado.", "CRAFT_UPDATED"),
    }));

    get().persist();
  },

  toggleFavoriteCraft: (id) => {
    set((state) => ({
      crafts: state.crafts.map((row) =>
        row.id === id ? { ...row, favorite: !row.favorite, updatedAt: nowIso() } : row,
      ),
      history: pushHistory(state.history, "Favorito atualizado.", "CRAFT_UPDATED"),
    }));

    get().persist();
  },

  addTag: (id, tag) => {
    set((state) => ({
      crafts: state.crafts.map((row) => {
        if (row.id !== id || row.tags.includes(tag)) {
          return row;
        }

        return {
          ...row,
          tags: [...row.tags, tag],
          updatedAt: nowIso(),
        };
      }),
    }));

    get().persist();
  },

  removeTag: (id, tag) => {
    set((state) => ({
      crafts: state.crafts.map((row) => {
        if (row.id !== id) {
          return row;
        }

        return {
          ...row,
          tags: row.tags.filter((value) => value !== tag),
          updatedAt: nowIso(),
        };
      }),
    }));

    get().persist();
  },

  setProductionLine: (craftId, quantity) => {
    set((state) => {
      const value = Math.max(1, Math.round(quantity));
      const existing = state.production.find((row) => row.craftId === craftId);

      let next: ProductionLine[];

      if (existing) {
        next = state.production.map((row) =>
          row.craftId === craftId ? { ...row, quantity: value } : row,
        );
      } else {
        next = [...state.production, { id: uid("prod"), craftId, quantity: value }];
      }

      return { production: next };
    });

    get().persist();
  },

  removeProductionLine: (craftId) => {
    set((state) => ({
      production: state.production.filter((row) => row.craftId !== craftId),
    }));

    get().persist();
  },
}));
