import type {
  DashboardRow,
  ImportedCraftItem,
  ReagentEntry,
  RecipeComponent,
} from "@/lib/modules/types";

function expectedDisenchantValue(item: ImportedCraftItem, priceById: Map<number, number>): number {
  return item.disenchant.reduce((total, row) => {
    const price = priceById.get(row.itemId) ?? 0;
    const averageQty = (row.min + row.max) / 2;
    return total + price * averageQty * row.chance;
  }, 0);
}

function buildRecipeCostResolver(reagents: ReagentEntry[]) {
  const byId = new Map<number, ReagentEntry>(reagents.map((entry) => [entry.itemId, entry]));
  const memo = new Map<number, number>();

  function costFromRecipe(recipe: RecipeComponent[], visited: Set<number>): number {
    return recipe.reduce((total, component) => {
      const nested = byId.get(component.itemId);
      if (!nested) {
        return total + component.quantity * 0;
      }

      const nestedCost = resolveCost(nested.itemId, visited);
      return total + nestedCost * component.quantity;
    }, 0);
  }

  function resolveCost(itemId: number, visited = new Set<number>()): number {
    const cached = memo.get(itemId);
    if (typeof cached === "number") {
      return cached;
    }

    if (visited.has(itemId)) {
      return byId.get(itemId)?.tsmPrice ?? 0;
    }

    const reagent = byId.get(itemId);
    if (!reagent) {
      return 0;
    }

    visited.add(itemId);

    const value = reagent.recipe.length > 0
      ? costFromRecipe(reagent.recipe, visited)
      : reagent.tsmPrice;

    const finalCost = Number.isFinite(value) && value > 0 ? value : 0;
    memo.set(itemId, finalCost);
    visited.delete(itemId);

    return finalCost;
  }

  return resolveCost;
}

export function applyCalculatedReagentPrices(reagents: ReagentEntry[]): ReagentEntry[] {
  const resolveCost = buildRecipeCostResolver(reagents);

  return reagents.map((entry) => {
    if (entry.recipe.length === 0) {
      return {
        ...entry,
        calculatedPrice: null,
      };
    }

    return {
      ...entry,
      calculatedPrice: resolveCost(entry.itemId),
    };
  });
}

export function computeDashboardRows(
  crafts: ImportedCraftItem[],
  reagents: ReagentEntry[],
): DashboardRow[] {
  const resolvedReagents = applyCalculatedReagentPrices(reagents);
  const priceById = new Map<number, number>();

  for (const reagent of resolvedReagents) {
    priceById.set(reagent.itemId, reagent.calculatedPrice ?? reagent.tsmPrice);
  }

  return crafts.map((craft) => {
    const craftCost = craft.recipe.reduce((total, component) => {
      const unit = priceById.get(component.itemId) ?? 0;
      return total + unit * component.quantity;
    }, 0);

    const auctionProfit = craft.auctionPrice - craftCost;
    const npcProfit = craft.vendorPrice - craftCost;
    const disenchantProfit = expectedDisenchantValue(craft, priceById) - craftCost;

    let bestOption: DashboardRow["bestOption"] = "NPC";
    let winnerValue = npcProfit;

    if (disenchantProfit > winnerValue) {
      bestOption = "DISENCHANT";
      winnerValue = disenchantProfit;
    }

    if (craft.isCommodity && auctionProfit > winnerValue) {
      bestOption = "AUCTION";
    }

    return {
      itemId: craft.itemId,
      name: craft.name,
      icon: craft.icon,
      profession: craft.profession,
      craftCost,
      auctionPrice: craft.auctionPrice,
      vendorPrice: craft.vendorPrice,
      auctionProfit,
      disenchantProfit,
      npcProfit,
      bestOption,
    };
  });
}
