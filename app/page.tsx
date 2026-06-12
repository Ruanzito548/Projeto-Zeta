"use client";

import { useMemo, useState, type ChangeEvent } from "react";
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#172554_0%,#020617_45%,#020617_100%)] p-4 text-slate-100">
      <Toaster richColors position="top-right" />

      <div className="mx-auto max-w-4xl space-y-4">
        <Card className="border-amber-400/25 bg-slate-900/80">
          <CardHeader>
            <CardTitle>Sistema TSM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-300">
              Projeto resetado para manter somente o sistema de puxar dados via TSM local.
            </p>

            <Input
              placeholder="Itens para consulta (um por linha, virgula ou ponto e virgula)"
              value={namesInput}
              onChange={(event) => setNamesInput(event.target.value)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">
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

            <Button onClick={pullFromTsm} disabled={updating}>
              {updating ? "Puxando dados do TSM..." : "Puxar dados do TSM"}
            </Button>

            {status ? <p className="text-sm text-slate-300">{status}</p> : null}
          </CardContent>
        </Card>

        {results.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Resultado da Consulta</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-md border border-slate-700/70">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-900/80 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Item ID</th>
                      <th className="px-3 py-2 text-left">Preco</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.name} className="border-t border-slate-700/60">
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
