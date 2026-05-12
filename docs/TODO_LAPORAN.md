# TODO: Fitur Laporan — Task Breakdown

Kerjain berurutan. Setiap task selesai → test manual → konfirmasi user → lanjut task berikutnya.

---

## Phase 0: Discovery & Plan (sebelum nulis kode)

- [ ] **0.1** Baca `CLAUDE.md` dan `docs/LAPORAN_SPEC.md` sampai paham
- [ ] **0.2** Baca file existing yang relevan:
  - `js/render.js` (pattern rendering)
  - `js/state.js` (cara akses sales data)
  - `js/app.js` (tab navigation)
  - `index.html` (struktur tab yang udah ada)
  - File laporan existing (kalau ada) — apa yang di-keep / di-redesign
- [ ] **0.3** Identifikasi nama exact field di sales (apakah `tanggal` / `date` / `tgl`, `finalPrice` / `final_price`, dll). Konfirmasi ke user kalau ada ambiguity
- [ ] **0.4** Tulis plan: file mana yang diubah, urutan kerja, library Chart.js yes/no. Submit ke user, tunggu approve

---

## Phase 1: Aggregator Function (logic only, no UI)

- [ ] **1.1** Bikin `js/laporan.js` dengan function:
  - `aggregateMonthly(sales, year, month)` → return KPI object untuk 1 bulan
  - `isShopee(note)` → boolean
  - `computeDelta(current, previous)` → percentage atau null
  - `getMonthRange(n)` → array of {year, month} untuk n bulan terakhir
- [ ] **1.2** Test manual di console: panggil `aggregateMonthly` dengan data bulan kemarin, verifikasi angka cocok dengan filter manual di Google Sheets
- [ ] **1.3** Konfirmasi ke user: tunjukin output object, validasi angka

---

## Phase 2: KPI Hero Cards

- [ ] **2.1** Markup HTML container untuk tab laporan (kalau belum ada) atau modify tab existing
- [ ] **2.2** Render 4 KPI cards: Revenue, Profit, Margin %, Units
  - Angka besar bulan ini
  - Angka kecil bulan lalu (subtle)
  - Badge delta (hijau ▲ / merah ▼) dengan % (untuk Margin: pakai percentage points / pp)
- [ ] **2.3** Styling: ikutin design language existing app
- [ ] **2.4** Selector bulan: dropdown atau button group untuk pilih bulan target. Default = bulan berjalan
- [ ] **2.5** Test: ganti-ganti bulan, pastikan card update

---

## Phase 3: Channel Breakdown

- [ ] **3.1** Render section Shopee vs non-Shopee
  - 2 angka berdampingan dengan % share
  - Atau stacked bar mini
- [ ] **3.2** Test: bandingkan dengan filter manual di sheet (note contains "shopee")

---

## Phase 4: Trend Chart

- [ ] **4.1** Decide: Chart.js CDN vs SVG manual (diskusi sama user kalau belum jelas)
- [ ] **4.2** Render line/bar chart 6 bulan terakhir (default)
- [ ] **4.3** Toggle metric: Revenue / Profit / Margin / Units
- [ ] **4.4** Toggle range: 3M / 6M / 12M
- [ ] **4.5** Empty months handled (chart tetap render dengan gap atau 0)
- [ ] **4.6** Test: pastikan chart smooth waktu toggle, ga blink/reload semua

---

## Phase 5: Comparison Table

- [ ] **5.1** Render tabel 6 bulan terakhir
  - Kolom: Bulan, Revenue, Profit, Margin %, Units, Shopee %
- [ ] **5.2** Row tambahan: Average, Best (bold)
- [ ] **5.3** Sortable per kolom (bonus, kalau gampang)
- [ ] **5.4** Mobile: horizontal scroll, atau collapse ke card vertikal

---

## Phase 6: Polish & Edge Cases

- [ ] **6.1** Empty state: bulan tanpa data → "Belum ada data"
- [ ] **6.2** Delta edge case: previous=0 → tampil "—"
- [ ] **6.3** Note null/kosong → non-Shopee
- [ ] **6.4** Profit null untuk transaksi lama → skip + warning console
- [ ] **6.5** Mobile responsive check (KPI cards stack, table scroll)
- [ ] **6.6** Cache check: closed months ga re-compute setiap render (kalau di-implement)

---

## Phase 7: Cleanup & Deploy

- [ ] **7.1** Remove console.log debug
- [ ] **7.2** Update `CLAUDE.md` kalau ada pattern baru yang worth documented
- [ ] **7.3** Commit dengan message jelas: "feat: dashboard laporan dengan 5 KPI dan comparison multi-bulan"
- [ ] **7.4** Push ke GitHub Pages, verifikasi live di production
- [ ] **7.5** Demo singkat ke user

---

## Definition of Done

- [ ] Semua KPI angka cocok dengan filter manual di Google Sheets
- [ ] Delta calculation akurat (cross-check 2-3 bulan manual)
- [ ] Mobile responsive (test di HP beneran)
- [ ] No console errors
- [ ] No regression di tab lain (sales, stok, preorder, cashflow masih jalan normal)
- [ ] User approve hasil akhir
