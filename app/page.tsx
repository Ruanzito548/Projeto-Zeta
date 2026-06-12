import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WOW_VERSIONS } from "@/lib/wow/versions";

export default function Page() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,rgba(34,197,94,0.12),transparent_40%),radial-gradient(ellipse_at_bottom_right,rgba(22,163,74,0.08),transparent_40%),#000000] px-4 py-8 text-green-100 md:px-8 md:py-10">
      <Toaster richColors position="top-right" />

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <header className="relative overflow-hidden rounded-3xl border border-green-500/40 bg-[linear-gradient(145deg,rgba(0,10,4,0.98),rgba(0,6,2,0.99))] p-7 shadow-[0_0_0_1px_rgba(34,197,94,0.2)_inset,0_0_60px_rgba(34,197,94,0.08),0_24px_60px_rgba(0,0,0,0.8)] md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(34,197,94,0.18),transparent_45%),radial-gradient(circle_at_88%_10%,rgba(22,163,74,0.12),transparent_40%)]" />
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.3em] text-green-400">LootMaster Core</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-green-50 md:text-5xl">Hub de Versoes do World of Warcraft</h1>
            <p className="mt-4 max-w-4xl text-sm text-green-200/70 md:text-lg">
              Entre em workspaces independentes para analise de economia, com dashboard financeiro, importacao de itens e catalogo de reagentes em uma experiencia premium.
            </p>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          {WOW_VERSIONS.map((version) => (
            <Card key={version.id} className="group overflow-hidden border-green-500/30 bg-[linear-gradient(145deg,rgba(0,8,3,0.98),rgba(0,4,2,0.99))] transition duration-300 hover:-translate-y-1 hover:border-green-400/55 hover:shadow-[0_0_0_1px_rgba(34,197,94,0.3)_inset,0_0_35px_rgba(34,197,94,0.1),0_30px_60px_rgba(0,0,0,0.7)]">
              <CardHeader className="border-b border-green-500/25 bg-[linear-gradient(145deg,rgba(0,12,5,0.98),rgba(0,7,3,0.99))]">
                <div className="flex items-center gap-4">
                  <img src={version.logo} alt={version.shortName} className="h-12 w-12 rounded-xl border border-green-400/40 object-cover shadow-[0_0_24px_rgba(34,197,94,0.3)]" />
                  <div>
                    <CardTitle className="text-xl text-green-50">{version.name}</CardTitle>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-green-400/80">{version.shortName}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <p className="text-sm leading-relaxed text-green-200/65">{version.description}</p>

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
