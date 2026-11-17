"use client";

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { computeProgress, formatElapsed } from "@/lib/import/progress";
import type { ImportJob, ImportLogEntry, ImportMode, ImportTargets } from "@/lib/import/types";

const ALL: ImportTargets = { professions: true, recipes: true, items: true, materials: true };
const NONE: ImportTargets = { professions: false, recipes: false, items: false, materials: false };

const STATUS_LABEL: Record<ImportJob["status"], string> = {
  running: "Em andamento",
  paused: "Interrompida (retomável)",
  completed: "Concluída",
  failed: "Falhou",
};

interface StatusPayload {
  foreverDbConfigured: boolean;
  jobs: ImportJob[];
  logs: ImportLogEntry[];
}

export function ImportDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [logs, setLogs] = useState<ImportLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [enrich, setEnrich] = useState(false);
  const [, setTick] = useState(0);
  const stopRef = useRef(false);
  const receivedAt = useRef(Date.now());

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!driving) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [driving]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await user?.getIdToken();
      const response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Erro ${response.status}`);
      return payload;
    },
    [user],
  );

  const refresh = useCallback(
    async (jobId?: string) => {
      const query = jobId ? `?jobId=${jobId}` : "";
      const payload = await api<StatusPayload>(`/api/admin/import${query}`);
      setStatus(payload);
      if (jobId) {
        setLogs(payload.logs);
        const fresh = payload.jobs.find((item) => item.id === jobId);
        if (fresh) setJob(fresh);
      }
      return payload;
    },
    [api],
  );

  useEffect(() => {
    if (!user) return;
    refresh()
      .then((payload) => {
        const latest = payload.jobs[0];
        if (latest) {
          setJob(latest);
          return refresh(latest.id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [user, refresh]);

  const drive = useCallback(
    async (jobId: string) => {
      stopRef.current = false;
      setDriving(true);
      setError(null);
      try {
        for (;;) {
          const result = await api<{ job: ImportJob; busy: boolean }>("/api/admin/import", {
            method: "POST",
            body: JSON.stringify({ action: "step", jobId }),
          });
          receivedAt.current = Date.now();
          setJob(result.job);
          if (result.job.status !== "running" || stopRef.current) break;
          if (result.busy) await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha de comunicação. Use Retomar para continuar.");
      } finally {
        setDriving(false);
        await refresh(jobId).catch(() => undefined);
      }
    },
    [api, refresh],
  );

  async function start(mode: ImportMode, targets: ImportTargets) {
    setError(null);
    try {
      const { job: created } = await api<{ job: ImportJob }>("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ action: "start", mode, targets, enrichWithForeverDb: enrich }),
      });
      setJob(created);
      receivedAt.current = Date.now();
      await drive(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar.");
    }
  }

  async function resume(target: ImportJob) {
    setError(null);
    try {
      const { job: resumed } = await api<{ job: ImportJob }>("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ action: "resume", jobId: target.id }),
      });
      setJob(resumed);
      await drive(resumed.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao retomar.");
    }
  }

  const previousTotals = useMemo(() => {
    const done = status?.jobs.find((item) => item.status === "completed" && item.id !== job?.id);
    return done ? { itemsFound: done.counters.itemsFound, recipesFound: done.counters.recipesFound } : null;
  }, [status, job?.id]);

  const resumable = status?.jobs.find((item) => item.status === "paused" || item.status === "running");
  const busy = driving || job?.status === "running";
  const elapsedMs = job ? job.elapsedMs + (driving ? Date.now() - receivedAt.current : 0) : 0;
  const progress = job ? computeProgress(job, previousTotals) : 0;
  const c = job?.counters;

  if (!ready) return <Shell>Carregando...</Shell>;

  if (!auth) {
    return <Shell>Firebase não está configurado neste ambiente (NEXT_PUBLIC_FIREBASE_*).</Shell>;
  }

  if (!user) {
    return (
      <Shell>
        <p className="mb-4 text-sm text-[#b8e6b8]">Entre com uma conta de administrador para importar dados.</p>
        <Button onClick={() => signInWithPopup(auth!, new GoogleAuthProvider()).catch((e: Error) => setError(e.message))}>
          Entrar com Google
        </Button>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </Shell>
    );
  }

  const indicators: Array<[string, number | string]> = [
    ["Itens encontrados", c?.itemsFound ?? 0],
    ["Itens importados", c?.itemsImported ?? 0],
    ["Itens atualizados", c?.itemsUpdated ?? 0],
    ["Receitas importadas", c?.recipesImported ?? 0],
    ["Materiais identificados", c?.materialsIdentified ?? 0],
    ["Registros ignorados", c?.skipped ?? 0],
    ["Erros", c?.errors ?? 0],
    ["Conclusão", `${progress}%`],
    ["Tempo decorrido", formatElapsed(elapsedMs)],
  ];

  return (
    <Shell>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Importar dados do WoW Forever</CardTitle>
            <p className="text-sm text-[#b8e6b8]">
              Fontes: Warcraft Forever Data Library (principal) e ForeverDB (opcional, exige chave). Preços da Casa de
              Leilão nunca são alterados por este importador.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button size="lg" disabled={busy} onClick={() => start("initial", ALL)}>
                IMPORTAR TUDO
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => start("initial", { ...NONE, items: true })}>
                Importar todos os itens
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => start("initial", { ...NONE, recipes: true })}>
                Importar receitas
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => start("initial", { ...NONE, professions: true })}>
                Importar profissões
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => start("initial", { ...NONE, materials: true })}>
                Importar materiais
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="ghost" disabled={busy} onClick={() => start("incremental", ALL)}>
                Importar somente novidades
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => start("sync", ALL)}>
                Atualizar dados existentes (sincronização completa)
              </Button>
              {resumable && !busy && (
                <Button variant="secondary" onClick={() => resume(resumable)}>
                  Retomar importação interrompida
                </Button>
              )}
              {driving && (
                <Button variant="danger" onClick={() => (stopRef.current = true)}>
                  Pausar após o passo atual
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-[#b8e6b8]">
              <input
                type="checkbox"
                checked={enrich}
                disabled={!status?.foreverDbConfigured || busy}
                onChange={(event) => setEnrich(event.target.checked)}
              />
              Enriquecer itens com o ForeverDB{" "}
              {!status?.foreverDbConfigured && "(indisponível: FOREVERDB_API_KEY não configurada)"}
            </label>
            {error && <p className="text-sm text-red-300">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {job ? `${STATUS_LABEL[job.status]} — fase: ${job.phase} — modo: ${job.mode}` : "Nenhuma importação ainda"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-3 w-full overflow-hidden rounded-full bg-black/50">
              <div className="h-full bg-[#4aa84a] transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {indicators.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-green-500/20 p-3">
                  <p className="text-xs uppercase tracking-wider text-[#9eff8a]/80">{label}</p>
                  <p className="text-xl font-semibold text-[#d4ffcc]">{value}</p>
                </div>
              ))}
            </div>
            {c && (
              <p className="text-xs text-[#b8e6b8]/80">
                Receitas encontradas: {c.recipesFound} · Receitas atualizadas: {c.recipesUpdated} · Profissões: {c.professionsImported} ·
                Materiais buscados: {c.materialsFetched} · Órfãos (mantidos): {c.orphans} · Requisições: {c.requests}
              </p>
            )}
            {job?.lastError && <p className="text-sm text-red-300">Último erro: {job.lastError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Histórico de importações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(status?.jobs ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setJob(item);
                  refresh(item.id).catch((e: Error) => setError(e.message));
                }}
                className="flex w-full items-center justify-between rounded-lg border border-green-500/15 px-3 py-2 text-left text-sm hover:bg-green-500/10"
              >
                <span>
                  {new Date(item.startedAt).toLocaleString()} · {item.mode} · build {item.datasets.build}
                </span>
                <span>
                  {STATUS_LABEL[item.status]} · {item.counters.itemsFound} itens · {item.counters.recipesFound} receitas ·{" "}
                  {item.counters.errors} erros
                </span>
              </button>
            ))}
            {status && status.jobs.length === 0 && <p className="text-sm text-[#b8e6b8]">Sem histórico.</p>}
          </CardContent>
        </Card>

        {logs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Logs da importação selecionada</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[#b8e6b8]">
                {logs.map((entry) => `${entry.at} [${entry.level}] ${entry.phase}: ${entry.message}`).join("\n")}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#030a04] px-4 py-8 text-[#e8ffeb] md:px-8">
      <div className="mx-auto w-full max-w-[1100px] space-y-6">
        <h1 className="text-3xl font-bold text-[#d4ffcc]">Importação em massa — WoW Forever</h1>
        {children}
      </div>
    </main>
  );
}
