import { notFound } from "next/navigation";

import { WowVersionWorkspace } from "@/components/wow/version-workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isWowVersion, WOW_VERSION_MAP } from "@/lib/wow/versions";

export default async function WowVersionPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const resolved = await params;

  if (!isWowVersion(resolved.version)) {
    notFound();
  }

  const version = resolved.version;
  const meta = WOW_VERSION_MAP[version];

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,rgba(34,197,94,0.12),transparent_40%),radial-gradient(ellipse_at_bottom_right,rgba(22,163,74,0.07),transparent_40%),#000000] px-4 py-8 text-green-100 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <Card className="overflow-hidden border-emerald-400/30">
          <CardHeader className="relative overflow-hidden border-b border-green-500/30 bg-[linear-gradient(145deg,rgba(0,10,4,0.98),rgba(0,6,2,0.99))] p-0">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.22),transparent_50%),radial-gradient(circle_at_85%_15%,rgba(22,163,74,0.15),transparent_40%)]" />
            <div className="relative flex flex-col gap-6 p-7 md:flex-row md:items-center md:justify-between md:p-10">
              <div className="flex items-start gap-5">
                <img
                  src={meta.logo}
                  alt={meta.shortName}
                  className="h-16 w-16 rounded-2xl border border-emerald-400/40 object-cover shadow-[0_0_30px_rgba(16,185,129,0.28)] md:h-20 md:w-20"
                />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.32em] text-green-400">MMO Vault Hub</p>
                  <CardTitle className="text-3xl font-bold leading-tight text-green-50 md:text-4xl">{meta.name}</CardTitle>
                  <p className="max-w-3xl text-sm text-green-200/65 md:text-base">{meta.description}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-green-300 shadow-[0_0_20px_rgba(34,197,94,0.12)]">
                  Workspace Premium
                </div>
                <div className="rounded-xl border border-green-400/30 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-green-400">
                  {meta.shortName}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4 border-t border-green-500/20 bg-[linear-gradient(180deg,rgba(0,6,2,0.95),rgba(0,4,1,0.9))] pt-6 text-sm text-green-200/60 md:grid-cols-3">
            <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              Analise de craft, reagentes e disenchant em uma interface orientada a margem.
            </div>
            <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              Operacoes locais com cache rapido e sincronizacao em nuvem para continuidade.
            </div>
            <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              Modulos independentes para evoluir novas features sem alterar o core do sistema.
            </div>
          </CardContent>
        </Card>

        <WowVersionWorkspace version={version} />
      </div>
    </main>
  );
}
