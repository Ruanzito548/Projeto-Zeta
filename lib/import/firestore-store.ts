import { FieldPath, type Firestore } from "firebase-admin/firestore";

import { COLLECTIONS, type CatalogCollection, type ImportStore, type StoredDoc } from "./store";
import type { ImportJob, ImportLogEntry } from "./types";

const GET_ALL_CHUNK = 300;

export class FirestoreImportStore implements ImportStore {
  constructor(private readonly db: Firestore) {}

  private col(name: CatalogCollection) {
    return this.db.collection(COLLECTIONS[name]);
  }

  async getHashes(col: CatalogCollection, ids: Array<number | string>) {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += GET_ALL_CHUNK) {
      const refs = ids.slice(i, i + GET_ALL_CHUNK).map((id) => this.col(col).doc(String(id)));
      if (refs.length === 0) continue;
      const snaps = await this.db.getAll(...refs, { fieldMask: ["contentHash"] });
      for (const snap of snaps) {
        if (snap.exists) out.set(snap.id, String(snap.get("contentHash") ?? ""));
      }
    }
    return out;
  }

  async getDocs<T>(col: CatalogCollection, ids: Array<number | string>) {
    const docs: T[] = [];
    for (let i = 0; i < ids.length; i += GET_ALL_CHUNK) {
      const refs = ids.slice(i, i + GET_ALL_CHUNK).map((id) => this.col(col).doc(String(id)));
      if (refs.length === 0) continue;
      for (const snap of await this.db.getAll(...refs)) {
        if (snap.exists) docs.push(snap.data() as T);
      }
    }
    return docs;
  }

  async upsertMany(col: CatalogCollection, docs: StoredDoc[]) {
    if (docs.length === 0) return;
    const writer = this.db.bulkWriter();
    const pending = docs.map((doc) => writer.set(this.col(col).doc(String(doc.id)), doc, { merge: true }));
    await writer.close();
    await Promise.all(pending);
  }

  async listPage<T>(col: CatalogCollection, afterId: string | null, limit: number) {
    let query = this.col(col).orderBy(FieldPath.documentId()).limit(limit);
    if (afterId !== null) query = query.startAfter(afterId);
    return (await query.get()).docs.map((snap) => snap.data() as T);
  }

  async recipeIdsByProduct(itemId: number) {
    const snap = await this.col("edges").where("itemId", "==", itemId).where("role", "==", "product").get();
    return snap.docs.map((doc) => doc.get("recipeId") as number);
  }

  async getJob(id: string) {
    const snap = await this.db.collection(COLLECTIONS.jobs).doc(id).get();
    return snap.exists ? (snap.data() as ImportJob) : null;
  }

  async saveJob(job: ImportJob) {
    await this.db.collection(COLLECTIONS.jobs).doc(job.id).set(job);
  }

  async listJobs(limit: number) {
    const snap = await this.db.collection(COLLECTIONS.jobs).orderBy("startedAt", "desc").limit(limit).get();
    return snap.docs.map((doc) => doc.data() as ImportJob);
  }

  async appendLog(jobId: string, entry: ImportLogEntry) {
    await this.db.collection(COLLECTIONS.jobs).doc(jobId).collection("logs").add(entry);
  }

  async listLogs(jobId: string, limit: number) {
    const snap = await this.db
      .collection(COLLECTIONS.jobs)
      .doc(jobId)
      .collection("logs")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as ImportLogEntry).reverse();
  }

  private lockRef() {
    return this.db.collection(COLLECTIONS.lock).doc("current");
  }

  acquireLock(owner: string, ttlMs: number) {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.lockRef());
      const now = Date.now();
      const current = snap.data() as { owner: string; expiresAt: number } | undefined;
      if (current && current.expiresAt > now && current.owner !== owner) return false;
      tx.set(this.lockRef(), { owner, expiresAt: now + ttlMs });
      return true;
    });
  }

  async renewLock(owner: string, ttlMs: number) {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.lockRef());
      if (snap.get("owner") === owner) tx.update(this.lockRef(), { expiresAt: Date.now() + ttlMs });
    });
  }

  async releaseLock(owner: string) {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.lockRef());
      if (snap.get("owner") === owner) tx.delete(this.lockRef());
    });
  }
}
