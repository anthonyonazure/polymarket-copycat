/**
 * Paper Trading Bot — monitors target wallets and simulates copy trades.
 *
 * No real money. No wallet needed. Just watches and records what would have happened.
 *
 * Usage:
 *   cp .env.example .env   # Edit settings
 *   node src/paper-trader.js
 *   node src/paper-trader.js --reset   # Clear state and start fresh
 */

import { config } from "./config.js";
import { Store } from "./store.js";
import { getWalletTrades, getTopTraders, getLeaderboard, sleep } from "./api.js";
import { rankWallets } from "./scorer.js";

const store = new Store();

if (process.argv.includes("--reset")) {
  const { unlinkSync } = await import("fs");
  try { unlinkSync("data/paper-state.json"); } catch {}
  console.log("State reset. Starting fresh.\n");
}

// ── Resolve target wallets ─────────────────────────────────

async function resolveTargets() {
  if (config.targetWallets[0] === "auto") {
    console.log(`Auto-selecting top ${config.autoTopCount} wallets...\n`);

    // Get all-time + weekly leaders
    const allTime = await getTopTraders(50);
    await sleep(500);
    const weeklyBatch = await getLeaderboard("WEEK", 50, 0);
    const weekly = Array.isArray(weeklyBatch) ? weeklyBatch : [];

    const weeklyAddrs = new Set(weekly.map((t) => (t.proxyWallet || "").toLowerCase()));
    const weeklyPnl = {};
    weekly.forEach((t) => {
      weeklyPnl[(t.proxyWallet || "").toLowerCase()] = parseFloat(t.pnl || 0);
    });

    // Merge and enrich
    const all = [...allTime, ...weekly];
    const seen = new Set();
    const unique = [];
    for (const t of all) {
      const addr = (t.proxyWallet || t.address || "").toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      unique.push({
        address: addr,
        username: t.userName || t.username || "",
        profit: parseFloat(t.pnl || t.profit || 0),
        weeklyActive: weeklyAddrs.has(addr),
        weeklyPnl: weeklyPnl[addr] || 0,
        trades: [], // Scorer needs this
      });
    }

    // Pick top N weekly-active wallets by weekly PnL (skip scorer since we have no trade data yet)
    const weeklyActiveWallets = unique
      .filter((w) => w.weeklyActive && w.weeklyPnl > 0)
      .sort((a, b) => b.weeklyPnl - a.weeklyPnl);
    const picks = weeklyActiveWallets.slice(0, config.autoTopCount).map((w) => ({
      address: w.address,
      username: w.username,
      score: 0,
      metrics: { weeklyPnl: w.weeklyPnl, weeklyActive: true },
    }));

    console.log("Selected wallets:");
    picks.forEach((w, i) => {
      console.log(`  ${i + 1}. ${w.address.slice(0, 14)}... (${w.username || "anon"}) — Score: ${w.score}, Weekly PnL: $${formatNum(w.metrics.weeklyPnl)}`);
    });
    console.log();

    return picks.map((w) => ({ address: w.address, username: w.username }));
  }

  return config.targetWallets.map((addr) => ({ address: addr.toLowerCase(), username: "" }));
}

// ── Monitor loop ───────────────────────────────────────────

async function monitorWallet(wallet) {
  const addr = wallet.address;
  try {
    const trades = await getWalletTrades(addr, 20, 0);
    const items = Array.isArray(trades) ? trades : trades?.data || [];

    for (const trade of items) {
      const tradeId = trade.transactionHash || `${trade.conditionId}-${trade.timestamp}-${trade.size}`;

      if (store.hasSeen(tradeId)) continue;

      const side = (trade.side || "").toUpperCase();
      const size = parseFloat(trade.size || 0);
      const price = parseFloat(trade.price || 0);

      // Only copy BUYs
      if (side !== "BUY") {
        store.s.seenTradeIds.push(tradeId);
        store.s.stats.skipped++;
        continue;
      }

      // Calculate copy size
      let copySize = Math.min(size * config.multiplier, config.maxTradeSize);
      if (copySize < config.minTradeSize) {
        store.s.seenTradeIds.push(tradeId);
        store.s.stats.skipped++;
        continue;
      }
      if (copySize > store.s.balance) {
        store.addLog(`Insufficient balance ($${store.s.balance.toFixed(2)}) for $${copySize.toFixed(2)} trade`);
        store.s.seenTradeIds.push(tradeId);
        continue;
      }

      // Record paper trade
      const paperTrade = {
        id: tradeId,
        timestamp: new Date().toISOString(),
        sourceWallet: addr,
        sourceUsername: wallet.username,
        side: "BUY",
        conditionId: trade.conditionId,
        asset: trade.asset,
        title: trade.title || trade.slug || "",
        outcome: trade.outcome || "",
        sourceSize: size,
        copySize: Math.round(copySize * 100) / 100,
        price,
        shares: price > 0 ? copySize / price : 0,
      };

      store.recordTrade(paperTrade);

      const msg = `COPY: ${wallet.username || addr.slice(0, 10)} BUY ${trade.outcome || "?"} @ ${price.toFixed(3)} — $${copySize.toFixed(2)} (source: $${size.toFixed(2)}) — ${trade.title || trade.slug || ""}`;
      store.addLog(msg);
      console.log(`  ${new Date().toLocaleTimeString()} | ${msg}`);
    }
  } catch (err) {
    // Silently handle transient errors
    if (!err.message.includes("429")) {
      store.addLog(`Error monitoring ${addr.slice(0, 10)}: ${err.message.slice(0, 60)}`);
    }
  }
}

async function printStatus() {
  const s = store.getSummary();
  const pnlSign = s.pnl >= 0 ? "+" : "";
  console.log(`\n  ── Status ──────────────────────────────────────`);
  console.log(`  Uptime: ${s.uptimeHours}h | Balance: $${s.balance} | PnL: ${pnlSign}$${s.pnl} (${pnlSign}${s.roi}%)`);
  console.log(`  Trades: ${s.totalTrades} | Invested: $${s.totalInvested} | Positions: ${s.openPositions}`);
  console.log(`  ────────────────────────────────────────────────\n`);
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("POLYMARKET PAPER TRADING BOT");
  console.log("=".repeat(60));
  console.log(`Mode:       PAPER (no real money)`);
  console.log(`Bankroll:   $${config.bankroll}`);
  console.log(`Multiplier: ${config.multiplier * 100}%`);
  console.log(`Max trade:  $${config.maxTradeSize}`);
  console.log(`Poll:       every ${config.pollInterval / 1000}s`);
  console.log("=".repeat(60) + "\n");

  const targets = await resolveTargets();
  store.init(config.bankroll, targets.map((t) => t.address));

  console.log(`\nMonitoring ${targets.length} wallets. Press Ctrl+C to stop.\n`);
  console.log(`Dashboard: http://localhost:${config.dashboardPort} (run 'npm run dashboard' in another terminal)\n`);

  let cycles = 0;

  while (true) {
    for (const wallet of targets) {
      await monitorWallet(wallet);
      await sleep(300); // Small delay between wallets to avoid rate limits
    }

    cycles++;
    if (cycles % 60 === 0) { // Print status every ~5 minutes
      await printStatus();
    }

    await sleep(config.pollInterval);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

function formatNum(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}
