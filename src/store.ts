/**
 * Persistent JSON store for paper trading state.
 * Saves trades, positions, and P&L to disk so you can stop and resume.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(process.cwd(), "data");

export interface PaperTrade {
  id: string;
  timestamp: string;
  sourceWallet: string;
  sourceUsername: string;
  side: "BUY";
  conditionId?: string;
  market?: string;
  asset?: string;
  title: string;
  outcome: string;
  sourceSize: number;
  copySize: number;
  price: number;
  shares: number;
}

export interface Position {
  invested: number;
  shares: number;
  trades: number;
  title?: string;
}

export interface LogEntry {
  time: string;
  msg: string;
}

export interface StoreState {
  startedAt: string;
  bankroll: number;
  balance: number;
  trades: PaperTrade[];
  positions: Record<string, Position>;
  seenTradeIds: string[];
  stats: {
    totalTrades: number;
    totalInvested: number;
    totalReturned: number;
    wins: number;
    losses: number;
    skipped: number;
  };
  targetWallets: string[];
  log: LogEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The state file is written only by this store, so anything that does not match
 * the shape is a corrupted or foreign file. Fail loudly on load instead of letting
 * a missing field surface later as NaN balances or a crash mid-trade.
 */
function assertStoreState(value: unknown, path: string): asserts value is StoreState {
  const stats = isObject(value) ? value.stats : undefined;
  const ok =
    isObject(value) &&
    typeof value.startedAt === "string" &&
    typeof value.bankroll === "number" &&
    typeof value.balance === "number" &&
    Array.isArray(value.trades) &&
    isObject(value.positions) &&
    Array.isArray(value.seenTradeIds) &&
    Array.isArray(value.targetWallets) &&
    Array.isArray(value.log) &&
    isObject(stats) &&
    ["totalTrades", "totalInvested", "totalReturned", "wins", "losses", "skipped"].every((k) => typeof stats[k] === "number");
  if (!ok) {
    throw new Error(`State file ${path} is not a valid paper-trading state file`);
  }
}

export class Store {
  path: string;
  state: StoreState;

  constructor(filename = "paper-state.json") {
    mkdirSync(DATA_DIR, { recursive: true });
    this.path = resolve(DATA_DIR, filename);
    this.state = this._load();
  }

  _load(): StoreState {
    if (existsSync(this.path)) {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf-8"));
      assertStoreState(parsed, this.path);
      return parsed;
    }
    return {
      startedAt: new Date().toISOString(),
      bankroll: 0,
      balance: 0,
      trades: [],
      positions: {},
      seenTradeIds: [],
      stats: {
        totalTrades: 0,
        totalInvested: 0,
        totalReturned: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
      },
      targetWallets: [],
      log: [],
    };
  }

  save(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  get s(): StoreState {
    return this.state;
  }

  init(bankroll: number, targetWallets: string[]): void {
    if (!this.state.bankroll) {
      this.state.bankroll = bankroll;
      this.state.balance = bankroll;
    }
    this.state.targetWallets = targetWallets;
    this.save();
  }

  hasSeen(tradeId: string): boolean {
    return this.state.seenTradeIds.includes(tradeId);
  }

  recordTrade(trade: PaperTrade): void {
    this.state.seenTradeIds.push(trade.id);
    // Keep last 10000 to prevent unbounded growth
    if (this.state.seenTradeIds.length > 10000) {
      this.state.seenTradeIds = this.state.seenTradeIds.slice(-5000);
    }

    this.state.trades.push(trade);
    this.state.stats.totalTrades++;
    this.state.stats.totalInvested += trade.copySize;
    this.state.balance -= trade.copySize;

    // Track position. A trade with no market id lands under the key "undefined",
    // exactly as indexing an object with an undefined key always did.
    const mkt = trade.conditionId || trade.market;
    const key = String(mkt);
    let position = this.state.positions[key];
    if (!position) {
      position = { invested: 0, shares: 0, trades: 0, title: trade.title || mkt };
      this.state.positions[key] = position;
    }
    position.invested += trade.copySize;
    position.shares += trade.price > 0 ? trade.copySize / trade.price : 0;
    position.trades++;

    this.save();
  }

  addLog(msg: string): void {
    const entry = { time: new Date().toISOString(), msg };
    this.state.log.push(entry);
    // Keep last 500 log entries
    if (this.state.log.length > 500) {
      this.state.log = this.state.log.slice(-250);
    }
    this.save();
  }

  getSummary() {
    const s = this.state;
    const pnl = s.balance - s.bankroll;
    const roi = s.bankroll > 0 ? (pnl / s.bankroll) * 100 : 0;
    const uptime = (Date.now() - new Date(s.startedAt).getTime()) / (1000 * 60 * 60);

    return {
      startedAt: s.startedAt,
      uptimeHours: Math.round(uptime * 10) / 10,
      bankroll: s.bankroll,
      balance: Math.round(s.balance * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      roi: Math.round(roi * 10) / 10,
      totalTrades: s.stats.totalTrades,
      totalInvested: Math.round(s.stats.totalInvested * 100) / 100,
      openPositions: Object.keys(s.positions).length,
      targetWallets: s.targetWallets.length,
      recentTrades: s.trades.slice(-10),
      recentLog: s.log.slice(-20),
    };
  }
}
