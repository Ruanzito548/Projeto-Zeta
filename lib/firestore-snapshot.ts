"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { defaultSnapshot, type AppSnapshot } from "@/lib/app-types";

type SnapshotDocument = {
  snapshot?: Partial<AppSnapshot>;
  updatedAt?: string;
};

function normalizeSnapshot(data: Partial<AppSnapshot> | undefined): AppSnapshot {
  const source = data ?? {};

  return {
    ...defaultSnapshot,
    ...source,
    reagents: (source.reagents ?? []).map((reagent) => ({
      ...reagent,
      category: reagent.category ?? "Miscellaneous",
      origin: reagent.origin?.trim() || undefined,
      priceLocked: Boolean(reagent.priceLocked),
      craftFromReagentId: reagent.craftFromReagentId || undefined,
      craftFromQuantity: Math.max(1, Number(reagent.craftFromQuantity) || 1),
    })),
    crafts: (source.crafts ?? []).map((craft) => ({
      ...craft,
      craftTimeMinutes:
        typeof craft.craftTimeMinutes === "number" && craft.craftTimeMinutes > 0
          ? craft.craftTimeMinutes
          : undefined,
    })),
    production: source.production ?? [],
    history: source.history ?? [],
    settings: {
      ...defaultSnapshot.settings,
      ...(source.settings ?? {}),
    },
  };
}

export async function loadCloudSnapshotByUser(userId: string): Promise<AppSnapshot | null> {
  const uid = userId.trim();

  if (!db || !uid || uid === "guest") {
    return null;
  }

  const ref = doc(db, "users", uid, "app", "snapshot");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }

  const payload = snap.data() as SnapshotDocument;
  return normalizeSnapshot(payload.snapshot);
}

export async function saveCloudSnapshotByUser(snapshot: AppSnapshot, userId: string): Promise<void> {
  const uid = userId.trim();

  if (!db || !uid || uid === "guest") {
    return;
  }

  const ref = doc(db, "users", uid, "app", "snapshot");
  await setDoc(
    ref,
    {
      snapshot,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
