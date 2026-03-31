// ═══════════════════════════════════════════════════════════════════════════
// sales.js — Manual sales, bundle sales, delete sales
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { openModal, closeModal, showToast, uid, today, fmt, getNormalPrice } from './helpers.js';
import { totalStock, fifoDeduct, fifoSim } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

export function openSaleManual() {
  openModal(`
    <div class="modal-title">Catat Penjualan</div>
    <div class="field">
      <label>Pilih Buku</label>
      <input type="hidden" id="f_bid" value="">
      <div style="position:relative">
        <input class="inp" id="sale-search-input" type="text" placeholder="Ketik judul buku..." autocomplete="off"
          oninput="saleSearchFilter(this.value)">
        <div id="sale-search-results" style="position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-s) var(--radius-s);display:none;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.1)"></div>
      </div>
      <div id="sale-selected-book" style="display:none;margin-top:8px;padding:8px 12px;background:var(--accent-s);border:1px solid var(--accent-t);border-radius:var(--radius-s);font-size:13px;display:none">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Jumlah</label><input class="inp" id="f_qty" type="number" min="1" value="1" oninput="onSaleChange()" style="max-width:120px"></div>
      <div class="field"><label>Tanggal</label><input class="inp" id="f_date" type="date" value="${today()}" max="${today()}" style="max-width:180px"></div>
    </div>
    <div id="price-section" style="display:none">
      <div class="override-panel">
        <div class="override-title">💰 Harga Jual</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:flex-end">
          <div class="field" style="margin-bottom:0">
            <label style="font-size:11px">Harga Modal (FIFO)</label>
            <input class="inp" id="f_hpp" type="number" readonly style="background:var(--bg);color:var(--text3)">
          </div>
          <div class="field" style="margin-bottom:0">
            <label style="font-size:11px">Harga Normal</label>
            <input class="inp" id="f_default" type="number" readonly style="background:var(--bg)">
          </div>
          <div class="field" style="margin-bottom:0">
            <label style="font-size:11px">Harga Final <span id="over-tag" style="display:none;color:var(--orange);font-size:10px;font-weight:700">✎ diskon</span></label>
            <input class="inp" id="f_final" type="number" oninput="onSaleChange()" style="border-color:var(--accent)">
          </div>
        </div>
        <div id="f_diff_wrap" style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <div id="f_diff" class="price-diff-pill diff-same">—</div>
          <div id="f_margin" style="font-size:11px;color:var(--text3)"></div>
        </div>
        <div id="note-wrap" style="display:none;margin-top:10px">
          <div class="field" style="margin-bottom:0">
            <label>Catatan <span style="color:var(--text3);font-weight:400">(wajib jika harga final ≠ normal)</span></label>
            <input class="inp" id="f_note" placeholder="e.g. diskon member, harga event, negosiasi...">
          </div>
        </div>
      </div>
    </div>
    <div id="sale-preview" style="display:none"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="saveSaleManual()">Simpan Penjualan</button>
    </div>`);
}

// ── Sale search + select ─────────────────────────────────────────────────────
export function saleSearchFilter(query) {
  const resultsEl = document.getElementById('sale-search-results');
  if (!resultsEl) return;
  const q = query.toLowerCase().trim();
  if (!q) { resultsEl.style.display = 'none'; return; }
  const matches = S.books
    .filter(b => totalStock(b) > 0)
    .filter(b => [b.title, b.author, b.barcode, b.publisher].some(v => v?.toLowerCase().includes(q)))
    .slice(0, 6);
  if (!matches.length) {
    resultsEl.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--text3)">Tidak ditemukan</div>`;
    resultsEl.style.display = 'block';
    return;
  }
  resultsEl.innerHTML = matches.map(b => `
    <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"
      onclick="saleSelectBook(${b.id})">
      <div>
        <div style="font-weight:600;font-size:13px">${b.title}</div>
        <div style="font-size:11px;color:var(--text3)">Stok: ${totalStock(b)} · ${fmt(getNormalPrice(b))}</div>
      </div>
      <span style="font-size:11px;color:var(--accent);background:var(--accent-s);padding:2px 8px;border-radius:12px;white-space:nowrap">Pilih</span>
    </div>`).join('');
  resultsEl.style.display = 'block';
}

export function saleSelectBook(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;
  // Set hidden input
  document.getElementById('f_bid').value = bookId;
  // Update search input to show selected book
  const searchInp = document.getElementById('sale-search-input');
  if (searchInp) { searchInp.value = book.title; searchInp.style.borderColor = 'var(--accent)'; searchInp.style.background = 'var(--accent-s)'; }
  // Hide results
  const resultsEl = document.getElementById('sale-search-results');
  if (resultsEl) resultsEl.style.display = 'none';
  // Show selected badge
  const selEl = document.getElementById('sale-selected-book');
  if (selEl) {
    selEl.style.display = 'flex';
    selEl.innerHTML = `<div style="flex:1"><strong>${book.title}</strong> · Stok: ${totalStock(book)} · ${fmt(getNormalPrice(book))}</div><span style="cursor:pointer;color:var(--accent);font-size:12px" onclick="saleClearBook()">✕ Ganti</span>`;
  }
  // Trigger price section
  onBookChange();
}

export function saleClearBook() {
  document.getElementById('f_bid').value = '';
  const searchInp = document.getElementById('sale-search-input');
  if (searchInp) { searchInp.value = ''; searchInp.style.borderColor = ''; searchInp.style.background = ''; searchInp.focus(); }
  const selEl = document.getElementById('sale-selected-book');
  if (selEl) selEl.style.display = 'none';
  const sec = document.getElementById('price-section');
  if (sec) sec.style.display = 'none';
  const pv = document.getElementById('sale-preview');
  if (pv) pv.style.display = 'none';
}

export function onBookChange() {
  const bid = +document.getElementById('f_bid')?.value;
  const sec = document.getElementById('price-section');
  if (!bid) { if(sec) sec.style.display='none'; return; }
  const book = S.books.find(b => b.id===bid);
  const normalP = getNormalPrice(book);
  sec.style.display = 'block';
  document.getElementById('f_default').value = normalP;
  document.getElementById('f_final').value   = normalP;
  onSaleChange();
}

export function onSaleChange() {
  const bid   = +document.getElementById('f_bid')?.value;
  const qty   = +document.getElementById('f_qty')?.value || 1;
  const pv    = document.getElementById('sale-preview');
  if (!bid) return;
  const book     = S.books.find(b => b.id===bid);
  const normalP  = getNormalPrice(book);
  const finP     = +document.getElementById('f_final')?.value || normalP;
  const diff     = finP - normalP;
  const isDiskon = finP !== normalP;

  // Update HPP estimate from FIFO sim
  const { cogs, details } = fifoSim(book, qty);
  const hppPerPcs = qty > 0 ? Math.round(cogs / qty) : 0;
  const hppEl = document.getElementById('f_hpp');
  if (hppEl) hppEl.value = hppPerPcs;

  const diffEl = document.getElementById('f_diff');
  if (diffEl) {
    if (diff < 0)      { diffEl.textContent = fmt(diff);     diffEl.className = 'price-diff-pill diff-down'; }
    else if (diff > 0) { diffEl.textContent = '+'+fmt(diff); diffEl.className = 'price-diff-pill diff-up'; }
    else               { diffEl.textContent = '—';           diffEl.className = 'price-diff-pill diff-same'; }
  }
  const marginEl = document.getElementById('f_margin');
  if (marginEl && finP > 0) {
    const profitPcs = finP - hppPerPcs;
    marginEl.textContent = `Margin per pcs: ${fmt(profitPcs)} (${Math.round(profitPcs/finP*100)}%)`;
    marginEl.style.color = profitPcs >= 0 ? 'var(--green)' : 'var(--red)';
  }
  document.getElementById('over-tag').style.display  = isDiskon ? 'inline' : 'none';
  document.getElementById('note-wrap').style.display = isDiskon ? 'block'  : 'none';

  const revenue = qty * finP, profit = revenue - cogs;
  if (pv) {
    pv.style.display = 'block';
    pv.innerHTML = `<div class="preview-box">
      <strong>Preview FIFO:</strong><br>${details.map(d=>`Batch ${d.batchDate}: ${d.qty} × ${fmt(d.buyPrice)}`).join('<br>')}
      <div class="preview-stats">
        <div><div class="preview-stat-label">Revenue</div><div class="preview-stat-value" style="color:var(--green)">${fmt(revenue)}</div></div>
        <div><div class="preview-stat-label">HPP Modal</div><div class="preview-stat-value" style="color:var(--red)">${fmt(cogs)}</div></div>
        <div><div class="preview-stat-label">Profit Real</div><div class="preview-stat-value" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(profit)}</div></div>
      </div>
    </div>`;
  }
}


export function onScanPriceInput(el) {
  const val = +el.value;
  S.set.scanOverPrice(isNaN(val) ? null : val);

  if (!S.scanResult) return;
  const defP  = getNormalPrice(S.scanResult);
  const finP  = S.scanOverPrice != null ? S.scanOverPrice : defP;
  const diff  = finP - defP;
  const isOver = finP !== defP;

  // Update diff pill in-place
  const diffEl = document.getElementById('scan-diff-pill');
  if (diffEl) {
    if (diff < 0)      { diffEl.textContent = fmt(diff);     diffEl.className = 'price-diff-pill diff-down'; }
    else if (diff > 0) { diffEl.textContent = '+'+fmt(diff); diffEl.className = 'price-diff-pill diff-up'; }
    else               { diffEl.textContent = '—';           diffEl.className = 'price-diff-pill diff-same'; }
  }

  // Show/hide override tag and note field
  const overTag  = document.getElementById('scan-over-tag');
  const noteWrap = document.getElementById('scan-note-wrap');
  if (overTag)  overTag.style.display  = isOver ? 'inline' : 'none';
  if (noteWrap) noteWrap.style.display = isOver ? 'block'  : 'none';

  // Update input border color to signal override
  el.style.borderColor = isOver ? 'var(--orange)' : '';
  el.style.background  = isOver ? '#fff7ed'        : '';

  // Update preview stats in-place
  const { cogs, details } = fifoSim(S.scanResult, S.scanQty);
  const revenue = S.scanQty * finP, profit = revenue - cogs;
  const pvRev  = document.getElementById('scan-prev-rev');
  const pvHPP  = document.getElementById('scan-prev-hpp');
  const pvProf = document.getElementById('scan-prev-prof');
  if (pvRev)  pvRev.textContent  = fmt(revenue);
  if (pvHPP)  pvHPP.textContent  = fmt(cogs);
  if (pvProf) { pvProf.textContent = fmt(profit); pvProf.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)'; }
}

export function onScanNoteInput(el) {
  S.set.scanOverNote(el.value);
  // no render needed — just update state
}

export function saveSaleManual() {
  const bid  = +document.getElementById('f_bid')?.value;
  const qty  = +document.getElementById('f_qty')?.value;
  const date = document.getElementById('f_date')?.value || today();
  if (!bid||!qty) { showToast('Lengkapi field!', 'err'); return; }
  if (qty <= 0) { showToast('Jumlah harus lebih dari 0', 'err'); return; }
  if (!date) { showToast('Tanggal harus diisi', 'err'); return; }
  const book = S.books.find(b => b.id===bid);
  if (qty > totalStock(book)) { showToast('Stok tidak cukup!', 'err'); return; }
  const normalP   = getNormalPrice(book);
  const finP      = +document.getElementById('f_final')?.value || normalP;
  if (finP <= 0) { showToast('Harga final harus lebih dari 0', 'err'); return; }
  const note      = document.getElementById('f_note')?.value?.trim()||'';
  const isDiskon  = finP !== normalP;
  if (isDiskon && !note) { showToast('Isi catatan untuk harga final yang berbeda dari normal', 'err'); return; }
  const { cogs } = fifoDeduct(bid, qty);
  const profit = qty * finP - cogs;
  S.sales.push({
    id:uid(), bookId:bid, bookTitle:book.title, qty,
    buyPrice: Math.round(cogs/qty),
    normalPrice: normalP,
    sellPrice: normalP,
    finalPrice: finP,
    finalSellPrice: finP,
    cogs, profit,
    date, via:'manual',
    priceOverride: isDiskon,
    note
  });
  closeModal(); S.save(); showToast('Penjualan dicatat ✓'); _render();
}

export function deleteSale(saleId) {
  const sale = S.sales.find(s => s.id === saleId);
  if (!sale) return;
  const book = S.books.find(b => b.id === sale.bookId);
  const bookName = book ? book.title : sale.bookTitle;
  const avgCogsPcs = Math.round(sale.cogs / sale.qty);

  if (!confirm(`Hapus transaksi "${bookName}" (${sale.qty} pcs)?\n\nStok akan dikembalikan +${sale.qty} pcs sebagai batch baru dengan harga modal ${new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(avgCogsPcs)}/pcs.`)) return;

  // Return stock as a new batch (safest approach with FIFO)
  if (book) {
    book.batches.push({
      id: uid(),
      qty: sale.qty,
      remaining: sale.qty,
      buyPrice: avgCogsPcs,
      date: today(),
      note: `Retur dari hapus transaksi tgl ${sale.date}`
    });
    S.restocks.push({
      id: uid(),
      bookId: book.id,
      bookTitle: book.title,
      qty: sale.qty,
      buyPrice: avgCogsPcs,
      date: today(),
      note: `Retur hapus transaksi`
    });
  }

  S.set.sales(S.sales.filter(s => s.id !== saleId));
  S.save();
  showToast(`Transaksi dihapus · stok +${sale.qty} pcs dikembalikan`);
  _render();
}

// ── Scanner Bundle ──────────────────────────────────────────────────────────
export function processScanBundle(code) {
  const book = S.books.find(b => b.barcode === code.trim());
  if (!book) { showToast('Barcode tidak ditemukan', 'err'); return; }
  if (totalStock(book) <= 0) { showToast(`Stok ${book.title} habis!`, 'err'); return; }
  // Cek apakah sudah ada di list
  const existing = S.scanBundleItems.find(i => i.bookId === book.id);
  if (existing) {
    if (existing.qty >= totalStock(book)) {
      showToast(`Stok ${book.title} tidak cukup!`, 'err'); return;
    }
    existing.qty++;
    showToast(`${book.title} → qty jadi ${existing.qty}`);
  } else {
    S.scanBundleItems.push({ bookId: book.id, qty: 1, book });
    showToast(`+ ${book.title} ditambahkan ke bundle`);
  }
  _render();
}

export function removeScanBundleItem(bookId) {
  S.set.scanBundleItems(S.scanBundleItems.filter(i => i.bookId !== bookId));
  _render();
}

export function changeScanBundleQty(bookId, delta) {
  const item = S.scanBundleItems.find(i => i.bookId === bookId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) { removeScanBundleItem(bookId); return; }
  if (newQty > totalStock(item.book)) { showToast('Stok tidak cukup!', 'err'); return; }
  item.qty = newQty;
  _render();
}

export function confirmScanBundle() {
  const price = +document.getElementById('scan-bundle-price')?.value || 0;
  const note  = document.getElementById('scan-bundle-note')?.value?.trim() || '';
  const date  = document.getElementById('scan-bundle-date')?.value || today();
  if (!S.scanBundleItems.length)  { showToast('Belum ada buku', 'err'); return; }
  if (!price)                    { showToast('Masukkan harga bundle', 'err'); return; }
  // Validasi stok
  for (const item of S.scanBundleItems) {
    if (totalStock(item.book) < item.qty) {
      showToast(`Stok ${item.book.title} tidak cukup!`, 'err'); return;
    }
  }
  // Deduct FIFO
  let totalCogs = 0;
  const deductions = [];
  for (const item of S.scanBundleItems) {
    const { cogs } = fifoDeduct(item.bookId, item.qty);
    totalCogs += cogs;
    deductions.push({ bookId: item.bookId, qty: item.qty, cogs });
  }
  const profit   = price - totalCogs;
  const bundleId = 'b_' + uid();
  S.sales.push({
    id: uid(), bundleId, isBundle: true, bookId: null,
    bookTitle: S.scanBundleItems.map(i=>`${i.book.title} x${i.qty}`).join(' + '),
    qty:         S.scanBundleItems.reduce((s,i)=>s+i.qty, 0),
    buyPrice:    Math.round(totalCogs / S.scanBundleItems.reduce((s,i)=>s+i.qty,0)),
    normalPrice: 0, sellPrice: 0,
    finalPrice: price, finalSellPrice: price,
    cogs: totalCogs, profit,
    date, via: 'scan',
    priceOverride: false, note,
    bundleItems: S.scanBundleItems.map(item => {
      const d = deductions.find(d => d.bookId === item.bookId);
      return { bookId: item.bookId, bookTitle: item.book.title, qty: item.qty, cogs: d?.cogs||0, buyPrice: d ? Math.round(d.cogs/item.qty) : 0 };
    }),
  });
  showToast(`✓ Bundle ${S.scanBundleItems.length} buku · profit ${fmt(profit)}`);
  S.set.scanBundleItems([]);
  S.set.scanBundleMode(false);
  S.save(); _render();
}

// ── Bundle Modal ────────────────────────────────────────────────────────────
export function openBundleModal() {
  S.set.bundleItems([]);
  S.set.bundlePrice(0);
  S.set.bundleNote(''); renderBundleModal();
}

export function renderBundleModal() {
  const totalNormal = S.bundleItems.reduce((s, item) => {
    const b = S.books.find(x => x.id === item.bookId);
    return s + (b ? getNormalPrice(b) * item.qty : 0);
  }, 0);
  const totalHPP = S.bundleItems.reduce((s, item) => {
    const b = S.books.find(x => x.id === item.bookId);
    if (!b) return s;
    const { cogs } = fifoSim(b, item.qty);
    return s + cogs;
  }, 0);
  const profit   = S.bundlePrice - totalHPP;
  const hasStock = S.bundleItems.every(item => {
    const b = S.books.find(x => x.id === item.bookId);
    return b && totalStock(b) >= item.qty;
  });
  const canSubmit = S.bundleItems.length && S.bundlePrice && hasStock;

  openModal(`
    <div class="modal-title">📦 Catat Penjualan Bundling</div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Cari buku untuk ditambahkan:</div>
      <div style="position:relative">
        <input class="inp" id="bundle-search-input" type="text" placeholder="Ketik judul buku..." autocomplete="off"
          oninput="bundleSearchFilter(this.value)">
        <div id="bundle-search-results" style="position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-s) var(--radius-s);display:none;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.1)"></div>
      </div>
    </div>

    ${S.bundleItems.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Isi bundle (${S.bundleItems.length} judul · ${S.bundleItems.reduce((s,i)=>s+i.qty,0)} buku total):</div>
      ${S.bundleItems.map((item, idx) => {
        const b = S.books.find(x => x.id === item.bookId);
        if (!b) return '';
        const stock = totalStock(b);
        const { cogs } = fifoSim(b, item.qty);
        const kurang = stock < item.qty;
        return `<div class="bundle-item-row" style="${kurang?'border-color:var(--red);background:#fef2f2':''}">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${b.title}</div>
            <div style="font-size:11px;color:var(--text3)">Normal: ${fmt(getNormalPrice(b))} · HPP FIFO: ${fmt(Math.round(cogs/item.qty))}/pcs · Stok: ${stock}</div>
            ${kurang ? `<div style="font-size:11px;color:var(--red);font-weight:600">⚠ Stok tidak cukup!</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-ghost btn-xs" onclick="bundleChangeQty(${idx},-1)">−</button>
            <span style="font-weight:700;min-width:24px;text-align:center">${item.qty}</span>
            <button class="btn btn-ghost btn-xs" onclick="bundleChangeQty(${idx},+1)">+</button>
            <button class="btn btn-danger btn-xs" style="margin-left:4px" onclick="bundleRemoveItem(${idx})">✕</button>
          </div>
        </div>`;
      }).join('')}

      <div class="bundle-summary-bar" style="margin-top:12px">
        <div style="flex:1;font-size:12px">
          <div>Total normal: <strong>${fmt(totalNormal)}</strong></div>
          <div style="color:var(--text3)">Total HPP modal: <strong id="bundle-hpp-display">${fmt(totalHPP)}</strong></div>
        </div>
        <div style="text-align:right;font-size:12px">
          <div style="color:var(--text3)">Profit bundle:</div>
          <div id="bundle-profit-display" style="font-size:16px;font-weight:700;color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(profit)}</div>
        </div>
      </div>
    </div>

    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-s);padding:14px;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💰 Harga Bundling</div>
      <div class="field" style="margin-bottom:6px">
        <label>Harga Jual Total Bundle (Rp) *</label>
        <input class="inp" id="bundle-price-input" type="number" value="${S.bundlePrice||''}"
          placeholder="Masukkan harga jual bundle..."
          oninput="setBundlePrice(+this.value)" style="border-color:var(--accent)">
        <div class="hint">Profit = harga ini − total HPP FIFO semua buku</div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Catatan <span style="color:var(--text3);font-weight:400">(opsional)</span></label>
        <input class="inp" id="bundle-note-input" value="${S.bundleNote}"
          placeholder="e.g. paket lebaran, bundel murid baru..."
          oninput="setBundleNote(this.value)">
      </div>
      <div class="field" style="margin-top:10px;margin-bottom:0">
        <label>Tanggal</label>
        <input class="inp" id="bundle-date-input" type="date" value="${today()}" max="${today()}" style="max-width:180px">
      </div>
    </div>` : `
    <div style="text-align:center;padding:24px;color:var(--text3);font-size:13px;background:var(--bg);border-radius:var(--radius-s);margin-bottom:16px">
      📦 Belum ada buku dipilih.<br>Ketik judul buku di search box di atas untuk menambahkan.
    </div>`}

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" id="bundle-submit-btn"
        ${!canSubmit ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}
        onclick="saveBundleSale()">
        ✓ Simpan Bundle (${S.bundleItems.reduce((s,i)=>s+i.qty,0)} buku)
      </button>
    </div>`);
}

// ── Bundle search + add ──────────────────────────────────────────────────────
export function bundleSearchFilter(query) {
  const resultsEl = document.getElementById('bundle-search-results');
  if (!resultsEl) return;
  const q = query.toLowerCase().trim();
  if (!q || q.length < 1) { resultsEl.style.display = 'none'; return; }
  const matches = S.books
    .filter(b => totalStock(b) > 0)
    .filter(b => [b.title, b.author, b.barcode, b.publisher].some(v => v?.toLowerCase().includes(q)))
    .slice(0, 6);
  if (!matches.length) {
    resultsEl.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--text3)">Tidak ditemukan</div>`;
    resultsEl.style.display = 'block';
    return;
  }
  resultsEl.innerHTML = matches.map(b => `
    <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"
      onclick="bundleAddById(${b.id})">
      <div>
        <div style="font-weight:600;font-size:13px">${b.title}</div>
        <div style="font-size:11px;color:var(--text3)">Stok: ${totalStock(b)} · ${fmt(getNormalPrice(b))}</div>
      </div>
      <span style="font-size:11px;color:var(--accent);background:var(--accent-s);padding:2px 8px;border-radius:12px;white-space:nowrap">+ Tambah</span>
    </div>`).join('');
  resultsEl.style.display = 'block';
}

export function bundleAddById(bookId) {
  const existing = S.bundleItems.find(i => i.bookId === bookId);
  if (existing) { existing.qty += 1; }
  else { S.bundleItems.push({ bookId, qty: 1 }); }
  renderBundleModal();
  // Re-focus search after modal rebuild
  setTimeout(() => {
    const inp = document.getElementById('bundle-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }, 50);
}

export function bundleRemoveItem(idx) {
  S.bundleItems.splice(idx, 1);
  renderBundleModal();
}

export function bundleChangeQty(idx, delta) {
  S.bundleItems[idx].qty = Math.max(1, S.bundleItems[idx].qty + delta);
  renderBundleModal();
}

export function saveBundleSale() {
  if (!S.bundleItems.length)  { showToast('Tambahkan minimal 1 buku', 'err'); return; }
  if (!S.bundlePrice)          { showToast('Masukkan harga bundling', 'err'); return; }
  // Validasi stok
  for (const item of S.bundleItems) {
    const b = S.books.find(x => x.id === item.bookId);
    if (!b || totalStock(b) < item.qty) {
      showToast(`Stok ${b?.title||'buku'} tidak cukup!`, 'err'); return;
    }
  }
  // Deduct FIFO & hitung total HPP
  let totalCogs = 0;
  const deductions = [];
  for (const item of S.bundleItems) {
    const { cogs } = fifoDeduct(item.bookId, item.qty);
    totalCogs += cogs;
    deductions.push({ bookId: item.bookId, qty: item.qty, cogs });
  }
  const profit   = S.bundlePrice - totalCogs;
  const note     = document.getElementById('bundle-note-input')?.value?.trim() || S.bundleNote || '';
  const date     = document.getElementById('bundle-date-input')?.value || today();
  const bundleId = 'b_' + uid();

  S.sales.push({
    id:             uid(),
    bundleId,
    isBundle:       true,
    bookId:         null,
    bookTitle:      S.bundleItems.map(item => {
      const b = S.books.find(x => x.id === item.bookId);
      return `${b?.title||'?'} x${item.qty}`;
    }).join(' + '),
    qty:            S.bundleItems.reduce((s, i) => s + i.qty, 0),
    buyPrice:       Math.round(totalCogs / S.bundleItems.reduce((s,i)=>s+i.qty,0)),
    normalPrice:    0,
    sellPrice:      0,
    finalPrice:     S.bundlePrice,
    finalSellPrice: S.bundlePrice,
    cogs:           totalCogs,
    profit,
    date:           date,
    via:            'manual',
    priceOverride:  false,
    note,
    bundleItems:    S.bundleItems.map(item => {
      const b = S.books.find(x => x.id === item.bookId);
      const d = deductions.find(d => d.bookId === item.bookId);
      return {
        bookId:    item.bookId,
        bookTitle: b?.title || '?',
        qty:       item.qty,
        cogs:      d?.cogs || 0,
        buyPrice:  d ? Math.round(d.cogs / item.qty) : 0,
      };
    }),
  });

  closeModal();
  S.save();
  showToast(`✓ Bundle dicatat — ${S.bundleItems.reduce((s,i)=>s+i.qty,0)} buku · profit ${fmt(profit)}`);
  S.set.bundleItems([]); S.set.bundlePrice(0); S.set.bundleNote(''); _render();
}

export function deleteSaleBundle(saleId) {
  const sale = S.sales.find(s => s.id === saleId);
  if (!sale) return;
  const titlesStr = sale.bundleItems
    ? sale.bundleItems.map(i => `${i.bookTitle} ×${i.qty}`).join(', ')
    : sale.bookTitle;
  if (!confirm(`Hapus bundling ini?\n${titlesStr}\n\nStok semua buku akan dikembalikan.`)) return;
  // Kembalikan stok tiap item
  if (sale.bundleItems) {
    for (const item of sale.bundleItems) {
      const b = S.books.find(x => x.id === item.bookId);
      if (b) {
        const avgBuyP = item.buyPrice || Math.round((item.cogs||0)/(item.qty||1));
        b.batches.push({ id:uid(), qty:item.qty, remaining:item.qty, buyPrice:avgBuyP, date:today(), note:`Retur bundle ${sale.date}` });
        S.restocks.push({ id:uid(), bookId:b.id, bookTitle:b.title, qty:item.qty, buyPrice:avgBuyP, date:today(), note:'Retur bundling' });
      }
    }
  }
  S.set.sales(S.sales.filter(s => s.id !== saleId));
  S.save();
  showToast(`Bundle dihapus · stok dikembalikan ✓`);
  _render();
}
