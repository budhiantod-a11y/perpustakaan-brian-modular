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
import { fmt, today, showToast } from './helpers.js';
import { totalStock, avgBuy, bookInventoryValue } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// Module-level UI state (selector state hanya hidup selama session, gak perlu di-persist)
let _persediaanExpanded = false;
let _persediaanSearch   = '';
export function togglePersediaan()    { _persediaanExpanded = !_persediaanExpanded; _render(); }
export function setPersediaanSearch(v){ _persediaanSearch = (v || '').toLowerCase().trim(); _render(); }

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

// ─── Render tab ───────────────────────────────────────────────────────────────

export function renderInto(area) {
  const s = S.laporanSettings || {};
  const arusKas    = calcArusKas();
  const persediaan = calcPersediaan();

  area.innerHTML = `
    <div class="page-hdr">
      <div>
        <div class="page-title">Laporan Keuangan</div>
        <div class="page-sub">Sesuai SAK EMKM — basis akrual, biaya historis</div>
      </div>
    </div>

    ${renderPengaturan(s)}
    ${renderArusKas(arusKas)}
    ${renderPersediaan(persediaan)}
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
