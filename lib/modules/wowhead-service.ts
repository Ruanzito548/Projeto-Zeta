import type {
  DisenchantEntry,
  ImportedCraftItem,
  Profession,
  Quality,
  ReagentEntry,
  RecipeComponent,
} from "@/lib/modules/types";
import { guessCommodityByName } from "@/lib/modules/catalog";
import { getWowheadItemUrl, getWowheadRoot, type WowVersion } from "@/lib/wow/versions";

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

function parseSellPriceFromTooltip(htmlTooltip: string): number {
  if (!htmlTooltip) {
    return 0;
  }

  const gold = Number(htmlTooltip.match(/class="moneygold">(\d+)</i)?.[1] ?? "0");
  const silver = Number(htmlTooltip.match(/class="moneysilver">(\d+)</i)?.[1] ?? "0");
  const copper = Number(htmlTooltip.match(/class="moneycopper">(\d+)</i)?.[1] ?? "0");

  const total = (Number.isFinite(gold) ? gold : 0) * 10000
    + (Number.isFinite(silver) ? silver : 0) * 100
    + (Number.isFinite(copper) ? copper : 0);

  return total > 0 ? total : 0;
}

function parseSellPrice(xml: string): number {
  const direct = parseNumberTag(xml, "sellprice");
  if (direct > 0) {
    return direct;
  }

  const jsonEquip = parseTag(xml, "jsonEquip");
  const jsonMatch = Number(jsonEquip.match(/"sellprice":(\d+)/i)?.[1] ?? "0");
  if (Number.isFinite(jsonMatch) && jsonMatch > 0) {
    return jsonMatch;
  }

  const htmlTooltip = parseTag(xml, "htmlTooltip");
  return parseSellPriceFromTooltip(htmlTooltip);
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

function parsePrimaryCreatedBySpell(xml: string): string {
  const createdBySection = xml.match(/<createdBy\b[^>]*>([\s\S]*?)<\/createdBy>/i)?.[1] ?? "";
  const scope = createdBySection || xml;

  const spellMatches = Array.from(scope.matchAll(/<spell\b[^>]*>[\s\S]*?<\/spell>/gi));

  for (const match of spellMatches) {
    const spellXml = match[0] ?? "";
    if (/<reagent\b[^>]*\/>/i.test(spellXml)) {
      return spellXml;
    }
  }

  return spellMatches[0]?.[0] ?? "";
}

function parseRecipe(xml: string): RecipeComponent[] {
  const recipe: RecipeComponent[] = [];
  const recipeScope = parsePrimaryCreatedBySpell(xml) || xml;

  for (const row of recipeScope.matchAll(/<reagent\b([^>]*)\/>/gi)) {
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
  const spellXml = parsePrimaryCreatedBySpell(xml);
  const raw = spellXml.match(/<spell[^>]*maxCount="(\d+)"/i)?.[1]
    ?? xml.match(/<spell[^>]*maxCount="(\d+)"/i)?.[1]
    ?? "1";
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseProfession(xml: string): Profession {
  const spellXml = parsePrimaryCreatedBySpell(xml);
  const raw = spellXml.match(/<spell[^>]*skill="([^"]+)"/i)?.[1]?.trim()
    ?? xml.match(/<spell[^>]*skill="([^"]+)"/i)?.[1]?.trim();
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

        const rawIcon = row.icon?.trim().toLowerCase();

        return {
          itemId: row.id,
          name: row.name,
          icon: rawIcon
            ? `https://wow.zamimg.com/images/wow/icons/large/${rawIcon}.jpg`
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

type EstimatedDisenchantMaterial = Omit<DisenchantEntry, "icon">;

const uncommonArmorDisenchantBands: Array<{
  minLevel: number;
  maxLevel: number;
  materials: EstimatedDisenchantMaterial[];
}> = [
  {
    minLevel: 5,
    maxLevel: 15,
    materials: [
      { itemId: 10940, name: "Strange Dust", chance: 0.8, min: 1, max: 2 },
      { itemId: 10938, name: "Lesser Magic Essence", chance: 0.2, min: 1, max: 2 },
    ],
  },
  {
    minLevel: 16,
    maxLevel: 20,
    materials: [
      { itemId: 10940, name: "Strange Dust", chance: 0.75, min: 2, max: 3 },
      { itemId: 10939, name: "Greater Magic Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 10978, name: "Small Glimmering Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 21,
    maxLevel: 25,
    materials: [
      { itemId: 10940, name: "Strange Dust", chance: 0.75, min: 4, max: 6 },
      { itemId: 10998, name: "Lesser Astral Essence", chance: 0.15, min: 1, max: 2 },
      { itemId: 10978, name: "Small Glimmering Shard", chance: 0.1, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 26,
    maxLevel: 30,
    materials: [
      { itemId: 11083, name: "Soul Dust", chance: 0.75, min: 1, max: 2 },
      { itemId: 11082, name: "Greater Astral Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 11084, name: "Large Glimmering Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 31,
    maxLevel: 35,
    materials: [
      { itemId: 11083, name: "Soul Dust", chance: 0.75, min: 2, max: 5 },
      { itemId: 11134, name: "Lesser Mystic Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 11086, name: "Small Glowing Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 36,
    maxLevel: 40,
    materials: [
      { itemId: 11137, name: "Vision Dust", chance: 0.75, min: 1, max: 2 },
      { itemId: 11135, name: "Greater Mystic Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 11139, name: "Large Glowing Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 41,
    maxLevel: 45,
    materials: [
      { itemId: 11137, name: "Vision Dust", chance: 0.75, min: 2, max: 5 },
      { itemId: 11174, name: "Lesser Nether Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 11177, name: "Small Radiant Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 46,
    maxLevel: 50,
    materials: [
      { itemId: 11176, name: "Dream Dust", chance: 0.75, min: 1, max: 2 },
      { itemId: 11175, name: "Greater Nether Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 11178, name: "Large Radiant Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 51,
    maxLevel: 55,
    materials: [
      { itemId: 11176, name: "Dream Dust", chance: 0.75, min: 2, max: 5 },
      { itemId: 16202, name: "Lesser Eternal Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 14343, name: "Small Brilliant Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 56,
    maxLevel: 60,
    materials: [
      { itemId: 16204, name: "Illusion Dust", chance: 0.75, min: 1, max: 2 },
      { itemId: 16203, name: "Greater Eternal Essence", chance: 0.2, min: 1, max: 2 },
      { itemId: 14344, name: "Large Brilliant Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 61,
    maxLevel: 65,
    materials: [
      { itemId: 16204, name: "Illusion Dust", chance: 0.75, min: 2, max: 5 },
      { itemId: 16203, name: "Greater Eternal Essence", chance: 0.2, min: 2, max: 3 },
      { itemId: 14344, name: "Large Brilliant Shard", chance: 0.05, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 66,
    maxLevel: 79,
    materials: [
      { itemId: 22445, name: "Arcane Dust", chance: 0.75, min: 1, max: 2 },
      { itemId: 22447, name: "Lesser Planar Essence", chance: 0.22, min: 1, max: 2 },
      { itemId: 22448, name: "Small Prismatic Shard", chance: 0.03, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 80,
    maxLevel: 99,
    materials: [
      { itemId: 22445, name: "Arcane Dust", chance: 0.75, min: 2, max: 3 },
      { itemId: 22447, name: "Lesser Planar Essence", chance: 0.22, min: 2, max: 3 },
      { itemId: 22448, name: "Small Prismatic Shard", chance: 0.03, min: 1, max: 1 },
    ],
  },
  {
    minLevel: 100,
    maxLevel: 120,
    materials: [
      { itemId: 22445, name: "Arcane Dust", chance: 0.75, min: 2, max: 5 },
      { itemId: 22446, name: "Greater Planar Essence", chance: 0.22, min: 1, max: 2 },
      { itemId: 22449, name: "Large Prismatic Shard", chance: 0.03, min: 1, max: 1 },
    ],
  },
];

function estimateClassicArmorDisenchant(xml: string, version: WowVersion): DisenchantEntry[] {
  if (
    (version !== "tbc" && version !== "ascension" && version !== "forever")
    || parseQuality(xml) !== "uncommon"
    || Number(xml.match(/<class[^>]*id="(\d+)"/i)?.[1]) !== 4
  ) {
    return [];
  }

  const itemLevel = parseNumberTag(xml, "level");
  const band = uncommonArmorDisenchantBands.find(
    (entry) => itemLevel >= entry.minLevel && itemLevel <= entry.maxLevel,
  );

  return band?.materials.map((material) => ({
    ...material,
    icon: fallbackIcon,
  })) ?? [];
}

const fallbackIcon = "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
const iconByItemIdCache = new Map<string, string>();

async function resolveItemIconById(itemId: number, version: WowVersion): Promise<string> {
  const cacheKey = `${version}:${itemId}`;
  const cached = iconByItemIdCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const xml = await fetchWowheadXml(itemId, version);
    const icon = parseIcon(xml);
    iconByItemIdCache.set(cacheKey, icon || fallbackIcon);
    return icon || fallbackIcon;
  } catch {
    return fallbackIcon;
  }
}

async function enrichDisenchantIcons(
  entries: DisenchantEntry[],
  version: WowVersion,
): Promise<DisenchantEntry[]> {
  return Promise.all(
    entries.map(async (entry) => {
      if (entry.icon && entry.icon !== fallbackIcon) {
        return entry;
      }

      const resolvedIcon = await resolveItemIconById(entry.itemId, version);
      return {
        ...entry,
        icon: resolvedIcon,
      };
    }),
  );
}

async function fetchWowheadXml(itemId: number, version: WowVersion): Promise<string> {
  const root = getWowheadRoot(version);
  const response = await fetch(`${root}/item=${itemId}&xml`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Nao foi possivel importar o item ${itemId} via Wowhead.`);
  }

  return response.text();
}

function getWowheadPageUrl(
  candidate: string,
  itemId: number,
  version: WowVersion,
): string | null {
  try {
    const url = new URL(candidate);
    const root = new URL(getWowheadRoot(version));
    const requiredPath = root.pathname.replace(/\/$/, "");
    const pathMatches = !requiredPath
      || url.pathname === requiredPath
      || url.pathname.startsWith(`${requiredPath}/`);
    const pageItemId = url.pathname.match(/(?:^|\/)item=(\d+)(?:\/|$)/)?.[1];

    if (
      url.protocol !== "https:"
      || url.hostname !== "www.wowhead.com"
      || !pathMatches
      || Number(pageItemId) !== itemId
    ) {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchWowheadHtml(
  itemId: number,
  version: WowVersion,
  pageUrl: string,
): Promise<string | null> {
  const response = await fetch(pageUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Referer": `${getWowheadRoot(version)}/`,
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });

  if (response.status === 202 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `O Wowhead nao permitiu ler os resultados de desencantamento do item ${itemId} (HTTP ${response.status}).`,
    );
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
    wowheadUrl: getWowheadItemUrl(version, itemId),
    source: buildSourceLabel(recipe),
    priceSource: "MATERIA_PRIMA",
    fixedPrice: null,
    tsmPrice: 0,
    ahPrice: 0,
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
  const xml = await fetchWowheadXml(itemId, version);
  const queryPageUrl = getWowheadPageUrl(query, itemId, version);
  const xmlPageUrl = getWowheadPageUrl(parseTag(xml, "link"), itemId, version);
  const pageUrl = queryPageUrl ?? xmlPageUrl ?? getWowheadItemUrl(version, itemId);
  const html = await fetchWowheadHtml(itemId, version, pageUrl);

  const name = parseTag(xml, "name") || `Item ${itemId}`;
  const icon = parseIcon(xml);
  const recipe = parseRecipe(xml);
  const wowheadDisenchant = html ? parseDisenchant(html) : [];
  const estimatedDisenchant = wowheadDisenchant.length === 0
    ? estimateClassicArmorDisenchant(xml, version)
    : [];
  const disenchant = await enrichDisenchantIcons(
    wowheadDisenchant.length > 0 ? wowheadDisenchant : estimatedDisenchant,
    version,
  );

  return {
    itemId,
    wowheadUrl: getWowheadItemUrl(version, itemId),
    name,
    icon,
    quality: parseQuality(xml),
    profession: parseProfession(xml),
    quantityProduced: parseProducedQuantity(xml),
    recipe,
    disenchant,
    ...(estimatedDisenchant.length > 0 ? { disenchantEstimated: true } : {}),
    auctionPrice: 0,
    vendorPrice: parseSellPrice(xml),
    isCommodity: guessCommodityByName(name),
    updatedAt: new Date().toISOString(),
  };
}
