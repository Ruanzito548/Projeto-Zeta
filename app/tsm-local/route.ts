import { promises as fs } from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

type TsmLocalResult = {
  name: string;
  itemId: number | null;
  price: number;
  ok: boolean;
};

const region = process.env.BLIZZARD_REGION ?? "us";
const staticNamespace =
  process.env.BLIZZARD_STATIC_NAMESPACE ?? "static-classicann-us";
const realmName = (process.env.BLIZZARD_REALM_NAME ?? "Nightslayer").trim();
const houseLabel = (process.env.BLIZZARD_DEFAULT_HOUSE_LABEL ?? "Horde").trim();

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Blizzard credentials are missing.");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch Blizzard token.");
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Invalid Blizzard token response.");
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

async function resolveItemIdByName(itemName: string): Promise<number | null> {
  const token = await getAccessToken();
  const url = new URL(`https://${region}.api.blizzard.com/data/wow/search/item`);
  url.searchParams.set("namespace", staticNamespace);
  url.searchParams.set("locale", "en_US");
  url.searchParams.set("name.en_US", itemName);
  url.searchParams.set("_pageSize", "25");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json()) as {
    results?: Array<{ data?: { id?: number; name?: { en_US?: string } } }>;
  };

  const exact = payload.results?.find((entry) => {
    const name = entry.data?.name?.en_US?.trim().toLowerCase();
    return name === itemName.trim().toLowerCase();
  });

  return typeof exact?.data?.id === "number" ? exact.data.id : null;
}

function decodeToken(value: string): number {
  // TSM AppData numeric tokens are base32 encoded.
  const decoded = Number.parseInt(value, 32);
  return Number.isFinite(decoded) && decoded > 0 ? decoded : 0;
}

function readPriceFromLegacyDirectMap(content: string, itemId: number): number {
  const id = String(itemId);
  const quotedRegex = new RegExp(`\\["i:${id}"\\]\\s*=\\s*"([^"]+)"`, "i");
  const quotedMatch = content.match(quotedRegex);

  if (quotedMatch?.[1]) {
    const token = quotedMatch[1].split(/[^0-9A-Za-z]+/g).find((part) => part.length > 0);
    return token ? decodeToken(token) : 0;
  }

  const numericRegex = new RegExp(`\\["i:${id}"\\]\\s*=\\s*(\\d+)`, "i");
  const numericMatch = content.match(numericRegex);

  if (numericMatch?.[1]) {
    const direct = Number(numericMatch[1]);
    return Number.isFinite(direct) && direct > 0 ? direct : 0;
  }

  return 0;
}

function readPriceFromLoadDataSection(
  content: string,
  sectionName: string,
  realmFactionKey: string,
  itemId: number,
): number {
  const sectionRegex = new RegExp(
    `LoadData\\(\\"${sectionName}\\",\\"${realmFactionKey}\\",\\[\\[return \\{.*?\\}\\]\\]\\)`,
    "s",
  );

  const section = content.match(sectionRegex)?.[0];

  if (!section) {
    return 0;
  }

  const itemRegex = new RegExp(`\\{${itemId},([A-Za-z0-9]+)\\}`, "i");
  const token = section.match(itemRegex)?.[1];

  if (!token) {
    return 0;
  }

  return decodeToken(token);
}

function readPriceFromNonCommodityDataSection(
  content: string,
  realmFactionKey: string,
  itemId: number,
): number {
  const sectionName = "AUCTIONDB_NON_COMMODITY_DATA";
  const sectionRegex = new RegExp(
    `LoadData\\(\\"${sectionName}\\",\\"${realmFactionKey}\\",\\[\\[return \\{.*?\\}\\]\\]\\)`,
    "s",
  );

  const section = content.match(sectionRegex)?.[0];

  if (!section) {
    return 0;
  }

  const rowRegex = new RegExp(`\\{${itemId},([^}]*)\\}`, "i");
  const row = section.match(rowRegex)?.[1];

  if (!row) {
    return 0;
  }

  // fields={"itemString","minBuyout","numAuctions","marketValueRecent"}
  const tokens = row.split(",").map((value) => value.trim());

  if (tokens.length === 0) {
    return 0;
  }

  const minBuyout = decodeToken(tokens[0]);
  return minBuyout;
}

function readPriceFromTsmData(content: string, itemId: number): number {
  const candidateRealmKeys = [
    `${realmName}-${houseLabel}`,
    `${realmName}-Horde`,
    `${realmName}-Alliance`,
    `${realmName}-Blackwater`,
  ];

  const sectionNames = [
    "AUCTIONDB_NON_COMMODITY_SCAN_STAT",
    "AUCTIONDB_NON_COMMODITY_HISTORICAL",
  ];

  // Prefer minBuyout from NON_COMMODITY_DATA when available.
  for (const realmKey of candidateRealmKeys) {
    const price = readPriceFromNonCommodityDataSection(content, realmKey, itemId);

    if (price > 0) {
      return price;
    }
  }

  for (const sectionName of sectionNames) {
    for (const realmKey of candidateRealmKeys) {
      const price = readPriceFromLoadDataSection(content, sectionName, realmKey, itemId);

      if (price > 0) {
        return price;
      }
    }
  }

  return readPriceFromLegacyDirectMap(content, itemId);
}

function getCandidatePaths() {
  const explicit = process.env.TSM_APPDATA_PATH?.trim();
  const wowDir = process.env.WOW_INSTALL_DIR?.trim();

  const defaults = [
    "C:/Program Files (x86)/World of Warcraft/_anniversary_/Interface/AddOns/TradeSkillMaster_AppHelper/AppData.lua",
    "C:/Program Files (x86)/World of Warcraft/_classic_/Interface/AddOns/TradeSkillMaster_AppHelper/AppData.lua",
    "C:/Program Files (x86)/World of Warcraft/_classic_era_/Interface/AddOns/TradeSkillMaster_AppHelper/AppData.lua",
    "C:/Program Files (x86)/World of Warcraft/_classic_ptr_/Interface/AddOns/TradeSkillMaster_AppHelper/AppData.lua",
  ];

  if (wowDir) {
    defaults.unshift(
      path.join(wowDir, "_anniversary_", "Interface", "AddOns", "TradeSkillMaster_AppHelper", "AppData.lua"),
    );
    defaults.unshift(
      path.join(wowDir, "_classic_", "Interface", "AddOns", "TradeSkillMaster_AppHelper", "AppData.lua"),
    );
    defaults.unshift(
      path.join(wowDir, "_classic_era_", "Interface", "AddOns", "TradeSkillMaster_AppHelper", "AppData.lua"),
    );
  }

  return [explicit, ...defaults]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replaceAll("\\", "/"));
}

async function loadTsmDataFile() {
  const tried: string[] = [];

  const explicit = process.env.TSM_APPDATA_PATH?.trim()?.replaceAll("\\", "/");

  if (explicit) {
    try {
      const content = await fs.readFile(explicit, "utf8");
      return { content, sourcePath: explicit, tried: [explicit] };
    } catch {
      tried.push(explicit);
    }
  }

  const candidates = getCandidatePaths().filter((pathItem) => pathItem !== explicit);
  const existing: Array<{ path: string; size: number; content: string }> = [];

  for (const candidatePath of candidates) {
    tried.push(candidatePath);
    try {
      const stat = await fs.stat(candidatePath);

      if (!stat.isFile()) {
        continue;
      }

      const content = await fs.readFile(candidatePath, "utf8");
      existing.push({ path: candidatePath, size: stat.size, content });
    } catch {
      // Continue searching next candidate path.
    }
  }

  if (existing.length > 0) {
    const realmFaction = `${realmName}-${houseLabel}`;

    const scored = existing.map((entry) => {
      let score = 0;

      if (entry.content.includes(`\"${realmFaction}\"`)) {
        score += 100;
      }

      if (entry.content.includes(`\"${realmName}-`)) {
        score += 50;
      }

      if (entry.content.includes("AUCTIONDB_NON_COMMODITY_SCAN_STAT")) {
        score += 20;
      }

      if (entry.path.includes("/_anniversary_/")) {
        score += 10;
      }

      return { ...entry, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return b.size - a.size;
    });

    const best = scored[0];
    return { content: best.content, sourcePath: best.path, tried };
  }

  throw new Error(
    `TSM AppData.lua not found. Checked: ${tried.join(" | ")}`,
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { names?: string[]; appDataContent?: string };
    const names = (body.names ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      return NextResponse.json({ error: "Nenhum item informado." }, { status: 400 });
    }

    const inlineContent = body.appDataContent?.trim();
    const loaded = inlineContent
      ? {
          content: inlineContent,
          sourcePath: "uploaded-appdata.lua",
          tried: [] as string[],
        }
      : await loadTsmDataFile();

    const { content, sourcePath, tried } = loaded;

    const idCache = new Map<string, number | null>();
    const results: TsmLocalResult[] = [];

    for (const name of names) {
      let itemId = idCache.get(name);

      if (typeof itemId === "undefined") {
        itemId = await resolveItemIdByName(name);
        idCache.set(name, itemId);
      }

      if (!itemId) {
        results.push({ name, itemId: null, price: 0, ok: false });
        continue;
      }

      const price = readPriceFromTsmData(content, itemId);
      results.push({ name, itemId, price, ok: price > 0 });
    }

    return NextResponse.json({
      sourcePath,
      checkedPaths: tried,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ler TSM local.";
    const hostedHint =
      process.env.VERCEL && message.includes("TSM AppData.lua not found")
        ? " Em deploy (Vercel), envie o AppData.lua pelo campo de upload na tela de reagentes."
        : "";

    return NextResponse.json(
      {
        error: `${message}${hostedHint}`,
      },
      { status: 500 },
    );
  }
}
