import { VERSION_REAGENT_SEEDS } from "@/lib/modules/catalog";
import { importReagentFromWowhead } from "@/lib/modules/wowhead-service";
import { isWowVersion } from "@/lib/wow/versions";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version")?.trim() ?? "";

  if (!isWowVersion(version)) {
    return NextResponse.json({ error: "Versao invalida." }, { status: 400 });
  }

  const ids = VERSION_REAGENT_SEEDS[version];

  try {
    const reagents = await Promise.all(ids.map((itemId) => importReagentFromWowhead(itemId, version)));
    return NextResponse.json({ reagents });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao importar reagentes via Wowhead.",
      },
      { status: 500 },
    );
  }
}
