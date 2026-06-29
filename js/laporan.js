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
let publisherChartInstance = null;
let dailyChartInstance = null;

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

// Omzet penjualan per hari di 1 bulan. Isi semua hari (termasuk 0) biar
// timeline kontinu untuk bar chart.
export function aggregateDailyRevenue(sales, year, month) {
  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;
  const byDate = new Map();
  for (const s of sales) {
    if (typeof s.date !== 'string' || s.date.slice(0, 7) !== yyyymm) continue;
    const rev = getRevenue(s);
    const e = byDate.get(s.date) || { amount: 0, count: 0 };
    e.amount += rev;
    e.count++;
    byDate.set(s.date, e);
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yyyymm}-${String(d).padStart(2, '0')}`;
    const e = byDate.get(ds) || { amount: 0, count: 0 };
    days.push({ date: ds, day: d, amount: e.amount, count: e.count });
  }
  return days;
}

// Delta % current vs previous. Null kalau previous null/0 → display "—".
export function computeDelta(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// Breakdown qty per buku dalam 1 bulan.
// Non-bundle → masuk qtySatuan. Bundle → tiap bundleItems[] di-explode ke qtyBundle.
// Return: array sorted by qtyTotal desc, lalu title asc.
export function aggregateBookBreakdown(sales, year, month) {
  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;
  const rows = sales.filter(s => typeof s.date === 'string' && s.date.slice(0, 7) === yyyymm);

  const acc = new Map();
  const bump = (bookId, title, qty, isBundle) => {
    if (!bookId || !qty) return;
    let e = acc.get(bookId);
    if (!e) { e = { bookId, title: title || '', qtySatuan: 0, qtyBundle: 0 }; acc.set(bookId, e); }
    if (isBundle) e.qtyBundle += qty; else e.qtySatuan += qty;
    if (!e.title && title) e.title = title;
  };

  for (const s of rows) {
    if (s.isBundle) {
      if (Array.isArray(s.bundleItems)) {
        for (const it of s.bundleItems) bump(it.bookId, it.bookTitle, it.qty || 0, true);
      }
    } else {
      bump(s.bookId, s.bookTitle, s.qty || 0, false);
    }
  }

  return [...acc.values()]
    .map(e => {
      const book = S.books.find(b => b.id === e.bookId);
      return { ...e, qtyTotal: e.qtySatuan + e.qtyBundle, publisher: (book?.publisher || '').trim() };
    })
    .sort((a, b) => b.qtyTotal - a.qtyTotal || a.title.localeCompare(b.title));
}

// Aggregate qty per penerbit dari list breakdown.
// Return semua penerbit (sort desc by qty, lalu alfabetis).
export function aggregateByPublisher(breakdownList) {
  const map = new Map();
  for (const r of breakdownList) {
    const pub = r.publisher || '(Tanpa penerbit)';
    map.set(pub, (map.get(pub) || 0) + r.qtyTotal);
  }
  return [...map.entries()]
    .map(([publisher, qty]) => ({ publisher, qty }))
    .sort((a, b) => b.qty - a.qty || a.publisher.localeCompare(b.publisher));
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

// Filter rows breakdown by judul + penerbit. Tidak rerender supaya cursor di search input gak loncat.
// Footer total ikut re-compute supaya bisa di-tally dgn bar chart penerbit.
export function filterBreakdown() {
  const titleQ = (document.getElementById('lap-breakdown-search')?.value || '').toLowerCase().trim();
  const pubQ   = (document.getElementById('lap-breakdown-pub-search')?.value || '').toLowerCase().trim();
  const tbody  = document.getElementById('lap-breakdown-tbody');
  if (!tbody) return;

  let totalSatuan = 0, totalBundle = 0, visibleCount = 0;
  for (const tr of tbody.querySelectorAll('tr')) {
    const t = tr.getAttribute('data-title') || '';
    const p = tr.getAttribute('data-publisher') || '';
    const match = (!titleQ || t.includes(titleQ)) && (!pubQ || p.includes(pubQ));
    tr.style.display = match ? '' : 'none';
    if (match) {
      totalSatuan += +tr.getAttribute('data-satuan') || 0;
      totalBundle += +tr.getAttribute('data-bundle') || 0;
      visibleCount++;
    }
  }

  const totalAll = totalSatuan + totalBundle;
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('lap-breakdown-foot-count',  visibleCount);
  setTxt('lap-breakdown-foot-satuan', totalSatuan);
  setTxt('lap-breakdown-foot-bundle', totalBundle);
  setTxt('lap-breakdown-foot-total',  totalAll);
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
      <div class="card-title">Omzet Penjualan Harian — ${fmtMonthFull(selectedYear, selectedMonth)}</div>
      ${renderDailyRevenue()}
    </div>

    <div class="card">
      <div class="card-title">Comparison 6 Bulan Terakhir</div>
      ${renderComparisonTable()}
    </div>

    <div class="card">
      <div class="card-title">Breakdown Buku Terjual — ${fmtMonthFull(selectedYear, selectedMonth)}</div>
      ${renderBookBreakdown()}
    </div>
  `;

  // Draw chart setelah DOM in place (Chart.js butuh canvas punya layout)
  setTimeout(() => { drawChart(); drawPublisherChart(); drawDailyChart(); }, 0);
}

function renderDailyRevenue() {
  const days = aggregateDailyRevenue(S.sales, selectedYear, selectedMonth);
  const total = days.reduce((s, d) => s + d.amount, 0);
  const activeDays = days.filter(d => d.amount > 0).length;
  if (total === 0) {
    return `<div class="lap-empty-inline">Belum ada penjualan bulan ini</div>`;
  }
  // ~32px per hari, min-width 100% biar bulan pendek tetap fit container
  const w = days.length * 32;
  return `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">
      ${activeDays} hari ada penjualan · total ${fmt(total)}
    </div>
    <div style="overflow-x:auto">
      <div style="position:relative;height:260px;min-width:100%;width:${w}px">
        <canvas id="laporan-daily-chart"></canvas>
      </div>
    </div>
  `;
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
  const allEmpty = cnt === 0;

  // Sum: kumulatif 6 bulan. Margin & Shopee% di-recompute dari total (bukan rata2 persentase).
  const sumRevenue       = rows.reduce((s, r) => s + r.revenue, 0);
  const sumProfit        = rows.reduce((s, r) => s + r.profit,  0);
  const sumUnits         = rows.reduce((s, r) => s + r.units,   0);
  const sumShopeeRevenue = rows.reduce((s, r) => s + r.shopeeRevenue, 0);
  const sum = allEmpty ? null : {
    revenue:     sumRevenue,
    profit:      sumProfit,
    margin:      sumRevenue > 0 ? (sumProfit / sumRevenue) * 100 : 0,
    units:       sumUnits,
    shopeeShare: sumRevenue > 0 ? (sumShopeeRevenue / sumRevenue) * 100 : 0,
  };
  const avg = allEmpty ? null : {
    revenue:     sumRevenue / cnt,
    profit:      sumProfit  / cnt,
    margin:      nonEmpty.reduce((s, r) => s + r.margin,      0) / cnt,
    units:       sumUnits   / cnt,
    shopeeShare: nonEmpty.reduce((s, r) => s + r.shopeeShare, 0) / cnt,
  };
  const best = allEmpty ? null : {
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
          ${cellAgg('Sum',     sum)}
          ${cellAgg('Average', avg)}
          ${cellAgg('Best',    best)}
        </tbody>
      </table>
    </div>
  `;
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBookBreakdown() {
  const list = aggregateBookBreakdown(S.sales, selectedYear, selectedMonth);
  if (list.length === 0) {
    return `<div class="lap-empty-inline">Belum ada penjualan bulan ini</div>`;
  }
  const totalSatuan = list.reduce((s, r) => s + r.qtySatuan, 0);
  const totalBundle = list.reduce((s, r) => s + r.qtyBundle, 0);
  const totalAll    = totalSatuan + totalBundle;

  const rowsHtml = list.map(r => `
    <tr data-title="${escapeAttr((r.title || '').toLowerCase())}"
        data-publisher="${escapeAttr((r.publisher || '').toLowerCase())}"
        data-satuan="${r.qtySatuan}"
        data-bundle="${r.qtyBundle}">
      <td>${escapeAttr(r.title || '(tanpa judul)')}</td>
      <td>${escapeAttr(r.publisher || '—')}</td>
      <td style="text-align:right">${r.qtySatuan || '—'}</td>
      <td style="text-align:right">${r.qtyBundle || '—'}</td>
      <td style="text-align:right;font-weight:600">${r.qtyTotal}</td>
    </tr>
  `).join('');

  return `
    <div class="lap-chart-wrap" style="margin-bottom:16px">
      <canvas id="laporan-publisher-chart"></canvas>
      <div id="laporan-publisher-empty" class="lap-empty-inline" style="display:none">Chart library belum ke-load (cek koneksi CDN)</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="search-input-wrap">
        <input class="inp" id="lap-breakdown-search" type="text" placeholder="Cari judul buku..."
          oninput="laporanFilterBreakdown()" autocomplete="off">
        <button class="search-clear-btn" onclick="clearInputField('lap-breakdown-search')" type="button">✕ Clear</button>
      </div>
      <div class="search-input-wrap">
        <input class="inp" id="lap-breakdown-pub-search" type="text" placeholder="Cari penerbit..."
          oninput="laporanFilterBreakdown()" autocomplete="off">
        <button class="search-clear-btn" onclick="clearInputField('lap-breakdown-pub-search')" type="button">✕ Clear</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="lap-table">
        <thead>
          <tr>
            <th>Judul</th>
            <th>Penerbit</th>
            <th style="text-align:right">Satuan</th>
            <th style="text-align:right">Bundling</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody id="lap-breakdown-tbody">${rowsHtml}</tbody>
        <tfoot>
          <tr class="lap-table-summary">
            <td>Total (<span id="lap-breakdown-foot-count">${list.length}</span> judul)</td>
            <td></td>
            <td style="text-align:right" id="lap-breakdown-foot-satuan">${totalSatuan}</td>
            <td style="text-align:right" id="lap-breakdown-foot-bundle">${totalBundle}</td>
            <td style="text-align:right" id="lap-breakdown-foot-total">${totalAll}</td>
          </tr>
        </tfoot>
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

// Horizontal bar chart breakdown qty per penerbit.
// Top 9 visible; sisanya di-group jadi "Lainnya" — tooltip-nya list semua penerbit.
function drawPublisherChart() {
  const canvas = document.getElementById('laporan-publisher-chart');
  const empty  = document.getElementById('laporan-publisher-empty');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (publisherChartInstance) { publisherChartInstance.destroy(); publisherChartInstance = null; }

  const list = aggregateBookBreakdown(S.sales, selectedYear, selectedMonth);
  if (list.length === 0) { canvas.style.display = 'none'; return; }

  const pubs   = aggregateByPublisher(list);
  const labels = pubs.map(p => p.publisher);
  const values = pubs.map(p => p.qty);
  const total  = values.reduce((a, b) => a + b, 0) || 1;

  // Auto-resize wrapper height kalau penerbit banyak — minimal 280px,
  // tiap bar dapet ~30px supaya readable.
  const wrap = canvas.parentElement;
  if (wrap && wrap.classList.contains('lap-chart-wrap')) {
    wrap.style.height = `${Math.max(280, pubs.length * 30 + 40)}px`;
  }

  publisherChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: '#4f46e5cc',
        borderColor: '#4f46e5',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v   = ctx.parsed.x;
              const pct = (v / total * 100).toFixed(1);
              return `${v} buku (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { font: { size: 11 }, precision: 0 }, grid: { color: '#f1f5f9' } },
        y: { ticks: { font: { size: 11 }, autoSkip: false }, grid: { display: false } },
      },
    },
  });
}

// Bar chart omzet penjualan harian untuk bulan terpilih.
function drawDailyChart() {
  const canvas = document.getElementById('laporan-daily-chart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') return;
  if (dailyChartInstance) { dailyChartInstance.destroy(); dailyChartInstance = null; }

  const days = aggregateDailyRevenue(S.sales, selectedYear, selectedMonth);
  if (!days.length) return;

  const labels = days.map(d => String(d.day));
  const values = days.map(d => d.amount);

  dailyChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: '#16a34acc',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: 24,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (ctx) => days[ctx[0].dataIndex].date,
            label: (ctx) => {
              const d = days[ctx.dataIndex];
              return `${fmt(d.amount)} · ${d.count} trx`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false, maxRotation: 0 } },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 10 },
            callback: (v) => {
              if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'jt';
              if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'rb';
              return v;
            },
          },
        },
      },
    },
  });
}
