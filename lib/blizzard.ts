type BlizzardSearchResult = {
  data?: {
    id?: number;
    name?: {
      en_US?: string;
    };
  };
};

type BlizzardAuction = {
  item?: {
    id?: number;
  };
  buyout?: number;
  unit_price?: number;
  quantity?: number;
};

export type AuctionPriceResult = {
  itemId: number;
  itemName: string;
  price: number;
  quantity: number;
  source: "commodities" | "realm-auctions";
  region: string;
  staticNamespace: string;
  dynamicNamespace: string;
  connectedRealmId: number;
  auctionHouseId: number | null;
  auctionHouseName: string | null;
  lastModified: string | null;
  requestedAt: string;
  staleHint: boolean;
};

let accessToken: string | null = null;
let tokenExpires = 0;
const region = process.env.BLIZZARD_REGION ?? "us";
const staticNamespace =
  process.env.BLIZZARD_STATIC_NAMESPACE ?? "static-classicann-us";
const dynamicNamespace =
  process.env.BLIZZARD_DYNAMIC_NAMESPACE ?? "dynamic-classicann-us";
const connectedRealmId = Number(process.env.BLIZZARD_CONNECTED_REALM_ID ?? "6065");
const defaultAuctionHouseId = Number(
  process.env.BLIZZARD_AUCTION_HOUSE_ID ?? "6"
);

function isRetailNamespace(namespace: string) {
  return namespace === "dynamic-us";
}

function getAuctionHouseIdFromInput(house?: string) {
  const normalized = house?.trim().toLowerCase();

  if (!normalized) {
    return defaultAuctionHouseId;
  }

  if (normalized === "alliance") {
    return 2;
  }

  if (normalized === "horde") {
    return 6;
  }

  if (normalized === "blackwater" || normalized === "neutral") {
    return 7;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? defaultAuctionHouseId : parsed;
}

function getAuctionHouseName(auctionHouseId: number | null) {
  if (auctionHouseId === 2) {
    return "Alliance";
  }

  if (auctionHouseId === 6) {
    return "Horde";
  }

  if (auctionHouseId === 7) {
    return "Blackwater";
  }

  return auctionHouseId ? `Auction House ${auctionHouseId}` : null;
}

function getStaleHint(lastModified: string | null) {
  if (!lastModified) {
    return false;
  }

  const parsed = Date.parse(lastModified);

  if (Number.isNaN(parsed)) {
    return false;
  }

  const ageInDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
  return ageInDays > 7;
}

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpires) {
    return accessToken;
  }

  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.BLIZZARD_CLIENT_ID}:${process.env.BLIZZARD_CLIENT_SECRET}`
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch Blizzard access token");
  }

  const data = await res.json();

  accessToken = data.access_token;
  tokenExpires = Date.now() + data.expires_in * 1000;

  if (!accessToken) {
    throw new Error("Blizzard access token is missing in the response");
  }

  return accessToken;
}

async function findItemByName(token: string, itemName: string) {
  const url = new URL(`https://${region}.api.blizzard.com/data/wow/search/item`);
  url.searchParams.set("namespace", staticNamespace);
  url.searchParams.set("locale", "en_US");
  url.searchParams.set("name.en_US", itemName);
  url.searchParams.set("_pageSize", "25");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to search Blizzard item");
  }

  const data = await res.json();
  const exactMatch = (data.results as BlizzardSearchResult[] | undefined)?.find(
    (result) => {
      return (
        result.data?.name?.en_US?.toLowerCase() === itemName.toLowerCase() &&
        typeof result.data?.id === "number"
      );
    }
  );

  if (!exactMatch?.data?.id || !exactMatch.data.name?.en_US) {
    throw new Error(`Item "${itemName}" not found`);
  }

  return {
    itemId: exactMatch.data.id,
    itemName: exactMatch.data.name.en_US,
  };
}

async function getItemNameById(token: string, itemId: number) {
  const url = new URL(`https://${region}.api.blizzard.com/data/wow/item/${itemId}`);
  url.searchParams.set("namespace", staticNamespace);
  url.searchParams.set("locale", "en_US");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch Blizzard item");
  }

  const data = await res.json();

  if (!data.name) {
    throw new Error(`Item ${itemId} not found`);
  }

  return data.name as string;
}

async function getCommodityPrice(token: string, itemId: number) {
  const url = new URL(
    `https://${region}.api.blizzard.com/data/wow/auctions/commodities`
  );
  url.searchParams.set("namespace", dynamicNamespace);
  url.searchParams.set("locale", "en_US");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const auctions =
    (data.auctions as BlizzardAuction[] | undefined)?.filter((auction) => {
      return auction.item?.id === itemId && (auction.unit_price ?? 0) > 0;
    }) ?? [];

  if (auctions.length === 0) {
    return null;
  }

  const unitPrices = auctions.map((auction) => auction.unit_price ?? 0);
  const quantity = auctions.reduce((total, auction) => {
    return total + (auction.quantity ?? 0);
  }, 0);

  return {
    price: Math.min(...unitPrices),
    quantity,
    source: "commodities" as const,
    auctionHouseId: null,
    lastModified: res.headers.get("Last-Modified"),
  };
}

async function getRetailRealmAuctionPrice(token: string, itemId: number) {
  const url = new URL(
    `https://${region}.api.blizzard.com/data/wow/connected-realm/${connectedRealmId}/auctions`
  );
  url.searchParams.set("namespace", dynamicNamespace);
  url.searchParams.set("locale", "en_US");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(
      `Failed to fetch realm auctions (${res.status}): ${details || res.statusText}`
    );
  }

  const data = await res.json();
  const auctions =
    (data.auctions as BlizzardAuction[] | undefined)?.filter((auction) => {
      return auction.item?.id === itemId;
    }) ?? [];

  const buyouts = auctions
    .map((auction) => auction.buyout ?? 0)
    .filter((buyout) => buyout > 0);

  const quantity = auctions.reduce((total, auction) => {
    return total + (auction.quantity ?? 0);
  }, 0);

  return {
    price: buyouts.length > 0 ? Math.min(...buyouts) : 0,
    quantity,
    source: "realm-auctions" as const,
    auctionHouseId: null,
    lastModified: res.headers.get("Last-Modified"),
  };
}

async function getClassicAuctionHousePrice(
  token: string,
  itemId: number,
  auctionHouseId: number
) {
  const url = new URL(
    `https://${region}.api.blizzard.com/data/wow/connected-realm/${connectedRealmId}/auctions/${auctionHouseId}`
  );
  url.searchParams.set("namespace", dynamicNamespace);
  url.searchParams.set("locale", "en_US");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(
      `Blizzard AH endpoint unavailable for ${dynamicNamespace}, realm ${connectedRealmId}, auction house ${auctionHouseId} (${res.status}). ${details || res.statusText}`
    );
  }

  const data = await res.json();
  const auctions =
    (data.auctions as BlizzardAuction[] | undefined)?.filter((auction) => {
      return auction.item?.id === itemId;
    }) ?? [];

  const buyouts = auctions
    .map((auction) => auction.buyout ?? 0)
    .filter((buyout) => buyout > 0);

  const quantity = auctions.reduce((total, auction) => {
    return total + (auction.quantity ?? 0);
  }, 0);

  return {
    price: buyouts.length > 0 ? Math.min(...buyouts) : 0,
    quantity,
    source: "realm-auctions" as const,
    auctionHouseId,
    lastModified: res.headers.get("Last-Modified"),
  };
}

export async function getAuctionPrice(input: {
  itemId?: number;
  itemName?: string;
  house?: string;
}) {
  const token = await getAccessToken();
  const requestedAt = new Date().toISOString();

  let itemId = input.itemId;
  let itemName = input.itemName?.trim() ?? "";

  if (!itemId && !itemName) {
    throw new Error("Missing itemId or itemName");
  }

  if (!itemId && itemName.length > 0) {
    const item = await findItemByName(token, itemName);
    itemId = item.itemId;
    itemName = item.itemName;
  }

  if (!itemId) {
    throw new Error("Item ID could not be resolved");
  }

  if (!itemName) {
    itemName = await getItemNameById(token, itemId);
  }

  const auctionResult = isRetailNamespace(dynamicNamespace)
    ? (await getCommodityPrice(token, itemId)) ??
      (await getRetailRealmAuctionPrice(token, itemId))
    : await getClassicAuctionHousePrice(
        token,
        itemId,
        getAuctionHouseIdFromInput(input.house)
      );

  return {
    itemId,
    itemName,
    price: auctionResult.price,
    quantity: auctionResult.quantity,
    source: auctionResult.source,
    region,
    staticNamespace,
    dynamicNamespace,
    connectedRealmId,
    auctionHouseId: auctionResult.auctionHouseId,
    auctionHouseName: getAuctionHouseName(auctionResult.auctionHouseId),
    lastModified: auctionResult.lastModified,
    requestedAt,
    staleHint: getStaleHint(auctionResult.lastModified),
  } satisfies AuctionPriceResult;
}
