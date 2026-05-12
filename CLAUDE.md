# CLAUDE.md — Perpustakaan Brian Internal Management App

File ini = reference utama untuk Claude Code di project ini. Baca dulu sebelum mulai kerja apa pun.

---

## Konteks Bisnis

Perpustakaan Brian = toko buku anak online (Indonesia). Owner-operated oleh Budhi.

Bisnis jalan via 2 channel:
- **Shopee** — marketplace
- **WhatsApp** — direct customer (toko fisik tidak ada)

App ini adalah **internal management tool** buat owner. Bukan customer-facing.

---

## Tech Stack

- **Frontend:** Vanilla JavaScript ES Modules (NO framework, NO bundler)
- **Backend / Data Store:** Google Sheets via Google Apps Script (GAS) Web App
- **Cache:** localStorage (offline-first)
- **Hosting:** GitHub Pages
- **Library tambahan:** SheetJS (untuk Excel import)

**Aturan absolut:**
- Tidak boleh introduce framework (React, Vue, dll)
- Tidak boleh introduce bundler atau npm install
- Library tambahan harus via CDN, justified, dan lightweight

---

## Repo Structure

```
/
├── index.html
├── style.css
├── js/
│   ├── app.js          # entry point, tab navigation
│   ├── state.js        # state management + localStorage
│   ├── render.js       # SEMUA DOM rendering
│   ├── fifo.js         # FIFO cost calculation (ISOLATED)
│   ├── import.js       # Excel bulk import (incl. bulk sales)
│   └── ... (modul lain)
├── docs/
│   ├── LAPORAN_SPEC.md
│   └── TODO_LAPORAN.md
└── CLAUDE.md           # file ini
```

GAS code = TIDAK ada di repo. Edit manual lewat GAS editor, deploy manual.

---

## Arsitektur Prinsip

1. **State centralization:** Semua state access lewat `state.js`. Jangan akses localStorage langsung dari modul lain.
2. **Render centralization:** Semua DOM manipulation lewat `render.js`. Jangan `document.querySelector` di modul logic.
3. **FIFO isolation:** Cost calculation cuma di `fifo.js`. Jangan duplicate FIFO logic di mana pun.
4. **bootFetching guard:** Saat boot fetch dari Sheets, semua outbound sync di-block. Jangan dihilangin — ini cegah localStorage kosong overwrite Sheets.
5. **Modular ES Modules:** Tiap modul handle satu domain concern. Jangan campur.

---

## Data Quirks (PENTING)

### Google Sheets auto-converts data
Sheets sering ubah type tanpa permisi:
- Boolean jadi string `"TRUE"` / `"FALSE"` di sheet, tapi `true`/`false` (native) saat dibaca via API
- Date jadi serial number (excel format) atau string tanggal random
- Angka kadang jadi string kalau ada karakter aneh

**Aturan:** Semua data dari Sheets HARUS explicit type cast & validation di GAS `rowToObj()` dan di JS reader.

### Known fixes (jangan di-revert)
- `rowToObj()` di GAS handle `typeof val === 'boolean'` explicitly (bukan `String(val) === 'TRUE'`)
- Excel date serial → JS Date: `new Date((serial - 25569) * 86400000)`
- `Boolean('FALSE')` returns `true` di JS — JANGAN PERNAH pakai `Boolean()` buat string-sourced boolean

---

## Working Style (jangan dilanggar)

- **Discuss before coding** — kasih plan dulu sebelum nulis kode. Tunggu user approve.
- **One thing at a time** — selesai 1 task, test, baru lanjut. Jangan bundle banyak perubahan dalam 1 commit.
- **No automated find-replace** untuk refactor JS — manual targeted edit only.
- **No speculative answers** — kalau gak yakin, baca file existing atau tanya user. Jangan kasih hipotesis sebagai jawaban.
- **Be concise** — skip preamble panjang. Langsung ke poin. Budhi udah corrected over-explanation.
- **Extend existing patterns** — fitur baru harus match konvensi UI/code existing. Cek file sejenis dulu sebelum nulis dari nol.

---

## Komunikasi

- Bahasa: **Bahasa Indonesia informal**, technical terms boleh English
- Format respon: ringkas, langsung ke poin, no excessive bullet points
- Kalau ambiguous, **tanya dulu jangan asumsi**

---

## File Fetching dari GitHub (untuk reference)

Format URL raw yang BENAR:
```
https://raw.githubusercontent.com/budhiantod-a11y/perpustakaan-brian-modular/refs/heads/main/js/[filename]
```

URL `github.com/.../blob/...` TIDAK bisa di-fetch (HTML wrapper, bukan raw file).

---

## Fitur Laporan (Dashboard Performa Bisnis)

### Tujuan
Menu Laporan = **lensa analitik aggregate** untuk lihat kondisi bisnis, bukan log transaksi. User butuh comparison antar bulan untuk decision making.

### Spec lengkap
Baca `docs/LAPORAN_SPEC.md` sebelum mulai kerja apa pun di modul ini.
Task breakdown ada di `docs/TODO_LAPORAN.md`.

### KPI yang di-track (5 vital signs)
1. Revenue (omzet)
2. Gross Profit
3. Margin %
4. Units Sold
5. Sales by Channel (Shopee vs non-Shopee)

### Aturan absolut Laporan
- **No schema change** di Google Sheets. Semua metric harus derivable dari data existing
- **No new sheet/tab** di GAS
- Channel detection: kolom `note` di sheet sales mengandung `"shopee"` (case-insensitive) = Shopee. Selain itu = non-Shopee
- Semua DOM rendering lewat `render.js` (atau modul render khusus laporan yang konsisten patternnya)
- Semua state access lewat `state.js`
- FIFO logic tidak di-touch — laporan baca `profit` yang udah ke-compute per transaksi

### File ownership Laporan
- `js/laporan.js` — aggregator + render dashboard (FILE BARU)
- `js/render.js` — entry point render tab laporan (modify minimal)
- `index.html` — markup container tab laporan
- `style.css` — styling KPI cards, chart, table

### Library policy Laporan
- Chart.js via CDN OK (lightweight, no build step)
- Tidak boleh introduce npm / bundler. Tetep vanilla JS ES modules

### Edge cases Laporan
- Bulan tanpa data → "Belum ada data", bukan crash
- Bulan sebelumnya 0 atau null untuk delta calculation → tampil "—", bukan Infinity/NaN
- `note` field kosong/null → treated as non-Shopee
- `profit` null untuk transaksi lama → skip dari aggregation (kasih warning di console)

---

## Anti-pattern (JANGAN dilakuin)

- ❌ Migrate ke React/Vue/framework apa pun
- ❌ Add npm dependency
- ❌ Akses localStorage langsung di luar state.js
- ❌ Render DOM di luar render.js
- ❌ Duplicate FIFO logic di luar fifo.js
- ❌ Modify GAS code di repo (gak ada, GAS edit manual)
- ❌ Refactor besar yang gak diminta user
- ❌ Auto find-replace untuk JS refactor
- ❌ Pakai `Boolean('FALSE')` atau `String() === 'TRUE'` untuk parse boolean dari Sheets
