import { openDB } from "idb";
import { defaultSnapshot, type AppSnapshot } from "@/lib/app-types";

const DB_NAME = "wow-tbc-profit";
const STORE_NAME = "snapshot";
const SNAPSHOT_KEY_PREFIX = "app";

let dbPromise: ReturnType<typeof openDB> | null = null;

function getDb() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return null;
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  return dbPromise;
}

function getSnapshotKey(userId: string): string {
  const normalized = userId.trim();
  return `${SNAPSHOT_KEY_PREFIX}:${normalized || "guest"}`;
}

export async function loadSnapshotByUser(userId: string): Promise<AppSnapshot> {
  const snapshotKey = getSnapshotKey(userId);
  const dbConn = getDb();

  if (!dbConn) {
    return defaultSnapshot;
  }

  const db = await dbConn;
  const data = (await db.get(STORE_NAME, snapshotKey)) as AppSnapshot | undefined;

  if (!data) {
    return defaultSnapshot;
  }

  return {
    ...defaultSnapshot,
    ...data,
    reagents: (data.reagents ?? []).map((reagent) => ({
      ...reagent,
      priceLocked: Boolean(reagent.priceLocked),
      craftFromReagentId: reagent.craftFromReagentId || undefined,
      craftFromQuantity: Math.max(1, Number(reagent.craftFromQuantity) || 1),
    })),
    settings: {
      ...defaultSnapshot.settings,
      ...(data.settings ?? {}),
    },
  };
}

export async function saveSnapshotByUser(snapshot: AppSnapshot, userId: string): Promise<void> {
  const snapshotKey = getSnapshotKey(userId);
  const dbConn = getDb();

  if (!dbConn) {
    return;
  }

  const db = await dbConn;
  await db.put(STORE_NAME, snapshot, snapshotKey);
}
