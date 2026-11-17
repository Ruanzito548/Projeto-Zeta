import { FirestoreImportStore } from "../import/firestore-store";
import { ForeverDbSource } from "../import/foreverdb-source";
import type { EngineDeps } from "../import/engine";
import { WfSource } from "../import/wf-source";
import { adminFirestore } from "./firebase-admin";

// Instância única por processo: preserva o cache de respostas e o rate limiter entre requisições.
let wfSource: WfSource | null = null;
let foreverDbSource: ForeverDbSource | null | undefined;

export function createImportDeps(): EngineDeps {
  wfSource ??= new WfSource();
  if (foreverDbSource === undefined) foreverDbSource = ForeverDbSource.fromEnv();

  return {
    store: new FirestoreImportStore(adminFirestore()),
    wf: wfSource,
    foreverDb: foreverDbSource,
    foreverDbMaxPerRun: Number(process.env.FOREVERDB_MAX_REQUESTS_PER_IMPORT) || 300,
  };
}

export function foreverDbConfigured(): boolean {
  return Boolean(process.env.FOREVERDB_API_KEY?.trim());
}
