import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WOW_VERSIONS } from "@/lib/wow/versions";

export default function Page() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_4%,#2a2110_0%,#12192c_38%,#070c18_100%)] px-3 py-6 text-slate-100 md:px-6 md:py-9">
      <Toaster richColors position="top-right" />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-2xl border border-amber-500/25 bg-slate-900/70 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.26em] text-amber-300">LootMaster Core</p>
          <h1 className="mt-2 text-3xl font-semibold text-amber-100 md:text-4xl">Hub de Versoes do World of Warcraft</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
            Selecione uma versao para entrar em um sistema independente, com modulos de Dashboard,
            Importar Item e Reagentes preparados para escalar sem refatoracao estrutural.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {WOW_VERSIONS.map((version) => (
            <Card key={version.id} className="overflow-hidden transition hover:-translate-y-0.5 hover:border-amber-400/35">
              <CardHeader className={`bg-gradient-to-r ${version.accent}`}>
                <div className="flex items-center gap-3">
                  <img src={version.logo} alt={version.shortName} className="h-10 w-10 rounded-md border border-amber-300/30" />
                  <div>
                    <CardTitle>{version.name}</CardTitle>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-amber-200/90">{version.shortName}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <p className="text-sm text-slate-300">{version.description}</p>

                <Link href={`/wow/${version.id}`}>
                  <Button className="w-full justify-between">
                    Entrar
                    <ChevronRight className="h-4 w-4" />
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
