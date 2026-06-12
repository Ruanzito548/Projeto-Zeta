import type {
  DisenchantEntry,
  ImportedCraftItem,
  Profession,
  Quality,
  ReagentEntry,
  RecipeComponent,
} from "@/lib/modules/types";
import { guessCommodityByName } from "@/lib/modules/catalog";
import type { WowVersion } from "@/lib/wow/versions";

const qualityById: Record<number, Quality> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

function parseTag(xml: string, tag: string): string {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "is"));
  if (cdata?.[1]) {
    return cdata[1].trim();
  }

  const plain = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, "is"));
  return plain?.[1]?.trim() ?? "";
}

function parseNumberTag(xml: string, tag: string): number {
  const parsed = Number(parseTag(xml, tag));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIcon(xml: string): string {
  const icon = parseTag(xml, "icon").toLowerCase();
  if (!icon) {
    return "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
  }

  return `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
}

function parseQuality(xml: string): Quality {
  const qualityAttr = xml.match(/<quality[^>]*id="(\d+)"/i)?.[1] ?? "1";
  const qualityId = Number(qualityAttr);
  return qualityById[qualityId] ?? "common";
}

function parseRecipe(xml: string): RecipeComponent[] {
  const recipe: RecipeComponent[] = [];

  for (const row of xml.matchAll(/<reagent\b([^>]*)\/>/gi)) {
    const attrs = row[1] ?? "";
    const idRaw = attrs.match(/\bid="(\d+)"/i)?.[1] ?? "";
    const qtyRaw = attrs.match(/\bcount="(\d+)"/i)?.[1] ?? "1";
    const name = attrs.match(/\bname="([^"]+)"/i)?.[1]?.trim() ?? "Unknown reagent";

    const itemId = Number(idRaw);
    const quantity = Number(qtyRaw);

    if (!Number.isFinite(itemId) || itemId <= 0) {
      continue;
    }

    recipe.push({
      itemId,
      name,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      icon: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg",
    });
  }

  return recipe;
}

function parseProducedQuantity(xml: string): number {
  const raw = xml.match(/<spell[^>]*maxCount="(\d+)"/i)?.[1] ?? "1";
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseProfession(xml: string): Profession {
  const raw = xml.match(/<spell[^>]*skill="([^"]+)"/i)?.[1]?.trim();
  const allowed: Profession[] = [
    "Alchemy",
    "Blacksmithing",
    "Enchanting",
    "Engineering",
    "Inscription",
    "Jewelcrafting",
    "Leatherworking",
    "Tailoring",
    "Cooking",
    "Other",
  ];

  if (raw && allowed.includes(raw as Profession)) {
    return raw as Profession;
  }

  return "Other";
}

function parseItemIdFromQuery(query: string): number | null {
  const trimmed = query.trim();

  if (!trimmed) {
    return null;
  }

  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const byUrl = trimmed.match(/item=(\d+)/i)?.[1];
  if (!byUrl) {
    return null;
  }

  const id = Number(byUrl);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function buildWowheadRoot(version: WowVersion): string {
  if (version === "tbc" || version === "ascension") {
    return "https://www.wowhead.com/tbc";
  }

  return "https://www.wowhead.com";
}

function extractJsonArray(source: string, startIndex: number): string | null {
  const openIndex = source.indexOf("[", startIndex);
  if (openIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

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
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  return null;
}

function parseDisenchant(html: string): DisenchantEntry[] {
  const marker = "id: 'disenchanting'";
  const markerIndex = html.indexOf(marker);

  if (markerIndex < 0) {
    return [];
  }

  const dataIndex = html.indexOf("data:", markerIndex);

  if (dataIndex < 0) {
    return [];
  }

  const rawJson = extractJsonArray(html, dataIndex);
  if (!rawJson) {
    return [];
  }

  try {
    const rows = JSON.parse(rawJson) as Array<{
      id: number;
      name: string;
      icon?: string;
      count?: number;
      outof?: number;
      stack?: number[];
    }>;

    return rows
      .filter((row) => Number.isFinite(row.id) && typeof row.name === "string")
      .map((row) => {
        const min = Array.isArray(row.stack) ? Number(row.stack[0] ?? 1) : 1;
        const max = Array.isArray(row.stack) ? Number(row.stack[1] ?? min) : min;
        const chance = row.outof && row.outof > 0 ? Number(row.count ?? 0) / row.outof : 0;

        return {
          itemId: row.id,
          name: row.name,
          icon: row.icon
            ? `https://wow.zamimg.com/images/wow/icons/large/${row.icon}.jpg`
            : "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg",
          min: Number.isFinite(min) && min > 0 ? min : 1,
          max: Number.isFinite(max) && max > 0 ? max : 1,
          chance: Number.isFinite(chance) && chance > 0 ? chance : 0,
        };
      });
  } catch {
    return [];
  }
}

async function fetchWowheadXml(itemId: number, version: WowVersion): Promise<string> {
  const root = buildWowheadRoot(version);
  const response = await fetch(`${root}/item=${itemId}&xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Nao foi possivel importar o item ${itemId} via Wowhead.`);
  }

  return response.text();
}

async function fetchWowheadHtml(itemId: number, version: WowVersion): Promise<string> {
  const root = buildWowheadRoot(version);
  const response = await fetch(`${root}/item=${itemId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    return "";
  }

  return response.text();
}

function buildSourceLabel(recipe: RecipeComponent[]): string {
  if (recipe.length === 0) {
    return "Drop, coleta ou recompensa (Wowhead).";
  }

  const parts = recipe.map((entry) => `${entry.quantity}x ${entry.name}`).join(", ");
  return `Craftado por receita: ${parts}.`;
}

export async function getWowheadItemIdFromInput(query: string): Promise<number> {
  const id = parseItemIdFromQuery(query);

  if (!id) {
    throw new Error("Informe URL do Wowhead ou Item ID valido.");
  }

  return id;
}

export async function importReagentFromWowhead(itemId: number, version: WowVersion): Promise<ReagentEntry> {
  const xml = await fetchWowheadXml(itemId, version);
  const recipe = parseRecipe(xml);
  const name = parseTag(xml, "name") || `Item ${itemId}`;

  return {
    itemId,
    name,
    icon: parseIcon(xml),
    quality: parseQuality(xml),
    wowheadUrl: `${buildWowheadRoot(version)}/item=${itemId}`,
    source: buildSourceLabel(recipe),
    tsmPrice: 0,
    calculatedPrice: null,
    recipe,
    updatedAt: new Date().toISOString(),
  };
}

export async function importCraftItemFromWowhead(
  query: string,
  version: WowVersion,
): Promise<ImportedCraftItem> {
  const itemId = await getWowheadItemIdFromInput(query);
  const [xml, html] = await Promise.all([
    fetchWowheadXml(itemId, version),
    fetchWowheadHtml(itemId, version),
  ]);

  const name = parseTag(xml, "name") || `Item ${itemId}`;
  const icon = parseIcon(xml);
  const recipe = parseRecipe(xml);

  return {
    itemId,
    wowheadUrl: `${buildWowheadRoot(version)}/item=${itemId}`,
    name,
    icon,
    quality: parseQuality(xml),
    profession: parseProfession(xml),
    quantityProduced: parseProducedQuantity(xml),
    recipe,
    disenchant: parseDisenchant(html),
    auctionPrice: 0,
    vendorPrice: parseNumberTag(xml, "sellprice"),
    isCommodity: guessCommodityByName(name),
    updatedAt: new Date().toISOString(),
  };
}
