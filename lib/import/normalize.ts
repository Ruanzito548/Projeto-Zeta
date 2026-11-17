import { createHash } from "node:crypto";
import type {
  ItemDoc,
  ProfessionDoc,
  RecipeDoc,
  RecipeEdgeDoc,
  SourceStamp,
  WfItem,
  WfProfession,
  WfRecipe,
} from "./types";

export type Fresh<T> = Omit<T, "importedAt" | "updatedAt">;

const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

// Classes de item do cliente Classic (ids estáveis do ItemClass).
const ITEM_CLASS_NAMES: Record<number, string> = {
  0: "Consumable",
  1: "Container",
  2: "Weapon",
  3: "Gem",
  4: "Armor",
  5: "Reagent",
  6: "Projectile",
  7: "Trade Goods",
  9: "Recipe",
  11: "Quiver",
  12: "Quest",
  13: "Key",
  15: "Miscellaneous",
};

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 32);
}

function withHash<T extends object>(doc: T): T & { contentHash: string } {
  return { ...doc, contentHash: contentHash(doc) };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function normalizeItem(
  raw: WfItem,
  ctx: { locale: string; stamp: SourceStamp; discoveredAs: ItemDoc["discoveredAs"] },
): Fresh<ItemDoc> {
  const itemClass = num(raw.class);
  const quality = num(raw.quality);

  return withHash({
    id: raw.id,
    name: str(raw.name),
    nameLocale: str(raw.nameLocale),
    locale: ctx.locale,
    icon: str(raw.icon),
    iconUrl: str(raw.iconUrl),
    quality,
    qualityName: quality !== null ? (QUALITY_NAMES[quality] ?? null) : null,
    category: itemClass !== null ? (ITEM_CLASS_NAMES[itemClass] ?? null) : null,
    // A fonte só publica o id da subclasse; sem nomes oficiais, não inventamos rótulo.
    subcategory: null,
    itemClass,
    itemSubclass: num(raw.subclass),
    equipSlot: num(raw.slot),
    requiredLevel: num(raw.level),
    description: str(raw.flavor),
    stack: num(raw.stack),
    vendorSell: num(raw.sell),
    vendorBuy: num(raw.buy),
    extra: {
      effectsJson: raw.effects && raw.effects.length > 0 ? JSON.stringify(raw.effects) : null,
      slug: str(raw.slug),
      url: str(raw.url),
    },
    discoveredAs: ctx.discoveredAs,
    sources: [ctx.stamp],
  });
}

export function normalizeRecipe(
  raw: WfRecipe,
  ctx: { stamp: SourceStamp; professionSlugs: Map<number, string> },
): Fresh<RecipeDoc> {
  const skill = raw.skill
    ? {
        ...(num(raw.skill.orange) !== null ? { orange: raw.skill.orange } : {}),
        ...(num(raw.skill.yellow) !== null ? { yellow: raw.skill.yellow } : {}),
        ...(num(raw.skill.green) !== null ? { green: raw.skill.green } : {}),
        ...(num(raw.skill.grey) !== null ? { grey: raw.skill.grey } : {}),
      }
    : null;

  // Receitas repetem o mesmo reagente? Somamos para manter uma linha por item.
  const reagentMap = new Map<number, number>();
  for (const [itemId, quantity] of raw.reagents ?? []) {
    reagentMap.set(itemId, (reagentMap.get(itemId) ?? 0) + quantity);
  }

  return withHash({
    id: raw.id,
    name: str(raw.name),
    nameLocale: str(raw.nameLocale),
    slug: str(raw.slug),
    professionId: raw.profession,
    professionSlug: ctx.professionSlugs.get(raw.profession) ?? null,
    categoryId: num(raw.category),
    requiredSkill: skill?.orange ?? null,
    skill: skill && Object.keys(skill).length > 0 ? skill : null,
    reagents: [...reagentMap].map(([itemId, quantity]) => ({ itemId, quantity })),
    product: raw.product ? { itemId: raw.product.item, quantity: raw.product.count } : null,
    toolCategories: raw.toolCategories ?? [],
    castMs: num(raw.castMs),
    icon: str(raw.icon),
    iconUrl: str(raw.iconUrl),
    description: str(raw.description),
    sources: [ctx.stamp],
  });
}

export function normalizeProfession(raw: WfProfession, ctx: { stamp: SourceStamp }): Fresh<ProfessionDoc> {
  return withHash({
    id: raw.id,
    slug: raw.slug,
    name: str(raw.name),
    kind: str(raw.kind),
    icon: str(raw.icon),
    iconUrl: str(raw.iconUrl),
    categories: (raw.categories ?? []).map((c) => ({
      id: c.id,
      name: str(c.name),
      order: num(c.order),
      hidden: Boolean(c.hidden),
    })),
    sources: [ctx.stamp],
  });
}

export function recipeEdges(recipe: Pick<RecipeDoc, "id" | "professionId" | "reagents" | "product">): RecipeEdgeDoc[] {
  const edges: RecipeEdgeDoc[] = recipe.reagents.map(({ itemId, quantity }) => {
    const base = {
      id: `${recipe.id}_reagent_${itemId}`,
      recipeId: recipe.id,
      itemId,
      role: "reagent" as const,
      quantity,
      professionId: recipe.professionId,
    };
    return { ...base, contentHash: contentHash(base) };
  });

  if (recipe.product) {
    const base = {
      id: `${recipe.id}_product_${recipe.product.itemId}`,
      recipeId: recipe.id,
      itemId: recipe.product.itemId,
      role: "product" as const,
      quantity: recipe.product.quantity,
      professionId: recipe.professionId,
    };
    edges.push({ ...base, contentHash: contentHash(base) });
  }

  return edges;
}
