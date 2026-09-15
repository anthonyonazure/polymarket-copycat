/**
 * Polymarket API client — wraps leaderboard, data, gamma, and CLOB endpoints.
 *
 * Every response is parsed as `unknown` and narrowed before use. The endpoints
 * are undocumented and return differently shaped records over time (proxyWallet
 * vs address, pnl vs profit), so records are kept as plain JSON objects and read
 * through the typed field readers below rather than trusted as a fixed shape.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DATA_BASE = "https://data-api.polymarket.com";

const HEADERS = {
  "User-Agent": "PolymarketScanner/1.0",
  Accept: "application/json",
};

// ── JSON narrowing ─────────────────────────────────────────────

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First truthy field among `keys`, mirroring `o.a || o.b`; undefined when none is truthy. */
export function pick(o: JsonObject, ...keys: string[]): unknown {
  for (const key of keys) {
    if (o[key]) return o[key];
  }
  return undefined;
}

type Scalar = string | number | boolean | bigint;

function isScalar(value: unknown): value is Scalar {
  return ["string", "number", "boolean", "bigint"].includes(typeof value);
}

/**
 * First truthy field as a string, or `fallback`, mirroring `o.a || o.b || fallback`.
 * A nested object or array is not a usable string, so it counts as missing rather
 * than printing "[object Object]".
 */
export function pickStr(o: JsonObject, keys: string[], fallback = ""): string {
  const value = pick(o, ...keys);
  return isScalar(value) ? String(value) : fallback;
}

/** First truthy field as a string, or undefined when none is a truthy scalar. */
export function pickOptStr(o: JsonObject, ...keys: string[]): string | undefined {
  const value = pick(o, ...keys);
  return isScalar(value) ? String(value) : undefined;
}

/** A raw field kept as-is when it is a string (even ""), stringified when scalar, undefined otherwise. */
export function asOptStr(value: unknown): string | undefined {
  return isScalar(value) ? String(value) : undefined;
}

/** A field for display: scalars as text, anything else as `fallback`. */
export function asText(value: unknown, fallback: string): string {
  return isScalar(value) ? String(value) : fallback;
}

/** `parseFloat(o.a || o.b || 0)`: a missing field is 0, a non-numeric one is NaN, as before. */
export function pickNum(o: JsonObject, ...keys: string[]): number {
  const value = pick(o, ...keys);
  if (value === undefined) return 0;
  return isScalar(value) ? parseFloat(String(value)) : NaN;
}

/**
 * The list inside a response: the response itself when it is an array, else the
 * first truthy array-valued field among `keys`. Non-object entries are dropped.
 * `rawLength` is the length before dropping, so pagination stops at the same page.
 */
function listFrom(data: unknown, keys: string[]): { items: JsonObject[]; rawLength: number } {
  let raw: unknown = data;
  if (!Array.isArray(data)) {
    raw = isJsonObject(data) ? pick(data, ...keys) : undefined;
  }
  if (!Array.isArray(raw)) return { items: [], rawLength: 0 };
  const list: unknown[] = raw;
  return { items: list.filter(isJsonObject), rawLength: list.length };
}

export function asList(data: unknown, ...keys: string[]): JsonObject[] {
  return listFrom(data, keys).items;
}

// ── HTTP ───────────────────────────────────────────────────────

function errorField(err: unknown, field: "name" | "code"): unknown {
  return typeof err === "object" && err !== null && field in err ? (err as Record<typeof field, unknown>)[field] : undefined;
}

async function fetchJSON(url: string, retries = 3): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });

      if (resp.status === 429) {
        const wait = parseInt(resp.headers.get("Retry-After") || "5") * 1000;
        console.log(`  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!resp.ok) {
        if (attempt < retries) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`HTTP ${resp.status}: ${url}`);
      }

      const body: unknown = await resp.json();
      return body;
    } catch (err) {
      if (attempt < retries && (errorField(err, "name") === "TimeoutError" || errorField(err, "code") === "ECONNRESET")) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Leaderboard ────────────────────────────────────────────────

export async function getLeaderboard(timePeriod = "ALL", limit = 50, offset = 0, category = "OVERALL", orderBy = "PNL"): Promise<unknown> {
  const url = `${DATA_BASE}/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=${orderBy}&limit=${limit}&offset=${offset}`;
  return await fetchJSON(url);
}

export async function getTopTraders(count = 200): Promise<JsonObject[]> {
  const traders: JsonObject[] = [];
  let offset = 0;
  const batchSize = 50; // API max is 50

  while (traders.length < count) {
    const batch = await getLeaderboard("ALL", batchSize, offset);
    const { items, rawLength } = listFrom(batch, ["leaderboard", "data"]);
    if (!rawLength) break;
    traders.push(...items);
    offset += batchSize;
    await sleep(500);
  }

  return traders.slice(0, count);
}

// ── Wallet Activity ────────────────────────────────────────────

export async function getWalletTrades(address: string, limit = 100, offset = 0): Promise<unknown> {
  const url = `${DATA_BASE}/trades?user=${address}&limit=${limit}&offset=${offset}`;
  return await fetchJSON(url);
}

export async function getWalletAllActivity(address: string, maxPages = 20): Promise<JsonObject[]> {
  const all: JsonObject[] = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < maxPages; page++) {
    const data = await getWalletTrades(address, limit, offset);
    const { items, rawLength } = listFrom(data, ["trades", "data"]);
    if (!rawLength) break;
    all.push(...items);
    offset += limit;
    await sleep(300);
  }

  return all;
}

// ── Wallet Positions ───────────────────────────────────────────

export async function getWalletPositions(address: string): Promise<unknown> {
  const url = `${DATA_BASE}/positions?address=${address}`;
  return await fetchJSON(url);
}

// ── CLOB Trades ────────────────────────────────────────────────

export async function getTradesByWallet(address: string, limit = 100): Promise<unknown> {
  const url = `${CLOB_BASE}/trades?maker_address=${address}&limit=${limit}`;
  return await fetchJSON(url);
}

// ── Market Info ────────────────────────────────────────────────

export async function getMarket(conditionId: string): Promise<unknown> {
  const url = `${GAMMA_BASE}/markets/${conditionId}`;
  return await fetchJSON(url);
}

export async function getMarkets(params: Record<string, string> = {}): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  const url = `${GAMMA_BASE}/markets${query ? "?" + query : ""}`;
  return await fetchJSON(url);
}

// ── Profile ────────────────────────────────────────────────────

export async function getProfile(address: string): Promise<unknown> {
  const url = `${DATA_BASE}/profile?address=${address}`;
  try {
    return await fetchJSON(url);
  } catch {
    return null;
  }
}

export { sleep };
