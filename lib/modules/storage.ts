import type { ModuleSnapshot } from "@/lib/modules/types";
import { DEFAULT_SNAPSHOT } from "@/lib/modules/types";
import type { WowVersion } from "@/lib/wow/versions";

function storageKey(version: WowVersion): string {
  return `lootmaster-v2-${version}`;
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

    return {
      ...DEFAULT_SNAPSHOT(version),
      ...parsed,
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
