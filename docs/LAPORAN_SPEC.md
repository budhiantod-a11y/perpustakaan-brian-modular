# Spec: Menu Laporan (Dashboard Performa Bisnis)

## Konteks

Menu Laporan existing fokus ke log transaksional per periode. User butuh **lensa analitik** untuk lihat kondisi bisnis secara aggregate, dengan kemampuan membandingkan performa antar bulan.

Target user: owner (Budhi), non-bisnis-background. Dashboard harus actionable, bukan vanity metrics.

---

## Scope

**In scope:**
- 5 KPI utama (vital signs bisnis)
- Trend chart 3/6/12 bulan
- Comparison table multi-bulan
- Breakdown Shopee vs non-Shopee
- Granularity: aggregate (total bisnis), bukan per SKU/kategori

**Out of scope (Fase 2+):**
- Inventory turnover (butuh snapshot historis inventory value)
- Top buku per bulan
- Repeat customer rate
- Per-category breakdown

**Constraint absolut:**
- **No schema change** di Google Sheets. Semua metric harus derivable dari data existing
- **No new sheet/tab** di GAS
- Ikutin pattern modular existing (render.js, state.js, dll)

---

## 5 KPI Utama

### 1. Revenue (Omzet)
- **Formula:** `SUM(finalPrice × qty)` filtered by month
- **Source:** `sales` sheet
- **Display:** Angka bulan ini + delta % vs bulan lalu

### 2. Gross Profit
- **Formula:** `SUM(profit)` filtered by month
- **Source:** `sales` sheet (kolom `profit` udah ke-compute per transaksi via FIFO)
- **Display:** Angka bulan ini + delta % vs bulan lalu

### 3. Margin %
- **Formula:** `(SUM(profit) / SUM(revenue)) × 100`
- **Display:** Persentase bulan ini + delta percentage points vs bulan lalu
- **Catatan:** Margin lebih penting dari profit absolut — sinyal kesehatan tiap rupiah revenue

### 4. Units Sold
- **Formula:** `SUM(qty)` filtered by month
- **Source:** `sales` sheet
- **Display:** Angka bulan ini + delta % vs bulan lalu

### 5. Sales by Channel (Shopee vs non-Shopee)
- **Detection:** Kolom `note` di sheet sales mengandung kata `"shopee"` (case-insensitive). Selain itu = non-Shopee
- **Formula:** Revenue per channel + % share
- **Display:** Stacked bar atau 2 angka berdampingan dengan % share

---

## Layout Dashboard

```
┌─────────────────────────────────────────────┐
│  Laporan — [selector: Mei 2026 ▼]           │
├─────────────────────────────────────────────┤
│  KPI HERO CARDS                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│  │Rev   │ │Profit│ │Margin│ │Units │        │
│  │25jt  │ │8.5jt │ │ 34%  │ │ 142  │        │
│  │+12%▲ │ │+8%▲  │ │-2pp▼ │ │+5%▲  │        │
│  └──────┘ └──────┘ └──────┘ └──────┘        │
├─────────────────────────────────────────────┤
│  CHANNEL BREAKDOWN                          │
│  Shopee: 15jt (60%) | Non-Shopee: 10jt(40%) │
├─────────────────────────────────────────────┤
│  TREND CHART                                │
│  [Range: 3M | 6M ✓ | 12M]                   │
│  [Metric: Rev | Profit | Margin | Units]    │
│  [bar/line chart]                           │
├─────────────────────────────────────────────┤
│  COMPARISON TABLE (6 bulan terakhir)        │
│  Bulan │Rev │Profit│Margin│Units│ Shopee%   │
│  Mei26 │... │ ...  │ ...  │ ... │  ...      │
│  Apr26 │... │ ...  │ ...  │ ... │  ...      │
│  ...                                        │
│  ─────────────────────────────────────      │
│  Avg   │... │ ...  │ ...  │ ... │  ...      │
│  Best  │... │ ...  │ ...  │ ... │  ...      │
└─────────────────────────────────────────────┘
```

---

## Technical Approach

### File baru
- `js/laporan.js` — aggregator function + render logic untuk dashboard

### File yang diubah
- `js/render.js` — tambahin render hook untuk tab laporan (kalau pattern existing pakai render.js sebagai entry point)
- `js/app.js` — wire up tab navigation kalau perlu
- `style.css` — styling KPI cards + chart container
- `index.html` — markup container untuk tab laporan

### Tidak diubah
- GAS / Google Sheets schema
- state.js (cuma baca dari `state.sales`)
- fifo.js (cuma baca `profit` yang udah dihitung)

### Library
- **Chart.js via CDN** untuk trend chart (lightweight, ga perlu npm)
- Atau **SVG manual** kalau mau zero-dependency

### Caching
- Hasil agregasi closed months (bulan-bulan lalu) immutable — bisa di-cache di-memory atau localStorage
- Bulan berjalan re-compute setiap render

---

## Aggregator Function Design

```javascript
// js/laporan.js

function aggregateMonthly(sales, year, month) {
  const filtered = sales.filter(s => isInMonth(s.tanggal, year, month));

  const revenue = sum(filtered, s => s.finalPrice * s.qty);
  const profit = sum(filtered, s => s.profit);
  const units = sum(filtered, s => s.qty);
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  const shopeeRows = filtered.filter(s => isShopee(s.note));
  const shopeeRev = sum(shopeeRows, s => s.finalPrice * s.qty);

  return {
    revenue,
    profit,
    margin,
    units,
    shopeeRevenue: shopeeRev,
    nonShopeeRevenue: revenue - shopeeRev,
    shopeeShare: revenue > 0 ? (shopeeRev / revenue) * 100 : 0,
    txCount: filtered.length
  };
}

function isShopee(note) {
  return note && note.toLowerCase().includes('shopee');
}

function computeDelta(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
```

---

## Acceptance Criteria

1. Tab "Laporan" baru tampil di nav, atau menu lama di-redesign
2. KPI cards tampil bulan terpilih + delta vs bulan sebelumnya
3. Selector bulan bisa pilih bulan mana aja (default: bulan berjalan)
4. Trend chart bisa toggle metric (rev/profit/margin/units) dan range (3M/6M/12M)
5. Comparison table tampil 6 bulan terakhir + row Average + Best
6. Channel breakdown akurat (verifikasi manual dengan filter di sheet)
7. Empty state handled: bulan tanpa data tampil "Belum ada data" bukan crash
8. Delta calculation handle edge case: bulan sebelumnya 0 atau null → tampil "—" bukan Infinity/NaN
9. Mobile responsive: KPI cards stack vertikal, table scroll horizontal
10. Mengikuti pattern existing — semua DOM rendering lewat render.js, semua state access lewat state.js

---

## Working Principles (jangan dilanggar)

- **Discuss before coding:** Sebelum nulis kode, kasih plan dulu (file mana yang diubah, urutan kerja). Tunggu konfirmasi user
- **One thing at a time:** Selesain 1 komponen, test, baru lanjut
- **Extend, don't replace:** Kalau ada menu Laporan existing, jangan langsung hapus. Diskusi dulu apa yang di-keep/redesign
- **No speculation:** Kalau ga yakin tentang struktur data atau field naming, baca file existing atau tanya user
- **Concise communication:** Skip preamble panjang. Langsung ke poin
