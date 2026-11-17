import { getWowheadItemIdFromInput, importReagentFromWowhead } from "@/lib/modules/wowhead-service";
import { fetchItemPricesFromAuctionHouse } from "@/lib/modules/auctionhouse-service";
import { isWowVersion } from "@/lib/wow/versions";
import { NextResponse, type NextRequest } from "next/server";

async function addAuctionHousePrice<T extends { itemId: number; tsmPrice: number; ahPrice: number }>(
  reagent: T,
  version: string,
): Promise<T> {
  if (version !== "forever") {
    return reagent;
  }

  const [price] = await fetchItemPricesFromAuctionHouse([reagent.itemId]);
  if (!price?.ok) {
    return reagent;
  }

  return {
    ...reagent,
    tsmPrice: price.price,
    ahPrice: price.price,
  };
}

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
    const imported = await importReagentFromWowhead(itemId, version);
    const reagent = await addAuctionHousePrice(imported, version);
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { version?: string; query?: string };
    const version = body.version?.trim() ?? "";
    const query = body.query?.trim() ?? "";

    if (!isWowVersion(version)) {
      return NextResponse.json({ error: "Versao invalida." }, { status: 400 });
    }

    const itemId = await getWowheadItemIdFromInput(query);
    const imported = await importReagentFromWowhead(itemId, version);
    const reagent = await addAuctionHousePrice(imported, version);
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
