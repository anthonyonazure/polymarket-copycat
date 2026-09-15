/**
 * Wallet scoring engine — ranks wallets by copy-trade quality.
 *
 * Scoring criteria (weighted):
 *   - Win rate (30%) — % of resolved markets where profit > 0
 *   - Consistency (25%) — low variance in returns, steady profits
 *   - Profit (20%) — total realized profit
 *   - Recency (15%) — recent activity weighted higher
 *   - Diversity (10%) — trades across many markets, not one lucky bet
 */

export interface WalletTrade {
  timestamp?: string | number;
  side?: string;
  size?: number | string;
  price?: number;
  market_id?: unknown;
  condition_id?: unknown;
  asset_id?: unknown;
  pnl?: number;
  resolved?: unknown;
}

export interface WalletInput {
  address: string;
  username?: string;
  name?: string;
  profit?: number;
  trades?: WalletTrade[];
  weeklyActive?: boolean;
  weeklyPnl?: number;
}

export interface WalletMetrics {
  efficiency: number;
  consistency: number;
  profit: number;
  recency: number;
  diversity: number;
  totalTrades: number;
  recentTrades: number;
  volume: number;
  buyRate: number;
  avgTradeSize: number;
  weeklyActive: boolean;
  weeklyPnl: number;
}

export interface ScoredWallet {
  address: string;
  username: string;
  score: number;
  grade: string;
  metrics: WalletMetrics;
}

export interface RejectedWallet extends WalletInput {
  score: 0;
  grade: "F";
  reason: string;
}

export function scoreWallet(wallet: WalletInput): ScoredWallet | RejectedWallet {
  const trades = wallet.trades || [];
  const profit = wallet.profit || 0;

  if (trades.length < 5) {
    return { ...wallet, score: 0, grade: "F", reason: "Too few trades" };
  }

  // Buy/Sell ratio — consistent buyers are better copy targets
  const buys = trades.filter((t) => (t.side || "").toUpperCase() === "BUY");
  const buyRate = trades.length > 0 ? buys.length / trades.length : 0;

  // Trade size consistency — low variance in trade sizes = disciplined trader
  const sizes = trades.map((t) => parseFloat(String(t.size)) || 0).filter((s) => s > 0);
  const avgSize = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);
  const sizeVariance = sizes.reduce((a, b) => a + (b - avgSize) ** 2, 0) / (sizes.length || 1);
  const sizeCV = avgSize > 0 ? Math.sqrt(sizeVariance) / avgSize : 10;
  const consistencyScore = Math.max(0, 1 - sizeCV / 5);

  // Recency — weekly leaderboard presence + recent trades
  const now = Date.now();
  const recentTrades = trades.filter((t) => {
    const ts = t.timestamp ? new Date(t.timestamp).getTime() : 0;
    return ts > 0 && (now - ts) < 7 * 24 * 60 * 60 * 1000;
  });
  const weeklyActive = wallet.weeklyActive || false;
  const weeklyPnl = wallet.weeklyPnl || 0;
  // Weekly active traders get a big boost; weekly profitable get more
  let recencyScore = 0;
  if (weeklyActive) recencyScore = 0.6;
  if (weeklyActive && weeklyPnl > 0) recencyScore = 0.8;
  if (weeklyActive && weeklyPnl > 10000) recencyScore = 1.0;
  // Also boost from trade timestamps
  recencyScore = Math.max(recencyScore, Math.min(1, recentTrades.length / 10));

  // Diversity — unique markets traded
  const uniqueMarkets = new Set(trades.map((t) => t.market_id || t.condition_id || t.asset_id).filter(Boolean));
  const diversityScore = Math.min(1, uniqueMarkets.size / 20);

  // Profit score — from leaderboard data, log scale
  const profitScore = profit > 0 ? Math.min(1, Math.log10(profit + 1) / 7) : 0;

  // Volume — total USDC traded
  const totalVolume = sizes.reduce((a, b) => a + b, 0);
  const volumeScore = totalVolume > 0 ? Math.min(1, Math.log10(totalVolume + 1) / 7) : 0;

  // Profit efficiency — profit per dollar of volume (ROI proxy)
  const efficiency = totalVolume > 0 ? profit / totalVolume : 0;
  const efficiencyScore = Math.min(1, Math.max(0, efficiency * 5));

  // Weighted composite — prioritize profit efficiency and recency
  const score =
    efficiencyScore * 0.25 +
    profitScore * 0.20 +
    recencyScore * 0.20 +
    diversityScore * 0.15 +
    consistencyScore * 0.10 +
    volumeScore * 0.10;

  const grade = getGrade(score);

  return {
    address: wallet.address,
    username: wallet.username || wallet.name || "anon",
    score: Math.round(score * 100),
    grade,
    metrics: {
      efficiency: Math.round(efficiencyScore * 100),
      consistency: Math.round(consistencyScore * 100),
      profit: Math.round(profit * 100) / 100,
      recency: Math.round(recencyScore * 100),
      diversity: uniqueMarkets.size,
      totalTrades: trades.length,
      recentTrades: recentTrades.length,
      volume: Math.round(totalVolume),
      buyRate: Math.round(buyRate * 100),
      avgTradeSize: Math.round(avgSize * 100) / 100,
      weeklyActive,
      weeklyPnl: Math.round(weeklyPnl * 100) / 100,
    },
  };
}

function getGrade(score: number): string {
  if (score >= 0.85) return "A+";
  if (score >= 0.75) return "A";
  if (score >= 0.65) return "B+";
  if (score >= 0.55) return "B";
  if (score >= 0.45) return "C+";
  if (score >= 0.35) return "C";
  if (score >= 0.25) return "D";
  return "F";
}

export function rankWallets(wallets: WalletInput[]): ScoredWallet[] {
  // A rejected wallet always has score 0, so "has metrics" adds no extra filtering;
  // it only tells the type system what `score > 0` already guarantees.
  return wallets
    .map(scoreWallet)
    .filter((w): w is ScoredWallet => "metrics" in w && w.score > 0)
    .sort((a, b) => b.score - a.score);
}
