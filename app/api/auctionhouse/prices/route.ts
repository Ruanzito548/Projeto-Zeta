import { fetchItemPricesFromAuctionHouse } from "@/lib/modules/auctionhouse-service";
import { isWowVersion } from "@/lib/wow/versions";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version")?.trim() ?? "";
  const itemIds = request.nextUrl.searchParams.get("items")?.split(",") ?? [];

  if (!isWowVersion(version)) {
    return NextResponse.json({ error: "Versao invalida." }, { status: 400 });
  }

  if (version !== "forever") {
    return NextResponse.json(
      { error: "AuctionHouse.fyi esta disponivel apenas para WoW Forever." },
      { status: 400 },
    );
  }

  if (!itemIds || itemIds.length === 0) {
    return NextResponse.json(
      { error: "Nenhum item foi fornecido." },
      { status: 400 },
    );
  }

  try {
    const parsedIds = itemIds
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id));

    if (parsedIds.length === 0) {
      return NextResponse.json(
        { error: "IDs de item invalidos." },
        { status: 400 },
      );
    }

    const prices = await fetchItemPricesFromAuctionHouse(parsedIds);
    
    return NextResponse.json({ 
      results: prices.map((p) => ({
        name: "", // AuctionHouse.fyi doesn't provide names
        itemId: p.itemId,
        price: p.price,
        ok: p.ok,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao buscar precos no AuctionHouse.fyi.",
      },
      { status: 500 },
    );
  }
}
