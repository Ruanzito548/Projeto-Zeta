import type { Profession, ReagentCategory } from "@/lib/app-types";

const ENCHANTING_KEYWORDS = ["dust", "essence", "shard", "crystal"];
const CLOTH_KEYWORDS = ["cloth"];
const LEATHER_KEYWORDS = ["leather", "hide", "scales", "scale", "scraps"];
const METAL_KEYWORDS = ["ore", "stone", "bar"];
const HERB_KEYWORDS = [
  "bloom",
  "leaf",
  "root",
  "weed",
  "whisker",
  "grass",
  "mushroom",
  "vine",
  "lichen",
  "thistle",
  "sansam",
  "foil",
  "herb",
];
const ELEMENTAL_KEYWORDS = ["mote", "primal"];
const CONSUMABLE_KEYWORDS = ["potion", "elixir", "flask", "food", "oil", "scroll"];
const GEM_NAMES = new Set([
  "malachite",
  "tigerseye",
  "shadowgem",
  "moss agate",
  "citrine",
  "jade",
  "aquamarine",
  "star ruby",
  "large opal",
  "azerothian diamond",
  "blue sapphire",
  "huge emerald",
  "blood garnet",
  "flame spessarite",
  "deep peridot",
  "golden draenite",
  "azure moonstone",
  "shadow draenite",
  "living ruby",
  "noble topaz",
  "dawnstone",
  "star of elune",
  "nightseye",
  "talasite",
]);

export function inferReagentCategory(name: string): ReagentCategory {
  const normalized = name.trim().toLowerCase();

  if (!normalized) {
    return "Miscellaneous";
  }

  if (ENCHANTING_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Enchanting Materials";
  }

  if (CLOTH_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Cloth";
  }

  if (LEATHER_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Leather";
  }

  if (METAL_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Metals & Stone";
  }

  if (HERB_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Herbs";
  }

  if (ELEMENTAL_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Elemental Materials";
  }

  if (CONSUMABLE_KEYWORDS.some((token) => normalized.includes(token))) {
    return "Consumables";
  }

  if (GEM_NAMES.has(normalized)) {
    return "Gems";
  }

  return "Miscellaneous";
}

export function inferCraftProfessionFromCategories(categories: ReagentCategory[]): Profession {
  const weights = new Map<Profession, number>([
    ["Enchanting", 0],
    ["Tailoring", 0],
    ["Blacksmithing", 0],
    ["Leatherworking", 0],
    ["Jewelcrafting", 0],
    ["Alchemy", 0],
    ["Engineering", 0],
    ["Inscription", 0],
    ["Cooking", 0],
    ["Other", 0],
  ]);

  for (const category of categories) {
    if (category === "Enchanting Materials") {
      weights.set("Enchanting", (weights.get("Enchanting") ?? 0) + 3);
      continue;
    }

    if (category === "Cloth") {
      weights.set("Tailoring", (weights.get("Tailoring") ?? 0) + 3);
      continue;
    }

    if (category === "Leather") {
      weights.set("Leatherworking", (weights.get("Leatherworking") ?? 0) + 3);
      continue;
    }

    if (category === "Metals & Stone") {
      weights.set("Blacksmithing", (weights.get("Blacksmithing") ?? 0) + 2);
      weights.set("Engineering", (weights.get("Engineering") ?? 0) + 2);
      continue;
    }

    if (category === "Gems") {
      weights.set("Jewelcrafting", (weights.get("Jewelcrafting") ?? 0) + 3);
      continue;
    }

    if (category === "Herbs") {
      weights.set("Alchemy", (weights.get("Alchemy") ?? 0) + 3);
      weights.set("Inscription", (weights.get("Inscription") ?? 0) + 1);
      continue;
    }

    if (category === "Consumables") {
      weights.set("Alchemy", (weights.get("Alchemy") ?? 0) + 1);
      weights.set("Cooking", (weights.get("Cooking") ?? 0) + 1);
      continue;
    }

    if (category === "Elemental Materials") {
      weights.set("Alchemy", (weights.get("Alchemy") ?? 0) + 1);
      weights.set("Engineering", (weights.get("Engineering") ?? 0) + 1);
      continue;
    }
  }

  let selected: Profession = "Other";
  let bestScore = 0;

  for (const [profession, score] of weights.entries()) {
    if (score > bestScore) {
      selected = profession;
      bestScore = score;
    }
  }

  return selected;
}
