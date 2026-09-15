/**
 * Load configuration from .env file and environment.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

export const config = {
  // Target wallets
  targetWallets: (process.env.TARGET_WALLETS || "auto").split(",").map((s) => s.trim()),
  autoTopCount: parseInt(process.env.AUTO_TOP_COUNT || "5"),

  // Paper trading
  bankroll: parseFloat(process.env.BANKROLL || "1000"),
  multiplier: parseFloat(process.env.POSITION_MULTIPLIER || "0.1"),
  maxTradeSize: parseFloat(process.env.MAX_TRADE_SIZE || "50"),
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || "1"),
  pollInterval: parseInt(process.env.POLL_INTERVAL || "5000"),

  // Dashboard
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || "3500"),

  // Live trading
  liveMode: process.env.LIVE_MODE === "true",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
  rpcUrl: process.env.RPC_URL || "",
  sigType: parseInt(process.env.SIG_TYPE || "0"),
  proxyWalletAddress: process.env.PROXY_WALLET_ADDRESS || "",
  geoToken: process.env.POLYMARKET_GEO_TOKEN || "",
  slippage: parseFloat(process.env.SLIPPAGE_TOLERANCE || "0.02"),
  orderType: process.env.ORDER_TYPE || "FOK",
  maxSessionNotional: parseFloat(process.env.MAX_SESSION_NOTIONAL || "100"),
  maxPerMarketNotional: parseFloat(process.env.MAX_PER_MARKET_NOTIONAL || "50"),
};
