import { defaultData, defaultSettings } from "@/lib/domain";
import type {
  AppData,
  AppSettings,
  CraftItem,
  PriceHistoryEntry,
} from "@/lib/domain";

const STORAGE_KEY = "tbc-profit-calculator.v1";

export interface AppRepository {
  getData(): AppData;
  saveItems(items: CraftItem[]): AppData;
  saveSettings(settings: AppSettings): AppData;
  appendHistory(entries: PriceHistoryEntry[]): AppData;
  replaceData(data: AppData): AppData;
}

function sanitizeData(raw: unknown): AppData {
  if (!raw || typeof raw !== "object") {
    return defaultData;
  }

  const parsed = raw as Partial<AppData>;

  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
    },
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

function readLocalStorage(): AppData {
  if (typeof window === "undefined") {
    return defaultData;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return defaultData;
  }

  try {
    return sanitizeData(JSON.parse(raw));
  } catch {
    return defaultData;
  }
}

function writeLocalStorage(data: AppData) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export class LocalStorageRepository implements AppRepository {
  getData(): AppData {
    return readLocalStorage();
  }

  saveItems(items: CraftItem[]): AppData {
    const current = readLocalStorage();
    const next = { ...current, items };
    writeLocalStorage(next);
    return next;
  }

  saveSettings(settings: AppSettings): AppData {
    const current = readLocalStorage();
    const next = { ...current, settings };
    writeLocalStorage(next);
    return next;
  }

  appendHistory(entries: PriceHistoryEntry[]): AppData {
    const current = readLocalStorage();
    const next = { ...current, history: [...current.history, ...entries] };
    writeLocalStorage(next);
    return next;
  }

  replaceData(data: AppData): AppData {
    const normalized = sanitizeData(data);
    writeLocalStorage(normalized);
    return normalized;
  }
}

// Contract-first factory for future DB/API repository swap.
export function createAppRepository(): AppRepository {
  return new LocalStorageRepository();
}
