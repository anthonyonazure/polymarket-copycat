/**
 * Persistent JSON store for paper trading state.
 * Saves trades, positions, and P&L to disk so you can stop and resume.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(process.cwd(), "data");

export class Store {
  constructor(filename = "paper-state.json") {
    mkdirSync(DATA_DIR, { recursive: true });
    this.path = resolve(DATA_DIR, filename);
    this.state = this._load();
  }

  _load() {
    if (existsSync(this.path)) {
      return JSON.parse(readFileSync(this.path, "utf-8"));
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

  save() {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  get s() {
    return this.state;
  }

  init(bankroll, targetWallets) {
    if (!this.state.bankroll) {
      this.state.bankroll = bankroll;
      this.state.balance = bankroll;
    }
    this.state.targetWallets = targetWallets;
    this.save();
  }

  hasSeen(tradeId) {
    return this.state.seenTradeIds.includes(tradeId);
  }

  recordTrade(trade) {
    this.state.seenTradeIds.push(trade.id);
    // Keep last 10000 to prevent unbounded growth
    if (this.state.seenTradeIds.length > 10000) {
      this.state.seenTradeIds = this.state.seenTradeIds.slice(-5000);
    }

    this.state.trades.push(trade);
    this.state.stats.totalTrades++;
    this.state.stats.totalInvested += trade.copySize;
    this.state.balance -= trade.copySize;

    // Track position
    const mkt = trade.conditionId || trade.market;
    if (!this.state.positions[mkt]) {
      this.state.positions[mkt] = { invested: 0, shares: 0, trades: 0, title: trade.title || mkt };
    }
    this.state.positions[mkt].invested += trade.copySize;
    this.state.positions[mkt].shares += trade.price > 0 ? trade.copySize / trade.price : 0;
    this.state.positions[mkt].trades++;

    this.save();
  }

  addLog(msg) {
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
