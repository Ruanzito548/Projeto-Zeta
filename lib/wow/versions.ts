export type WowVersion = "tbc" | "retail" | "ascension" | "forever";

export interface WowVersionMeta {
  id: WowVersion;
  name: string;
  shortName: string;
  description: string;
  wowheadPath: "tbc" | "retail" | "forever";
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
  {
    id: "forever",
    name: "World of Warcraft Forever",
    shortName: "Forever",
    description:
      "Servidor eternal com economia balanceada e progressao permanente para jogadores dedicados.",
    wowheadPath: "forever",
    accent: "from-purple-300/20 to-pink-500/10",
    logo: "https://wow.zamimg.com/images/wow/icons/large/inv_misc_orb_03.jpg",
  },
];

export const WOW_VERSION_MAP = Object.fromEntries(
  WOW_VERSIONS.map((version) => [version.id, version]),
) as Record<WowVersion, WowVersionMeta>;

export function getWowheadRoot(version: WowVersion): string {
  const path = WOW_VERSION_MAP[version].wowheadPath;
  return path === "retail" ? "https://www.wowhead.com" : `https://www.wowhead.com/${path}`;
}

export function getWowheadItemUrl(version: WowVersion, itemId: number): string {
  return `${getWowheadRoot(version)}/item=${itemId}`;
}

export function isWowVersion(value: string): value is WowVersion {
  return value === "tbc" || value === "retail" || value === "ascension" || value === "forever";
}
