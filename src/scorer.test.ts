import { describe, expect, test } from "bun:test";
import { rankWallets, scoreWallet } from "./scorer.ts";
import type { WalletInput, WalletTrade } from "./scorer.ts";

const DAY = 24 * 60 * 60 * 1000;

function trades(n: number, overrides: Partial<WalletTrade> = {}): WalletTrade[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.now() - 30 * DAY).toISOString(),
    side: "BUY",
    size: 100,
    market_id: `m${i}`,
    ...overrides,
  }));
}

describe("scoreWallet", () => {
  test("rejects wallets with fewer than 5 trades", () => {
    const result = scoreWallet({ address: "0xa", trades: trades(4) });
    expect(result).toMatchObject({ score: 0, grade: "F", reason: "Too few trades" });
  });

  test("scores a steady, diverse, profitable wallet from its inputs", () => {
    const result = scoreWallet({ address: "0xa", username: "alice", profit: 1000, trades: trades(20) });
    if (!("metrics" in result)) throw new Error("expected a scored wallet");
    // volume 2000, efficiency 0.5 -> 1; diversity 20 -> 1; equal sizes -> consistency 1;
    // no recent trades and not weekly active -> recency 0.
    expect(result.metrics).toMatchObject({
      efficiency: 100,
      consistency: 100,
      diversity: 20,
      totalTrades: 20,
      recentTrades: 0,
      recency: 0,
      volume: 2000,
      buyRate: 100,
      avgTradeSize: 100,
    });
    const expected = 0.25 + (Math.log10(1001) / 7) * 0.2 + 0.15 + 0.1 + (Math.log10(2001) / 7) * 0.1;
    expect(result.score).toBe(Math.round(expected * 100));
    expect(result.username).toBe("alice");
  });

  test("weekly activity and weekly profit raise recency in steps", () => {
    const base: WalletInput = { address: "0xa", trades: trades(5) };
    const recency = (w: WalletInput) => {
      const r = scoreWallet(w);
      return "metrics" in r ? r.metrics.recency : -1;
    };
    expect(recency(base)).toBe(0);
    expect(recency({ ...base, weeklyActive: true })).toBe(60);
    expect(recency({ ...base, weeklyActive: true, weeklyPnl: 1 })).toBe(80);
    expect(recency({ ...base, weeklyActive: true, weeklyPnl: 10001 })).toBe(100);
  });

  test("numeric strings in size are parsed, not concatenated", () => {
    const result = scoreWallet({ address: "0xa", trades: trades(5, { size: "50" }) });
    expect("metrics" in result && result.metrics.volume).toBe(250);
  });
});

describe("rankWallets", () => {
  test("drops rejected wallets and sorts by score, highest first", () => {
    const ranked = rankWallets([
      { address: "low", profit: 1, trades: trades(5) },
      { address: "rejected", profit: 1e6, trades: trades(2) },
      { address: "high", profit: 1e5, trades: trades(20), weeklyActive: true, weeklyPnl: 20000 },
    ]);
    expect(ranked.map((w) => w.address)).toEqual(["high", "low"]);
  });
});
