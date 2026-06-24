# LAPORAN_KEUANGAN_SPEC.md

Spec untuk modul **Laporan Keuangan** Perpustakaan Brian.
Standar acuan: **SAK EMKM** (basis akrual, biaya historis).

---

## 0. Prinsip & Batasan

- **`cashflow.js` boleh ditambah kategori (additive only)**, JANGAN edit logic existing. Kategori baru yang diperlukan: `pinjaman_pemilik` (income), `pelunasan_pinjaman` (expense) — untuk track Utang ke Pemilik di Neraca.
- Modul baru: `js/laporan-keuangan.js`. Hanya membaca sheet untuk laporan, tidak mengubah behavior cashflow.
- Render lewat `render.js` (pola existing).
- Dua sheet baru:
  - `pengaturan_laporan` (5 field manual, sekali isi)
  - `rekonsiliasi` (per bulan, opsional, histori rekon end-of-month)
- Pendapatan di sheet sales **sudah net** (admin marketplace sudah terpotong). JANGAN tambah baris komisi.
- **Tidak ada Piutang Shopee.** Transaksi diakui saat barang dikirim = de facto kas. Tidak tracking tanggal dana cair.
- Konsekuensi: ada gap kecil saldo app vs rekening real (dana Shopee in-transit). Ditangani via baris rekonsiliasi opsional end-of-month (lihat §5).

---

## 1. Input Manual — sheet `pengaturan_laporan`

Sheet baru, format key-value. Diisi sekali oleh Budhi saat build selesai.

| key | tipe | keterangan |
|---|---|---|
| `cut_off_date` | tanggal | Tanggal rekening bisnis terpisah dibuat. Garis pemisah histori vs kas terekonsiliasi |
| `saldo_pembukaan_kas` | angka | Uang **masih cair** di cut-off (rekening + tunai + ewallet + Shopee belum cair). **Uang yang sudah jadi buku JANGAN dimasukkan** — sudah tercatat di inventory |
| `modal_awal` | angka | Modal Budhi untuk Neraca. Acuan: `saldo_pembukaan_kas` + nilai persediaan di cut-off |
| `nama_usaha` | teks | Header CaLK |
| `alamat_usaha` | teks | CaLK |

Aturan double-count: `saldo_pembukaan_kas` HANYA uang cair. Stok dibiarkan dihitung inventory. Jika uang cair dimasukkan padahal sudah jadi buku → double count.

---

## 2. Laporan Laba Rugi (akrual, per bulan + YTD)

```
Pendapatan Penjualan          [Σ revenue per trx dari sales sheet, net, basis tanggal transaksi]
(-) HPP                       [Σ cost per trx via fifo.js — sudah ada]
= LABA KOTOR
(-) Beban Ongkir              [cashflow: category='ongkir']
(-) Beban Operasional         [cashflow: category='operasional']
(-) Beban Iklan/Marketing     [cashflow: category='iklan_marketing']
(-) Beban Lain-lain           [cashflow: category='lainnya' AND type='expense']
= LABA BERSIH
```

- Tanpa baris Retur (kecuali ada datanya).
- Tanpa baris Komisi Marketplace (sudah net di pendapatan).
- Tampilkan kolom: bulan ini | YTD | bulan sebelumnya (min 2 periode, syarat SAK EMKM komparatif).

**Mapping kategori cashflow → bucket Laba Rugi:**

| Kategori cashflow | Bucket L/R |
|---|---|
| `bayar_po` | SKIP (sudah masuk HPP via FIFO, jangan double count) |
| `ongkir` | Beban Ongkir |
| `operasional` | Beban Operasional |
| `iklan_marketing` | Beban Iklan/Marketing |
| `lainnya` (expense) | Beban Lain-lain |
| `dp_customer` | SKIP (liability di Neraca, bukan pendapatan sampai delivered) |
| `pinjaman_pemilik` | SKIP (liability di Neraca) |
| `pelunasan_pinjaman` | SKIP (mengurangi liability di Neraca) |
| `penjualan` (auto dari sales) | SKIP (pendapatan sudah dihitung langsung dari sales sheet) |

---

## 3. Laporan Posisi Keuangan (Neraca) — snapshot akhir periode

```
ASET                              | LIABILITAS
Kas & Setara Kas  [saldo gulung]  | Utang ke Pemilik          [Σ pinjaman − Σ pelunasan]
Persediaan Buku   [inventory]     | Uang Muka Pelanggan       [Σ dp_customer where !delivered]
                                  | ─────────────
                                  | EKUITAS
                                  | Modal Budhi              [modal_awal]
                                  | Laba Ditahan             [Σ Laba Bersih post cut-off]
TOTAL ASET                        | TOTAL LIABILITAS + EKUITAS
```

- **Tanpa Piutang Shopee** (lihat §0).
- **Uang Muka Pelanggan:** Σ amount dari cashflow `category='dp_customer'` dengan `isAdvance=true AND delivered=false`. Saat delivered=true, otomatis pindah jadi Pendapatan (handled di cashflow logic existing), jadi tidak akan double count.
- **Utang ke Pemilik (Owner Loan):** uang pribadi dipinjamkan ke bisnis (mis. buat bayar buku saat kas habis). Outstanding = Σ kategori `pinjaman_pemilik` − Σ `pelunasan_pinjaman` dari cashflow sheet. JANGAN campur dengan Modal — Modal = setoran permanen, Owner Loan = pinjaman sementara yang akan dibalikin.
- **Modal Budhi:** aset bersih di cut-off date = `saldo_pembukaan_kas` + nilai persediaan saat cut-off. Input manual sekali via `pengaturan_laporan`. Acuan hitung: lo opname stock full di cut-off date, jumlahkan nilai persediaan-nya, tambah saldo cair.
- **Laba Ditahan:** akumulasi Laba Bersih **SEJAK cut-off only**. Data pre-cut-off cuma untuk histori/tren di dashboard, tidak ikut Laba Ditahan (sudah ter-summarize di Modal Awal — kalau diikutin = double count, Neraca tidak balance).
- Kas = saldo gulung dari laporan §4.
- Persediaan = Σ(qty × harga modal) dari inventory live (bukan snapshot cut-off — itu sudah masuk Modal).
- **Validasi wajib: TOTAL ASET == TOTAL LIABILITAS + EKUITAS.** Jika tidak balance, render warning, jangan diam.

---

## 4. Laporan Arus Kas — running balance (laporan TERPISAH)

Bukan net per bulan saja. **Saldo bergulir.**

```
                  Masuk    Keluar   Net Bulanan   Saldo Akhir
Saldo Pembukaan                                   [saldo_pembukaan_kas]
[bulan]           xxx      xxx      +/-           [gulung dari atas]
...
```

- Titik mulai = `saldo_pembukaan_kas` di `cut_off_date`.
- Hanya transaksi kas **sejak cut-off** yang masuk gulungan.
- Data sebelum cut-off = histori (untuk Laba Rugi & tren), TIDAK masuk running balance.
- Net Bulanan tetap ditampilkan (sinyal performa bulan itu). Saldo Akhir = uang real.
- Sumber transaksi kas: baca dari cashflow sheet (read-only).

---

## 5. Rekonsiliasi End-of-Month (OPSIONAL, disimpan per bulan)

Karena tidak ada piutang & transaksi diakui saat kirim, saldo app bisa beda dari rekening real karena dana Shopee in-transit. Baris ini muncul HANYA di akhir bulan saat Budhi mau cocokkan ke rupiah. **Bukan input harian.**

```
Saldo menurut app:           Rp X   [dari §4]
(-) Shopee in-transit:       Rp Y   [dana belum dilepas Shopee, input manual saat rekon]
= Perkiraan saldo rekening:  Rp X-Y
```

- `Y` = input manual sekali per bulan saat rekon. Budhi cek dashboard Shopee, masukkan total dana belum dilepas.
- Toggle: tampilkan baris ini hanya kalau user klik "Rekonsiliasi" untuk bulan tsb.
- **Disimpan per bulan** di sheet `rekonsiliasi` (schema §5c) — histori bisa di-recall untuk audit / cek tren.

### 5b. Buku In-Transit (sudah dibayar, belum datang)

Gap kedua: belanja buku sudah bayar (kas turun) tapi barang belum tiba → belum masuk inventory. Nilainya sementara "hilang": bukan kas, bukan persediaan. Pos: **Persediaan Dalam Perjalanan / Uang Muka Pembelian** (aset).

Pola sama seperti Shopee — input manual saat rekon, bukan harian:

```
Neraca saat rekon, tambah baris ASET:
  Persediaan Dalam Perjalanan:  Rp Z   [nilai buku sudah dibayar belum datang, input manual]
```

- `Z` = input manual saat rekon. Begitu buku tiba & masuk inventory, `Z` di-nol-kan di rekon bulan berikutnya (nilai sudah pindah ke Persediaan).
- Muncul hanya di mode Rekonsiliasi.

### 5c. Sheet `rekonsiliasi` (schema)

Sheet baru, satu row per bulan:

| kolom | tipe | keterangan |
|---|---|---|
| `bulan` | string `YYYY-MM` | primary key, contoh `2026-06` |
| `shopee_in_transit` | angka | nilai `Y` (§5) |
| `buku_in_transit` | angka | nilai `Z` (§5b) |
| `note` | teks (opsional) | catatan rekon, mis. selisih sisa |
| `created_at` | timestamp | waktu rekon dibuat / di-update |

Behavior:
- Kalau bulan tsb sudah pernah direkon, button "Rekonsiliasi" jadi mode edit (load nilai existing & overwrite `created_at`), bukan create row baru.
- Bulan tanpa row = belum direkon. Render Neraca normal (tanpa baris rekon).

---

## 6. Catatan atas Laporan Keuangan (CaLK) — wajib SAK EMKM

Template statis + inject angka. Isi minimum:

1. Gambaran umum usaha (`nama_usaha`, `alamat_usaha`, jenis usaha)
2. Pernyataan kepatuhan SAK EMKM
3. Kebijakan akuntansi: persediaan **FIFO**; pengakuan pendapatan **saat barang dikirim**; basis **akrual**
4. Rincian akun signifikan: Kas, Persediaan, Modal, Utang ke Pemilik
5. Catatan pemisahan kekayaan pribadi vs usaha sejak `cut_off_date`

---

## 6.5 Dashboard Kesehatan Bisnis (ringkas, di atas laporan detail)

5 kartu indikator + 1 grafik tren (Laba & Kas). Tujuan: tahu bisnis sehat/tidak dalam sekali lihat.

| Indikator | Sumber | Hijau | Kuning | Merah |
|---|---|---|---|---|
| Laba Bersih | §2 | positif & naik MoM | positif tapi turun | negatif |
| Margin % (laba kotor ÷ pendapatan) | §2 | naik/stabil | turun tipis | turun tajam |
| Saldo Kas | §4 | positif & tumbuh | positif tapi turun | menipis/negatif |
| Net Cashflow bulanan | §4 | positif | nol/sesekali minus | minus beruntun |
| Persediaan vs Kas | §3 §4 | seimbang | stok mulai dominan | modal nyangkut di stok |

- Grafik tren: garis Laba Bersih + garis Saldo Kas, 3M/6M/12M (pola toggle existing Laporan dashboard).
- **Warning klasik:** laba naik tapi kas turun beruntun → kebanyakan beli stok. Render hint.

---

## 6.6 Penyimpanan Data

- **TIDAK simpan snapshot bulanan untuk Laba Rugi / Neraca / Arus Kas.** Semua laporan dihitung on-the-fly dari data mentah (sales, cashflow, inventory) saat user pilih periode.
- Yang disimpan permanen di sheet baru:
  - `pengaturan_laporan` — 5 field manual, sekali isi (§1)
  - `rekonsiliasi` — satu row per bulan, opsional, manual saat user klik rekon (§5c). Bukan snapshot otomatis.
- Keuntungan: laporan utama selalu akurat (tidak ada data basi, tidak ada sinkronisasi snapshot). Rekon disimpan karena memang input manual end-of-month, bukan derivable.

---

## 7. Sumber Data (mapping)

| Akun | Sumber | Catatan |
|---|---|---|
| Pendapatan | sales sheet | sudah net, basis tanggal transaksi |
| HPP | fifo.js | sudah ada |
| Beban Ongkir | cashflow sheet | `category='ongkir'` |
| Beban Operasional | cashflow sheet | `category='operasional'` |
| Beban Iklan/Marketing | cashflow sheet | `category='iklan_marketing'` |
| Beban Lain-lain | cashflow sheet | `category='lainnya' AND type='expense'` |
| Persediaan | inventory sheet | qty × harga modal (live) |
| Kas (gulung) | cashflow sheet + `saldo_pembukaan_kas` | running balance sejak cut-off |
| Utang ke Pemilik | cashflow sheet | Σ `pinjaman_pemilik` − Σ `pelunasan_pinjaman` |
| Uang Muka Pelanggan | cashflow sheet | Σ `dp_customer` where `isAdvance=true AND delivered=false` |
| Modal | `pengaturan_laporan` | manual, = saldo_pembukaan_kas + nilai persediaan di cut-off |
| Laba Ditahan | dihitung | Σ Laba Bersih **post cut-off only** |
| Shopee in-transit | sheet `rekonsiliasi` | manual per bulan saat rekon |
| Buku in-transit | sheet `rekonsiliasi` | manual per bulan saat rekon |

GitHub raw access: `https://raw.githubusercontent.com/budhiantod-a11y/perpustakaan-brian-modular/refs/heads/main/js/[filename]`

---

## 8. Urutan Build (fase, satu per satu — validasi sebelum lanjut)

1. Tambah kategori `pinjaman_pemilik` (income) & `pelunasan_pinjaman` (expense) di `cashflow.js` `CATEGORIES` & `CATEGORY_LABELS` (additive only, jangan edit logic existing)
2. Sheet `pengaturan_laporan` + reader-nya
3. Laporan Arus Kas gulung (§4) — paling penting, acuan uang real
4. Laporan Persediaan (feed ke Neraca)
5. Laba Rugi (§2)
6. Neraca (§3) — gabungan, dengan validasi balance
7. CaLK (§6)
8. Sheet `rekonsiliasi` + UI rekon end-of-month (§5) — opsional
9. Export PDF/print untuk bank
