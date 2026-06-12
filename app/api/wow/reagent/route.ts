import { importReagentFromWowhead } from "@/lib/modules/wowhead-service";
import { isWowVersion } from "@/lib/wow/versions";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version")?.trim() ?? "";
  const itemIdRaw = request.nextUrl.searchParams.get("itemId")?.trim() ?? "";

  if (!isWowVersion(version)) {
    return NextResponse.json({ error: "Versao invalida." }, { status: 400 });
  }

  const itemId = Number(itemIdRaw);

  if (!Number.isFinite(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "Item ID invalido." }, { status: 400 });
  }

  try {
    const reagent = await importReagentFromWowhead(itemId, version);
    return NextResponse.json({ reagent });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao importar reagente.",
      },
      { status: 500 },
    );
  }
}
