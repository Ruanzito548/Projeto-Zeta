import { getAuctionPrice } from "@/lib/blizzard";
import { type NextRequest, NextResponse } from "next/server";

type WowheadDisenchantRow = {
  id: number;
  name: string;
  count?: number;
  outof?: number;
  stack?: number[];
};

type ImportPayload = {
  itemId: number;
  itemName: string;
  iconUrl: string;
  quantityPerCraft: number;
  reagents: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    iconUrl: string;
  }>;
  disenchantTable: Array<{
    materialName: string;
    chancePercent: number;
    minQuantity: number;
    maxQuantity: number;
    materialPrice: number;
    iconUrl: string;
  }>;
};

function parseItemId(query: string): number | null {
  const trimmed = query.trim();

  if (!trimmed) {
    return null;
  }

  const direct = Number(trimmed);

  if (!Number.isNaN(direct) && direct > 0) {
    return direct;
  }

  const urlMatch = trimmed.match(/item=(\d+)/i);

  if (urlMatch?.[1]) {
    return Number(urlMatch[1]);
  }

  return null;
}

function extractXmlTag(content: string, tagName: string): string {
  const match = content.match(new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[(.*?)\\]\\]><\\/${tagName}>`, "is"));
  return match?.[1]?.trim() ?? "";
}

function extractIconName(xml: string): string {
  const match = xml.match(/<icon[^>]*>([^<]+)<\/icon>/i);
  return match?.[1]?.trim() ?? "";
}

function extractQuantityPerCraft(xml: string): number {
  const match = xml.match(/<spell[^>]*minCount="(\d+)"[^>]*maxCount="(\d+)"/i);

  if (!match) {
    return 1;
  }

  const maxCount = Number(match[2]);
  return Number.isFinite(maxCount) && maxCount > 0 ? maxCount : 1;
}

function extractReagents(xml: string) {
  const reagentRegex = /<reagent\b([^>]*)\/>/gi;
  const reagents: Array<{ name: string; quantity: number; itemId: number | null }> = [];

  for (const match of xml.matchAll(reagentRegex)) {
    const attrs = match[1] ?? "";
    const name = attrs.match(/\bname="([^"]+)"/i)?.[1]?.trim() ?? "";
    const countRaw = attrs.match(/\bcount="(\d+)"/i)?.[1] ?? "1";
    const itemIdRaw = attrs.match(/\bid="(\d+)"/i)?.[1] ?? "";

    if (!name) {
      continue;
    }

    const quantity = Number(countRaw);
    const itemId = Number(itemIdRaw);

    reagents.push({
      name,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      itemId: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
    });
  }

  return reagents;
}

const iconCache = new Map<number, Promise<string>>();

async function getWowheadIconByItemId(itemId: number): Promise<string> {
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return "";
  }

  const cached = iconCache.get(itemId);

  if (cached) {
    return cached;
  }

  const task = (async () => {
    try {
      let xml = "";

      const tbcRes = await fetch(`https://www.wowhead.com/tbc/item=${itemId}&xml`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });

      if (tbcRes.ok) {
        xml = await tbcRes.text();
      } else {
        const genericRes = await fetch(`https://www.wowhead.com/item=${itemId}&xml`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
        });

        if (genericRes.ok) {
          xml = await genericRes.text();
        }
      }

      const iconName = extractIconName(xml).toLowerCase();

      if (!iconName) {
        return "";
      }

      return `https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`;
    } catch {
      return "";
    }
  })();

  iconCache.set(itemId, task);
  return task;
}

function extractJsonArray(source: string, startIndex: number): string | null {
  const openIndex = source.indexOf("[", startIndex);

  if (openIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }

  return null;
}

function extractDisenchantData(html: string): WowheadDisenchantRow[] {
  const listViewId = "id: 'disenchanting'";
  const listViewIndex = html.indexOf(listViewId);

  if (listViewIndex < 0) {
    return [];
  }

  const dataIndex = html.indexOf("data:", listViewIndex);

  if (dataIndex < 0) {
    return [];
  }

  const arrayRaw = extractJsonArray(html, dataIndex);

  if (!arrayRaw) {
    return [];
  }

  try {
    const parsed = JSON.parse(arrayRaw) as WowheadDisenchantRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getMarketPriceByName(itemName: string): Promise<number> {
  try {
    const result = await getAuctionPrice({ itemName });
    return Number.isFinite(result.price) && result.price > 0 ? result.price : 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("query")?.trim() ?? "";

    if (!query) {
      return NextResponse.json({ error: "Informe um ID ou URL do item no Wowhead." }, { status: 400 });
    }

    const itemId = parseItemId(query);

    if (!itemId) {
      return NextResponse.json(
        {
          error:
            "Nao foi possivel identificar o item. Use ID numerico (ex: 6238) ou URL Wowhead (ex: https://www.wowhead.com/tbc/item=6238).",
        },
        { status: 400 },
      );
    }

    // Prefer TBC dataset to avoid reagent mismatches from other expansions.
    let xml = "";
    let html = "";

    const [xmlTbcRes, htmlTbcRes] = await Promise.all([
      fetch(`https://www.wowhead.com/tbc/item=${itemId}&xml`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      }),
      fetch(`https://www.wowhead.com/tbc/item=${itemId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      }),
    ]);

    if (xmlTbcRes.ok) {
      xml = await xmlTbcRes.text();
      html = htmlTbcRes.ok ? await htmlTbcRes.text() : "";
    } else {
      const [xmlGenericRes, htmlGenericRes] = await Promise.all([
        fetch(`https://www.wowhead.com/item=${itemId}&xml`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
        }),
        fetch(`https://www.wowhead.com/item=${itemId}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
        }),
      ]);

      if (!xmlGenericRes.ok) {
        return NextResponse.json({ error: "Falha ao buscar XML no Wowhead." }, { status: 502 });
      }

      xml = await xmlGenericRes.text();
      html = htmlGenericRes.ok ? await htmlGenericRes.text() : "";
    }

    const itemName = extractXmlTag(xml, "name");
    const iconName = extractIconName(xml);
    const quantityPerCraft = extractQuantityPerCraft(xml);
    const reagentsRaw = extractReagents(xml);
    const deRaw = extractDisenchantData(html);

    const [reagents, disenchantTable] = await Promise.all([
      Promise.all(
        reagentsRaw.map(async (row) => ({
          name: row.name,
          quantity: row.quantity,
          unitPrice: await getMarketPriceByName(row.name),
          iconUrl: row.itemId ? await getWowheadIconByItemId(row.itemId) : "",
        })),
      ),
      Promise.all(
        deRaw.map(async (row) => {
          const outOf = Number(row.outof ?? 0);
          const count = Number(row.count ?? 0);
          const chancePercentRaw = outOf > 0 ? (count / outOf) * 100 : 0;
          const chancePercent = Math.round(chancePercentRaw);
          const stack = Array.isArray(row.stack) ? row.stack : [1, 1];
          const minQuantity = Math.max(1, Number(stack[0] ?? 1));
          const maxQuantity = Math.max(minQuantity, Number(stack[1] ?? minQuantity));

          return {
            materialName: row.name,
            chancePercent,
            minQuantity,
            maxQuantity,
            materialPrice: await getMarketPriceByName(row.name),
            iconUrl: await getWowheadIconByItemId(row.id),
          };
        }),
      ),
    ]);

    const payload: ImportPayload = {
      itemId,
      itemName,
      iconUrl: iconName
        ? `https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`
        : "",
      quantityPerCraft,
      reagents,
      disenchantTable,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao importar dados do Wowhead.",
      },
      { status: 500 },
    );
  }
}
