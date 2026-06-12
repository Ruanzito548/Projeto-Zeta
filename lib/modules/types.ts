import type { WowVersion } from "@/lib/wow/versions";

export type Profession =
  | "Alchemy"
  | "Blacksmithing"
  | "Enchanting"
  | "Engineering"
  | "Inscription"
  | "Jewelcrafting"
  | "Leatherworking"
  | "Tailoring"
  | "Cooking"
  | "Other";

export type Quality = "poor" | "common" | "uncommon" | "rare" | "epic" | "legendary";

export type PriceSource = "MATERIA_PRIMA" | "CRAFTING" | "NPC";

export interface RecipeComponent {
  itemId: number;
  name: string;
  icon: string;
  quantity: number;
}

export interface ReagentEntry {
  itemId: number;
  name: string;
  icon: string;
  quality: Quality;
  wowheadUrl: string;
  source: string;
  priceSource: PriceSource;
  fixedPrice: number | null;
  tsmPrice: number;
  calculatedPrice: number | null;
  recipe: RecipeComponent[];
  updatedAt: string;
}

export interface DisenchantEntry {
  itemId: number;
  name: string;
  icon: string;
  chance: number;
  min: number;
  max: number;
}

export interface ImportedCraftItem {
  itemId: number;
  wowheadUrl: string;
  name: string;
  icon: string;
  quality: Quality;
  profession: Profession;
  quantityProduced: number;
  recipe: RecipeComponent[];
  disenchant: DisenchantEntry[];
  auctionPrice: number;
  vendorPrice: number;
  isCommodity: boolean;
  updatedAt: string;
}

export interface DashboardRow {
  itemId: number;
  name: string;
  icon: string;
  profession: Profession;
  craftCost: number;
  auctionPrice: number;
  vendorPrice: number;
  auctionProfit: number;
  disenchantProfit: number;
  npcProfit: number;
  bestOption: "AUCTION" | "DISENCHANT" | "NPC";
}

export interface ModuleSnapshot {
  version: WowVersion;
  reagents: ReagentEntry[];
  crafts: ImportedCraftItem[];
  lastTsmSyncAt: string | null;
}

export const DEFAULT_SNAPSHOT = (version: WowVersion): ModuleSnapshot => ({
  version,
  reagents: [],
  crafts: [],
  lastTsmSyncAt: null,
});
