import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WOW_VERSIONS } from "@/lib/wow/versions";

export default function Page() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(16,185,129,0.2),transparent_33%),radial-gradient(circle_at_90%_8%,rgba(14,116,144,0.23),transparent_36%),linear-gradient(180deg,#020407_0%,#030a0f_45%,#02050a_100%)] px-4 py-8 text-slate-100 md:px-8 md:py-10">
      <Toaster richColors position="top-right" />

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <header className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-[linear-gradient(145deg,rgba(6,18,20,0.94),rgba(4,11,18,0.96))] p-7 shadow-[0_0_0_1px_rgba(16,185,129,0.15)_inset,0_24px_60px_rgba(0,0,0,0.45)] md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.2),transparent_45%),radial-gradient(circle_at_85%_18%,rgba(14,116,144,0.25),transparent_40%)]" />
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">LootMaster Core</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-emerald-50 md:text-5xl">Hub de Versoes do World of Warcraft</h1>
            <p className="mt-4 max-w-4xl text-sm text-slate-300 md:text-lg">
              Entre em workspaces independentes para analise de economia, com dashboard financeiro, importacao de itens e catalogo de reagentes em uma experiencia premium.
            </p>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          {WOW_VERSIONS.map((version) => (
            <Card key={version.id} className="group overflow-hidden border-emerald-500/25 transition duration-300 hover:-translate-y-1 hover:border-emerald-400/45 hover:shadow-[0_0_0_1px_rgba(52,211,153,0.25)_inset,0_30px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className={`border-b border-emerald-500/20 bg-[linear-gradient(145deg,rgba(5,15,18,0.92),rgba(4,11,17,0.95))] ${version.accent}`}>
                <div className="flex items-center gap-4">
                  <img src={version.logo} alt={version.shortName} className="h-12 w-12 rounded-xl border border-emerald-400/35 object-cover shadow-[0_0_24px_rgba(16,185,129,0.25)]" />
                  <div>
                    <CardTitle className="text-xl">{version.name}</CardTitle>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-emerald-200/90">{version.shortName}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <p className="text-sm leading-relaxed text-slate-300">{version.description}</p>

                <Link href={`/wow/${version.id}`}>
                  <Button className="w-full justify-between">
                    Entrar no Workspace
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
