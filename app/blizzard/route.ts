import { getAuctionPrice } from "@/lib/blizzard";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const itemIdParam = req.nextUrl.searchParams.get("itemId");
    const itemName = req.nextUrl.searchParams.get("itemName")?.trim();
    const house = req.nextUrl.searchParams.get("house")?.trim();

    if (!itemIdParam && !itemName) {
      return NextResponse.json(
        { error: "Missing itemId or itemName" },
        { status: 400 }
      );
    }

    const itemId = itemIdParam ? Number(itemIdParam) : undefined;

    if (itemIdParam && Number.isNaN(itemId)) {
      return NextResponse.json({ error: "Invalid itemId" }, { status: 400 });
    }

    const result = await getAuctionPrice({ itemId, itemName, house });
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "API error",
        region: process.env.BLIZZARD_REGION ?? "us",
        dynamicNamespace:
          process.env.BLIZZARD_DYNAMIC_NAMESPACE ?? "dynamic-classicann-us",
        connectedRealmId:
          process.env.BLIZZARD_CONNECTED_REALM_ID ?? "6065",
      },
      { status: 500 }
    );
  }
}
