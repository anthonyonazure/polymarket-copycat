/**
 * Full scanner — leaderboard → analyze → rank → recommend.
 *
 * Usage:
 *   node src/scanner.js                    # Scan top 50, analyze, rank
 *   node src/scanner.js --count 100        # Scan top 100
 *   node src/scanner.js --quick            # Leaderboard only, no deep analysis
 */

import { getTopTraders, getWalletAllActivity, getProfile, sleep } from "./api.js";
import { rankWallets } from "./scorer.js";
import { writeFileSync } from "fs";

const args = process.argv.slice(2);
const count = parseInt(args.find((_, i) => args[i - 1] === "--count") || "50");
const quick = args.includes("--quick");

console.log("\n" + "=".repeat(70));
console.log("POLYMARKET WHALE SCANNER");
console.log("=".repeat(70));
console.log(`Scanning top ${count} traders...`);
console.log(`Mode: ${quick ? "Quick (leaderboard only)" : "Deep (with trade analysis)"}`);
console.log("=".repeat(70) + "\n");

// Step 1: Get leaderboard — merge all-time + weekly for recency signal
console.log("Step 1: Fetching leaderboards...");
const { getLeaderboard } = await import("./api.js");

const allTimeLeaders = await getTopTraders(count);
console.log(`  All-time: ${allTimeLeaders.length} traders`);

await sleep(500);
const weeklyBatch = await getLeaderboard("WEEK", 50, 0);
const weeklyLeaders = Array.isArray(weeklyBatch) ? weeklyBatch : weeklyBatch?.data || [];
console.log(`  Weekly:   ${weeklyLeaders.length} traders`);

// Build a set of weekly-active addresses for recency boost
const weeklyActive = new Set(weeklyLeaders.map((t) => (t.proxyWallet || t.address || "").toLowerCase()));
const weeklyPnl = {};
weeklyLeaders.forEach((t) => {
  const addr = (t.proxyWallet || t.address || "").toLowerCase();
  weeklyPnl[addr] = parseFloat(t.pnl || t.profit || 0);
});

// Merge: start with all-time, tag weekly-active ones
const leaders = allTimeLeaders.map((t) => {
  const addr = (t.proxyWallet || t.address || "").toLowerCase();
  return { ...t, weeklyActive: weeklyActive.has(addr), weeklyPnl: weeklyPnl[addr] || 0 };
});

// Add any weekly leaders not in all-time top
const allTimeAddrs = new Set(leaders.map((t) => (t.proxyWallet || t.address || "").toLowerCase()));
for (const t of weeklyLeaders) {
  const addr = (t.proxyWallet || t.address || "").toLowerCase();
  if (!allTimeAddrs.has(addr)) {
    leaders.push({ ...t, weeklyActive: true, weeklyPnl: parseFloat(t.pnl || 0) });
  }
}

console.log(`  Merged:   ${leaders.length} unique traders\n`);

if (!leaders.length) {
  console.log("No data returned. Polymarket API may have changed.");
  console.log("Check: https://polymarket.com/leaderboard");
  process.exit(1);
}

if (quick) {
  // Quick mode — just show leaderboard with basic info
  leaders.forEach((t, i) => {
    const addr = t.proxyWallet || t.address || t.wallet || "?";
    const profit = parseFloat(t.pnl || t.profit || 0);
    const name = t.userName || t.username || t.name || "";
    console.log(`${String(i + 1).padStart(3)}. ${addr.slice(0, 10)}...${addr.slice(-4)} | ${formatUSD(profit).padStart(10)} | ${name}`);
  });
  writeFileSync("leaderboard.json", JSON.stringify(leaders, null, 2));
  console.log(`\nSaved to leaderboard.json`);
  process.exit(0);
}

// Step 2: Deep analysis
console.log("Step 2: Analyzing trade histories...\n");

const wallets = [];

for (let i = 0; i < leaders.length; i++) {
  const t = leaders[i];
  const addr = t.proxyWallet || t.address || t.wallet;
  if (!addr) continue;

  const name = t.userName || t.username || t.name || "";
  const profit = parseFloat(t.pnl || t.profit || 0);

  process.stdout.write(`  [${i + 1}/${leaders.length}] ${(name || addr.slice(0, 10)).padEnd(20)}`);

  try {
    const activity = await getWalletAllActivity(addr, 5); // 5 pages max for speed
    const trades = activity.map((a) => ({
      timestamp: a.timestamp || a.created_at || a.createdAt,
      side: a.side || a.type || "",
      size: parseFloat(a.size || a.amount || a.usdcSize || 0),
      price: parseFloat(a.price || a.avgPrice || 0),
      market_id: a.market || a.conditionId || a.condition_id,
      pnl: parseFloat(a.pnl || a.profit || 0),
      resolved: a.resolved || a.isResolved || false,
    }));

    wallets.push({ address: addr, username: name, profit, trades, weeklyActive: t.weeklyActive || false, weeklyPnl: t.weeklyPnl || 0 });
    console.log(`${trades.length} trades${t.weeklyActive ? " [ACTIVE THIS WEEK]" : ""}`);
  } catch (err) {
    wallets.push({ address: addr, username: name, profit, trades: [], weeklyActive: t.weeklyActive || false, weeklyPnl: t.weeklyPnl || 0 });
    console.log(`error: ${err.message.slice(0, 40)}`);
  }

  await sleep(300);
}

// Step 3: Score and rank
console.log("\n" + "=".repeat(70));
console.log("RANKINGS");
console.log("=".repeat(70) + "\n");

const ranked = rankWallets(wallets);

console.log(
  `${"#".padStart(3)} | ${"Score".padStart(5)} | ${"Grd".padEnd(3)} | ${"Effic".padStart(5)} | ${"Profit".padStart(10)} | ${"Wk PnL".padStart(10)} | ${"Trades".padStart(6)} | ${"Mkts".padStart(4)} | ${"Active".padEnd(6)} | Wallet`
);
console.log("-".repeat(110));

ranked.slice(0, 30).forEach((w, i) => {
  const m = w.metrics;
  const active = m.weeklyActive ? "  YES" : "   --";
  console.log(
    `${String(i + 1).padStart(3)} | ${String(w.score).padStart(5)} | ${w.grade.padEnd(3)} | ${(m.efficiency + "%").padStart(5)} | ${formatUSD(m.profit).padStart(10)} | ${formatUSD(m.weeklyPnl).padStart(10)} | ${String(m.totalTrades).padStart(6)} | ${String(m.diversity).padStart(4)} | ${active} | ${w.address.slice(0, 10)}...${w.address.slice(-4)} ${w.username ? "(" + w.username + ")" : ""}`
  );
});

// Save
writeFileSync("analysis.json", JSON.stringify(ranked, null, 2));
writeFileSync("top-wallets.txt", ranked.slice(0, 10).map((w) => w.address).join("\n") + "\n");

// Recommendations
console.log("\n" + "=".repeat(70));
console.log("RECOMMENDED WALLETS TO COPY");
console.log("=".repeat(70) + "\n");

const topPicks = ranked.filter((w) => w.grade.startsWith("A") || w.grade === "B+").slice(0, 5);

if (topPicks.length === 0) {
  console.log("No A/B+ wallets found. Consider expanding the scan (--count 200).");
  console.log("Top 3 regardless:\n");
  ranked.slice(0, 3).forEach(printRecommendation);
} else {
  topPicks.forEach(printRecommendation);
}

console.log(`\nResults saved to: analysis.json, top-wallets.txt`);
console.log(`\nNext steps:`);
console.log(`  1. Review the top wallets on polymarket.com/profile/<address>`);
console.log(`  2. Run what-if simulation: node src/whatif.js --top 5`);
console.log(`  3. Use top-wallets.txt with the copy trading bot`);

function printRecommendation(w, i) {
  const m = w.metrics;
  console.log(`${i + 1}. ${w.address}`);
  console.log(`   ${w.username || "Anonymous"} | Score: ${w.score}/100 (${w.grade})`);
  console.log(`   Win: ${m.winRate}% | Profit: ${formatUSD(m.profit)} | ${m.totalTrades} trades across ${m.diversity} markets`);
  console.log(`   ${m.recentTrades} trades in last 7 days | Consistency: ${m.consistency}%`);
  console.log();
}

function formatUSD(n) {
  const num = parseFloat(n) || 0;
  if (Math.abs(num) >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}
