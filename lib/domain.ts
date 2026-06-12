export type Profession =
  | "Enchanting"
  | "Tailoring"
  | "Blacksmithing"
  | "Leatherworking"
  | "Jewelcrafting"
  | "Alchemy"
  | "Engineering"
  | "Inscription"
  | "Cooking"
  | "Other";

export type Currency = "GSC" | "GOLD";

export interface Reagent {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface DisenchantEntry {
  id: string;
  materialName: string;
  chancePercent: number;
  minQuantity: number;
  maxQuantity: number;
  materialPrice: number;
}

export interface CraftItem {
  id: string;
  name: string;
  profession: Profession;
  requiredProfessionLevel: number;
  iconUrl?: string;
  auctionSellValue: number;
  quantityPerCraft: number;
  reagents: Reagent[];
  disenchantTable: DisenchantEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryEntry {
  id: string;
  itemId: string;
  itemName: string;
  targetType: "REAGENT" | "DISENCHANT_MATERIAL" | "SELL_PRICE";
  targetName: string;
  previousPrice: number;
  nextPrice: number;
  changedAt: string;
}

export interface AppSettings {
  auctionFeePercent: number;
  currency: Currency;
  simulatedCraftCount: number;
  decimals: number;
}

export interface AppData {
  items: CraftItem[];
  settings: AppSettings;
  history: PriceHistoryEntry[];
}

export const PROFESSIONS: Profession[] = [
  "Enchanting",
  "Tailoring",
  "Blacksmithing",
  "Leatherworking",
  "Jewelcrafting",
  "Alchemy",
  "Engineering",
  "Inscription",
  "Cooking",
  "Other",
];

export const defaultSettings: AppSettings = {
  auctionFeePercent: 5,
  currency: "GSC",
  simulatedCraftCount: 1,
  decimals: 2,
};

export const defaultData: AppData = {
  items: [],
  settings: defaultSettings,
  history: [],
};
