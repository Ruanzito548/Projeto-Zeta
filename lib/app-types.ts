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

export type CraftTag =
  | "Farm"
  | "Lucro Alto"
  | "ROI Alto"
  | "Prioridade"
  | "Mercado Lento"
  | "Mercado Rapido";

export interface Reagent {
  id: string;
  name: string;
  iconUrl?: string;
  priceLocked: boolean;
  craftFromReagentId?: string;
  craftFromQuantity?: number;
  currentPrice: number;
  profession: Profession | "Any";
  updatedAt: string;
  usageCount: number;
}

export interface CraftReagentLine {
  id: string;
  reagentId: string;
  quantity: number;
}

export interface DisenchantLine {
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
  iconUrl?: string;
  profession: Profession;
  requiredProfessionLevel: number;
  quantityProduced: number;
  saleValue: number;
  reagents: CraftReagentLine[];
  disenchantTable: DisenchantLine[];
  tags: CraftTag[];
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComputedCraftMetrics {
  totalReagentCost: number;
  disenchantExpectedValue: number;
  deWorstCaseValue: number;
  deBestCaseValue: number;
  saleProfit: number;
  disenchantProfit: number;
  saleRoi: number;
  disenchantRoi: number;
  bestChoice: "SELL" | "DISENCHANT" | "TIE";
}

export interface ProductionLine {
  id: string;
  craftId: string;
  quantity: number;
}

export interface HistoryEntry {
  id: string;
  type: "REAGENT_PRICE" | "CRAFT_UPDATED" | "DISENCHANT_UPDATED" | "CRAFT_CREATED" | "CRAFT_DELETED";
  message: string;
  createdAt: string;
}

export interface AppSettings {
  auctionFeePercent: number;
  currency: "GSC" | "GOLD";
}

export interface AppSnapshot {
  reagents: Reagent[];
  crafts: CraftItem[];
  production: ProductionLine[];
  history: HistoryEntry[];
  settings: AppSettings;
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

export const CRAFT_TAGS: CraftTag[] = [
  "Farm",
  "Lucro Alto",
  "ROI Alto",
  "Prioridade",
  "Mercado Lento",
  "Mercado Rapido",
];

export const defaultSnapshot: AppSnapshot = {
  reagents: [],
  crafts: [],
  production: [],
  history: [],
  settings: {
    auctionFeePercent: 5,
    currency: "GSC",
  },
};
