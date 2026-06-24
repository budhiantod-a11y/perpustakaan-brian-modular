// ═══════════════════════════════════════════════════════════════════════════
// laporan-keuangan.js — Laporan Keuangan SAK EMKM
//
// Per LAPORAN_KEUANGAN_SPEC.md:
//   - Pengaturan (5 field manual ke sheet pengaturan_laporan)
//   - Laporan Arus Kas running balance (§4)  ← fase 3
//   - Laba Rugi (§2)                         ← fase 5
//   - Neraca (§3)                            ← fase 6
//   - CaLK (§6)                              ← fase 7
//   - Rekonsiliasi (§5)                      ← fase 8
// ═══════════════════════════════════════════════════════════════════════════

import * as S from './state.js';
import { fmt, today, showToast, openModal, closeModal } from './helpers.js';
import { totalStock, avgBuy, bookInventoryValue } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// Module-level UI state (selector state hanya hidup selama session, gak perlu di-persist)
let _persediaanExpanded = false;
let _persediaanSearch   = '';
export function togglePersediaan()    { _persediaanExpanded = !_persediaanExpanded; _render(); }
export function setPersediaanSearch(v){ _persediaanSearch = (v || '').toLowerCase().trim(); _render(); }

// CaLK: collapsible
let _calkExpanded = false;
export function toggleCaLK() { _calkExpanded = !_calkExpanded; _render(); }

// Rekonsiliasi: helpers
function findRekon(bulan) { return S.rekonsiliasi.find(r => r.bulan === bulan); }
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function openRekonModal(bulan) {
  bulan = bulan || currentMonth();
  const existing = findRekon(bulan) || { bulan, shopee_in_transit: 0, buku_in_transit: 0, note: '' };
  openModal(`
    <h2 class="modal-title">Rekonsiliasi ${bulan}</h2>
    <div class="page-sub" style="margin-bottom:12px">
      Catat dana yang masih in-transit di akhir bulan. Disimpan per bulan, bisa di-edit kapan aja.
    </div>

    <div class="field">
      <label>Shopee in-transit (Rp)</label>
      <input class="inp" type="number" id="rekon-shopee" value="${existing.shopee_in_transit || ''}" min="0" placeholder="Dana belum dilepas Shopee">
      <div class="page-sub" style="font-size:11px;margin-top:4px">Cek dashboard Shopee → total saldo belum cair.</div>
    </div>

    <div class="field">
      <label>Buku in-transit (Rp)</label>
      <input class="inp" type="number" id="rekon-buku" value="${existing.buku_in_transit || ''}" min="0" placeholder="Nilai buku sudah dibayar tapi belum datang">
      <div class="page-sub" style="font-size:11px;margin-top:4px">Belanja stok sudah bayar, barang belum tiba. Nol-kan bulan berikutnya saat buku masuk inventory.</div>
    </div>

    <div class="field">
      <label>Catatan (opsional)</label>
      <input class="inp" type="text" id="rekon-note" value="${(existing.note || '').replace(/"/g,'&quot;')}" placeholder="Selisih sisa, dst">
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      ${findRekon(bulan) ? `<button class="btn btn-ghost" style="color:var(--red)" onclick="lkDeleteRekon('${bulan}')">Hapus</button>` : ''}
      <button class="btn btn-primary" onclick="lkSaveRekon('${bulan}')">Simpan</button>
    </div>
  `);
}

export function saveRekon(bulan) {
  const shopee = Number(document.getElementById('rekon-shopee')?.value) || 0;
  const buku   = Number(document.getElementById('rekon-buku')?.value)   || 0;
  const note   = (document.getElementById('rekon-note')?.value || '').trim();

  const entry = {
    bulan,
    shopee_in_transit: shopee,
    buku_in_transit:   buku,
    note,
    created_at: new Date().toISOString(),
  };

  const idx = S.rekonsiliasi.findIndex(r => r.bulan === bulan);
  if (idx >= 0) S.rekonsiliasi[idx] = entry;
  else          S.rekonsiliasi.push(entry);
  S.save();
  closeModal();
  showToast(`Rekonsiliasi ${bulan} tersimpan ✓`);
  _render();
}

export function deleteRekon(bulan) {
  if (!confirm(`Hapus rekonsiliasi bulan ${bulan}?`)) return;
  const idx = S.rekonsiliasi.findIndex(r => r.bulan === bulan);
  if (idx >= 0) S.rekonsiliasi.splice(idx, 1);
  S.save();
  closeModal();
  showToast(`Rekonsiliasi ${bulan} dihapus`);
  _render();
}

// Laba Rugi: bulan terpilih (default = bulan current)
let _lrSelectedYear  = null;
let _lrSelectedMonth = null;
function ensureLrInit() {
  if (_lrSelectedYear === null) {
    const now = new Date();
    _lrSelectedYear  = now.getFullYear();
    _lrSelectedMonth = now.getMonth() + 1;
  }
}
export function setLrMonth(yyyymm) {
  if (!yyyymm || !/^\d{4}-\d{2}$/.test(yyyymm)) return;
  const [y, m] = yyyymm.split('-');
  _lrSelectedYear  = Number(y);
  _lrSelectedMonth = Number(m);
  _render();
}

const BULAN_ID_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function fmtMonth(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return BULAN_ID_FULL[Number(m) - 1] + ' ' + y;
}

// ─── Pengaturan: simpan form ──────────────────────────────────────────────────

export function savePengaturan() {
  const cut_off_date        = document.getElementById('lk-cut-off-date')?.value || '';
  const saldo_pembukaan_kas = Number(document.getElementById('lk-saldo-pembukaan')?.value) || 0;
  const modal_awal          = Number(document.getElementById('lk-modal-awal')?.value) || 0;
  const nama_usaha          = (document.getElementById('lk-nama-usaha')?.value || '').trim();
  const alamat_usaha        = (document.getElementById('lk-alamat-usaha')?.value || '').trim();

  if (cut_off_date && !/^\d{4}-\d{2}-\d{2}$/.test(cut_off_date)) {
    showToast('Format cut-off date salah (harus YYYY-MM-DD)', 'err');
    return;
  }

  S.set.laporanSettings({ cut_off_date, saldo_pembukaan_kas, modal_awal, nama_usaha, alamat_usaha });
  S.save();
  showToast('Pengaturan tersimpan ✓');
  _render();
}

// ─── Arus Kas: running balance per bulan sejak cut-off ─────────────────────────

export function calcArusKas() {
  const settings = S.laporanSettings || {};
  const cutOff = settings.cut_off_date || '';
  const saldoPembukaan = Number(settings.saldo_pembukaan_kas) || 0;

  if (!cutOff) return { ok: false, reason: 'no-cutoff', saldoPembukaan: 0, rows: [] };

  const todayStr = today();
  const byMonth = {};

  const add = (date, type, amount) => {
    if (!date || date < cutOff || date > todayStr) return;
    const month = date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { masuk: 0, keluar: 0 };
    if (type === 'income') byMonth[month].masuk  += amount;
    else                   byMonth[month].keluar += amount;
  };

  // Auto: revenue dari sales
  for (const s of S.sales) {
    const rev = s.isBundle
      ? (s.finalPrice || s.finalSellPrice || 0)
      : (s.qty || 0) * (s.finalPrice || s.finalSellPrice || 0);
    add(s.date, 'income', rev);
  }

  // Auto: preorder paymentLog (kas keluar)
  for (const po of S.preorders) {
    for (const pay of (po.paymentLog || [])) {
      add(pay.date, 'expense', pay.amount || 0);
    }
  }

  // Manual cashflows (termasuk pinjaman/pelunasan pemilik)
  // DP customer yang sudah delivered di-SKIP — sale auto-entry sudah cover full revenue,
  // kalau DP delivered juga dihitung = double count (lihat diskusi spec §2).
  // DP pending (belum delivered) tetap masuk karena cash udah masuk tapi sale belum dibuat.
  for (const cf of S.cashflows) {
    if (cf.category === 'dp_customer' && cf.delivered === true && cf.isAdvance === false) continue;
    add(cf.date, cf.type, cf.amount || 0);
  }

  // Sort bulan ascending, compute running balance
  const months = Object.keys(byMonth).sort();
  let saldo = saldoPembukaan;
  const rows = months.map(m => {
    const { masuk, keluar } = byMonth[m];
    const net = masuk - keluar;
    saldo += net;
    return { bulan: m, masuk, keluar, net, saldoAkhir: saldo };
  });

  return { ok: true, saldoPembukaan, rows };
}

// ─── Persediaan: total nilai inventory (live, untuk Neraca) ────────────────────

export function calcPersediaan() {
  let totalValue = 0, totalTitles = 0, totalQty = 0;
  const items = [];

  for (const b of S.books) {
    const qty = totalStock(b);
    if (qty <= 0) continue;  // skip buku stok 0
    const value = bookInventoryValue(b);
    totalValue  += value;
    totalQty    += qty;
    totalTitles += 1;
    items.push({
      id:       b.id,
      title:    b.title,
      author:   b.author || '',
      qty,
      avgBuy:   avgBuy(b),
      value,
    });
  }

  items.sort((a, b) => b.value - a.value);
  return { totalValue, totalTitles, totalQty, items };
}

// ─── Laba Rugi: per periode (bulan tertentu, atau range YTD) ────────────────────
// Per spec §2 mapping:
//   bayar_po           → SKIP (sudah masuk HPP via FIFO)
//   ongkir             → Beban Ongkir
//   operasional        → Beban Operasional
//   iklan_marketing    → Beban Iklan/Marketing
//   lainnya (expense)  → Beban Lain-lain
//   dp_customer        → SKIP (liability di Neraca)
//   pinjaman_pemilik   → SKIP (liability di Neraca)
//   pelunasan_pinjaman → SKIP (mengurangi liability di Neraca)

function inPeriod(dateStr, year, monthFrom, monthTo) {
  if (!dateStr) return false;
  const [y, m] = dateStr.split('-');
  const yi = Number(y), mi = Number(m);
  if (yi !== year) return false;
  return mi >= monthFrom && mi <= monthTo;
}

function aggregateLabaRugi(year, monthFrom, monthTo) {
  let revenue = 0, hpp = 0;
  let bebanOngkir = 0, bebanOperasional = 0, bebanIklan = 0, bebanLain = 0;
  let salesCount = 0;

  for (const s of S.sales) {
    if (!inPeriod(s.date, year, monthFrom, monthTo)) continue;
    const rev = s.isBundle
      ? (s.finalPrice || s.finalSellPrice || 0)
      : (s.qty || 0) * (s.finalPrice || s.finalSellPrice || 0);
    revenue += rev;
    hpp     += (s.cogs || 0);
    salesCount++;
  }

  for (const cf of S.cashflows) {
    if (cf.type !== 'expense') continue;
    if (!inPeriod(cf.date, year, monthFrom, monthTo)) continue;
    switch (cf.category) {
      case 'ongkir':          bebanOngkir      += (cf.amount || 0); break;
      case 'operasional':     bebanOperasional += (cf.amount || 0); break;
      case 'iklan_marketing': bebanIklan       += (cf.amount || 0); break;
      case 'lainnya':         bebanLain        += (cf.amount || 0); break;
      // bayar_po, pelunasan_pinjaman → skip
    }
  }

  const labaKotor  = revenue - hpp;
  const totalBeban = bebanOngkir + bebanOperasional + bebanIklan + bebanLain;
  const labaBersih = labaKotor - totalBeban;
  const margin     = revenue > 0 ? (labaKotor / revenue) * 100 : 0;
  const empty      = salesCount === 0 && totalBeban === 0;

  return { revenue, hpp, labaKotor, margin, bebanOngkir, bebanOperasional, bebanIklan, bebanLain, totalBeban, labaBersih, empty };
}

export function calcLabaRugi(year, month) { return aggregateLabaRugi(year, month, month); }
export function calcLabaRugiYtd(year, untilMonth) { return aggregateLabaRugi(year, 1, untilMonth); }

// ─── Neraca: snapshot live (per hari ini) ──────────────────────────────────────
// Per spec §3. TOTAL ASET harus == TOTAL LIABILITAS + EKUITAS.
// Filtering date >= cut_off untuk Owner Loan & Laba Ditahan (pre-cut-off sudah masuk Modal Awal).
// DP Pending dihitung apa adanya (live state, tidak filter date).

export function calcNeraca() {
  const settings = S.laporanSettings || {};
  const cutOff = settings.cut_off_date || '';
  if (!cutOff) return { ok: false, reason: 'no-cutoff' };

  // ── ASET ──
  const arusKas = calcArusKas();
  const kas = arusKas.ok && arusKas.rows.length > 0
    ? arusKas.rows[arusKas.rows.length - 1].saldoAkhir
    : (Number(settings.saldo_pembukaan_kas) || 0);
  const persediaan = calcPersediaan().totalValue;
  const totalAset = kas + persediaan;

  // ── LIABILITAS ──
  let pinjaman = 0, pelunasan = 0, dpPending = 0;
  for (const cf of S.cashflows) {
    if (!cf.date) continue;

    // Owner loan: filter date >= cut_off (pre-cut-off sudah ter-resolved di Modal)
    if (cf.date >= cutOff) {
      if (cf.category === 'pinjaman_pemilik')   pinjaman  += cf.amount || 0;
      if (cf.category === 'pelunasan_pinjaman') pelunasan += cf.amount || 0;
    }

    // DP pending: live state, semua waktu (kalau pre-cut-off masih pending = tetap liability)
    if (cf.category === 'dp_customer' && cf.isAdvance === true && cf.delivered === false) {
      dpPending += cf.amount || 0;
    }
  }
  const utangPemilik       = pinjaman - pelunasan;
  const uangMukaPelanggan  = dpPending;
  const totalLiabilitas    = utangPemilik + uangMukaPelanggan;

  // ── EKUITAS ──
  const modal = Number(settings.modal_awal) || 0;

  // Laba Ditahan = Σ Laba Bersih sejak cut-off (inline, supaya date filter pakai cutOff exact, bukan per bulan)
  let revPost = 0, hppPost = 0, bebanPost = 0;
  for (const s of S.sales) {
    if (!s.date || s.date < cutOff) continue;
    const rev = s.isBundle
      ? (s.finalPrice || s.finalSellPrice || 0)
      : (s.qty || 0) * (s.finalPrice || s.finalSellPrice || 0);
    revPost += rev;
    hppPost += (s.cogs || 0);
  }
  const BEBAN_CATEGORIES = ['ongkir', 'operasional', 'iklan_marketing', 'lainnya'];
  for (const cf of S.cashflows) {
    if (cf.type !== 'expense') continue;
    if (!cf.date || cf.date < cutOff) continue;
    if (BEBAN_CATEGORIES.includes(cf.category)) bebanPost += (cf.amount || 0);
  }
  const labaDitahan = revPost - hppPost - bebanPost;

  const totalEkuitas    = modal + labaDitahan;
  const totalLiabEkuitas = totalLiabilitas + totalEkuitas;

  const selisih = totalAset - totalLiabEkuitas;
  const balanced = Math.abs(selisih) < 1; // toleransi 1 rupiah (rounding)

  return {
    ok: true,
    cutOff,
    aset:        { kas, persediaan, total: totalAset },
    liabilitas:  { utangPemilik, uangMukaPelanggan, total: totalLiabilitas },
    ekuitas:     { modal, labaDitahan, total: totalEkuitas },
    totalLiabEkuitas,
    balanced,
    selisih,
  };
}

// ─── Render tab ───────────────────────────────────────────────────────────────

export function renderInto(area) {
  ensureLrInit();
  const s = S.laporanSettings || {};
  const arusKas    = calcArusKas();
  const persediaan = calcPersediaan();

  const curr = calcLabaRugi(_lrSelectedYear, _lrSelectedMonth);
  const ytd  = calcLabaRugiYtd(_lrSelectedYear, _lrSelectedMonth);
  // Bulan sebelumnya (handle year crossover)
  let prevY = _lrSelectedYear, prevM = _lrSelectedMonth - 1;
  if (prevM < 1) { prevM = 12; prevY--; }
  const prev = calcLabaRugi(prevY, prevM);

  area.innerHTML = `
    <div class="page-hdr">
      <div>
        <div class="page-title">Laporan Keuangan</div>
        <div class="page-sub">Sesuai SAK EMKM — basis akrual, biaya historis</div>
      </div>
    </div>

    ${renderPengaturan(s)}
    ${renderLabaRugi(curr, ytd, prev, _lrSelectedYear, _lrSelectedMonth, prevY, prevM)}
    ${renderArusKas(arusKas)}
    ${renderPersediaan(persediaan)}
    ${renderNeraca(calcNeraca())}
    ${renderRekonsiliasi()}
    ${renderCaLK(s, calcNeraca())}
  `;
}

function renderRekonsiliasi() {
  const rows = [...S.rekonsiliasi].sort((a, b) => b.bulan.localeCompare(a.bulan));
  const thisMonth = currentMonth();
  const hasThisMonth = !!findRekon(thisMonth);

  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3);font-size:13px">Belum ada rekonsiliasi tercatat</td></tr>`
    : rows.map(r => `
        <tr>
          <td><strong>${r.bulan}</strong></td>
          <td style="text-align:right">${fmt(r.shopee_in_transit)}</td>
          <td style="text-align:right">${fmt(r.buku_in_transit)}</td>
          <td style="font-size:12px;color:var(--text3)">${r.note || '—'}</td>
          <td style="text-align:right">
            <button class="btn btn-ghost btn-xs" onclick="lkOpenRekonModal('${r.bulan}')">Edit</button>
          </td>
        </tr>
      `).join('');

  return `
    <div class="card">
      <div class="lap-trend-hdr">
        <div class="card-title" style="margin:0">Rekonsiliasi End-of-Month (opsional)</div>
        <button class="btn btn-primary btn-sm" onclick="lkOpenRekonModal('${thisMonth}')">
          ${hasThisMonth ? `Edit Rekon ${thisMonth}` : `+ Rekon ${thisMonth}`}
        </button>
      </div>
      <div class="page-sub" style="margin-bottom:12px">
        Cocokkan saldo app vs rekening real saat akhir bulan. Input <strong>Y</strong> (Shopee dana belum cair) & <strong>Z</strong> (buku sudah dibayar belum datang). Disimpan per bulan.
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bulan</th>
              <th style="text-align:right">Shopee in-transit</th>
              <th style="text-align:right">Buku in-transit</th>
              <th>Catatan</th>
              <th style="text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCaLK(settings, neraca) {
  const namaUsaha   = settings.nama_usaha   || '<em style="color:var(--text3)">(belum diisi)</em>';
  const alamatUsaha = settings.alamat_usaha || '<em style="color:var(--text3)">(belum diisi)</em>';
  const cutOff      = settings.cut_off_date || '<em style="color:var(--text3)">(belum diisi)</em>';
  const modal       = neraca.ok ? fmt(neraca.ekuitas.modal)            : '—';
  const kas         = neraca.ok ? fmt(neraca.aset.kas)                 : '—';
  const persediaan  = neraca.ok ? fmt(neraca.aset.persediaan)          : '—';
  const utangPemilik= neraca.ok ? fmt(neraca.liabilitas.utangPemilik)  : '—';

  const body = !_calkExpanded ? '' : `
    <div style="margin-top:16px;padding:16px;background:#fafafa;border-radius:8px;line-height:1.7;font-size:13px">
      <h3 style="margin:0 0 8px 0;font-size:14px">1. Gambaran Umum Usaha</h3>
      <p style="margin:0 0 12px 0">
        <strong>${namaUsaha}</strong> adalah usaha mikro di bidang penjualan buku anak, berdomisili di ${alamatUsaha}.
        Usaha dijalankan dengan model online via marketplace Shopee dan saluran WhatsApp untuk customer langsung.
      </p>

      <h3 style="margin:0 0 8px 0;font-size:14px">2. Pernyataan Kepatuhan</h3>
      <p style="margin:0 0 12px 0">
        Laporan keuangan ini disusun sesuai <strong>Standar Akuntansi Keuangan Entitas Mikro, Kecil, dan Menengah (SAK EMKM)</strong>
        yang diterbitkan Ikatan Akuntan Indonesia (IAI).
      </p>

      <h3 style="margin:0 0 8px 0;font-size:14px">3. Kebijakan Akuntansi</h3>
      <ul style="margin:0 0 12px 0;padding-left:20px">
        <li><strong>Basis penyusunan:</strong> akrual, biaya historis.</li>
        <li><strong>Persediaan:</strong> dinilai dengan metode <strong>FIFO (First-In, First-Out)</strong> per batch pembelian.</li>
        <li><strong>Pengakuan pendapatan:</strong> diakui saat barang dikirim ke pelanggan (delivery basis). Pendapatan dari marketplace Shopee dicatat <strong>net</strong> (biaya admin marketplace sudah dipotong di sumber).</li>
        <li><strong>HPP:</strong> dihitung dengan FIFO costing per transaksi penjualan.</li>
        <li><strong>Kas:</strong> tidak ada pemisahan Piutang Marketplace dalam Neraca — saldo Shopee in-transit ditangani melalui rekonsiliasi bulanan opsional.</li>
      </ul>

      <h3 style="margin:0 0 8px 0;font-size:14px">4. Rincian Akun Signifikan</h3>
      <ul style="margin:0 0 12px 0;padding-left:20px">
        <li><strong>Kas &amp; Setara Kas:</strong> ${kas} — total saldo kas (rekening, tunai, e-wallet, Shopee saldo) per tanggal pelaporan.</li>
        <li><strong>Persediaan Buku:</strong> ${persediaan} — dihitung qty × harga modal FIFO per batch.</li>
        <li><strong>Modal Pemilik:</strong> ${modal} — setoran awal pemilik per cut-off date.</li>
        <li><strong>Utang ke Pemilik (Owner Loan):</strong> ${utangPemilik} — pinjaman sementara dari pemilik untuk operasional/belanja stok, akan dikembalikan. Terpisah dari Modal.</li>
      </ul>

      <h3 style="margin:0 0 8px 0;font-size:14px">5. Pemisahan Kekayaan</h3>
      <p style="margin:0">
        Sejak <strong>${cutOff}</strong>, kekayaan usaha dipisahkan dari kekayaan pribadi pemilik melalui rekening bisnis terpisah.
        Transaksi pre-cut-off telah ter-summarize dalam Modal Awal. Setoran/penarikan pemilik post-cut-off dicatat sebagai Utang ke Pemilik
        (jika sementara) atau penambahan/pengurangan Modal (jika permanen).
      </p>
    </div>
  `;

  return `
    <div class="card">
      <div class="card-title">Catatan atas Laporan Keuangan (CaLK)</div>
      <div class="page-sub" style="margin-bottom:12px">
        Wajib SAK EMKM. Template statis + nilai dari Pengaturan & laporan di atas.
      </div>
      <button class="btn btn-ghost btn-sm" onclick="lkToggleCaLK()" style="width:100%">
        ${_calkExpanded ? '▲ Sembunyikan CaLK' : '▼ Lihat CaLK lengkap'}
      </button>
      ${body}
    </div>
  `;
}

function renderNeraca(n) {
  if (!n.ok) {
    return `
      <div class="card">
        <div class="card-title">Neraca (Laporan Posisi Keuangan)</div>
        <div class="page-sub" style="padding:24px 0;text-align:center">
          📋 Isi <strong>Cut-off Date</strong> & <strong>Modal Awal</strong> di Pengaturan dulu.
        </div>
      </div>
    `;
  }

  const { aset, liabilitas, ekuitas, totalLiabEkuitas, balanced, selisih } = n;
  const todayStr = today();

  const row = (label, val, opts = {}) => {
    const { bold, indent, color } = opts;
    const tdLabelStyle = [
      indent ? 'padding-left:20px' : '',
      bold ? 'font-weight:700' : '',
      color ? `color:${color}` : '',
    ].filter(Boolean).join(';');
    const tdValStyle = [
      'text-align:right',
      bold ? 'font-weight:700' : '',
      color ? `color:${color}` : '',
    ].filter(Boolean).join(';');
    return `
      <tr>
        <td style="${tdLabelStyle}">${label}</td>
        <td style="${tdValStyle}">${fmt(val)}</td>
      </tr>
    `;
  };

  const warningHtml = balanced ? '' : `
    <div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:16px">
      <strong style="color:var(--red)">⚠ Neraca tidak balance!</strong>
      <div style="font-size:13px;margin-top:4px">
        Selisih: <strong>${fmt(selisih)}</strong> (ASET ${selisih > 0 ? 'lebih besar' : 'lebih kecil'} dari LIABILITAS + EKUITAS).
      </div>
      <div style="font-size:12px;color:var(--text3);margin-top:6px">
        Penyebab umum: Modal Awal di Pengaturan belum sesuai (acuan = Saldo Pembukaan + nilai persediaan di cut-off), atau ada transaksi pre-cut-off yang seharusnya gak masuk Laba Ditahan.
      </div>
    </div>
  `;

  return `
    <div class="card">
      <div class="card-title">Neraca (Laporan Posisi Keuangan)</div>
      <div class="page-sub" style="margin-bottom:12px">
        Snapshot per <strong>${todayStr}</strong>. Cut-off: <strong>${n.cutOff}</strong>. Validasi: TOTAL ASET == TOTAL LIABILITAS + EKUITAS.
      </div>

      ${warningHtml}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- ASET -->
        <div>
          <div style="padding:8px 12px;background:#f0fdf4;border-radius:6px;font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.5px;color:var(--green)">ASET</div>
          <table style="margin-top:8px">
            <tbody>
              ${row('Kas & Setara Kas', aset.kas)}
              ${row('Persediaan Buku',  aset.persediaan)}
              <tr><td colspan="2" style="border-top:1px solid var(--border);padding:4px"></td></tr>
              ${row('TOTAL ASET', aset.total, { bold: true })}
            </tbody>
          </table>
        </div>

        <!-- LIABILITAS + EKUITAS -->
        <div>
          <div style="padding:8px 12px;background:#fef2f2;border-radius:6px;font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.5px;color:var(--red)">LIABILITAS</div>
          <table style="margin-top:8px">
            <tbody>
              ${row('Utang ke Pemilik',     liabilitas.utangPemilik)}
              ${row('Uang Muka Pelanggan',  liabilitas.uangMukaPelanggan)}
              <tr><td colspan="2" style="border-top:1px solid var(--border);padding:4px"></td></tr>
              ${row('Total Liabilitas', liabilitas.total, { bold: true })}
            </tbody>
          </table>

          <div style="padding:8px 12px;background:#eff6ff;border-radius:6px;font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.5px;color:var(--blue);margin-top:12px">EKUITAS</div>
          <table style="margin-top:8px">
            <tbody>
              ${row('Modal Budhi',    ekuitas.modal)}
              ${row('Laba Ditahan',   ekuitas.labaDitahan, { color: ekuitas.labaDitahan >= 0 ? 'inherit' : 'var(--red)' })}
              <tr><td colspan="2" style="border-top:1px solid var(--border);padding:4px"></td></tr>
              ${row('Total Ekuitas', ekuitas.total, { bold: true })}
            </tbody>
          </table>

          <table style="margin-top:12px">
            <tbody>
              <tr style="background:${balanced ? '#fef9c3' : '#fef2f2'}">
                <td style="font-weight:700;padding:8px">TOTAL LIABILITAS + EKUITAS</td>
                <td style="text-align:right;font-weight:700;padding:8px">${fmt(totalLiabEkuitas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderPengaturan(s) {
  return `
    <div class="card">
      <div class="card-title">Pengaturan</div>
      <div class="page-sub" style="margin-bottom:12px">
        5 field manual yang jadi acuan semua laporan. Cukup diisi sekali (atau update saat ada perubahan).
      </div>

      <div class="field">
        <label>Cut-off Date (tanggal rekening bisnis dipisah) *</label>
        <input class="inp" type="date" id="lk-cut-off-date" value="${s.cut_off_date || ''}" max="${today()}">
        <div class="page-sub" style="font-size:11px;margin-top:4px">Garis pemisah histori vs kas terekonsiliasi. Semua running balance arus kas dihitung sejak tanggal ini.</div>
      </div>

      <div class="field">
        <label>Saldo Pembukaan Kas (Rp) *</label>
        <input class="inp" type="number" id="lk-saldo-pembukaan" value="${s.saldo_pembukaan_kas || ''}" min="0" placeholder="Total uang cair di cut-off date">
        <div class="page-sub" style="font-size:11px;margin-top:4px">Rekening + tunai + ewallet + Shopee belum cair. <strong>Uang yang sudah jadi buku JANGAN dimasukkan</strong> — itu sudah tercatat di inventory.</div>
      </div>

      <div class="field">
        <label>Modal Awal (Rp) *</label>
        <input class="inp" type="number" id="lk-modal-awal" value="${s.modal_awal || ''}" min="0" placeholder="Saldo cair + nilai persediaan di cut-off">
        <div class="page-sub" style="font-size:11px;margin-top:4px">Untuk Neraca. Acuan: Saldo Pembukaan Kas + nilai persediaan (qty × harga modal) di cut-off date.</div>
      </div>

      <div class="field">
        <label>Nama Usaha</label>
        <input class="inp" type="text" id="lk-nama-usaha" value="${(s.nama_usaha || '').replace(/"/g,'&quot;')}" placeholder="Perpustakaan Brian">
      </div>

      <div class="field">
        <label>Alamat Usaha</label>
        <input class="inp" type="text" id="lk-alamat-usaha" value="${(s.alamat_usaha || '').replace(/"/g,'&quot;')}" placeholder="Alamat lengkap">
      </div>

      <button class="btn btn-primary" onclick="lkSavePengaturan()">Simpan Pengaturan</button>
    </div>
  `;
}

function renderLabaRugi(curr, ytd, prev, year, month, prevY, prevM) {
  const monthLabel    = fmtMonth(year + '-' + String(month).padStart(2, '0'));
  const prevLabel     = fmtMonth(prevY + '-' + String(prevM).padStart(2, '0'));
  const ytdLabel      = `YTD ${year}`;
  const monthInputVal = year + '-' + String(month).padStart(2, '0');

  // Helper: render satu cell amount (right-aligned)
  const cell = (val, opts = {}) => {
    const { bold, color, isPct } = opts;
    const text = isPct ? (val.toFixed(1) + '%') : fmt(val);
    const style = [
      'text-align:right',
      bold ? 'font-weight:700' : '',
      color ? `color:${color}` : '',
    ].filter(Boolean).join(';');
    return `<td style="${style}">${text}</td>`;
  };

  // Row helper
  const row = (label, c, y, p, opts = {}) => {
    const { bold, indent, color, highlight, isPct } = opts;
    const tdLabelStyle = [
      indent ? 'padding-left:24px' : '',
      bold ? 'font-weight:700' : '',
      color ? `color:${color}` : '',
    ].filter(Boolean).join(';');
    const trStyle = highlight ? 'background:#fef9c3' : '';
    return `
      <tr style="${trStyle}">
        <td style="${tdLabelStyle}">${label}</td>
        ${cell(c, { bold, color, isPct })}
        ${cell(y, { bold, color, isPct })}
        ${cell(p, { bold, color, isPct })}
      </tr>
    `;
  };

  const labaBersihColor = (v) => v >= 0 ? 'var(--green)' : 'var(--red)';

  const bodyHtml = `
    ${row('Pendapatan Penjualan', curr.revenue, ytd.revenue, prev.revenue)}
    ${row('(-) HPP',              curr.hpp,     ytd.hpp,     prev.hpp)}
    ${row('= LABA KOTOR',         curr.labaKotor, ytd.labaKotor, prev.labaKotor, { bold: true })}
    ${row('Margin %',             curr.margin,  ytd.margin,  prev.margin, { indent: true, isPct: true, color: 'var(--text3)' })}
    <tr><td colspan="4" style="padding:6px 0;border:none"></td></tr>
    ${row('(-) Beban Ongkir',           curr.bebanOngkir,      ytd.bebanOngkir,      prev.bebanOngkir)}
    ${row('(-) Beban Operasional',      curr.bebanOperasional, ytd.bebanOperasional, prev.bebanOperasional)}
    ${row('(-) Beban Iklan/Marketing',  curr.bebanIklan,       ytd.bebanIklan,       prev.bebanIklan)}
    ${row('(-) Beban Lain-lain',        curr.bebanLain,        ytd.bebanLain,        prev.bebanLain)}
    <tr><td colspan="4" style="padding:6px 0;border:none"></td></tr>
    ${row('= LABA BERSIH', curr.labaBersih, ytd.labaBersih, prev.labaBersih, {
      bold: true,
      highlight: true,
      color: labaBersihColor(curr.labaBersih),
    })}
  `;

  return `
    <div class="card">
      <div class="lap-trend-hdr">
        <div class="card-title" style="margin:0">Laporan Laba Rugi (akrual)</div>
        <div class="lap-month-picker">
          <label>Bulan</label>
          <input type="month" value="${monthInputVal}" onchange="lkSetLrMonth(this.value)">
        </div>
      </div>
      <div class="page-sub" style="margin-bottom:12px">
        Pendapatan diakui saat barang dikirim. HPP = FIFO per transaksi. Beban dari kategori cashflow (skip <code>bayar_po</code>, <code>dp_customer</code>, <code>pinjaman_pemilik</code>, <code>pelunasan_pinjaman</code>).
      </div>

      ${curr.empty ? `
        <div class="lap-empty-banner" style="margin-bottom:12px">
          <strong>📭 Belum ada transaksi</strong> untuk ${monthLabel}. Kolom YTD & Bulan Sblmnya tetap dihitung.
        </div>
      ` : ''}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Akun</th>
              <th style="text-align:right">${monthLabel}</th>
              <th style="text-align:right">${ytdLabel}</th>
              <th style="text-align:right">${prevLabel}</th>
            </tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderArusKas(arusKas) {
  if (!arusKas.ok) {
    return `
      <div class="card">
        <div class="card-title">Laporan Arus Kas</div>
        <div class="page-sub" style="padding:24px 0;text-align:center">
          📋 Isi <strong>Cut-off Date</strong> di Pengaturan dulu, baru arus kas bisa dihitung.
        </div>
      </div>
    `;
  }

  const { saldoPembukaan, rows } = arusKas;

  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3);font-size:13px">Belum ada transaksi sejak cut-off date</td></tr>`
    : rows.map(r => {
        const netColor = r.net >= 0 ? 'var(--green)' : 'var(--red)';
        const saldoColor = r.saldoAkhir >= 0 ? 'inherit' : 'var(--red)';
        return `
          <tr>
            <td><strong>${fmtMonth(r.bulan)}</strong></td>
            <td style="text-align:right;color:var(--green)">${fmt(r.masuk)}</td>
            <td style="text-align:right;color:var(--red)">${fmt(r.keluar)}</td>
            <td style="text-align:right;color:${netColor};font-weight:600">${r.net >= 0 ? '+' : ''}${fmt(r.net)}</td>
            <td style="text-align:right;color:${saldoColor};font-weight:600">${fmt(r.saldoAkhir)}</td>
          </tr>
        `;
      }).join('');

  const saldoAkhir = rows.length > 0 ? rows[rows.length - 1].saldoAkhir : saldoPembukaan;

  return `
    <div class="card">
      <div class="card-title">Laporan Arus Kas (Running Balance)</div>
      <div class="page-sub" style="margin-bottom:12px">
        Saldo bergulir sejak <strong>${S.laporanSettings.cut_off_date}</strong>. Saldo akhir = uang real yang harus ada (sebelum rekon Shopee in-transit).
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:140px;padding:12px;background:#f8fafc;border-radius:8px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Saldo Pembukaan</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${fmt(saldoPembukaan)}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:#f0fdf4;border-radius:8px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Saldo Akhir (sekarang)</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;color:${saldoAkhir >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(saldoAkhir)}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bulan</th>
              <th style="text-align:right">Masuk</th>
              <th style="text-align:right">Keluar</th>
              <th style="text-align:right">Net</th>
              <th style="text-align:right">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPersediaan(p) {
  const { totalValue, totalTitles, totalQty, items } = p;
  const search = _persediaanSearch;

  const filteredItems = search
    ? items.filter(it => it.title.toLowerCase().includes(search) || it.author.toLowerCase().includes(search))
    : items;

  const tableHtml = !_persediaanExpanded ? '' : `
    <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
      <div class="search-wrap" style="flex:1;position:relative">
        <input class="inp" type="text" id="lk-persediaan-search" placeholder="Cari judul atau penulis..."
          oninput="lkSetPersediaanSearch(this.value)" value="${search.replace(/"/g,'&quot;')}"
          style="width:100%">
        ${search ? `<button class="search-clear-btn" onclick="clearInputField('lk-persediaan-search')" type="button">✕ Clear</button>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text3);white-space:nowrap">
        ${filteredItems.length} dari ${items.length} judul
      </div>
    </div>

    <div class="table-wrap" style="margin-top:8px">
      <table>
        <thead>
          <tr>
            <th>Buku</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Harga Modal Avg</th>
            <th style="text-align:right">Total Nilai</th>
          </tr>
        </thead>
        <tbody>
          ${filteredItems.length === 0
            ? `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text3);font-size:13px">${search ? 'Tidak ada buku cocok dengan filter' : 'Tidak ada stok buku'}</td></tr>`
            : filteredItems.map(it => `
              <tr>
                <td>
                  <div style="font-size:13px;font-weight:500">${it.title}</div>
                  ${it.author ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${it.author}</div>` : ''}
                </td>
                <td style="text-align:right;font-weight:600">${it.qty}</td>
                <td style="text-align:right;color:var(--text3);font-size:12px">${fmt(it.avgBuy)}</td>
                <td style="text-align:right;font-weight:600">${fmt(it.value)}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  return `
    <div class="card">
      <div class="card-title">Laporan Persediaan</div>
      <div class="page-sub" style="margin-bottom:12px">
        Nilai inventory live (Σ qty × harga modal FIFO per batch). Feed ke baris <strong>Persediaan Buku</strong> di Neraca.
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1;min-width:140px;padding:12px;background:#fef9c3;border-radius:8px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total Nilai</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${fmt(totalValue)}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:#f8fafc;border-radius:8px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total Judul</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${totalTitles}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:12px;background:#f8fafc;border-radius:8px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total Pcs</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${totalQty}</div>
        </div>
      </div>

      <button class="btn btn-ghost btn-sm" onclick="lkTogglePersediaan()" style="width:100%">
        ${_persediaanExpanded ? '▲ Sembunyikan detail per buku' : '▼ Lihat detail per buku'}
      </button>

      ${tableHtml}
    </div>
  `;
}
