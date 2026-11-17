import { fetchJson, RateLimiter, type HttpOptions } from "./http";
import type { DatasetKind, WfEnvelope, WfItem, WfManifest, WfProfession, WfRecipe } from "./types";

export const WF_ORIGIN = "https://warcraftforever.com";
export const WF_BATCH_LIMIT = 50;
export const WF_PAGE_LIMIT = 100;

type KindRecord = { items: WfItem; recipes: WfRecipe; professions: WfProfession };

export interface WfSourceOptions {
  origin?: string;
  minIntervalMs?: number;
  http?: HttpOptions;
  cacheTtlMs?: number;
  now?: () => number;
}

/**
 * Cliente da biblioteca de dados do Warcraft Forever.
 * Contrato: GET /api/data/v1/{dataset}/{locale}/{recurso}?query=&limit=&cursor=  e  ?ids=1,2,3
 * Itens, receitas e profissões podem ter datasets diferentes: nunca reutilizar IDs entre eles.
 */
export class WfSource {
  private readonly origin: string;
  private readonly limiter: RateLimiter;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly ttl: number;
  private readonly now: () => number;
  requests = 0;

  constructor(private readonly options: WfSourceOptions = {}) {
    this.origin = options.origin ?? WF_ORIGIN;
    this.limiter = new RateLimiter(options.minIntervalMs ?? 250);
    this.ttl = options.cacheTtlMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.origin}${path}`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.ttl) return hit.value as T;

    const value = await fetchJson<T>(url, this.limiter, {
      ...this.options.http,
      onRequest: () => {
        this.requests += 1;
        this.options.http?.onRequest?.();
      },
    });

    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(url, { at: this.now(), value });
    return value;
  }

  manifest(): Promise<WfManifest> {
    return this.get<WfManifest>("/api/data/v1/manifest");
  }

  /** Datasets fixados do canal padrão (live). */
  async resolveDatasets() {
    const manifest = await this.manifest();
    const channelName = manifest.aliases?.[manifest.defaultChannel] ?? manifest.defaultChannel;
    const channel = manifest.channels[channelName];
    if (!channel) throw new Error(`Canal "${channelName}" não existe no manifest.`);

    const { items, recipes, professions } = channel.datasets;
    if (!items || !recipes || !professions) {
      throw new Error("Manifest não publica datasets de items/recipes/professions.");
    }
    return { items, recipes, professions, build: channel.build, locales: channel.locales, limits: manifest.limits };
  }

  /** Uma página de navegação (query vazia). O cursor só vale para o mesmo dataset/locale/recurso. */
  page<K extends DatasetKind>(kind: K, dataset: string, locale: string, cursor: string | null) {
    const params = new URLSearchParams({ query: "", limit: String(WF_PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    return this.get<WfEnvelope<KindRecord[K]>>(`/api/data/v1/${dataset}/${locale}/${kind}?${params}`);
  }

  getMany<K extends DatasetKind>(kind: K, dataset: string, locale: string, ids: number[]) {
    if (ids.length === 0 || ids.length > WF_BATCH_LIMIT) {
      throw new RangeError(`getMany aceita de 1 a ${WF_BATCH_LIMIT} IDs.`);
    }
    const params = new URLSearchParams({ ids: ids.join(",") });
    return this.get<WfEnvelope<KindRecord[K]>>(`/api/data/v1/${dataset}/${locale}/${kind}?${params}`);
  }
}
