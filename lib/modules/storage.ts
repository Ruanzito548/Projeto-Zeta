import type {
  ImportedCraftItem,
  ModuleSnapshot,
  PersonalDashboardSnapshot,
  PriceSource,
  ReagentEntry,
} from "@/lib/modules/types";
import {
  DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT,
  DEFAULT_SNAPSHOT,
} from "@/lib/modules/types";
import type { WowVersion } from "@/lib/wow/versions";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

function storageKey(version: WowVersion): string {
  return `lootmaster-v2-${version}`;
}

function personalStorageKey(version: WowVersion): string {
  return `lootmaster-v2-personal-${version}`;
}

function normalizePriceSource(value: unknown): PriceSource {
  if (value === "CRAFTING" || value === "NPC" || value === "MATERIA_PRIMA") {
    return value;
  }

  return "MATERIA_PRIMA";
}

function normalizeReagent(entry: ReagentEntry): ReagentEntry {
  return {
    ...entry,
    priceSource: normalizePriceSource((entry as ReagentEntry & { priceSource?: unknown }).priceSource),
    fixedPrice:
      typeof entry.fixedPrice === "number" && Number.isFinite(entry.fixedPrice) && entry.fixedPrice > 0
        ? Math.round(entry.fixedPrice)
        : null,
  };
}

function normalizeSnapshot(raw: unknown, version: WowVersion): ModuleSnapshot {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_SNAPSHOT(version);
  }

  const parsed = raw as Partial<ModuleSnapshot>;

  return {
    ...DEFAULT_SNAPSHOT(version),
    ...parsed,
    reagents: Array.isArray(parsed.reagents)
      ? parsed.reagents.map((entry) => normalizeReagent(entry))
      : [],
    crafts: Array.isArray(parsed.crafts) ? parsed.crafts : [],
    version,
  };
}

function normalizePersonalSnapshot(raw: unknown, version: WowVersion): PersonalDashboardSnapshot {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT(version);
  }

  const parsed = raw as Partial<PersonalDashboardSnapshot>;

  return {
    ...DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT(version),
    ...parsed,
    importedCrafts: Array.isArray(parsed.importedCrafts) ? parsed.importedCrafts : [],
    reagents: Array.isArray(parsed.reagents)
      ? parsed.reagents.map((entry) => normalizeReagent(entry))
      : [],
    favoriteGlobalCraftIds: Array.isArray(parsed.favoriteGlobalCraftIds)
      ? parsed.favoriteGlobalCraftIds.filter((id): id is number => Number.isFinite(id))
      : [],
    version,
  };
}

export function loadSnapshot(version: WowVersion): ModuleSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT(version);
  }

  try {
    const raw = window.localStorage.getItem(storageKey(version));
    if (!raw) {
      return DEFAULT_SNAPSHOT(version);
    }

    return normalizeSnapshot(JSON.parse(raw), version);
  } catch {
    return DEFAULT_SNAPSHOT(version);
  }
}

export function saveSnapshot(snapshot: ModuleSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey(snapshot.version), JSON.stringify(snapshot));
}

export function loadPersonalDashboardSnapshot(version: WowVersion): PersonalDashboardSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT(version);
  }

  try {
    const raw = window.localStorage.getItem(personalStorageKey(version));
    if (!raw) {
      return DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT(version);
    }

    return normalizePersonalSnapshot(JSON.parse(raw), version);
  } catch {
    return DEFAULT_PERSONAL_DASHBOARD_SNAPSHOT(version);
  }
}

export function savePersonalDashboardSnapshot(snapshot: PersonalDashboardSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(personalStorageKey(snapshot.version), JSON.stringify(snapshot));
}

export async function loadSnapshotFromCloud(version: WowVersion): Promise<ModuleSnapshot | null> {
  if (!isFirebaseConfigured || !db) {
    return null;
  }

  try {
    const ref = doc(db, "wowSnapshots", version);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return null;
    }

    const data = snap.data();

    // New format: crafts and reagents stored as maps keyed by itemId
    if (data.craftsById && typeof data.craftsById === "object") {
      const crafts = Object.values(data.craftsById) as ImportedCraftItem[];
      const reagents = Object.values(
        (data.reagentsById ?? {}) as Record<string, ReagentEntry>,
      );

      return normalizeSnapshot(
        {
          version,
          lastTsmSyncAt: data.lastTsmSyncAt ?? null,
          crafts,
          reagents,
        },
        version,
      );
    }

    // Legacy format: snapshot stored as nested object
    if (data.snapshot) {
      return normalizeSnapshot(data.snapshot, version);
    }

    return null;
  } catch {
    return null;
  }
}

// Saves crafts and reagents as Firestore maps keyed by itemId.
// Using merge:true means parallel writes from different users never
// overwrite each other's items — only the changed keys are touched.
export async function saveSnapshotToCloud(snapshot: ModuleSnapshot): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", snapshot.version);

    const craftsById: Record<string, ImportedCraftItem> = {};
    for (const craft of snapshot.crafts) {
      craftsById[String(craft.itemId)] = craft;
    }

    const reagentsById: Record<string, ReagentEntry> = {};
    for (const reagent of snapshot.reagents) {
      reagentsById[String(reagent.itemId)] = reagent;
    }

    await setDoc(
      ref,
      {
        version: snapshot.version,
        lastTsmSyncAt: snapshot.lastTsmSyncAt,
        craftsById,
        reagentsById,
        syncedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Ignore cloud sync failures to keep local storage flow responsive.
  }
}

// Atomically saves a single craft item to the global Firestore document.
export async function saveGlobalCraftToCloud(
  craft: ImportedCraftItem,
  reagents: ReagentEntry[],
  version: WowVersion,
): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", version);

    const reagentsById: Record<string, ReagentEntry> = {};
    for (const reagent of reagents) {
      reagentsById[String(reagent.itemId)] = reagent;
    }

    await setDoc(
      ref,
      {
        version,
        [`craftsById.${craft.itemId}`]: craft,
        ...Object.fromEntries(
          Object.entries(reagentsById).map(([k, v]) => [`reagentsById.${k}`, v]),
        ),
        syncedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Ignore cloud sync failures.
  }
}

// Atomically removes a craft item from the global Firestore document.
export async function deleteGlobalCraftFromCloud(
  itemId: number,
  version: WowVersion,
): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", version);
    await updateDoc(ref, {
      [`craftsById.${itemId}`]: deleteField(),
    });
  } catch {
    // Ignore cloud sync failures.
  }
}

// Atomically removes a reagent from the global Firestore document.
export async function deleteGlobalReagentFromCloud(
  itemId: number,
  version: WowVersion,
): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", version);
    await updateDoc(ref, {
      [`reagentsById.${itemId}`]: deleteField(),
    });
  } catch {
    // Ignore cloud sync failures.
  }
}

// Saves reagent prices update (TSM sync) globally.
export async function saveGlobalReagentPricesToCloud(
  reagents: ReagentEntry[],
  crafts: ImportedCraftItem[],
  lastTsmSyncAt: string,
  version: WowVersion,
): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", version);

    const reagentsById: Record<string, ReagentEntry> = {};
    for (const reagent of reagents) {
      reagentsById[String(reagent.itemId)] = reagent;
    }

    const craftsById: Record<string, ImportedCraftItem> = {};
    for (const craft of crafts) {
      craftsById[String(craft.itemId)] = craft;
    }

    await setDoc(
      ref,
      {
        version,
        lastTsmSyncAt,
        reagentsById,
        craftsById,
        syncedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Ignore cloud sync failures.
  }
}
