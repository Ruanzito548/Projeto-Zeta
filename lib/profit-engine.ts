import type {
  AppSettings,
  ComputedCraftMetrics,
  CraftItem,
  DisenchantLine,
  Reagent,
} from "@/lib/app-types";

const AUCTION_FEE_TBC = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function expectedDEValue(line: DisenchantLine): number {
  const chance = clamp(line.chancePercent, 0, 100) / 100;
  const minQ = Math.max(0, line.minQuantity);
  const maxQ = Math.max(minQ, line.maxQuantity);
  const avgQty = (minQ + maxQ) / 2;

  return chance * avgQty * Math.max(0, line.materialPrice);
}

function findPriceForReagent(reagentId: string, reagents: Reagent[]): number {
  const reagent = reagents.find((row) => row.id === reagentId);
  return reagent ? Math.max(0, reagent.currentPrice) : 0;
}

export function computeCraftMetrics(
  craft: CraftItem,
  reagents: Reagent[],
  settings: AppSettings,
): ComputedCraftMetrics {
  const totalReagentCost = craft.reagents.reduce((sum, line) => {
    return sum + findPriceForReagent(line.reagentId, reagents) * Math.max(0, line.quantity);
  }, 0);

  const totalCost = totalReagentCost;
  const grossSale = Math.max(0, craft.saleValue) * Math.max(1, craft.quantityProduced);
  const fee = grossSale * (clamp(settings.auctionFeePercent, 0, 100) / 100);
  const saleProfit = grossSale - fee - totalCost;

  const disenchantExpectedValue =
    craft.disenchantTable.reduce((sum, line) => sum + expectedDEValue(line), 0) *
    (1 - AUCTION_FEE_TBC) *
    Math.max(1, craft.quantityProduced);

  const deBestCaseValue =
    craft.disenchantTable.reduce((sum, line) => {
      const chance = clamp(line.chancePercent, 0, 100) / 100;
      return sum + chance * Math.max(line.minQuantity, line.maxQuantity) * Math.max(0, line.materialPrice);
    }, 0) * (1 - AUCTION_FEE_TBC) * Math.max(1, craft.quantityProduced);

  const deWorstCaseValue =
    craft.disenchantTable.reduce((sum, line) => {
      const chance = clamp(line.chancePercent, 0, 100) / 100;
      return sum + chance * Math.max(0, line.minQuantity) * Math.max(0, line.materialPrice);
    }, 0) * (1 - AUCTION_FEE_TBC) * Math.max(1, craft.quantityProduced);

  const disenchantProfit = disenchantExpectedValue - totalCost;
  const saleRoi = totalCost > 0 ? (saleProfit / totalCost) * 100 : 0;
  const disenchantRoi = totalCost > 0 ? (disenchantProfit / totalCost) * 100 : 0;

  let bestChoice: ComputedCraftMetrics["bestChoice"] = "TIE";

  if (saleProfit > disenchantProfit) {
    bestChoice = "SELL";
  } else if (disenchantProfit > saleProfit) {
    bestChoice = "DISENCHANT";
  }

  return {
    totalReagentCost,
    disenchantExpectedValue,
    deWorstCaseValue,
    deBestCaseValue,
    saleProfit,
    disenchantProfit,
    saleRoi,
    disenchantRoi,
    bestChoice,
  };
}

export function formatCopper(value: number, settings: AppSettings): string {
  if (settings.currency === "GOLD") {
    return `${(value / 10000).toFixed(2)}g`;
  }

  const rounded = Math.max(0, Math.round(value));
  const gold = Math.floor(rounded / 10000);
  const silver = Math.floor((rounded % 10000) / 100);
  const copper = rounded % 100;

  return `${gold}g ${silver}s ${copper}c`;
}

export function roiColor(value: number): "high" | "medium" | "low" {
  if (value >= 120) {
    return "high";
  }

  if (value >= 30) {
    return "medium";
  }

  return "low";
}
