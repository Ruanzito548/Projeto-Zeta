import { getAuctionPrice } from "@/lib/blizzard";
import { type NextRequest, NextResponse } from "next/server";

export type TsmBulkResult = {
  name: string;
  price: number;
  ok: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { names: string[] };
    const names: string[] = Array.isArray(body?.names)
      ? body.names.filter((n) => typeof n === "string" && n.trim())
      : [];

    if (names.length === 0) {
      return NextResponse.json({ error: "Nenhum reagente informado." }, { status: 400 });
    }

    // Fetch prices in parallel with a concurrency cap to avoid rate-limiting.
    const CONCURRENCY = 4;
    const results: TsmBulkResult[] = [];

    for (let i = 0; i < names.length; i += CONCURRENCY) {
      const batch = names.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (name): Promise<TsmBulkResult> => {
          try {
            const result = await getAuctionPrice({ itemName: name });
            return { name, price: result.price > 0 ? result.price : 0, ok: result.price > 0 };
          } catch {
            return { name, price: 0, ok: false };
          }
        }),
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao buscar precos." },
      { status: 500 },
    );
  }
}
