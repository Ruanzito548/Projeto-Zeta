import type {
  ImportedCraftItem,
  Profession,
  Quality,
  ReagentEntry,
  RecipeComponent,
} from "../modules/types";
import { getWowheadItemUrl } from "../wow/versions";
import type { ItemDoc, RecipeDoc } from "./types";

const QUALITY_MAP: Quality[] = ["poor", "common", "uncommon", "rare", "epic", "legendary"];

const PROFESSION_BY_SLUG: Record<string, Profession> = {
  alchemy: "Alchemy",
  blacksmithing: "Blacksmithing",
  enchanting: "Enchanting",
  engineering: "Engineering",
  leatherworking: "Leatherworking",
  tailoring: "Tailoring",
  cooking: "Cooking",
};

const FALLBACK_ICON = "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";

export function mapProfession(slug: string | null): Profession {
  return (slug && PROFESSION_BY_SLUG[slug]) || "Other";
}

function iconOf(item: Pick<ItemDoc, "iconUrl"> | undefined): string {
  return item?.iconUrl ?? FALLBACK_ICON;
}

/**
 * Converte receita + itens do catálogo para o formato usado pelos cálculos atuais
 * (computeDashboardRows). Preços de mercado NÃO vêm do catálogo: ficam em 0 até
 * a integração existente do Z1 (AuctionHouse/TSM) preenchê-los.
 */
export function toImportedCraftItem(recipe: RecipeDoc, items: Map<number, ItemDoc>): ImportedCraftItem | null {
  if (!recipe.product) return null;
  const product = items.get(recipe.product.itemId);

  const components: RecipeComponent[] = recipe.reagents.map((line) => {
    const item = items.get(line.itemId);
    return {
      itemId: line.itemId,
      name: item?.name ?? `Item ${line.itemId}`,
      icon: iconOf(item),
      quantity: line.quantity,
    };
  });

  return {
    itemId: recipe.product.itemId,
    wowheadUrl: getWowheadItemUrl("forever", recipe.product.itemId),
    name: product?.name ?? recipe.name ?? `Item ${recipe.product.itemId}`,
    icon: iconOf(product),
    quality: QUALITY_MAP[product?.quality ?? 1] ?? "common",
    profession: mapProfession(recipe.professionSlug),
    quantityProduced: recipe.product.quantity,
    craftTimeSeconds: recipe.castMs ? recipe.castMs / 1000 : undefined,
    recipe: components,
    disenchant: [],
    auctionPrice: 0,
    vendorPrice: product?.vendorSell ?? 0,
    isCommodity: false,
    updatedAt: recipe.updatedAt,
  };
}

export function toReagentEntry(
  item: ItemDoc,
  craftedBy: RecipeDoc | null,
  items: Map<number, ItemDoc>,
): ReagentEntry {
  return {
    itemId: item.id,
    name: item.name ?? `Item ${item.id}`,
    icon: iconOf(item),
    quality: QUALITY_MAP[item.quality ?? 1] ?? "common",
    wowheadUrl: getWowheadItemUrl("forever", item.id),
    source: "WoW Forever",
    priceSource: craftedBy ? "CRAFTING" : "MATERIA_PRIMA",
    fixedPrice: null,
    tsmPrice: 0,
    ahPrice: 0,
    calculatedPrice: null,
    recipe: craftedBy
      ? craftedBy.reagents.map((line) => ({
          itemId: line.itemId,
          name: items.get(line.itemId)?.name ?? `Item ${line.itemId}`,
          icon: iconOf(items.get(line.itemId)),
          quantity: line.quantity,
        }))
      : [],
    craftTimeSeconds: craftedBy?.castMs ? craftedBy.castMs / 1000 : undefined,
    updatedAt: item.updatedAt,
  };
}
