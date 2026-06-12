"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { Activity, Database, Sparkles } from "lucide-react";
import { Toaster, toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TsmResult = {
  name: string;
  itemId: number | null;
  price: number;
  ok: boolean;
};

export default function Page() {
  const [namesInput, setNamesInput] = useState("");
  const [appDataContent, setAppDataContent] = useState("");
  const [appDataFileName, setAppDataFileName] = useState("");
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<TsmResult[]>([]);

  const parsedNames = useMemo(() => {
    return namesInput
      .split(/\r?\n|,|;/)
      .map((value) => value.trim())
      .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
  }, [namesInput]);

  async function onSelectTsmAppData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setAppDataContent(content);
      setAppDataFileName(file.name);
      setStatus(`Arquivo carregado: ${file.name}`);
      toast.success("AppData.lua carregado.");
    } catch {
      toast.error("Nao foi possivel ler o arquivo AppData.lua.");
    }
  }

  async function pullFromTsm() {
    if (parsedNames.length === 0) {
      toast.error("Informe ao menos 1 item para consulta no TSM.");
      return;
    }

    setUpdating(true);
    setStatus("Lendo dados do TSM local...");

    try {
      const res = await fetch("/tsm-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          names: parsedNames,
          appDataContent: appDataContent.trim() ? appDataContent : undefined,
        }),
      });

      const data = (await res.json()) as {
        results?: TsmResult[];
        sourcePath?: string;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? "Erro ao consultar TSM local.");
      }

      const rows = data.results ?? [];
      setResults(rows);

      const okCount = rows.filter((row) => row.ok && row.price > 0).length;
      const suffix = data.sourcePath ? ` (${data.sourcePath})` : "";
      setStatus(`${okCount} de ${rows.length} itens com preco encontrado${suffix}.`);
      toast.success("Consulta TSM finalizada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao consultar TSM.";
      setStatus(message);
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#0d1b13_0%,#060b14_45%,#04070d_100%)] text-slate-100">
      <Toaster richColors position="top-right" />

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 md:px-6 md:py-6">
        <header className="rounded-xl border border-emerald-400/20 bg-slate-900/75 px-4 py-3 shadow-[0_0_0_1px_rgba(52,211,153,0.08),0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/80">LootMaster</p>
              <h1 className="text-2xl font-semibold text-emerald-100">Sistema TSM</h1>
              <p className="text-sm text-slate-300">Consulta de preco local com o mesmo visual da plataforma.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-500/15">
                <Sparkles className="h-3.5 w-3.5" /> Premium UI
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-slate-950/60 px-3 py-1 text-xs text-slate-300 transition hover:border-emerald-300/35 hover:text-emerald-200">
                <Database className="h-3.5 w-3.5" /> TSM Data
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-slate-950/60 px-3 py-1 text-xs text-slate-300 transition hover:border-emerald-300/35 hover:text-emerald-200">
                <Activity className="h-3.5 w-3.5" /> Live Status
              </span>
            </div>
          </div>
        </header>

        <Card className="rounded-xl border border-emerald-400/20 bg-[linear-gradient(150deg,rgba(15,23,42,0.92),rgba(2,8,23,0.94))] shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_18px_40px_rgba(0,0,0,0.4)]">
          <CardHeader>
            <CardTitle className="text-emerald-100">Sistema TSM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-300">
              Projeto resetado para manter somente o sistema de puxar dados via TSM local.
            </p>

            <Input
              className="border-emerald-400/25 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-emerald-400/45"
              placeholder="Itens para consulta (um por linha, virgula ou ponto e virgula)"
              value={namesInput}
              onChange={(event) => setNamesInput(event.target.value)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-md border border-emerald-400/25 bg-slate-950/50 px-2 py-1 text-xs text-emerald-100 transition hover:border-emerald-300/45 hover:bg-emerald-500/10">
                Enviar AppData.lua
                <input
                  type="file"
                  accept=".lua,text/plain"
                  className="hidden"
                  onChange={onSelectTsmAppData}
                />
              </label>

              {appDataFileName ? (
                <span className="text-xs text-emerald-300">Arquivo: {appDataFileName}</span>
              ) : (
                <span className="text-xs text-slate-500">Opcional: enviar AppData.lua manualmente.</span>
              )}
            </div>

            <Button
              className="border border-emerald-300/40 bg-emerald-500 text-slate-950 shadow-[0_0_0_1px_rgba(16,185,129,0.1)] transition hover:bg-emerald-400"
              onClick={pullFromTsm}
              disabled={updating}
            >
              {updating ? "Puxando dados do TSM..." : "Puxar dados do TSM"}
            </Button>

            {status ? <p className="text-sm text-emerald-100/90">{status}</p> : null}
          </CardContent>
        </Card>

        {results.length > 0 ? (
          <Card className="rounded-xl border border-emerald-400/20 bg-[linear-gradient(160deg,rgba(15,23,42,0.88),rgba(2,8,23,0.94))] shadow-[0_0_0_1px_rgba(52,211,153,0.06),0_14px_34px_rgba(0,0,0,0.35)]">
            <CardHeader>
              <CardTitle className="text-emerald-100">Resultado da Consulta</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-md border border-emerald-400/15">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-900/90 text-emerald-100/90">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Item ID</th>
                      <th className="px-3 py-2 text-left">Preco</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.name} className="border-t border-emerald-400/10 transition hover:bg-emerald-500/5">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2">{row.itemId ?? "-"}</td>
                        <td className="px-3 py-2">{row.price}</td>
                        <td className="px-3 py-2">
                          <span className={row.ok ? "text-emerald-300" : "text-rose-300"}>
                            {row.ok ? "OK" : "Nao encontrado"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
