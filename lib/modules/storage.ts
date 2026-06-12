import type { ModuleSnapshot, PriceSource, ReagentEntry } from "@/lib/modules/types";
import { DEFAULT_SNAPSHOT } from "@/lib/modules/types";
import type { WowVersion } from "@/lib/wow/versions";

function storageKey(version: WowVersion): string {
  return `lootmaster-v2-${version}`;
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

export function loadSnapshot(version: WowVersion): ModuleSnapshot {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT(version);
  }

  try {
    const raw = window.localStorage.getItem(storageKey(version));
    if (!raw) {
      return DEFAULT_SNAPSHOT(version);
    }

    const parsed = JSON.parse(raw) as ModuleSnapshot;
    if (!parsed || !Array.isArray(parsed.reagents) || !Array.isArray(parsed.crafts)) {
      return DEFAULT_SNAPSHOT(version);
    }

    const normalizedReagents = parsed.reagents.map((entry) => normalizeReagent(entry));

    return {
      ...DEFAULT_SNAPSHOT(version),
      ...parsed,
      reagents: normalizedReagents,
      version,
    };
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
