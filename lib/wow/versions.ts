export type WowVersion = "tbc" | "retail" | "ascension";

export interface WowVersionMeta {
  id: WowVersion;
  name: string;
  shortName: string;
  description: string;
  wowheadPath: "tbc" | "retail";
  accent: string;
  logo: string;
}

export const WOW_VERSIONS: WowVersionMeta[] = [
  {
    id: "tbc",
    name: "World of Warcraft: The Burning Crusade",
    shortName: "TBC",
    description:
      "Economia classica com foco em profissao, insumos intermediarios e margem por craft.",
    wowheadPath: "tbc",
    accent: "from-amber-300/20 to-orange-500/10",
    logo: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg",
  },
  {
    id: "retail",
    name: "World of Warcraft Retail",
    shortName: "Retail",
    description:
      "Mercado dinamico com alta rotacao de materiais, enchants e consumiveis atuais.",
    wowheadPath: "retail",
    accent: "from-sky-300/20 to-blue-500/10",
    logo: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_coin_02.jpg",
  },
  {
    id: "ascension",
    name: "World of Warcraft Ascension",
    shortName: "Ascension",
    description:
      "Estrutura preparada para servidores customizados com regras proprias de obtencao e demanda.",
    wowheadPath: "tbc",
    accent: "from-emerald-300/20 to-cyan-500/10",
    logo: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_orb_04.jpg",
  },
];

export const WOW_VERSION_MAP = Object.fromEntries(
  WOW_VERSIONS.map((version) => [version.id, version]),
) as Record<WowVersion, WowVersionMeta>;

export function isWowVersion(value: string): value is WowVersion {
  return value === "tbc" || value === "retail" || value === "ascension";
}
