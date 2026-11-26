const AUCTIONHOUSE_BASE_URL = "https://auctionhouse.fyi/api/v1";

export type AhMarket = "forever.normal.horde.us" | "forever.normal.alliance.us" | "forever.pvp.horde.us" | "forever.pvp.alliance.us";

export interface AhPriceResponse {
  market: string;
  item: number;
  row: [price: number | null, quantity: number | null, at: number] | null;
  days: Array<[price: number, quantity: number, at: number]>;
  volume: number[];
  now: number;
  live: boolean;
}

export interface AhItemPriceResult {
  itemId: number;
  price: number;
  quantity: number | null;
  lastUpdated: number;
  ok: boolean;
}

const DEFAULT_MARKET: AhMarket = "forever.pvp.horde.us";

export async function fetchItemPricesFromAuctionHouse(
  itemIds: number[],
  market: AhMarket = DEFAULT_MARKET,
): Promise<AhItemPriceResult[]> {
  try {
    const results = await Promise.all(
      itemIds.map((itemId) => fetchSingleItemPrice(itemId, market)),
    );
    return results;
  } catch (error) {
    console.error("Error fetching from AuctionHouse.fyi:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to fetch prices from AuctionHouse.fyi",
    );
  }
}

async function fetchSingleItemPrice(
  itemId: number,
  market: AhMarket,
): Promise<AhItemPriceResult> {
  const url = `${AUCTIONHOUSE_BASE_URL}/ah/${market}/${itemId}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      itemId,
      price: 0,
      quantity: null,
      lastUpdated: Date.now(),
      ok: false,
    };
  }

  const data = (await response.json()) as AhPriceResponse;

  if (!data.row || data.row[0] === null) {
    return {
      itemId,
      price: 0,
      quantity: data.row?.[1] ?? null,
      lastUpdated: data.row?.[2] ?? Date.now(),
      ok: false,
    };
  }

  const [price, quantity, at] = data.row;

  return {
    itemId,
    price,
    quantity,
    lastUpdated: at,
    ok: true,
  };
}

export function convertCopperToGoldSilverCopper(copper: number): string {
  if (copper === 0) return "0c";

  const gold = Math.floor(copper / 10000);
  const remainder = copper % 10000;
  const silver = Math.floor(remainder / 100);
  const copperLeft = remainder % 100;

  const parts = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0) parts.push(`${silver}s`);
  if (copperLeft > 0) parts.push(`${copperLeft}c`);

  return parts.join(" ");
}
