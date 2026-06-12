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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#14100a_0%,#0d1425_45%,#04070d_100%)] px-3 py-5 text-slate-100 md:px-6 md:py-7">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Card className="overflow-hidden">
          <CardHeader className={`bg-gradient-to-r ${meta.accent}`}>
            <CardTitle>{meta.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-sm text-slate-300">{meta.description}</p>
          </CardContent>
        </Card>

        <WowVersionWorkspace version={version} />
      </div>
    </main>
  );
}
