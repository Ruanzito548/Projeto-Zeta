import { importCraftItemFromWowhead } from "@/lib/modules/wowhead-service";
import { isWowVersion } from "@/lib/wow/versions";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { version?: string; query?: string }
    | null;

  const version = body?.version?.trim() ?? "";
  const query = body?.query?.trim() ?? "";

  if (!isWowVersion(version)) {
    return NextResponse.json({ error: "Versao invalida." }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ error: "Informe URL do Wowhead ou Item ID." }, { status: 400 });
  }

  try {
    const item = await importCraftItemFromWowhead(query, version);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao importar item via Wowhead.",
      },
      { status: 500 },
    );
  }
}
