export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  onRequest?: () => void;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espaça requisições por um intervalo mínimo (rate limiting). */
export class RateLimiter {
  private nextAt = 0;
  private penaltyUntil = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async acquire(): Promise<void> {
    const t = this.now();
    const start = Math.max(t, this.nextAt, this.penaltyUntil);
    this.nextAt = start + this.minIntervalMs;
    if (start > t) await this.sleep(start - t);
  }

  /** Após HTTP 429 todas as requisições aguardam o Retry-After. */
  penalize(ms: number) {
    this.penaltyUntil = Math.max(this.penaltyUntil, this.now() + ms);
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function backoffDelay(attempt: number, base: number, max: number, random = Math.random): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp / 2 + (random() * exp) / 2);
}

export async function fetchJson<T>(
  url: string,
  limiter: RateLimiter | null,
  options: HttpOptions = {},
): Promise<T> {
  const {
    headers,
    timeoutMs = 15_000,
    maxRetries = 4,
    baseDelayMs = 500,
    maxDelayMs = 20_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    onRetry,
    onRequest,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await limiter?.acquire();
    onRequest?.();

    let retryDelay: number | null = null;
    let reason = "";

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 429) {
        retryDelay =
          parseRetryAfter(response.headers.get("retry-after")) ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);
        limiter?.penalize(retryDelay);
        reason = "HTTP 429";
        lastError = new HttpError(`HTTP 429 em ${url}`, 429, true);
      } else if (response.status >= 500 || response.status === 408) {
        retryDelay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
        reason = `HTTP ${response.status}`;
        lastError = new HttpError(`HTTP ${response.status} em ${url}`, response.status, true);
      } else {
        throw new HttpError(`HTTP ${response.status} em ${url}`, response.status, false);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        if (!error.retryable) throw error;
      } else {
        const name = (error as Error)?.name;
        reason = name === "TimeoutError" || name === "AbortError" ? "timeout" : "erro de rede";
        retryDelay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
        lastError = error;
      }
    }

    if (attempt === maxRetries || retryDelay === null) break;
    onRetry?.({ attempt: attempt + 1, delayMs: retryDelay, reason });
    // Com limiter o 429 já espera via penalize(); nos demais casos o backoff é aqui.
    if (!(reason === "HTTP 429" && limiter)) await sleep(retryDelay);
  }

  throw lastError instanceof Error ? lastError : new Error(`Falha ao requisitar ${url}`);
}
