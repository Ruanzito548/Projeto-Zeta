import type { ImportStore } from "./store";
import type { ItemDoc, RecipeDoc } from "./types";

export interface GraphReader {
  getItem(itemId: number): Promise<ItemDoc | null>;
  recipesProducing(itemId: number): Promise<RecipeDoc[]>;
}

export interface ChainNode {
  itemId: number;
  name: string | null;
  /** Quantidade necessária do item para UMA unidade do nó pai. */
  quantity: number;
  /** Receita escolhida (menor ID) quando o item é fabricável; null para materiais base. */
  recipe: { id: number; name: string | null; professionSlug: string | null; requiredSkill: number | null; produces: number } | null;
  alternativeRecipeIds: number[];
  /** true quando o item já aparece no caminho: a recursão para para evitar loops. */
  circular: boolean;
  truncated: boolean;
  reagents: ChainNode[];
}

export function createStoreGraphReader(store: ImportStore): GraphReader {
  const items = new Map<number, ItemDoc | null>();
  const producing = new Map<number, RecipeDoc[]>();

  return {
    async getItem(itemId) {
      if (!items.has(itemId)) items.set(itemId, (await store.getDocs<ItemDoc>("items", [itemId]))[0] ?? null);
      return items.get(itemId) ?? null;
    },
    async recipesProducing(itemId) {
      if (!producing.has(itemId)) {
        const ids = await store.recipeIdsByProduct(itemId);
        // Arestas podem estar defasadas: a receita é a fonte da verdade.
        const recipes = (await store.getDocs<RecipeDoc>("recipes", ids))
          .filter((recipe) => recipe.product?.itemId === itemId)
          .sort((a, b) => a.id - b.id);
        producing.set(itemId, recipes);
      }
      return producing.get(itemId) ?? [];
    },
  };
}

/** Descobre a cadeia de produção completa de um item, sem loops infinitos. */
export async function resolveChain(
  reader: GraphReader,
  itemId: number,
  options: { maxDepth?: number } = {},
): Promise<ChainNode> {
  const maxDepth = options.maxDepth ?? 12;

  async function build(id: number, quantity: number, path: Set<number>, depth: number): Promise<ChainNode> {
    const item = await reader.getItem(id);
    const base: ChainNode = {
      itemId: id,
      name: item?.name ?? null,
      quantity,
      recipe: null,
      alternativeRecipeIds: [],
      circular: path.has(id),
      truncated: false,
      reagents: [],
    };
    if (base.circular) return base;

    const [recipe, ...others] = await reader.recipesProducing(id);
    if (!recipe) return base;

    base.recipe = {
      id: recipe.id,
      name: recipe.name,
      professionSlug: recipe.professionSlug,
      requiredSkill: recipe.requiredSkill,
      produces: recipe.product?.quantity ?? 1,
    };
    base.alternativeRecipeIds = others.map((other) => other.id);

    if (depth >= maxDepth) {
      base.truncated = true;
      return base;
    }

    const nextPath = new Set(path).add(id);
    for (const line of recipe.reagents) {
      base.reagents.push(await build(line.itemId, line.quantity, nextPath, depth + 1));
    }
    return base;
  }

  return build(itemId, 1, new Set(), 0);
}

/** Totais de materiais base (sem receita) para fabricar `count` unidades do item raiz. */
export function flattenBaseMaterials(root: ChainNode, count = 1): Map<number, number> {
  const totals = new Map<number, number>();

  function walk(node: ChainNode, needed: number) {
    if (!node.recipe || node.circular || node.truncated || node.reagents.length === 0) {
      totals.set(node.itemId, (totals.get(node.itemId) ?? 0) + needed);
      return;
    }
    const crafts = Math.ceil(needed / node.recipe.produces);
    for (const child of node.reagents) walk(child, child.quantity * crafts);
  }

  walk(root, count);
  return totals;
}
