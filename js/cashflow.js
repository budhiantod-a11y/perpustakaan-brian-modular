// ═══════════════════════════════════════════════════════════════════════════
// cashflow.js — Manual cashflow entries + merge/ledger logic
//
// Hanya manual entries yang disimpan ke S.cashflows[].
// Auto-entries (dari sales & preorder paymentLog) di-generate on-the-fly
// saat render → tidak ada double-save, selalu fresh.
// ═══════════════════════════════════════════════════════════════════════════

import * as S from './state.js';
import { uid, today, fmt, showToast, openModal, closeModal } from './helpers.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ─── Category config ──────────────────────────────────────────────────────────

export const CATEGORIES = {
  income: [
    { value: 'dp_customer', label: 'DP / Uang Muka',   canAdvance: true },
    { value: 'lainnya',     label: 'Pemasukan Lain',   canAdvance: false },
  ],
  expense: [
    { value: 'ongkir',      label: 'Ongkir',           canAdvance: false },
    { value: 'operasional', label: 'Operasional',      canAdvance: false },
    { value: 'lainnya',     label: 'Pengeluaran Lain', canAdvance: false },
  ],
};

export const CATEGORY_LABELS = {
  penjualan:    'Penjualan',
  dp_customer:  'DP / Uang Muka',
  lainnya:      'Lainnya',
  bayar_po:     'Bayar PO',
  ongkir:       'Ongkir',
  operasional:  'Operasional',
};

// ─── Merge logic: gabungkan auto + manual entries ─────────────────────────────

export function buildLedger(dateFrom, dateTo) {
  const entries = [];

  // 1. Auto entries dari sales — aggregate per hari
  const salesInRange = S.sales.filter(s => s.date >= dateFrom && s.date <= dateTo);
  const salesByDay = {};
  for (const s of salesInRange) {
    if (!salesByDay[s.date]) salesByDay[s.date] = { count: 0, amount: 0 };
    const rev = s.isBundle
      ? (s.finalPrice || s.finalSellPrice || 0)
      : s.qty * (s.finalPrice || s.finalSellPrice || 0);
    salesByDay[s.date].count++;
    salesByDay[s.date].amount += rev;
  }
  for (const [date, val] of Object.entries(salesByDay)) {
    entries.push({
      id:        'auto-sale-' + date,
      date,
      type:      'income',
      category:  'penjualan',
      amount:    val.amount,
      note:      val.count + ' transaksi',
      isAdvance: false,
      delivered: true,
      source:    'auto',
    });
  }

  // 2. Auto entries dari preorder paymentLog
  for (const po of S.preorders) {
    for (const pay of (po.paymentLog || [])) {
      if (!pay.date || pay.date < dateFrom || pay.date > dateTo) continue;
      entries.push({
        id:        'auto-po-' + po.id + '-' + pay.date + '-' + pay.amount,
        date:      pay.date,
        type:      'expense',
        category:  'bayar_po',
        amount:    pay.amount,
        note:      po.publisher,
        isAdvance: false,
        delivered: true,
        source:    'auto',
        sourceRef: String(po.id),
      });
    }
  }

  // 3. Manual entries dari S.cashflows
  for (const cf of S.cashflows) {
    if (!cf.date || cf.date < dateFrom || cf.date > dateTo) continue;
    entries.push({ ...cf, source: 'manual' });
  }

  // Sort: terbaru dulu
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return entries;
}

// ─── Summary calculations ─────────────────────────────────────────────────────

export function calcSummary(ledger) {
  let totalCashIn  = 0;
  let totalCashOut = 0;
  let dpPending    = 0;

  for (const e of ledger) {
    if (e.type === 'income') {
      totalCashIn += e.amount;
      if (e.isAdvance && !e.delivered) dpPending += e.amount;
    } else {
      totalCashOut += e.amount;
    }
  }

  // Net = cash in - cash out, DP pending TIDAK dihitung (bukan confirmed revenue)
  const netCashflow = (totalCashIn - dpPending) - totalCashOut;

  return { totalCashIn, totalCashOut, netCashflow, dpPending };
}

// ─── All-time DP Pending (tidak terikat periode) ───────────────────────────────

export function calcAllTimePendingDp() {
  const entries = S.cashflows.filter(cf => cf.isAdvance && !cf.delivered);
  return {
    total: entries.reduce((s, e) => s + e.amount, 0),
    count: entries.length,
    entries,
  };
}

// ─── Add manual entry ─────────────────────────────────────────────────────────

export function openAddCashflow() {
  openModal(`
    <h2 class="modal-title">Tambah Entri Cashflow</h2>
    <div class="field">
      <label>Tipe *</label>
      <div style="display:flex;gap:8px">
        <button type="button" id="cf-type-income"
          class="btn btn-primary btn-sm"
          style="flex:1"
          onclick="cfSetType('income')">
          ↑ Pemasukan
        </button>
        <button type="button" id="cf-type-expense"
          class="btn btn-ghost btn-sm"
          style="flex:1"
          onclick="cfSetType('expense')">
          ↓ Pengeluaran
        </button>
      </div>
      <input type="hidden" id="cf-type" value="income">
    </div>
    <div class="field">
      <label>Kategori *</label>
      <select class="inp" id="cf-category" onchange="cfOnCategoryChange()">
        <option value="dp_customer">DP / Uang Muka</option>
        <option value="lainnya">Pemasukan Lain</option>
      </select>
    </div>
    <div class="field">
      <label>Tanggal *</label>
      <input class="inp" type="date" id="cf-date" value="${today()}" max="${today()}">
    </div>
    <div class="field">
      <label>Jumlah (Rp) *</label>
      <input class="inp" type="number" id="cf-amount" min="1" placeholder="Masukkan jumlah...">
    </div>
    <div class="field">
      <label>Keterangan *</label>
      <input class="inp" type="text" id="cf-note" placeholder="e.g. DP Bu Ani — Buku XYZ" autocomplete="off">
    </div>
    <div id="cf-advance-section" style="display:block">
      <div class="preview-box" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="cf-is-advance" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer" onchange="cfOnAdvanceChange()">
        <label for="cf-is-advance" style="cursor:pointer;font-size:13px;margin:0">
          <strong>Tandai sebagai DP Pending</strong>
          <div style="font-size:11px;color:var(--text3);font-weight:400;margin-top:1px">Uang sudah diterima tapi buku belum dikirim</div>
        </label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="saveCashflow()">Simpan</button>
    </div>
  `);
}

export function cfSetType(type) {
  document.getElementById('cf-type').value = type;

  // Update button styles
  const incBtn = document.getElementById('cf-type-income');
  const expBtn = document.getElementById('cf-type-expense');
  if (type === 'income') {
    incBtn.className = 'btn btn-primary btn-sm'; incBtn.style.flex = '1';
    expBtn.className = 'btn btn-ghost btn-sm';   expBtn.style.flex = '1';
  } else {
    incBtn.className = 'btn btn-ghost btn-sm';   incBtn.style.flex = '1';
    expBtn.className = 'btn btn-primary btn-sm'; expBtn.style.flex = '1';
  }

  // Update category options
  const sel = document.getElementById('cf-category');
  sel.innerHTML = type === 'income'
    ? `<option value="dp_customer">DP / Uang Muka</option>
       <option value="lainnya">Pemasukan Lain</option>`
    : `<option value="ongkir">Ongkir</option>
       <option value="operasional">Operasional</option>
       <option value="lainnya">Pengeluaran Lain</option>`;

  // Show/hide advance section
  cfOnCategoryChange();
}

export function cfOnCategoryChange() {
  const type = document.getElementById('cf-type')?.value;
  const cat  = document.getElementById('cf-category')?.value;
  const sec  = document.getElementById('cf-advance-section');
  if (sec) sec.style.display = (type === 'income' && cat === 'dp_customer') ? 'block' : 'none';
}

export function cfOnAdvanceChange() {
  // No-op for now — checkbox state is read at save time
}

export function saveCashflow() {
  const type      = document.getElementById('cf-type')?.value;
  const category  = document.getElementById('cf-category')?.value;
  const date      = document.getElementById('cf-date')?.value;
  const amount    = Number(document.getElementById('cf-amount')?.value);
  const note      = document.getElementById('cf-note')?.value?.trim();
  const isAdvance = document.getElementById('cf-is-advance')?.checked || false;

  // Validation
  if (!date)         { showToast('Tanggal wajib diisi', 'err'); return; }
  if (!amount || amount <= 0) { showToast('Jumlah harus lebih dari 0', 'err'); return; }
  if (!note)         { showToast('Keterangan wajib diisi', 'err'); return; }

  const entry = {
    id:        String(uid()),
    date,
    type,
    category,
    amount,
    note,
    isAdvance: type === 'income' && category === 'dp_customer' && isAdvance,
    delivered: !(type === 'income' && category === 'dp_customer' && isAdvance),
    source:    'manual',
  };

  S.cashflows.push(entry);
  S.save();
  closeModal();
  showToast('Entri cashflow disimpan ✓');
  _render();
}

// ─── Edit manual entry ────────────────────────────────────────────────────────

export function openEditCashflow(id) {
  const cf = S.cashflows.find(c => c.id === id);
  if (!cf) return;

  const incomeOptions = `
    <option value="dp_customer" ${cf.category==='dp_customer'?'selected':''}>DP / Uang Muka</option>
    <option value="lainnya"     ${cf.category==='lainnya'&&cf.type==='income'?'selected':''}>Pemasukan Lain</option>`;
  const expenseOptions = `
    <option value="ongkir"      ${cf.category==='ongkir'?'selected':''}>Ongkir</option>
    <option value="operasional" ${cf.category==='operasional'?'selected':''}>Operasional</option>
    <option value="lainnya"     ${cf.category==='lainnya'&&cf.type==='expense'?'selected':''}>Pengeluaran Lain</option>`;

  openModal(`
    <h2 class="modal-title">Edit Entri Cashflow</h2>
    <div class="field">
      <label>Tipe *</label>
      <div style="display:flex;gap:8px">
        <button type="button" id="cf-type-income"
          class="btn ${cf.type==='income'?'btn-primary':'btn-ghost'} btn-sm"
          style="flex:1"
          onclick="cfSetType('income')">
          ↑ Pemasukan
        </button>
        <button type="button" id="cf-type-expense"
          class="btn ${cf.type==='expense'?'btn-primary':'btn-ghost'} btn-sm"
          style="flex:1"
          onclick="cfSetType('expense')">
          ↓ Pengeluaran
        </button>
      </div>
      <input type="hidden" id="cf-type" value="${cf.type}">
    </div>
    <div class="field">
      <label>Kategori *</label>
      <select class="inp" id="cf-category" onchange="cfOnCategoryChange()">
        ${cf.type === 'income' ? incomeOptions : expenseOptions}
      </select>
    </div>
    <div class="field">
      <label>Tanggal *</label>
      <input class="inp" type="date" id="cf-date" value="${cf.date || today()}" max="${today()}">
    </div>
    <div class="field">
      <label>Jumlah (Rp) *</label>
      <input class="inp" type="number" id="cf-amount" min="1" value="${cf.amount}">
    </div>
    <div class="field">
      <label>Keterangan *</label>
      <input class="inp" type="text" id="cf-note" value="${cf.note}" autocomplete="off">
    </div>
    <div id="cf-advance-section" style="display:${cf.type==='income'&&cf.category==='dp_customer'?'block':'none'}">
      <div class="preview-box" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="cf-is-advance" ${cf.isAdvance?'checked':''} style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer">
        <label for="cf-is-advance" style="cursor:pointer;font-size:13px;margin:0">
          <strong>Tandai sebagai DP Pending</strong>
          <div style="font-size:11px;color:var(--text3);font-weight:400;margin-top:1px">Uang sudah diterima tapi buku belum dikirim</div>
        </label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="updateCashflow('${id}')">Simpan</button>
    </div>
  `);
}

export function updateCashflow(id) {
  const idx = S.cashflows.findIndex(c => c.id === id);
  if (idx === -1) return;

  const type      = document.getElementById('cf-type')?.value;
  const category  = document.getElementById('cf-category')?.value;
  const date      = document.getElementById('cf-date')?.value;
  const amount    = Number(document.getElementById('cf-amount')?.value);
  const note      = document.getElementById('cf-note')?.value?.trim();
  const isAdvance = document.getElementById('cf-is-advance')?.checked || false;

  if (!date)               { showToast('Tanggal wajib diisi', 'err'); return; }
  if (!amount || amount <= 0) { showToast('Jumlah harus lebih dari 0', 'err'); return; }
  if (!note)               { showToast('Keterangan wajib diisi', 'err'); return; }

  S.cashflows[idx] = {
    ...S.cashflows[idx],
    date, type, category, amount, note,
    isAdvance: type === 'income' && category === 'dp_customer' && isAdvance,
    delivered: !(type === 'income' && category === 'dp_customer' && isAdvance),
  };

  S.save();
  closeModal();
  showToast('Entri diperbarui ✓');
  _render();
}

// ─── Delete manual entry ──────────────────────────────────────────────────────

export function deleteCashflow(id) {
  if (!confirm('Hapus entri ini?')) return;
  S.set.cashflows(S.cashflows.filter(c => c.id !== id));
  S.save();
  showToast('Entri dihapus');
  _render();
}

// ─── Mark DP as delivered ─────────────────────────────────────────────────────

export function markDelivered(id) {
  const cf = S.cashflows.find(c => c.id === id);
  if (!cf) return;
  cf.isAdvance = false;
  cf.delivered = true;
  S.save();
  showToast('Ditandai sebagai delivered ✓');
  _render();
}
