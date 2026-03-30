/**
 * Polymarket API client — wraps leaderboard, data, gamma, and CLOB endpoints.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DATA_BASE = "https://data-api.polymarket.com";
const PROFILE_BASE = "https://polymarket.com/api";

const HEADERS = {
  "User-Agent": "PolymarketScanner/1.0",
  Accept: "application/json",
};

async function fetchJSON(url, retries = 3) {
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

      return await resp.json();
    } catch (err) {
      if (attempt < retries && (err.name === "TimeoutError" || err.code === "ECONNRESET")) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Leaderboard ────────────────────────────────────────────────

export async function getLeaderboard(timePeriod = "ALL", limit = 50, offset = 0, category = "OVERALL", orderBy = "PNL") {
  const url = `${DATA_BASE}/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=${orderBy}&limit=${limit}&offset=${offset}`;
  return await fetchJSON(url);
}

export async function getTopTraders(count = 200) {
  const traders = [];
  let offset = 0;
  const batchSize = 50; // API max is 50

  while (traders.length < count) {
    const batch = await getLeaderboard("ALL", batchSize, offset);
    const items = Array.isArray(batch) ? batch : batch?.leaderboard || batch?.data || [];
    if (!items.length) break;
    traders.push(...items);
    offset += batchSize;
    await sleep(500);
  }

  return traders.slice(0, count);
}

// ── Wallet Activity ────────────────────────────────────────────

export async function getWalletTrades(address, limit = 100, offset = 0) {
  const url = `${DATA_BASE}/trades?user=${address}&limit=${limit}&offset=${offset}`;
  return await fetchJSON(url);
}

export async function getWalletAllActivity(address, maxPages = 20) {
  const all = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < maxPages; page++) {
    const data = await getWalletTrades(address, limit, offset);
    const items = Array.isArray(data) ? data : data?.trades || data?.data || [];
    if (!items.length) break;
    all.push(...items);
    offset += limit;
    await sleep(300);
  }

  return all;
}

// ── Wallet Positions ───────────────────────────────────────────

export async function getWalletPositions(address) {
  const url = `${DATA_BASE}/positions?address=${address}`;
  return await fetchJSON(url);
}

// ── CLOB Trades ────────────────────────────────────────────────

export async function getTradesByWallet(address, limit = 100) {
  const url = `${CLOB_BASE}/trades?maker_address=${address}&limit=${limit}`;
  return await fetchJSON(url);
}

// ── Market Info ────────────────────────────────────────────────

export async function getMarket(conditionId) {
  const url = `${GAMMA_BASE}/markets/${conditionId}`;
  return await fetchJSON(url);
}

export async function getMarkets(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${GAMMA_BASE}/markets${query ? "?" + query : ""}`;
  return await fetchJSON(url);
}

// ── Profile ────────────────────────────────────────────────────

export async function getProfile(address) {
  const url = `${DATA_BASE}/profile?address=${address}`;
  try {
    return await fetchJSON(url);
  } catch {
    return null;
  }
}

export { sleep };
