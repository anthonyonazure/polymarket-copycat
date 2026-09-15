/**
 * Pull and display the Polymarket leaderboard.
 *
 * Usage: bun src/leaderboard.ts [--count 50] [--period all|weekly|monthly]
 */

import { getTopTraders, asText, pick, pickStr } from "./api.ts";

const args = process.argv.slice(2);
const count = parseInt(args.find((_, i) => args[i - 1] === "--count") || "50");
const period = args.find((_, i) => args[i - 1] === "--period") || "all";

console.log(`\nFetching top ${count} traders (period: ${period})...\n`);

try {
  const traders = await getTopTraders(count);

  if (!traders.length) {
    console.log("No leaderboard data returned. API may have changed.");
    console.log("Try visiting https://polymarket.com/leaderboard to verify.");
    process.exit(1);
  }

  console.log(`${"Rank".padStart(4)} | ${"Address".padEnd(44)} | ${"Profit".padStart(12)} | ${"Volume".padStart(12)} | ${"Markets".padStart(7)} | Name`);
  console.log("-".repeat(110));

  traders.forEach((t, i) => {
    const addr = pickStr(t, ["proxyWallet", "address", "wallet"], "unknown");
    const profit = pick(t, "pnl", "profit") ?? 0;
    const volume = pick(t, "vol", "volume") ?? 0;
    const markets = asText(pick(t, "markets_traded", "num_markets"), "?");
    const name = pickStr(t, ["userName", "username", "name"]);

    console.log(
      `${String(i + 1).padStart(4)} | ${addr.padEnd(44)} | ${formatUSD(profit).padStart(12)} | ${formatUSD(volume).padStart(12)} | ${markets.padStart(7)} | ${name}`
    );
  });

  console.log(`\nTotal: ${traders.length} traders`);

  // Save to file for analysis
  const outPath = "leaderboard.json";
  const { writeFileSync } = await import("fs");
  writeFileSync(outPath, JSON.stringify(traders, null, 2));
  console.log(`Saved to ${outPath}`);
} catch (err) {
  console.error("Error fetching leaderboard:", err instanceof Error ? err.message : err);
  process.exit(1);
}

function formatUSD(n: unknown): string {
  const num = parseFloat(asText(n, "")) || 0;
  if (Math.abs(num) >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}
