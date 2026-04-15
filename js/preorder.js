// preorder.js — Preorder / PO Buku ke Penerbit
// Flow: PO dibuat → Unpaid → Paid → Toggle Buku Datang → Barcode input → Restock/Buku Baru

import * as S from './state.js';
import { uid, today, fmt, showToast, openModal, closeModal } from './helpers.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ─── Status helpers ────────────────────────────────────────────────────────────

export function getPoStatus(po) {
  const paid  = Number(po.paidAmount) || 0;
  const total = getPoTotal(po);
  if (paid >= total && total > 0) return 'paid';
  if (po.dueDate && po.dueDate < today() && paid < total) return 'overdue';
  if (paid > 0 && paid < total) return 'partial';
  return 'unpaid';
}

export function getPoTotal(po) {
  return (po.items || []).reduce((s, i) => s + (Number(i.qty) * Number(i.pricePerPcs)), 0);
}

export function getStatusLabel(status) {
  return {
    paid:    { label: 'Lunas',       cls: 'status-paid' },
    partial: { label: 'Sebagian',    cls: 'status-partial' },
    unpaid:  { label: 'Belum Bayar', cls: 'status-unpaid' },
    overdue: { label: 'Terlambat',   cls: 'status-overdue' },
  }[status] || { label: status, cls: '' };
}

// Days until due date (negative = overdue)
export function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(dueDate); due.setHours(0,0,0,0);
  return Math.round((due - now) / 86400000);
}

// ─── Shared field helper ───────────────────────────────────────────────────────

function field(label, inputHtml) {
  return `<div class="field"><label>${label}</label>${inputHtml}</div>`;
}

function inp(attrs) {
  return `<input class="inp" ${attrs}>`;
}

// ─── Add PO ───────────────────────────────────────────────────────────────────

export function openAddPreorder() {
  _poItemCount = 1;
  openModal(`
    <h2 class="modal-title">Buat Preorder Baru</h2>
    ${field('Nama Penerbit *', inp('type="text" id="po-publisher" placeholder="Contoh: Gramedia Pustaka Utama" autocomplete="off"'))}
    <div class="inp-grid-2">
      ${field('Tgl Open PO',  inp('type="date" id="po-open-date" value="' + today() + '"'))}
      ${field('Tgl Close PO', inp('type="date" id="po-close-date"'))}
    </div>
    <div class="inp-grid-2">
      ${field('Tgl Ready Penerbit',  inp('type="date" id="po-ready-date"'))}
      ${field('Deadline Pembayaran', inp('type="date" id="po-due-date"'))}
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label style="margin:0">Daftar Buku *</label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="poAddItem()">+ Tambah Buku</button>
      </div>
      <div id="po-items-list">${poItemRow(0)}</div>
      <div class="preview-box" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total PO</span>
        <span style="font-size:16px;font-weight:700;color:var(--text)" id="po-total-display">Rp 0</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="savePreorder()">Simpan PO</button>
    </div>
  `);
}

export function poItemRow(idx) {
  return '<div class="po-item-row" id="po-item-' + idx + '" style="display:grid;grid-template-columns:1fr 72px 130px 32px;gap:8px;margin-bottom:8px;align-items:center">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px" type="text" placeholder="Judul buku" oninput="poUpdateTotal()">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px;text-align:center" type="number" min="1" value="1" oninput="poUpdateTotal()">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px" type="number" min="0" placeholder="Harga/pcs" oninput="poUpdateTotal()">'
    + '<button type="button" class="btn btn-danger btn-xs" style="padding:6px 8px;font-size:13px;height:36px" onclick="poRemoveItem(' + idx + ')">✕</button>'
    + '</div>';
}

let _poItemCount = 1;
export function poAddItem() {
  const list = document.getElementById('po-items-list');
  if (!list) return;
  const idx = _poItemCount++;
  const div = document.createElement('div');
  div.innerHTML = poItemRow(idx);
  list.appendChild(div.firstElementChild);
}

export function poRemoveItem(idx) {
  const el = document.getElementById('po-item-' + idx);
  if (el) el.remove();
  poUpdateTotal();
}

export function poUpdateTotal() {
  let total = 0;
  document.querySelectorAll('.po-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    total += (Number(inputs[1]?.value) || 0) * (Number(inputs[2]?.value) || 0);
  });
  const el = document.getElementById('po-total-display');
  if (el) el.textContent = fmt(total);
}

function collectItems() {
  const items = [];
  document.querySelectorAll('.po-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const title  = inputs[0]?.value.trim();
    const qty    = Number(inputs[1]?.value) || 0;
    const price  = Number(inputs[2]?.value) || 0;
    if (title && qty > 0 && price > 0) items.push({ id: uid(), title, qty, pricePerPcs: price });
  });
  return items;
}

export function savePreorder() {
  _poItemCount = 1;
  const publisher = document.getElementById('po-publisher')?.value.trim();
  const openDate  = document.getElementById('po-open-date')?.value  || null;
  const closeDate = document.getElementById('po-close-date')?.value || null;
  const readyDate = document.getElementById('po-ready-date')?.value || null;
  const dueDate   = document.getElementById('po-due-date')?.value   || null;
  const items     = collectItems();
  if (!publisher) return showToast('Nama penerbit wajib diisi', 'error');
  if (!items.length) return showToast('Tambahkan minimal 1 buku dengan judul, qty, dan harga', 'error');
  S.preorders.push({ id: uid(), publisher, openDate, closeDate, readyDate, dueDate, items, paidAmount: 0, bookArrived: false });
  S.save(); closeModal(); showToast('Preorder berhasil dibuat ✓'); _render();
}

// ─── Edit PO ──────────────────────────────────────────────────────────────────

export function openEditPreorder(id) {
  const po = S.preorders.find(p => String(p.id) === String(id));
  if (!po) return;
  _poItemCount = po.items.length;
  const itemsHtml = po.items.map((item, idx) =>
    '<div class="po-item-row" id="po-item-' + idx + '" style="display:grid;grid-template-columns:1fr 72px 130px 32px;gap:8px;margin-bottom:8px;align-items:center">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px" type="text" value="' + (item.title||'') + '" oninput="poUpdateTotal()">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px;text-align:center" type="number" min="1" value="' + item.qty + '" oninput="poUpdateTotal()">'
    + '<input class="inp" style="padding:8px 10px;font-size:13px" type="number" min="0" value="' + item.pricePerPcs + '" oninput="poUpdateTotal()">'
    + '<button type="button" class="btn btn-danger btn-xs" style="padding:6px 8px;font-size:13px;height:36px" onclick="poRemoveItem(' + idx + ')">✕</button>'
    + '</div>'
  ).join('');
  openModal(`
    <h2 class="modal-title">Edit Preorder</h2>
    ${field('Nama Penerbit *', inp('type="text" id="po-publisher" value="' + (po.publisher||'') + '" autocomplete="off"'))}
    <div class="inp-grid-2">
      ${field('Tgl Open PO',  inp('type="date" id="po-open-date"  value="' + (po.openDate||'')  + '"'))}
      ${field('Tgl Close PO', inp('type="date" id="po-close-date" value="' + (po.closeDate||'') + '"'))}
    </div>
    <div class="inp-grid-2">
      ${field('Tgl Ready Penerbit',  inp('type="date" id="po-ready-date" value="' + (po.readyDate||'') + '"'))}
      ${field('Deadline Pembayaran', inp('type="date" id="po-due-date"   value="' + (po.dueDate||'')   + '"'))}
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label style="margin:0">Daftar Buku *</label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="poAddItem()">+ Tambah Buku</button>
      </div>
      <div id="po-items-list">${itemsHtml}</div>
      <div class="preview-box" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total PO</span>
        <span style="font-size:16px;font-weight:700;color:var(--text)" id="po-total-display">${fmt(getPoTotal(po))}</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="updatePreorder('${id}')">Simpan</button>
    </div>
  `);
}

export function updatePreorder(id) {
  _poItemCount = 1;
  const idx = S.preorders.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return;
  const publisher = document.getElementById('po-publisher')?.value.trim();
  const openDate  = document.getElementById('po-open-date')?.value  || null;
  const closeDate = document.getElementById('po-close-date')?.value || null;
  const readyDate = document.getElementById('po-ready-date')?.value || null;
  const dueDate   = document.getElementById('po-due-date')?.value   || null;
  const items     = collectItems();
  if (!publisher) return showToast('Nama penerbit wajib diisi', 'error');
  if (!items.length) return showToast('Tambahkan minimal 1 buku', 'error');
  S.preorders[idx] = { ...S.preorders[idx], publisher, openDate, closeDate, readyDate, dueDate, items };
  S.save(); closeModal(); showToast('Preorder diperbarui ✓'); _render();
}

// ─── Delete PO ────────────────────────────────────────────────────────────────

export function deletePreorder(id) {
  const po = S.preorders.find(p => String(p.id) === String(id));
  if (!po) return;
  if (!confirm('Hapus preorder dari "' + po.publisher + '"? Aksi ini tidak bisa dibatalkan.')) return;
  S.set.preorders(S.preorders.filter(p => String(p.id) !== String(id)));
  S.save(); showToast('Preorder dihapus'); _render();
}

// ─── Quick Pay ────────────────────────────────────────────────────────────────

export function openQuickPayPo(id) {
  const po = S.preorders.find(p => String(p.id) === String(id));
  if (!po) return;
  const total     = getPoTotal(po);
  const remaining = total - (po.paidAmount || 0);
  openModal(`
    <h2 class="modal-title">Catat Pembayaran</h2>
    <div class="preview-box" style="margin-bottom:20px">
      <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:10px">${po.publisher}</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Total PO</div><div style="font-weight:700;margin-top:3px">${fmt(total)}</div></div>
        <div><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Sudah Bayar</div><div style="font-weight:700;margin-top:3px">${fmt(po.paidAmount || 0)}</div></div>
        <div><div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Sisa</div><div style="font-weight:700;color:var(--red);margin-top:3px">${fmt(remaining)}</div></div>
      </div>
    </div>
    ${field('Jumlah Dibayar Sekarang (Rp) *', inp('type="number" id="qpay-amount" min="0" max="' + remaining + '" value="' + remaining + '" placeholder="0"'))}
    ${field('Tanggal Pembayaran', inp('type="date" id="qpay-date" value="' + today() + '"'))}
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-green" onclick="saveQuickPayPo('${id}')">💳 Catat Pembayaran</button>
    </div>
  `);
}

export function saveQuickPayPo(id) {
  const idx = S.preorders.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return;
  const po     = S.preorders[idx];
  const total  = getPoTotal(po);
  const nowPay = Number(document.getElementById('qpay-amount')?.value) || 0;
  if (nowPay <= 0) return showToast('Jumlah harus lebih dari 0', 'error');
  const payDate = document.getElementById('qpay-date')?.value || today();
  const newPaid = Math.min((po.paidAmount || 0) + nowPay, total);
  const newLog  = [...(po.paymentLog || []), { amount: nowPay, date: payDate }];
  S.preorders[idx] = { ...po, paidAmount: newPaid, lastPayDate: payDate, paymentLog: newLog };
  S.save(); closeModal();
  showToast(getPoStatus(S.preorders[idx]) === 'paid' ? 'PO lunas! ✓' : 'Pembayaran dicatat ✓');
  _render();
}

// ─── Buku Datang → Barcode Flow ───────────────────────────────────────────────

export function openBukuDatang(id) {
  const po = S.preorders.find(p => String(p.id) === String(id));
  if (!po) return;
  const itemsHtml = po.items.map((item, idx) =>
    '<div class="buku-datang-row" id="bd-row-' + idx + '">'
    + '<div class="bd-book-info"><span class="bd-title">' + item.title + '</span>'
    + '<span class="bd-qty">' + item.qty + ' pcs · ' + fmt(item.pricePerPcs) + '/pcs</span></div>'
    + '<div class="bd-barcode-wrap">'
    + '<input class="inp bd-barcode-input" type="text" id="bd-barcode-' + idx + '" placeholder="Scan / ketik barcode → Enter" onkeydown="bdBarcodeKeydown(event,' + idx + ',\'' + id + '\')">'
    + '<span class="bd-barcode-status" id="bd-status-' + idx + '"></span>'
    + '</div></div>'
  ).join('');
  openModal(
    '<h2 class="modal-title">📦 Buku Datang — Input Barcode</h2>'
    + '<p style="font-size:13px;color:var(--text3);margin-bottom:16px">Scan atau ketik barcode tiap buku → tekan <kbd style="background:var(--bg);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;font-size:11px">Enter</kbd> untuk konfirmasi per buku.</p>'
    + '<div class="buku-datang-list">' + itemsHtml + '</div>'
    + '<div class="modal-footer">'
    + '<button class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button class="btn btn-green" onclick="confirmBukuDatang(\'' + id + '\')">✓ Konfirmasi & Restock Semua</button>'
    + '</div>'
  );
  setTimeout(() => document.getElementById('bd-barcode-0')?.focus(), 100);
}

export function bdBarcodeKeydown(e, idx, poId) {
  if (e.key !== 'Enter') return;
  const input = document.getElementById('bd-barcode-' + idx);
  const statusEl = document.getElementById('bd-status-' + idx);
  if (!input || !statusEl) return;
  const barcode = input.value.trim();
  if (!barcode) return;
  const book = S.books.find(b => b.barcode === barcode);
  statusEl.innerHTML = book
    ? '<span class="badge badge-green">✓ ' + book.title + '</span>'
    : '<span class="badge badge-amber">⚠ Buku baru</span>';
  document.getElementById('bd-barcode-' + (idx + 1))?.focus();
}

export function confirmBukuDatang(poId) {
  const poIdx = S.preorders.findIndex(p => String(p.id) === String(poId));
  if (poIdx === -1) return;
  const po = S.preorders[poIdx];
  const barcodes = po.items.map((_, idx) => document.getElementById('bd-barcode-' + idx)?.value.trim() || '');
  if (barcodes.some(b => !b)) return showToast('Semua buku harus diisi barcodenya', 'error');
  const newBooks = po.items.map((item, idx) => ({ idx, barcode: barcodes[idx], item }))
    .filter(({ barcode }) => !S.books.find(b => b.barcode === barcode));
  if (newBooks.length > 0) { openNewBookFromPo(poId, newBooks, 0, barcodes); return; }
  processRestockAll(poId, barcodes);
}

// ─── New Book Form (from PO context) ──────────────────────────────────────────

function openNewBookFromPo(poId, newBooksNeeded, currentIdx, barcodes) {
  if (currentIdx >= newBooksNeeded.length) { processRestockAll(poId, barcodes); return; }
  const { barcode, item } = newBooksNeeded[currentIdx];
  const remaining = newBooksNeeded.length - currentIdx;
  const po = S.preorders.find(p => String(p.id) === String(poId));
  openModal(
    '<h2 class="modal-title">Buku Baru — Lengkapi Data</h2>'
    + '<div class="preview-box" style="margin-bottom:16px">'
    + '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Barcode</div>'
    + '<div style="font-family:monospace;font-size:15px;font-weight:700">' + barcode + '</div>'
    + (remaining > 1 ? '<div style="margin-top:6px;font-size:12px;color:var(--text3)">' + (remaining-1) + ' buku baru lagi setelah ini</div>' : '')
    + '</div>'
    + '<input type="hidden" id="nb-barcode" value="' + barcode + '">'
    + field('Judul *', inp('type="text" id="nb-title" value="' + (item.title||'') + '" autocomplete="off"'))
    + '<div class="inp-grid-2">'
    + field('Penulis', inp('type="text" id="nb-author" placeholder="Opsional"'))
    + field('Penerbit', inp('type="text" id="nb-publisher" value="' + (po?.publisher||'') + '" autocomplete="off"'))
    + '</div>'
    + '<div class="inp-grid-2">'
    + field('Kategori', inp('type="text" id="nb-category" placeholder="Opsional"'))
    + field('Harga Jual Normal (Rp)', inp('type="number" id="nb-normal-price" min="0" placeholder="0"'))
    + '</div>'
    + '<div class="modal-footer">'
    + '<button class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button class="btn btn-primary" onclick="saveNewBookFromPo(\'' + poId + '\',' + JSON.stringify(newBooksNeeded).replace(/"/g,'&quot;') + ',' + currentIdx + ',' + JSON.stringify(barcodes).replace(/"/g,'&quot;') + ')">'
    + 'Simpan & Lanjut' + (remaining > 1 ? ' (' + (currentIdx+1) + '/' + newBooksNeeded.length + ')' : '') + '</button>'
    + '</div>'
  );
}

export function saveNewBookFromPo(poId, newBooksNeeded, currentIdx, barcodes) {
  const barcode     = document.getElementById('nb-barcode')?.value.trim();
  const title       = document.getElementById('nb-title')?.value.trim();
  const author      = document.getElementById('nb-author')?.value.trim();
  const publisher   = document.getElementById('nb-publisher')?.value.trim();
  const category    = document.getElementById('nb-category')?.value.trim();
  const normalPrice = Number(document.getElementById('nb-normal-price')?.value) || 0;
  if (!title) return showToast('Judul buku wajib diisi', 'error');
  const po = S.preorders.find(p => String(p.id) === String(poId));
  const item = newBooksNeeded[currentIdx].item;
  const newBook = { id: uid(), barcode, title, author, publisher, category, normalPrice, sellPrice: normalPrice, batches: [] };
  S.books.push(newBook);
  addRestockBatch(newBook.id, title, item.qty, item.pricePerPcs, po?.openDate || today());
  S.save(); showToast('"' + title + '" ditambahkan ✓');
  openNewBookFromPo(poId, newBooksNeeded, currentIdx + 1, barcodes);
}

// ─── Restock all existing books ───────────────────────────────────────────────

function processRestockAll(poId, barcodes) {
  const poIdx = S.preorders.findIndex(p => String(p.id) === String(poId));
  if (poIdx === -1) return;
  const po = S.preorders[poIdx];
  po.items.forEach((item, idx) => {
    const book = S.books.find(b => b.barcode === barcodes[idx]);
    if (book) addRestockBatch(book.id, book.title, item.qty, item.pricePerPcs, po.openDate || today());
  });
  S.preorders[poIdx] = { ...po, bookArrived: true };
  S.save(); closeModal(); showToast('Semua buku berhasil di-restock! ✓'); _render();
}

function addRestockBatch(bookId, bookTitle, qty, buyPrice, date) {
  const idx = S.books.findIndex(b => b.id === bookId);
  if (idx === -1) return;
  S.books[idx].batches.push({ id: uid(), qty: Number(qty), remaining: Number(qty), buyPrice: Number(buyPrice), date });
  S.restocks.push({ id: uid(), bookId, bookTitle, qty: Number(qty), buyPrice: Number(buyPrice), date, note: 'Dari Preorder' });
}
