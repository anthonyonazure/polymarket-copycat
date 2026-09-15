/**
 * Live dashboard — web UI for monitoring paper trading performance.
 *
 * Usage: bun src/dashboard.ts
 * Then open http://localhost:3500
 */

import { createServer } from "http";
import { Store } from "./store.ts";
import { config } from "./config.ts";

const store = new Store();
const PORT = config.dashboardPort;

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Polymarket Copycat — Paper Trading</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', system-ui, sans-serif; padding: 20px; }
    h1 { color: #58a6ff; margin-bottom: 5px; }
    .subtitle { color: #8b949e; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card .label { color: #8b949e; font-size: 12px; text-transform: uppercase; }
    .card .value { font-size: 24px; font-weight: 600; margin-top: 4px; }
    .positive { color: #3fb950; }
    .negative { color: #f85149; }
    .neutral { color: #c9d1d9; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align: left; color: #8b949e; font-size: 12px; text-transform: uppercase; padding: 8px; border-bottom: 1px solid #30363d; }
    td { padding: 8px; border-bottom: 1px solid #21262d; font-size: 13px; }
    tr:hover { background: #161b22; }
    .section { margin-bottom: 24px; }
    .section h2 { color: #58a6ff; font-size: 16px; margin-bottom: 8px; }
    .log { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; }
    .log div { padding: 2px 0; border-bottom: 1px solid #161b22; }
    .log .time { color: #8b949e; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge.buy { background: #1f6feb33; color: #58a6ff; }
    .badge.paper { background: #3fb95033; color: #3fb950; }
    .refresh { color: #8b949e; font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Polymarket Copycat</h1>
  <p class="subtitle"><span class="badge paper">PAPER MODE</span> Auto-refreshes every 10s</p>

  <div class="grid" id="stats"></div>

  <div class="section">
    <h2>Recent Trades</h2>
    <table>
      <thead><tr><th>Time</th><th>Source</th><th>Side</th><th>Market</th><th>Outcome</th><th>Price</th><th>Copy Size</th></tr></thead>
      <tbody id="trades"></tbody>
    </table>
  </div>

  <div class="section">
    <h2>Open Positions</h2>
    <table>
      <thead><tr><th>Market</th><th>Invested</th><th>Shares</th><th>Trades</th></tr></thead>
      <tbody id="positions"></tbody>
    </table>
  </div>

  <div class="section">
    <h2>Activity Log</h2>
    <div class="log" id="log"></div>
  </div>

  <p class="refresh">Last updated: <span id="updated">—</span></p>

  <script>
    async function refresh() {
      const resp = await fetch('/api/status');
      const d = await resp.json();

      const pnlClass = d.pnl >= 0 ? 'positive' : 'negative';
      const pnlSign = d.pnl >= 0 ? '+' : '';

      document.getElementById('stats').innerHTML =
        card('Bankroll', '$' + d.bankroll) +
        card('Balance', '$' + d.balance, d.balance >= d.bankroll ? 'positive' : 'negative') +
        card('P&L', pnlSign + '$' + d.pnl + ' (' + pnlSign + d.roi + '%)', pnlClass) +
        card('Trades', d.totalTrades) +
        card('Invested', '$' + d.totalInvested) +
        card('Positions', d.openPositions) +
        card('Wallets', d.targetWallets) +
        card('Uptime', d.uptimeHours + 'h');

      const trades = d.recentTrades || [];
      document.getElementById('trades').innerHTML = trades.reverse().map(t =>
        '<tr>' +
        '<td>' + new Date(t.timestamp).toLocaleTimeString() + '</td>' +
        '<td>' + (t.sourceUsername || t.sourceWallet?.slice(0,10) || '?') + '</td>' +
        '<td><span class="badge buy">BUY</span></td>' +
        '<td>' + (t.title || t.conditionId || '').slice(0, 40) + '</td>' +
        '<td>' + (t.outcome || '?') + '</td>' +
        '<td>' + (t.price?.toFixed(3) || '?') + '</td>' +
        '<td>$' + (t.copySize?.toFixed(2) || '?') + '</td>' +
        '</tr>'
      ).join('');

      const pos = await fetch('/api/positions').then(r => r.json());
      document.getElementById('positions').innerHTML = pos.map(p =>
        '<tr><td>' + p.title.slice(0,50) + '</td><td>$' + p.invested.toFixed(2) + '</td><td>' + p.shares.toFixed(2) + '</td><td>' + p.trades + '</td></tr>'
      ).join('');

      const log = (d.recentLog || []).reverse();
      document.getElementById('log').innerHTML = log.map(l =>
        '<div><span class="time">' + new Date(l.time).toLocaleTimeString() + '</span> ' + l.msg + '</div>'
      ).join('');

      document.getElementById('updated').textContent = new Date().toLocaleTimeString();
    }

    function card(label, value, cls) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value ' + (cls||'neutral') + '">' + value + '</div></div>';
    }

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === "/api/status") {
    const summary = store.getSummary();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(summary));
  } else if (req.url === "/api/positions") {
    const positions = Object.entries(store.s.positions).map(([id, p]) => ({
      id,
      title: p.title || id,
      invested: p.invested,
      shares: p.shares,
      trades: p.trades,
    }));
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(positions));
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Reads from data/paper-state.json (updated by paper-trader)`);
});
