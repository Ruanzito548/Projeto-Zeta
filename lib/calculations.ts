import type { AppSettings, CraftItem, DisenchantEntry } from "@/lib/domain";

export interface CraftMetrics {
  craftCost: number;
  saleValue: number;
  auctionFee: number;
  saleProfit: number;
  saleROI: number;
  disenchantExpectedValue: number;
  disenchantProfit: number;
  disenchantROI: number;
  bestChoice: "SELL" | "DISENCHANT" | "TIE";
}

export function roundValue(value: number, decimals: number) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
}

export function calculateCraftCost(item: CraftItem): number {
  return item.reagents.reduce(
    (total, reagent) => total + reagent.quantity * reagent.unitPrice,
    0,
  );
}

function expectedValueForEntry(entry: DisenchantEntry): number {
  const chance = Math.max(0, entry.chancePercent) / 100;
  const avgQty = (entry.minQuantity + entry.maxQuantity) / 2;
  return chance * avgQty * entry.materialPrice;
}

export function calculateDisenchantExpectedValue(item: CraftItem): number {
  return item.disenchantTable.reduce(
    (total, entry) => total + expectedValueForEntry(entry),
    0,
  );
}

export function calculateMetrics(
  item: CraftItem,
  settings: AppSettings,
): CraftMetrics {
  const craftCount = Math.max(1, settings.simulatedCraftCount);
  const craftCost = calculateCraftCost(item) * craftCount;
  const saleValue = item.auctionSellValue * item.quantityPerCraft * craftCount;
  const auctionFee = saleValue * (Math.max(0, settings.auctionFeePercent) / 100);
  const saleProfit = saleValue - auctionFee - craftCost;

  const disenchantExpectedValue =
    calculateDisenchantExpectedValue(item) * item.quantityPerCraft * craftCount;
  const disenchantProfit = disenchantExpectedValue - craftCost;

  const saleROI = craftCost > 0 ? (saleProfit / craftCost) * 100 : 0;
  const disenchantROI = craftCost > 0 ? (disenchantProfit / craftCost) * 100 : 0;

  let bestChoice: CraftMetrics["bestChoice"] = "TIE";

  if (saleProfit > disenchantProfit) {
    bestChoice = "SELL";
  } else if (disenchantProfit > saleProfit) {
    bestChoice = "DISENCHANT";
  }

  return {
    craftCost,
    saleValue,
    auctionFee,
    saleProfit,
    saleROI,
    disenchantExpectedValue,
    disenchantProfit,
    disenchantROI,
    bestChoice,
  };
}

export function formatCurrency(
  value: number,
  settings: AppSettings,
): string {
  if (settings.currency === "GOLD") {
    return `${roundValue(value / 10000, settings.decimals)}g`;
  }

  const totalCopper = Math.max(0, Math.round(value));
  const gold = Math.floor(totalCopper / 10000);
  const silver = Math.floor((totalCopper % 10000) / 100);
  const copper = totalCopper % 100;

  return `${gold}g ${silver}s ${copper}c`;
}

export function calcProfitBarWidth(value: number, maxAbs: number): string {
  if (!Number.isFinite(value) || maxAbs <= 0) {
    return "0%";
  }

  const normalized = Math.min(Math.abs(value) / maxAbs, 1);
  return `${Math.round(normalized * 100)}%`;
}
