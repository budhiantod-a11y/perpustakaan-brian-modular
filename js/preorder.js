// preorder.js — Preorder / PO Buku ke Penerbit
// Flow: PO dibuat → Unpaid → Paid → Toggle Buku Datang → Barcode input → Restock/Buku Baru

import * as S from './state.js';
import { uid, today, fmt, showToast, openModal, closeModal } from './helpers.js';
import { saveBook } from './books.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ─── Status helpers ────────────────────────────────────────────────────────────

export function getPoStatus(po) {
  const paid = Number(po.paidAmount) || 0;
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

// ─── Add PO ───────────────────────────────────────────────────────────────────

export function openAddPreorder() {
  openModal(`
    <h2 class="modal-title">Buat Preorder Baru</h2>
    <div class="form-group">
      <label>Nama Penerbit *</label>
      <input type="text" id="po-publisher" placeholder="Contoh: Gramedia Pustaka Utama" autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Tgl Open PO</label>
        <input type="date" id="po-open-date" value="${today()}">
      </div>
      <div class="form-group">
        <label>Tgl Close PO</label>
        <input type="date" id="po-close-date">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Tgl Ready Penerbit</label>
        <input type="date" id="po-ready-date">
      </div>
      <div class="form-group">
        <label>Deadline Pembayaran</label>
        <input type="date" id="po-due-date">
      </div>
    </div>

    <div class="po-items-section">
      <div class="po-items-header">
        <label>Daftar Buku *</label>
        <button type="button" class="btn-xs btn-add-item" onclick="poAddItem()">+ Tambah Buku</button>
      </div>
      <div id="po-items-list">
        ${poItemRow(0)}
      </div>
      <div class="po-total-preview">
        Total: <strong id="po-total-display">Rp 0</strong>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn-primary" onclick="savePreorder()">Simpan PO</button>
    </div>
  `);
}

export function poItemRow(idx) {
  return `
    <div class="po-item-row" id="po-item-${idx}" data-idx="${idx}">
      <input type="text" class="po-item-title" placeholder="Judul buku" oninput="poUpdateTotal()">
      <input type="number" class="po-item-qty" placeholder="Qty" min="1" value="1" oninput="poUpdateTotal()">
      <input type="number" class="po-item-price" placeholder="Harga/pcs" min="0" oninput="poUpdateTotal()">
      <button type="button" class="btn-xs btn-del" onclick="poRemoveItem(${idx})">✕</button>
    </div>
  `;
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
  const el = document.getElementById(`po-item-${idx}`);
  if (el) el.remove();
  poUpdateTotal();
}

export function poUpdateTotal() {
  const rows = document.querySelectorAll('.po-item-row');
  let total = 0;
  rows.forEach(row => {
    const qty   = Number(row.querySelector('.po-item-qty')?.value) || 0;
    const price = Number(row.querySelector('.po-item-price')?.value) || 0;
    total += qty * price;
  });
  const el = document.getElementById('po-total-display');
  if (el) el.textContent = fmt(total);
}

function collectItems() {
  const rows = document.querySelectorAll('.po-item-row');
  const items = [];
  rows.forEach(row => {
    const title      = row.querySelector('.po-item-title')?.value.trim();
    const qty        = Number(row.querySelector('.po-item-qty')?.value) || 0;
    const pricePerPcs= Number(row.querySelector('.po-item-price')?.value) || 0;
    if (title && qty > 0 && pricePerPcs > 0) {
      items.push({ id: uid(), title, qty, pricePerPcs });
    }
  });
  return items;
}

export function savePreorder() {
  _poItemCount = 1;
  const publisher = document.getElementById('po-publisher')?.value.trim();
  const openDate  = document.getElementById('po-open-date')?.value || null;
  const closeDate = document.getElementById('po-close-date')?.value || null;
  const readyDate = document.getElementById('po-ready-date')?.value || null;
  const dueDate   = document.getElementById('po-due-date')?.value || null;
  const items     = collectItems();

  if (!publisher) return showToast('Nama penerbit wajib diisi', 'error');
  if (items.length === 0) return showToast('Tambahkan minimal 1 buku dengan judul, qty, dan harga', 'error');

  const po = {
    id: uid(),
    publisher,
    openDate,
    closeDate,
    readyDate,
    dueDate,
    items,
    paidAmount: 0,
    bookArrived: false,
  };

  S.preorders.push(po);
  S.save();
  closeModal();
  showToast('Preorder berhasil dibuat', 'success');
  _render();
}

// ─── Edit PO ──────────────────────────────────────────────────────────────────

export function openEditPreorder(id) {
  const po = S.preorders.find(p => p.id === id);
  if (!po) return;
  _poItemCount = po.items.length;

  const itemsHtml = po.items.map((item, idx) => `
    <div class="po-item-row" id="po-item-${idx}" data-idx="${idx}">
      <input type="text" class="po-item-title" placeholder="Judul buku" value="${item.title || ''}" oninput="poUpdateTotal()">
      <input type="number" class="po-item-qty" placeholder="Qty" min="1" value="${item.qty}" oninput="poUpdateTotal()">
      <input type="number" class="po-item-price" placeholder="Harga/pcs" min="0" value="${item.pricePerPcs}" oninput="poUpdateTotal()">
      <button type="button" class="btn-xs btn-del" onclick="poRemoveItem(${idx})">✕</button>
    </div>
  `).join('');

  const total = getPoTotal(po);

  openModal(`
    <h2 class="modal-title">Edit Preorder</h2>
    <div class="form-group">
      <label>Nama Penerbit *</label>
      <input type="text" id="po-publisher" value="${po.publisher || ''}" autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Tgl Open PO</label>
        <input type="date" id="po-open-date" value="${po.openDate || ''}">
      </div>
      <div class="form-group">
        <label>Tgl Close PO</label>
        <input type="date" id="po-close-date" value="${po.closeDate || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Tgl Ready Penerbit</label>
        <input type="date" id="po-ready-date" value="${po.readyDate || ''}">
      </div>
      <div class="form-group">
        <label>Deadline Pembayaran</label>
        <input type="date" id="po-due-date" value="${po.dueDate || ''}">
      </div>
    </div>

    <div class="po-items-section">
      <div class="po-items-header">
        <label>Daftar Buku *</label>
        <button type="button" class="btn-xs btn-add-item" onclick="poAddItem()">+ Tambah Buku</button>
      </div>
      <div id="po-items-list">${itemsHtml}</div>
      <div class="po-total-preview">
        Total: <strong id="po-total-display">${fmt(total)}</strong>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn-primary" onclick="updatePreorder('${id}')">Simpan</button>
    </div>
  `);
}

export function updatePreorder(id) {
  _poItemCount = 1;
  const idx = S.preorders.findIndex(p => p.id === id);
  if (idx === -1) return;

  const publisher = document.getElementById('po-publisher')?.value.trim();
  const openDate  = document.getElementById('po-open-date')?.value || null;
  const closeDate = document.getElementById('po-close-date')?.value || null;
  const readyDate = document.getElementById('po-ready-date')?.value || null;
  const dueDate   = document.getElementById('po-due-date')?.value || null;
  const items     = collectItems();

  if (!publisher) return showToast('Nama penerbit wajib diisi', 'error');
  if (items.length === 0) return showToast('Tambahkan minimal 1 buku', 'error');

  S.preorders[idx] = { ...S.preorders[idx], publisher, openDate, closeDate, readyDate, dueDate, items };
  S.save();
  closeModal();
  showToast('Preorder diperbarui', 'success');
  _render();
}

// ─── Delete PO ────────────────────────────────────────────────────────────────

export function deletePreorder(id) {
  const po = S.preorders.find(p => p.id === id);
  if (!po) return;
  if (!confirm(`Hapus preorder dari "${po.publisher}"? Aksi ini tidak bisa dibatalkan.`)) return;
  S.set.preorders(S.preorders.filter(p => p.id !== id));
  S.save();
  showToast('Preorder dihapus', 'success');
  _render();
}

// ─── Quick Pay ────────────────────────────────────────────────────────────────

export function openQuickPayPo(id) {
  const po = S.preorders.find(p => p.id === id);
  if (!po) return;
  const total     = getPoTotal(po);
  const remaining = total - (po.paidAmount || 0);
  openModal(`
    <h2 class="modal-title">Catat Pembayaran</h2>
    <p style="margin-bottom:12px;color:var(--text-secondary)">
      <strong>${po.publisher}</strong><br>
      Sisa tagihan: <strong>${fmt(remaining)}</strong>
    </p>
    <div class="form-group">
      <label>Jumlah Dibayar Sekarang (Rp)</label>
      <input type="number" id="qpay-amount" min="0" max="${remaining}" value="${remaining}">
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn-primary" onclick="saveQuickPayPo('${id}')">Bayar</button>
    </div>
  `);
}

export function saveQuickPayPo(id) {
  const idx = S.preorders.findIndex(p => p.id === id);
  if (idx === -1) return;
  const po      = S.preorders[idx];
  const total   = getPoTotal(po);
  const nowPay  = Number(document.getElementById('qpay-amount')?.value) || 0;
  if (nowPay <= 0) return showToast('Jumlah harus lebih dari 0', 'error');

  const newPaid = Math.min((po.paidAmount || 0) + nowPay, total);
  S.preorders[idx] = { ...po, paidAmount: newPaid };
  S.save();
  closeModal();
  const status = getPoStatus(S.preorders[idx]);
  showToast(status === 'paid' ? 'PO lunas! ✓' : 'Pembayaran dicatat', 'success');
  _render();
}

// ─── Buku Datang → Barcode Flow ───────────────────────────────────────────────

export function openBukuDatang(id) {
  const po = S.preorders.find(p => p.id === id);
  if (!po) return;

  const itemsHtml = po.items.map((item, idx) => `
    <div class="buku-datang-row" id="bd-row-${idx}">
      <div class="bd-book-info">
        <span class="bd-title">${item.title}</span>
        <span class="bd-qty">${item.qty} pcs · ${fmt(item.pricePerPcs)}/pcs</span>
      </div>
      <div class="bd-barcode-wrap">
        <input
          type="text"
          class="bd-barcode-input"
          id="bd-barcode-${idx}"
          placeholder="Scan / ketik barcode"
          data-item-idx="${idx}"
          onkeydown="bdBarcodeKeydown(event, ${idx}, '${id}')"
        >
        <span class="bd-barcode-status" id="bd-status-${idx}"></span>
      </div>
    </div>
  `).join('');

  openModal(`
    <h2 class="modal-title">Buku Datang — Input Barcode</h2>
    <p class="modal-subtitle">Scan atau ketik barcode tiap buku. Enter untuk konfirmasi.</p>
    <div class="buku-datang-list">
      ${itemsHtml}
    </div>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn-primary" onclick="confirmBukuDatang('${id}')">Konfirmasi Semua & Restock</button>
    </div>
  `);

  // Auto-focus first barcode input
  setTimeout(() => document.getElementById('bd-barcode-0')?.focus(), 100);
}

// On Enter per barcode input: lookup book and show preview
export function bdBarcodeKeydown(e, idx, poId) {
  if (e.key !== 'Enter') return;
  const input   = document.getElementById(`bd-barcode-${idx}`);
  const statusEl= document.getElementById(`bd-status-${idx}`);
  if (!input || !statusEl) return;
  const barcode = input.value.trim();
  if (!barcode) return;

  const book = S.books.find(b => b.barcode === barcode);
  if (book) {
    statusEl.textContent = `✓ ${book.title}`;
    statusEl.className = 'bd-barcode-status bd-found';
  } else {
    statusEl.textContent = '⚠ Buku baru — akan dibuat saat konfirmasi';
    statusEl.className = 'bd-barcode-status bd-new';
  }

  // Move focus to next input
  const nextInput = document.getElementById(`bd-barcode-${idx + 1}`);
  if (nextInput) nextInput.focus();
}

export function confirmBukuDatang(poId) {
  const poIdx = S.preorders.findIndex(p => p.id === poId);
  if (poIdx === -1) return;
  const po = S.preorders[poIdx];

  const rows = document.querySelectorAll('.buku-datang-row');
  let allFilled = true;
  let newBooksNeeded = []; // items that need a new book form

  rows.forEach((row, idx) => {
    const barcode = document.getElementById(`bd-barcode-${idx}`)?.value.trim();
    if (!barcode) { allFilled = false; return; }
    const item  = po.items[idx];
    const book  = S.books.find(b => b.barcode === barcode);
    if (!book) {
      newBooksNeeded.push({ idx, barcode, item });
    }
  });

  if (!allFilled) return showToast('Semua buku harus diisi barcodenya', 'error');

  if (newBooksNeeded.length > 0) {
    // Show new book form for first unregistered book
    openNewBookFromPo(poId, newBooksNeeded, 0, collectBarcodes(po.items.length));
    return;
  }

  // All books exist → restock all
  processRestockAll(poId, collectBarcodes(po.items.length));
}

function collectBarcodes(count) {
  const barcodes = [];
  for (let i = 0; i < count; i++) {
    barcodes.push(document.getElementById(`bd-barcode-${i}`)?.value.trim() || '');
  }
  return barcodes;
}

// ─── New Book Form (from PO context) ──────────────────────────────────────────

function openNewBookFromPo(poId, newBooksNeeded, currentIdx, barcodes) {
  if (currentIdx >= newBooksNeeded.length) {
    // All new books handled → restock all
    processRestockAll(poId, barcodes);
    return;
  }

  const { idx, barcode, item } = newBooksNeeded[currentIdx];
  const remaining = newBooksNeeded.length - currentIdx;

  openModal(`
    <h2 class="modal-title">Buku Baru — Lengkapi Data</h2>
    <p class="modal-subtitle" style="color:var(--text-secondary);margin-bottom:16px">
      Barcode <strong>${barcode}</strong> belum ada di sistem. Lengkapi data buku ini.
      ${remaining > 1 ? `<br><em>(${remaining - 1} buku baru lagi setelah ini)</em>` : ''}
    </p>
    <div class="form-group">
      <label>Barcode</label>
      <input type="text" id="nb-barcode" value="${barcode}" readonly style="opacity:.6">
    </div>
    <div class="form-group">
      <label>Judul *</label>
      <input type="text" id="nb-title" value="${item.title || ''}" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Penulis</label>
      <input type="text" id="nb-author" placeholder="Opsional">
    </div>
    <div class="form-group">
      <label>Penerbit</label>
      <input type="text" id="nb-publisher" value="${S.preorders.find(p=>p.id===poId)?.publisher || ''}" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Kategori</label>
      <input type="text" id="nb-category" placeholder="Opsional">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Harga Jual Normal (Rp)</label>
        <input type="number" id="nb-normal-price" min="0" placeholder="0">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn-primary" onclick="saveNewBookFromPo('${poId}', ${JSON.stringify(newBooksNeeded).replace(/"/g, '&quot;')}, ${currentIdx}, ${JSON.stringify(barcodes).replace(/"/g, '&quot;')})">
        Simpan & Lanjut
      </button>
    </div>
  `);
}

export function saveNewBookFromPo(poId, newBooksNeeded, currentIdx, barcodes) {
  const barcode     = document.getElementById('nb-barcode')?.value.trim();
  const title       = document.getElementById('nb-title')?.value.trim();
  const author      = document.getElementById('nb-author')?.value.trim();
  const publisher   = document.getElementById('nb-publisher')?.value.trim();
  const category    = document.getElementById('nb-category')?.value.trim();
  const normalPrice = Number(document.getElementById('nb-normal-price')?.value) || 0;

  if (!title) return showToast('Judul buku wajib diisi', 'error');

  const po   = S.preorders.find(p => p.id === poId);
  const item = newBooksNeeded[currentIdx].item;

  // Create new book (empty batches — restock will add batch below)
  const newBook = {
    id: uid(),
    barcode,
    title,
    author,
    publisher,
    category,
    normalPrice,
    sellPrice: normalPrice,
    batches: [],
  };
  S.books.push(newBook);

  // Add restock batch for this book
  addRestockBatch(newBook.id, title, item.qty, item.pricePerPcs, po?.openDate || today());

  S.save();
  showToast(`Buku "${title}" ditambahkan`, 'success');

  // Continue to next new book
  openNewBookFromPo(poId, newBooksNeeded, currentIdx + 1, barcodes);
}

// ─── Restock all existing books ───────────────────────────────────────────────

function processRestockAll(poId, barcodes) {
  const poIdx = S.preorders.findIndex(p => p.id === poId);
  if (poIdx === -1) return;
  const po = S.preorders[poIdx];

  po.items.forEach((item, idx) => {
    const barcode = barcodes[idx];
    const book    = S.books.find(b => b.barcode === barcode);
    if (book) {
      addRestockBatch(book.id, book.title, item.qty, item.pricePerPcs, po.openDate || today());
    }
    // New books were already handled in saveNewBookFromPo
  });

  // Mark PO as bookArrived
  S.preorders[poIdx] = { ...po, bookArrived: true };
  S.save();
  closeModal();
  showToast('Semua buku berhasil di-restock! ✓', 'success');
  _render();
}

function addRestockBatch(bookId, bookTitle, qty, buyPrice, date) {
  const bookIdx = S.books.findIndex(b => b.id === bookId);
  if (bookIdx === -1) return;
  S.books[bookIdx].batches.push({
    id: uid(),
    qty: Number(qty),
    remaining: Number(qty),
    buyPrice: Number(buyPrice),
    date,
  });
  // Also record in restocks log
  S.restocks.push({
    id: uid(),
    bookId,
    bookTitle,
    qty: Number(qty),
    buyPrice: Number(buyPrice),
    date,
    note: 'Dari Preorder',
  });
}
