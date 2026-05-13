// ═══════════════════════════════════════════════════════════════════════════
// laporan.js — Aggregator + render dashboard performa bisnis
//
// Tab "Laporan" sebagai lensa analitik bulanan:
//   - 5 KPI (revenue, profit, margin, units, channel split)
//   - Trend chart toggleable (3/6/12M × revenue/profit/margin/units)
//   - Comparison table 6 bulan + Avg/Best
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { fmt } from './helpers.js';

const BULAN_ID      = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const BULAN_ID_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ── Module state (selector state hanya hidup selama session) ─────────────────
let selectedYear  = null;
let selectedMonth = null;
let trendRange    = 6;          // 3 | 6 | 12
let trendMetric   = 'revenue';  // 'revenue' | 'profit' | 'margin' | 'units'
let chartInstance = null;

function ensureInit() {
  if (selectedYear === null) {
    const now = new Date();
    selectedYear  = now.getFullYear();
    selectedMonth = now.getMonth() + 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregator functions (pure)
// ═══════════════════════════════════════════════════════════════════════════

// Channel detection: note mengandung "shopee" (case-insensitive) → Shopee.
export function isShopee(note) {
  if (!note || typeof note !== 'string') return false;
  return note.toLowerCase().includes('shopee');
}

// Revenue per transaksi:
//   bundle   → finalPrice apa adanya (harga paket utuh)
//   non-bundle → qty × finalPrice
//   fallback ke finalSellPrice (nama lama).
export function getRevenue(sale) {
  const price = sale.finalPrice || sale.finalSellPrice || 0;
  return sale.isBundle ? price : (sale.qty || 0) * price;
}

// KPI bulanan. Empty month → semua 0, flag empty: true.
export function aggregateMonthly(sales, year, month) {
  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;
  const rows = sales.filter(s => typeof s.date === 'string' && s.date.slice(0, 7) === yyyymm);

  if (rows.length === 0) {
    return {
      revenue: 0, profit: 0, margin: 0, units: 0,
      shopeeRevenue: 0, nonShopeeRevenue: 0, shopeeShare: 0,
      txCount: 0, empty: true,
    };
  }

  let revenue = 0, profit = 0, units = 0, shopeeRevenue = 0;
  for (const s of rows) {
    const rev = getRevenue(s);
    revenue += rev;
    profit  += (s.profit || 0);
    units   += (s.qty || 0);
    if (isShopee(s.note)) shopeeRevenue += rev;
  }

  const nonShopeeRevenue = revenue - shopeeRevenue;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const shopeeShare = revenue > 0 ? (shopeeRevenue / revenue) * 100 : 0;

  return {
    revenue, profit, margin, units,
    shopeeRevenue, nonShopeeRevenue, shopeeShare,
    txCount: rows.length, empty: false,
  };
}

// Delta % current vs previous. Null kalau previous null/0 → display "—".
export function computeDelta(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// n bulan terakhir inklusif anchor, urut dari paling lama → paling baru.
export function getMonthRange(n, anchorYear, anchorMonth) {
  const out = [];
  let y = anchorYear, m = anchorMonth;
  for (let i = 0; i < n; i++) {
    out.unshift({ year: y, month: m });
    m--;
    if (m < 1) { m = 12; y--; }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Setters (dipanggil dari inline onclick/onchange via window.laporan*)
// ═══════════════════════════════════════════════════════════════════════════
export function setMonth(yyyymm) {
  if (!/^\d{4}-\d{2}$/.test(yyyymm)) return;
  const [y, m] = yyyymm.split('-').map(Number);
  selectedYear  = y;
  selectedMonth = m;
  rerender();
}

export function setTrendRange(n) {
  trendRange = Number(n) || 6;
  rerender();
}

export function setTrendMetric(m) {
  if (['revenue','profit','margin','units'].includes(m)) trendMetric = m;
  rerender();
}

function rerender() {
  if (typeof window !== 'undefined' && typeof window.render === 'function') window.render();
}

// ═══════════════════════════════════════════════════════════════════════════
// Render helpers
// ═══════════════════════════════════════════════════════════════════════════
function pad(n) { return String(n).padStart(2, '0'); }
function selectedYyyymm() { return `${selectedYear}-${pad(selectedMonth)}`; }
function fmtMonthShort(y, m) { return `${BULAN_ID[m-1]} ${String(y).slice(-2)}`; }
function fmtMonthFull(y, m)  { return `${BULAN_ID_FULL[m-1]} ${y}`; }

function deltaBadge(delta, isMargin = false) {
  if (delta === null || delta === undefined || !isFinite(delta)) {
    return `<span class="lap-delta lap-delta-flat" title="Bulan sebelumnya tidak ada data">—</span>`;
  }
  if (Math.abs(delta) < 0.05) {
    return `<span class="lap-delta lap-delta-flat">0${isMargin?'pp':'%'}</span>`;
  }
  const cls = delta > 0 ? 'up' : 'down';
  const arr = delta > 0 ? '▲' : '▼';
  const sign = delta > 0 ? '+' : '';
  const val = isMargin ? `${delta.toFixed(1)}pp` : `${delta.toFixed(1)}%`;
  return `<span class="lap-delta lap-delta-${cls}">${arr} ${sign}${val}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main render — dipanggil dari render.js saat currentTab === 'laporan'
// ═══════════════════════════════════════════════════════════════════════════
export function renderInto(area) {
  ensureInit();

  const curr = aggregateMonthly(S.sales, selectedYear, selectedMonth);

  // Previous month (handle year crossover)
  let prevY = selectedYear, prevM = selectedMonth - 1;
  if (prevM < 1) { prevM = 12; prevY--; }
  const prev = aggregateMonthly(S.sales, prevY, prevM);

  const dRev   = computeDelta(curr.revenue, prev.revenue);
  const dProf  = computeDelta(curr.profit,  prev.profit);
  const dUnits = computeDelta(curr.units,   prev.units);
  // Margin: pakai percentage points (selisih langsung), null kalau prev empty
  const dMarg  = prev.empty ? null : (curr.margin - prev.margin);

  area.innerHTML = `
    <div class="page-hdr">
      <div>
        <div class="page-title">Laporan</div>
        <div class="page-sub">Performa bisnis bulanan — ${fmtMonthFull(selectedYear, selectedMonth)}</div>
      </div>
      <div class="lap-month-picker">
        <label>Bulan</label>
        <input type="month" value="${selectedYyyymm()}" onchange="laporanSetMonth(this.value)">
      </div>
    </div>

    ${curr.empty ? `
      <div class="lap-empty-banner">
        <strong>📭 Belum ada data transaksi</strong> untuk ${fmtMonthFull(selectedYear, selectedMonth)}.
        Pilih bulan lain atau cek apakah data sudah ter-sync dari Google Sheets.
      </div>
    ` : ''}

    <div class="lap-kpi-grid">
      ${renderKpiCard('Revenue', fmt(curr.revenue),               deltaBadge(dRev),         prev.revenue, fmt,                            'var(--green)')}
      ${renderKpiCard('Profit',  fmt(curr.profit),                deltaBadge(dProf),        prev.profit,  fmt,                            'var(--accent)')}
      ${renderKpiCard('Margin',  curr.margin.toFixed(1) + '%',    deltaBadge(dMarg, true),  prev.margin,  v => v.toFixed(1) + '%',        'var(--amber)')}
      ${renderKpiCard('Units',   String(curr.units),              deltaBadge(dUnits),       prev.units,   v => String(v),                 'var(--blue)')}
    </div>

    <div class="card">
      <div class="card-title">Channel Breakdown</div>
      ${renderChannel(curr)}
    </div>

    <div class="card">
      <div class="lap-trend-hdr">
        <div class="card-title" style="margin:0">Trend</div>
        <div class="lap-toolbar">
          <div class="lap-toggle-group">
            ${[3, 6, 12].map(n => `<button class="lap-toggle ${trendRange===n?'active':''}" onclick="laporanSetRange(${n})">${n}M</button>`).join('')}
          </div>
          <div class="lap-toggle-group">
            ${[
              ['revenue','Revenue'],
              ['profit', 'Profit'],
              ['margin', 'Margin'],
              ['units',  'Units'],
            ].map(([k,l]) => `<button class="lap-toggle ${trendMetric===k?'active':''}" onclick="laporanSetMetric('${k}')">${l}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="lap-chart-wrap">
        <canvas id="laporan-trend-chart"></canvas>
        <div id="laporan-trend-empty" class="lap-empty-inline" style="display:none">Chart library belum ke-load (cek koneksi CDN)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Comparison 6 Bulan Terakhir</div>
      ${renderComparisonTable()}
    </div>
  `;

  // Draw chart setelah DOM in place (Chart.js butuh canvas punya layout)
  setTimeout(drawChart, 0);
}

function renderKpiCard(label, val, deltaHtml, prevVal, prevFmt, colorCss) {
  const prevStr = (prevVal === 0 || prevVal === null || prevVal === undefined) ? '—' : prevFmt(prevVal);
  return `
    <div class="lap-kpi-card">
      <div class="lap-kpi-label">${label}</div>
      <div class="lap-kpi-value" style="color:${colorCss}">${val}</div>
      <div class="lap-kpi-meta">
        ${deltaHtml}
        <span class="lap-kpi-prev">vs ${prevStr}</span>
      </div>
    </div>
  `;
}

function renderChannel(agg) {
  if (agg.revenue === 0) {
    return `<div class="lap-empty-inline">Belum ada penjualan bulan ini</div>`;
  }
  const shopeePct = agg.shopeeShare;
  const nonPct    = 100 - shopeePct;
  return `
    <div class="lap-channel">
      <div class="lap-channel-bar">
        <div class="lap-channel-fill lap-channel-shopee" style="width:${shopeePct}%"></div>
        <div class="lap-channel-fill lap-channel-non"    style="width:${nonPct}%"></div>
      </div>
      <div class="lap-channel-legend">
        <div class="lap-channel-item">
          <span class="lap-dot lap-dot-shopee"></span>
          <span class="lap-channel-name">Shopee</span>
          <span class="lap-channel-val">${fmt(agg.shopeeRevenue)} <span class="lap-channel-pct">(${shopeePct.toFixed(1)}%)</span></span>
        </div>
        <div class="lap-channel-item">
          <span class="lap-dot lap-dot-non"></span>
          <span class="lap-channel-name">Non-Shopee</span>
          <span class="lap-channel-val">${fmt(agg.nonShopeeRevenue)} <span class="lap-channel-pct">(${nonPct.toFixed(1)}%)</span></span>
        </div>
      </div>
    </div>
  `;
}

function renderComparisonTable() {
  const months = getMonthRange(6, selectedYear, selectedMonth);
  const rows = months.map(({ year, month }) => {
    const a = aggregateMonthly(S.sales, year, month);
    return { label: fmtMonthShort(year, month), ...a };
  });

  const display = [...rows].reverse(); // recent first

  const nonEmpty = rows.filter(r => !r.empty);
  const cnt = nonEmpty.length;
  const avgEmpty = cnt === 0;
  const avg = avgEmpty ? null : {
    revenue:     nonEmpty.reduce((s, r) => s + r.revenue,     0) / cnt,
    profit:      nonEmpty.reduce((s, r) => s + r.profit,      0) / cnt,
    margin:      nonEmpty.reduce((s, r) => s + r.margin,      0) / cnt,
    units:       nonEmpty.reduce((s, r) => s + r.units,       0) / cnt,
    shopeeShare: nonEmpty.reduce((s, r) => s + r.shopeeShare, 0) / cnt,
  };
  const best = avgEmpty ? null : {
    revenue:     Math.max(...rows.map(r => r.revenue)),
    profit:      Math.max(...rows.map(r => r.profit)),
    margin:      Math.max(...rows.map(r => r.margin)),
    units:       Math.max(...rows.map(r => r.units)),
    shopeeShare: Math.max(...rows.map(r => r.shopeeShare)),
  };

  const cellMonth = (r) => `
    <tr>
      <td>${r.label}</td>
      <td>${r.empty ? '—' : fmt(r.revenue)}</td>
      <td>${r.empty ? '—' : fmt(r.profit)}</td>
      <td>${r.empty ? '—' : r.margin.toFixed(1) + '%'}</td>
      <td>${r.empty ? '—' : r.units}</td>
      <td>${r.empty ? '—' : r.shopeeShare.toFixed(1) + '%'}</td>
    </tr>`;

  const cellAgg = (label, r) => {
    if (!r) return `<tr class="lap-table-summary"><td>${label}</td><td colspan="5">—</td></tr>`;
    return `
      <tr class="lap-table-summary">
        <td>${label}</td>
        <td>${fmt(Math.round(r.revenue))}</td>
        <td>${fmt(Math.round(r.profit))}</td>
        <td>${r.margin.toFixed(1)}%</td>
        <td>${Math.round(r.units)}</td>
        <td>${r.shopeeShare.toFixed(1)}%</td>
      </tr>`;
  };

  return `
    <div class="table-wrap">
      <table class="lap-table">
        <thead>
          <tr>
            <th>Bulan</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>Units</th><th>Shopee %</th>
          </tr>
        </thead>
        <tbody>
          ${display.map(cellMonth).join('')}
          ${cellAgg('Average', avg)}
          ${cellAgg('Best',    best)}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// Chart rendering (Chart.js via CDN, loaded from index.html)
// ═══════════════════════════════════════════════════════════════════════════
function drawChart() {
  const canvas  = document.getElementById('laporan-trend-chart');
  const empty   = document.getElementById('laporan-trend-empty');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const months = getMonthRange(trendRange, selectedYear, selectedMonth);
  const data   = months.map(({ year, month }) => aggregateMonthly(S.sales, year, month));
  const labels = months.map(({ year, month }) => fmtMonthShort(year, month));

  const metricCfg = {
    revenue: { label: 'Revenue', color: '#16a34a' },
    profit:  { label: 'Profit',  color: '#4f46e5' },
    margin:  { label: 'Margin',  color: '#d97706' },
    units:   { label: 'Units',   color: '#2563eb' },
  };
  const cfg = metricCfg[trendMetric] || metricCfg.revenue;
  const values = data.map(a => a[trendMetric] || 0);

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: cfg.label,
        data: values,
        backgroundColor: cfg.color + 'cc',
        borderColor: cfg.color,
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (trendMetric === 'margin') return `${cfg.label}: ${v.toFixed(1)}%`;
              if (trendMetric === 'units')  return `${cfg.label}: ${v}`;
              return `${cfg.label}: ${fmt(v)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 11 },
            callback: (v) => {
              if (trendMetric === 'margin') return v + '%';
              if (trendMetric === 'units')  return v;
              if (v >= 1_000_000) return (v/1_000_000).toFixed(1) + 'jt';
              if (v >= 1_000)     return (v/1_000).toFixed(0) + 'rb';
              return v;
            }
          },
          grid: { color: '#f1f5f9' }
        }
      }
    }
  });
}
