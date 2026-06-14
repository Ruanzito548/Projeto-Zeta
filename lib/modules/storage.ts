import type {
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
import { doc, getDoc, setDoc } from "firebase/firestore";

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

    return normalizeSnapshot(snap.data().snapshot, version);
  } catch {
    return null;
  }
}

export async function saveSnapshotToCloud(snapshot: ModuleSnapshot): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  try {
    const ref = doc(db, "wowSnapshots", snapshot.version);
    await setDoc(
      ref,
      {
        version: snapshot.version,
        snapshot,
        syncedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Ignore cloud sync failures to keep local storage flow responsive.
  }
}
