import { fetchJson, RateLimiter, type HttpOptions } from "./http";

export const FOREVERDB_BASE = "https://foreverdb.net/api/v1";
export const FOREVERDB_USER_AGENT = "Z1-WoWForever-Importer/1.0 (+https://foreverdb.net)";

/**
 * Cliente opcional do ForeverDB. Exige chave própria (variável de ambiente privada).
 * Plano gratuito: 30 req/min e 5.000/dia, por conta. O formato da resposta é `{ data, meta }`;
 * o conteúdo de `data` é preservado como veio, sem presumir campos.
 */
export class ForeverDbSource {
  private readonly limiter: RateLimiter;
  requests = 0;

  constructor(
    private readonly apiKey: string,
    private readonly options: { minIntervalMs?: number; http?: HttpOptions; base?: string } = {},
  ) {
    this.limiter = new RateLimiter(options.minIntervalMs ?? 2_100);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ForeverDbSource | null {
    const key = env.FOREVERDB_API_KEY?.trim();
    return key ? new ForeverDbSource(key) : null;
  }

  async item(id: number): Promise<{ data: unknown; meta?: unknown } | null> {
    try {
      return await fetchJson<{ data: unknown; meta?: unknown }>(
        `${this.options.base ?? FOREVERDB_BASE}/items/${id}`,
        this.limiter,
        {
          ...this.options.http,
          headers: {
            "X-API-Key": this.apiKey,
            "User-Agent": FOREVERDB_USER_AGENT,
            ...this.options.http?.headers,
          },
          onRequest: () => {
            this.requests += 1;
          },
        },
      );
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }
}
