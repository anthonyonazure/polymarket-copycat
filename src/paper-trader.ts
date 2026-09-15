/**
 * Paper Trading Bot — monitors target wallets and simulates copy trades.
 *
 * No real money. No wallet needed. Just watches and records what would have happened.
 *
 * Usage:
 *   cp .env.example .env   # Edit settings
 *   bun src/paper-trader.ts
 *   bun src/paper-trader.ts --reset   # Clear state and start fresh
 */

import { config } from "./config.ts";
import { Store } from "./store.ts";
import type { PaperTrade } from "./store.ts";
import { getWalletTrades, getTopTraders, getLeaderboard, sleep, asList, asOptStr, pickNum, pickOptStr, pickStr } from "./api.ts";

interface Target {
  address: string;
  username: string;
}

const store = new Store();

if (process.argv.includes("--reset")) {
  const { unlinkSync } = await import("fs");
  try {
    unlinkSync("data/paper-state.json");
  } catch (err) {
    // No state file yet is the normal case for a reset. Anything else (permissions,
    // a directory in the way) means the reset did not happen, so say so instead of
    // printing "State reset" over a stale file.
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code !== "ENOENT") {
      console.error(`Could not delete data/paper-state.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("State reset. Starting fresh.\n");
}

// ── Resolve target wallets ─────────────────────────────────

async function resolveTargets(): Promise<Target[]> {
  if (config.targetWallets[0] === "auto") {
    console.log(`Auto-selecting top ${config.autoTopCount} wallets...\n`);

    // Get all-time + weekly leaders
    const allTime = await getTopTraders(50);
    await sleep(500);
    const weeklyBatch = await getLeaderboard("WEEK", 50, 0);
    const weekly = asList(weeklyBatch);

    const weeklyAddrs = new Set(weekly.map((t) => pickStr(t, ["proxyWallet"]).toLowerCase()));
    const weeklyPnl: Record<string, number> = {};
    weekly.forEach((t) => {
      weeklyPnl[pickStr(t, ["proxyWallet"]).toLowerCase()] = pickNum(t, "pnl");
    });

    // Merge and enrich
    const all = [...allTime, ...weekly];
    const seen = new Set<string>();
    const unique = [];
    for (const t of all) {
      const addr = pickStr(t, ["proxyWallet", "address"]).toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      unique.push({
        address: addr,
        username: pickStr(t, ["userName", "username"]),
        profit: pickNum(t, "pnl", "profit"),
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

async function monitorWallet(wallet: Target): Promise<void> {
  const addr = wallet.address;
  try {
    const trades = await getWalletTrades(addr, 20, 0);
    const items = asList(trades, "data");

    for (const trade of items) {
      const tradeId =
        pickOptStr(trade, "transactionHash") ||
        `${String(trade.conditionId)}-${String(trade.timestamp)}-${String(trade.size)}`;

      if (store.hasSeen(tradeId)) continue;

      const side = pickStr(trade, ["side"]).toUpperCase();
      const size = pickNum(trade, "size");
      const price = pickNum(trade, "price");

      // Only copy BUYs
      if (side !== "BUY") {
        store.s.seenTradeIds.push(tradeId);
        store.s.stats.skipped++;
        continue;
      }

      // Calculate copy size
      const copySize = Math.min(size * config.multiplier, config.maxTradeSize);
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
      const paperTrade: PaperTrade = {
        id: tradeId,
        timestamp: new Date().toISOString(),
        sourceWallet: addr,
        sourceUsername: wallet.username,
        side: "BUY",
        conditionId: asOptStr(trade.conditionId),
        asset: asOptStr(trade.asset),
        title: pickStr(trade, ["title", "slug"]),
        outcome: pickStr(trade, ["outcome"]),
        sourceSize: size,
        copySize: Math.round(copySize * 100) / 100,
        price,
        shares: price > 0 ? copySize / price : 0,
      };

      store.recordTrade(paperTrade);

      const msg = `COPY: ${wallet.username || addr.slice(0, 10)} BUY ${pickStr(trade, ["outcome"], "?")} @ ${price.toFixed(3)} — $${copySize.toFixed(2)} (source: $${size.toFixed(2)}) — ${pickStr(trade, ["title", "slug"])}`;
      store.addLog(msg);
      console.log(`  ${new Date().toLocaleTimeString()} | ${msg}`);
    }
  } catch (err) {
    // Silently handle transient errors
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("429")) {
      store.addLog(`Error monitoring ${addr.slice(0, 10)}: ${message.slice(0, 60)}`);
    }
  }
}

function printStatus(): void {
  const s = store.getSummary();
  const pnlSign = s.pnl >= 0 ? "+" : "";
  console.log(`\n  ── Status ──────────────────────────────────────`);
  console.log(`  Uptime: ${s.uptimeHours}h | Balance: $${s.balance} | PnL: ${pnlSign}$${s.pnl} (${pnlSign}${s.roi}%)`);
  console.log(`  Trades: ${s.totalTrades} | Invested: $${s.totalInvested} | Positions: ${s.openPositions}`);
  console.log(`  ────────────────────────────────────────────────\n`);
}

// ── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
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
  console.log(`Dashboard: http://localhost:${config.dashboardPort} (run 'bun run dashboard' in another terminal)\n`);

  let cycles = 0;

  while (true) {
    for (const wallet of targets) {
      await monitorWallet(wallet);
      await sleep(300); // Small delay between wallets to avoid rate limits
    }

    cycles++;
    if (cycles % 60 === 0) { // Print status every ~5 minutes
      printStatus();
    }

    await sleep(config.pollInterval);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});

function formatNum(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}
