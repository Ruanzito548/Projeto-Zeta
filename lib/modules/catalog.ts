import type { WowVersion } from "@/lib/wow/versions";

export const VERSION_REAGENT_SEEDS: Record<WowVersion, number[]> = {
  tbc: [4306, 4305, 4338, 17056, 22572, 22445, 22446, 21877],
  retail: [190452, 190453, 190454, 190456, 190315, 190316, 190320, 193050],
  ascension: [4306, 4338, 10940, 10938, 14343, 16204, 17056, 22572],
};

const COMMODITY_KEYWORDS = [
  "cloth",
  "dust",
  "essence",
  "shard",
  "ore",
  "bar",
  "leather",
  "herb",
  "gem",
  "thread",
  "ink",
  "pigment",
];

export function guessCommodityByName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return COMMODITY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
