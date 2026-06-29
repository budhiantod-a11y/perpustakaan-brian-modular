// ═══════════════════════════════════════════════════════════════════════════
// sales.js — Manual sales, bundle sales, delete sales
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { openModal, closeModal, showToast, uid, today, fmt, getNormalPrice } from './helpers.js';
import { totalStock, fifoDeduct, fifoSim, manualDeduct, manualSim } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

export function openSaleManual() {
  S.set.manualCartItems([]);
  renderManualSaleModal();
}

export function renderManualSaleModal() {
  const items = S.manualCartItems;
  const canSubmit = items.length > 0 && items.every(item => {
    const b = S.books.find(x => x.id === item.bookId);
    if (!b || totalStock(b) < item.qty || item.finalPrice <= 0) return false;
    // Kalau batch override aktif (toggle on), total harus pas — biar 0 pun tetep gagal
    if (Array.isArray(item.batchOverride)) {
      const total = item.batchOverride.reduce((s,o)=>s+(+o.qty||0),0);
      if (total !== item.qty) return false;
    }
    return true;
  });

  openModal(`
    <div class="modal-title">Catat Penjualan</div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Cari buku untuk ditambahkan:</div>
      <div class="search-input-wrap">
        <input class="inp" id="manual-cart-search-input" type="text" placeholder="Ketik judul buku..." autocomplete="off"
          oninput="manualCartSearchFilter(this.value)">
        <button class="search-clear-btn" onclick="clearInputField('manual-cart-search-input')" type="button">✕ Clear</button>
        <div id="manual-cart-search-results" style="position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-s) var(--radius-s);display:none;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.1)"></div>
      </div>
    </div>

    ${items.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">
        Daftar buku (${items.length} judul · ${items.reduce((s,i)=>s+i.qty,0)} pcs):
      </div>
      ${items.map((item, idx) => {
        const b = S.books.find(x => x.id === item.bookId);
        if (!b) return '';
        const stock = totalStock(b);
        const normalP = getNormalPrice(b);
        const useManual = Array.isArray(item.batchOverride);
        const sim = useManual ? manualSim(b, item.batchOverride) : fifoSim(b, item.qty);
        const cogs = sim.cogs;
        const hppPerPcs = item.qty > 0 ? Math.round(cogs / item.qty) : 0;
        const kurang = stock < item.qty;
        const diff = item.finalPrice - normalP;
        const diffClass = diff < 0 ? 'diff-down' : diff > 0 ? 'diff-up' : 'diff-same';
        const diffText = diff < 0 ? fmt(diff) : diff > 0 ? '+'+fmt(diff) : '—';
        const isDiskon = item.finalPrice !== normalP;
        const activeBatches = b.batches.filter(bt => bt.remaining > 0)
          .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
        const multipleBatches = activeBatches.length > 1;
        const overrideTotal = useManual ? item.batchOverride.reduce((s,o)=>s+(+o.qty||0),0) : 0;
        const overrideOk = useManual && overrideTotal === item.qty;
        return `<div class="bundle-item-row" style="${kurang ? 'border-color:var(--red);background:#fef2f2' : (useManual ? 'border-color:#7c3aed' : '')};flex-direction:column;align-items:stretch">
          <div style="display:flex;gap:12px;align-items:flex-start;width:100%">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${b.title}</div>
              <div style="font-size:11px;color:var(--text3)">Normal: ${fmt(normalP)} · HPP: ${fmt(hppPerPcs)}/pcs · Stok: ${stock}</div>
              ${kurang ? `<div style="font-size:11px;color:var(--red);font-weight:600">⚠ Stok tidak cukup!</div>` : ''}
              ${useManual && !overrideOk ? `<div style="font-size:11px;color:#7c3aed;font-weight:600">⚠ Batch manual: ${overrideTotal}/${item.qty} pcs — total harus pas</div>` : ''}
              ${useManual && overrideOk ? `<div style="font-size:11px;color:#7c3aed">✓ Batch manual aktif</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div style="display:flex;align-items:center;gap:6px">
                <button class="btn btn-ghost btn-xs" onclick="manualCartChangeQty(${idx},-1)">−</button>
                <span style="font-weight:700;min-width:24px;text-align:center">${item.qty}</span>
                <button class="btn btn-ghost btn-xs" onclick="manualCartChangeQty(${idx},+1)">+</button>
                <button class="btn btn-danger btn-xs" style="margin-left:4px" onclick="manualCartRemoveItem(${idx})">✕</button>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <label style="font-size:11px;color:var(--text3);white-space:nowrap">Harga:</label>
                <input class="inp" type="number" id="manual-price-${idx}" value="${item.finalPrice}"
                  oninput="manualCartUpdatePrice(${idx},+this.value)"
                  style="width:110px;font-size:13px;padding:4px 8px;${isDiskon ? 'border-color:var(--orange)' : 'border-color:var(--accent)'}">
                <span class="price-diff-pill ${diffClass}" id="manual-diff-${idx}">${diffText}</span>
              </div>
              <div id="manual-note-wrap-${idx}" style="width:100%">
                <input class="inp" type="text" id="manual-note-${idx}"
                  value="${(item.note||'').replace(/"/g,'&quot;')}"
                  placeholder="${isDiskon ? 'Catatan diskon (wajib)...' : 'Catatan (opsional)...'}"
                  oninput="manualCartUpdateNote(${idx},this.value)"
                  style="font-size:12px;padding:4px 8px;width:100%;box-sizing:border-box">
              </div>
            </div>
          </div>
          ${multipleBatches ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);cursor:pointer">
              <input type="checkbox" ${useManual ? 'checked' : ''} onchange="manualCartToggleBatchOverride(${idx})" style="cursor:pointer">
              Pilih batch manual (default: FIFO)
            </label>
            ${useManual ? `
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
              ${activeBatches.map(bt => {
                const ov = item.batchOverride.find(o => String(o.batchId) === String(bt.id));
                const qtyVal = ov ? ov.qty : 0;
                return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 8px;background:var(--bg);border-radius:var(--radius-s)">
                  <span style="color:var(--text3);min-width:74px;font-size:11px">${bt.date || '—'}</span>
                  <span style="min-width:60px;font-size:11px">${fmt(bt.buyPrice)}/pcs</span>
                  <span style="color:var(--text3);min-width:60px;font-size:11px">sisa ${bt.remaining}</span>
                  <input type="number" min="0" max="${bt.remaining}" value="${qtyVal}"
                    class="batch-qty-input" data-item-idx="${idx}" data-batch-id="${bt.id}"
                    oninput="manualCartSetBatchQty(this)"
                    style="width:60px;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;margin-left:auto">
                  <span style="font-size:10px;color:var(--text3)">pcs</span>
                </div>`;
              }).join('')}
              <div id="manual-batch-total-${idx}" style="font-size:11px;color:${overrideOk ? 'var(--green)' : '#7c3aed'};text-align:right;margin-top:2px;font-weight:600">
                Total: ${overrideTotal} / ${item.qty} pcs ${overrideOk ? '✓' : ''}
              </div>
            </div>` : ''}
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:4px">
      <div class="field" style="flex:0 0 180px">
        <label>Tanggal</label>
        <input class="inp" id="manual-cart-date" type="date" value="${today()}" max="${today()}">
      </div>
      <div class="field" style="flex:1;min-width:200px">
        <label>Customer <span style="color:var(--text3);font-weight:400">(opsional)</span></label>
        <input class="inp" id="manual-cart-customer" type="text" placeholder="Nama customer" autocomplete="off">
      </div>
    </div>` : `
    <div style="text-align:center;padding:24px;color:var(--text3);font-size:13px;background:var(--bg);border-radius:var(--radius-s);margin-bottom:16px">
      Belum ada buku dipilih.<br>Ketik judul buku di atas untuk menambahkan.
    </div>`}

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" ${!canSubmit ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}
        onclick="saveSaleManual()">
        Simpan${items.length ? ` (${items.reduce((s,i)=>s+i.qty,0)} buku · ${items.length} judul)` : ''}
      </button>
    </div>`);

  setTimeout(() => {
    const inp = document.getElementById('manual-cart-search-input');
    if (inp) inp.focus();
  }, 50);
}

// ── Manual cart helpers ───────────────────────────────────────────────────────
export function manualCartSearchFilter(query) {
  const resultsEl = document.getElementById('manual-cart-search-results');
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
      onclick='manualCartAddById(${JSON.stringify(b.id)})'>
      <div>
        <div style="font-weight:600;font-size:13px">${b.title}</div>
        <div style="font-size:11px;color:var(--text3)">Stok: ${totalStock(b)} · ${fmt(getNormalPrice(b))}</div>
      </div>
      <span style="font-size:11px;color:var(--accent);background:var(--accent-s);padding:2px 8px;border-radius:12px;white-space:nowrap">+ Tambah</span>
    </div>`).join('');
  resultsEl.style.display = 'block';
}

export function manualCartAddById(bookId) {
  const book = S.books.find(b => b.id === bookId);
  if (!book) return;
  const existing = S.manualCartItems.find(i => i.bookId === bookId);
  if (existing) {
    existing.qty += 1;
  } else {
    S.manualCartItems.push({ bookId, qty: 1, finalPrice: getNormalPrice(book), note: '' });
  }
  renderManualSaleModal();
  setTimeout(() => {
    const inp = document.getElementById('manual-cart-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }, 50);
}

export function manualCartRemoveItem(idx) {
  S.manualCartItems.splice(idx, 1);
  renderManualSaleModal();
}

export function manualCartChangeQty(idx, delta) {
  const item = S.manualCartItems[idx];
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) { manualCartRemoveItem(idx); return; }
  const b = S.books.find(x => x.id === item.bookId);
  if (newQty > totalStock(b)) { showToast('Stok tidak cukup!', 'err'); return; }
  item.qty = newQty;
  renderManualSaleModal();
}

export function manualCartUpdatePrice(idx, val) {
  const item = S.manualCartItems[idx];
  if (!item) return;
  item.finalPrice = isNaN(val) ? 0 : val;
  const b = S.books.find(x => x.id === item.bookId);
  const normalP = getNormalPrice(b);
  const diff = item.finalPrice - normalP;
  const diffEl = document.getElementById(`manual-diff-${idx}`);
  const priceEl = document.getElementById(`manual-price-${idx}`);
  const noteEl = document.getElementById(`manual-note-${idx}`);
  if (diffEl) {
    if (diff < 0)      { diffEl.textContent = fmt(diff);     diffEl.className = 'price-diff-pill diff-down'; }
    else if (diff > 0) { diffEl.textContent = '+'+fmt(diff); diffEl.className = 'price-diff-pill diff-up'; }
    else               { diffEl.textContent = '—';           diffEl.className = 'price-diff-pill diff-same'; }
  }
  if (priceEl) priceEl.style.borderColor = diff !== 0 ? 'var(--orange)' : 'var(--accent)';
  if (noteEl)  noteEl.placeholder = diff !== 0 ? 'Catatan diskon (wajib)...' : 'Catatan (opsional)...';
}

export function manualCartUpdateNote(idx, val) {
  const item = S.manualCartItems[idx];
  if (!item) return;
  item.note = val;
}

// ── Batch override (manual pilih batch) ──────────────────────────────────────
export function manualCartToggleBatchOverride(idx) {
  const item = S.manualCartItems[idx];
  if (!item) return;
  if (Array.isArray(item.batchOverride) && item.batchOverride.length > 0) {
    // Matikan → revert ke FIFO
    delete item.batchOverride;
  } else {
    // Aktifkan → prefill pakai FIFO order biar user tinggal sesuaikan
    const b = S.books.find(x => x.id === item.bookId);
    if (!b) return;
    const { details } = fifoSim(b, item.qty);
    // Map details ke batchId
    const sorted = [...b.batches].filter(bt => bt.remaining > 0).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const overrides = [];
    let left = item.qty;
    for (const bt of sorted) {
      if (left <= 0) break;
      const take = Math.min(bt.remaining, left);
      // Selalu simpan batchId sebagai string biar konsisten dengan dataset.batchId (yang selalu string)
      overrides.push({ batchId: String(bt.id), qty: take });
      left -= take;
    }
    item.batchOverride = overrides;
  }
  renderManualSaleModal();
}

export function manualCartSetBatchQty(el) {
  const idx     = +el.dataset.itemIdx;
  const batchId = String(el.dataset.batchId);
  const item    = S.manualCartItems[idx];
  if (!item || !Array.isArray(item.batchOverride)) return;
  const qty = Math.max(0, +el.value || 0);
  const existing = item.batchOverride.find(o => String(o.batchId) === batchId);
  if (existing) {
    existing.qty = qty;  // keep entry walau 0, biar field gak hilang & cursor terjaga
  } else if (qty > 0) {
    item.batchOverride.push({ batchId, qty });
  }
  // Skip full re-render (preserve focus) — update total counter inline
  const total = item.batchOverride.reduce((s,o)=>s+(+o.qty||0),0);
  const counterEl = document.getElementById(`manual-batch-total-${idx}`);
  if (counterEl) {
    const ok = total === item.qty;
    counterEl.innerHTML = `Total: ${total} / ${item.qty} pcs ${ok ? '✓' : ''}`;
    counterEl.style.color = ok ? 'var(--green)' : '#7c3aed';
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
  const items = S.manualCartItems;
  if (!items.length) { showToast('Tambahkan minimal 1 buku', 'err'); return; }
  const date = document.getElementById('manual-cart-date')?.value || today();
  const customer = document.getElementById('manual-cart-customer')?.value?.trim() || '';

  // Read latest DOM values into state before validating (handles fast typing edge cases)
  for (let idx = 0; idx < items.length; idx++) {
    const priceEl = document.getElementById(`manual-price-${idx}`);
    const noteEl  = document.getElementById(`manual-note-${idx}`);
    if (priceEl) items[idx].finalPrice = +priceEl.value || 0;
    if (noteEl)  items[idx].note = noteEl.value?.trim() || '';
    // Read latest batch qty inputs kalau override aktif
    if (Array.isArray(items[idx].batchOverride)) {
      const inputs = document.querySelectorAll(`.batch-qty-input[data-item-idx="${idx}"]`);
      if (inputs.length) {
        const rebuilt = [];
        inputs.forEach(inp => {
          const qty = Math.max(0, +inp.value || 0);
          if (qty > 0) rebuilt.push({ batchId: inp.dataset.batchId, qty });
        });
        items[idx].batchOverride = rebuilt;
      }
    }
  }

  // Validate each item
  for (const item of items) {
    const b = S.books.find(x => x.id === item.bookId);
    if (!b) { showToast('Data buku tidak valid', 'err'); return; }
    if (item.qty <= 0) { showToast(`Jumlah "${b.title}" harus lebih dari 0`, 'err'); return; }
    if (item.finalPrice <= 0) { showToast(`Harga "${b.title}" harus lebih dari 0`, 'err'); return; }
    if (totalStock(b) < item.qty) { showToast(`Stok "${b.title}" tidak cukup!`, 'err'); return; }
    const normalP = getNormalPrice(b);
    if (item.finalPrice !== normalP && !item.note) {
      showToast(`Isi catatan untuk "${b.title}" (harga beda dari normal)`, 'err'); return;
    }
    // Validasi batch override — kalau toggle aktif, total wajib pas (biar 0 ditolak)
    if (Array.isArray(item.batchOverride)) {
      const total = item.batchOverride.reduce((s,o)=>s+(+o.qty||0),0);
      if (total !== item.qty) { showToast(`Batch manual "${b.title}": total ${total} ≠ qty ${item.qty}`, 'err'); return; }
    }
  }

  const groupId = items.length > 1 ? 'mg_' + uid() : null;

  for (const item of items) {
    const book   = S.books.find(x => x.id === item.bookId);
    const normalP = getNormalPrice(book);
    const useManual = Array.isArray(item.batchOverride);
    let cogs, details;
    if (useManual) {
      const res = manualDeduct(item.bookId, item.batchOverride);
      if (!res.ok) { showToast(`Batch "${book.title}": ${res.reason}`, 'err'); return; }
      cogs = res.cogs; details = res.details;
    } else {
      const res = fifoDeduct(item.bookId, item.qty);
      cogs = res.cogs; details = res.details;
    }
    const batchConsumption = details.map(d => ({ batchId: d.batchId, qty: d.qty, buyPrice: d.buyPrice }));
    const profit   = item.qty * item.finalPrice - cogs;
    const isDiskon = item.finalPrice !== normalP;
    S.sales.push({
      id: uid(),
      bookId: item.bookId,
      bookTitle: book.title,
      qty: item.qty,
      buyPrice: Math.round(cogs / item.qty),
      normalPrice: normalP,
      sellPrice: normalP,
      finalPrice: item.finalPrice,
      finalSellPrice: item.finalPrice,
      cogs, profit,
      date, via: 'manual',
      priceOverride: isDiskon,
      note: item.note || '',
      customer,
      batchConsumption,
      ...(useManual ? { batchSource: 'manual' } : {}),
      ...(groupId ? { groupId } : {}),
    });
  }

  const totalPcs = items.reduce((s, i) => s + i.qty, 0);
  closeModal();
  S.save();
  showToast(`✓ ${items.length} judul · ${totalPcs} buku dicatat`);
  S.set.manualCartItems([]);
  _render();
}

export function deleteSale(saleId) {
  const sale = S.sales.find(s => s.id === saleId);
  if (!sale) return;
  const book = S.books.find(b => b.id === sale.bookId);
  const bookName = book ? book.title : sale.bookTitle;
  const avgCogsPcs = Math.round(sale.cogs / sale.qty);

  // Cek apakah bisa restore ke batch asal: butuh batchConsumption ada & semua batchId masih ditemukan
  const hasBC = Array.isArray(sale.batchConsumption) && sale.batchConsumption.length > 0;
  const canRestoreToOrigin = hasBC && book && sale.batchConsumption.every(bc =>
    book.batches.find(b => String(b.id) === String(bc.batchId))
  );

  const confirmMsg = canRestoreToOrigin
    ? `Hapus transaksi "${bookName}" (${sale.qty} pcs)?\n\nStok akan dikembalikan ke ${sale.batchConsumption.length} batch asal.`
    : `Hapus transaksi "${bookName}" (${sale.qty} pcs)?\n\nStok akan dikembalikan +${sale.qty} pcs sebagai batch baru dengan harga modal ${new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(avgCogsPcs)}/pcs.`;

  if (!confirm(confirmMsg)) return;

  if (book) {
    if (canRestoreToOrigin) {
      for (const bc of sale.batchConsumption) {
        const bt = book.batches.find(b => String(b.id) === String(bc.batchId));
        bt.remaining += bc.qty;
      }
      S.restocks.push({
        id: uid(), bookId: book.id, bookTitle: book.title,
        qty: sale.qty, buyPrice: avgCogsPcs, date: today(),
        note: `Retur ke batch asal (hapus trx tgl ${sale.date})`
      });
    } else {
      // Fallback: sale lama tanpa batchConsumption, atau batch asal hilang
      book.batches.push({
        id: uid(), qty: sale.qty, remaining: sale.qty, buyPrice: avgCogsPcs,
        date: today(), note: `Retur dari hapus transaksi tgl ${sale.date}`
      });
      S.restocks.push({
        id: uid(), bookId: book.id, bookTitle: book.title,
        qty: sale.qty, buyPrice: avgCogsPcs, date: today(),
        note: `Retur hapus transaksi`
      });
    }
  }

  S.set.sales(S.sales.filter(s => s.id !== saleId));
  S.save();
  showToast(canRestoreToOrigin
    ? `Transaksi dihapus · stok dikembalikan ke ${sale.batchConsumption.length} batch asal ✓`
    : `Transaksi dihapus · stok +${sale.qty} pcs dikembalikan`);
  _render();
}

// ── Edit Sale (buyPrice + finalPrice) ──────────────────────────────────────
// Scenario A: edit cuma sale itu, batch/stok tidak ke-touch (manual edit di menu Stok)
export function openEditSaleModal(saleId) {
  const sale = S.sales.find(s => s.id === saleId);
  if (!sale) return;
  if (sale.isBundle) renderEditBundleModal(sale);
  else               renderEditSaleModal(sale);
}

function renderEditSaleModal(sale) {
  const oldFinal = sale.finalPrice || sale.finalSellPrice || 0;
  const oldBuyP  = sale.buyPrice   || Math.round((sale.cogs || 0) / (sale.qty || 1));
  const oldProfit = sale.profit || 0;

  openModal(`
    <div class="modal-title">✎ Edit Transaksi</div>

    <div style="background:var(--accent-s);border-radius:var(--radius-s);padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--text2);line-height:1.6">
      <strong>${sale.bookTitle}</strong> · qty ${sale.qty} · ${sale.date}<br>
      Profit lama: <strong style="color:var(--green)">${fmt(oldProfit)}</strong>
    </div>

    <div class="field">
      <label>Harga Modal / pcs <span style="color:var(--text3);font-weight:400">(lama: ${fmt(oldBuyP)})</span></label>
      <input class="inp" id="edit-buy-price" type="number" min="0" value="${oldBuyP}" data-qty="${sale.qty || 0}" oninput="editSalePreview()">
    </div>

    <div class="field">
      <label>Harga Final Total <span style="color:var(--text3);font-weight:400">(lama: ${fmt(oldFinal)})</span></label>
      <input class="inp" id="edit-final-price" type="number" min="0" value="${oldFinal}" oninput="editSalePreview()">
    </div>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-s);padding:10px 12px;margin:14px 0;font-size:13px">
      Profit baru: <strong id="edit-profit-preview" style="color:var(--green);font-size:16px">${fmt(oldProfit)}</strong>
    </div>

    <div class="field">
      <label>Catatan Perubahan <span style="color:var(--red)">*wajib</span></label>
      <textarea class="inp" id="edit-note" rows="2" placeholder="Misal: koreksi harga modal, salah input, dll" style="resize:vertical"></textarea>
      <div class="hint">Disimpan terpisah di kolom <code>editNote</code> · note transaksi asli tidak berubah</div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick='submitEditSale(${JSON.stringify(sale.id)})'>✓ Simpan Perubahan</button>
    </div>
  `);
}

function renderEditBundleModal(sale) {
  const oldFinal = sale.finalPrice || sale.finalSellPrice || 0;
  const items = Array.isArray(sale.bundleItems) ? sale.bundleItems : [];

  openModal(`
    <div class="modal-title">✎ Edit Bundling</div>

    <div style="background:var(--accent-s);border-radius:var(--radius-s);padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--text2);line-height:1.6">
      <strong>${items.length} judul</strong> · ${items.reduce((s,i)=>s+i.qty,0)} buku · ${sale.date}<br>
      Profit lama: <strong style="color:var(--green)">${fmt(sale.profit || 0)}</strong>
    </div>

    <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Harga Modal / pcs per buku:</div>
    ${items.map((it, idx) => {
      const oldBuyP = it.buyPrice || Math.round((it.cogs || 0) / (it.qty || 1));
      return `
        <div class="bundle-item-row" style="flex-direction:column;align-items:stretch;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:6px">
            <strong>${it.bookTitle}</strong>
            <span style="color:var(--text3)">×${it.qty}</span>
          </div>
          <input class="inp" type="number" min="0"
            data-edit-bundle-idx="${idx}"
            data-qty="${it.qty || 0}"
            value="${oldBuyP}"
            placeholder="Modal/pcs (lama: ${fmt(oldBuyP)})"
            oninput="editSalePreview()">
        </div>`;
    }).join('')}

    <div class="field" style="margin-top:14px">
      <label>Harga Bundle <span style="color:var(--text3);font-weight:400">(lama: ${fmt(oldFinal)})</span></label>
      <input class="inp" id="edit-final-price" type="number" min="0" value="${oldFinal}" oninput="editSalePreview()">
    </div>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-s);padding:10px 12px;margin:14px 0;font-size:13px">
      Total HPP baru: <strong id="edit-cogs-preview">${fmt(sale.cogs || 0)}</strong><br>
      Profit baru: <strong id="edit-profit-preview" style="color:var(--green);font-size:16px">${fmt(sale.profit || 0)}</strong>
    </div>

    <div class="field">
      <label>Catatan Perubahan <span style="color:var(--red)">*wajib</span></label>
      <textarea class="inp" id="edit-note" rows="2" placeholder="Misal: koreksi harga modal, salah input, dll" style="resize:vertical"></textarea>
      <div class="hint">Disimpan terpisah di kolom <code>editNote</code> · note transaksi asli tidak berubah</div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick='submitEditSale(${JSON.stringify(sale.id)})'>✓ Simpan Perubahan</button>
    </div>
  `);
}

// Live preview cogs + profit saat user ketik
export function editSalePreview() {
  const profitEl = document.getElementById('edit-profit-preview');
  const cogsEl   = document.getElementById('edit-cogs-preview');
  const finalP   = +document.getElementById('edit-final-price')?.value || 0;

  // Bundle case: ada cogsEl
  if (cogsEl) {
    const itemInputs = document.querySelectorAll('[data-edit-bundle-idx]');
    let totalCogs = 0;
    // Cari sale yg lagi di-edit untuk akses qty
    // Workaround: ambil qty dari urutan items dgn lookup ke modal — kita pass via data-qty
    itemInputs.forEach(inp => {
      const idx = +inp.getAttribute('data-edit-bundle-idx');
      const qty = +inp.getAttribute('data-qty') || 0;
      const bp  = +inp.value || 0;
      totalCogs += bp * qty;
    });
    if (cogsEl) cogsEl.textContent = fmt(totalCogs);
    if (profitEl) profitEl.textContent = fmt(finalP - totalCogs);
    return;
  }

  // Non-bundle case
  const buyP = +document.getElementById('edit-buy-price')?.value || 0;
  const qty  = +document.getElementById('edit-buy-price')?.getAttribute('data-qty') || 0;
  const cogs = buyP * qty;
  if (profitEl) profitEl.textContent = fmt(finalP * qty - cogs);
}

export function submitEditSale(saleId) {
  const sale = S.sales.find(s => s.id === saleId);
  if (!sale) { showToast('Transaksi tidak ditemukan', 'err'); return; }

  const noteEl = document.getElementById('edit-note');
  const editNote = (noteEl?.value || '').trim();
  if (!editNote) { showToast('Catatan perubahan wajib diisi', 'err'); noteEl?.focus(); return; }

  const newFinal = +document.getElementById('edit-final-price')?.value || 0;
  if (newFinal <= 0) { showToast('Harga final harus > 0', 'err'); return; }

  if (sale.isBundle) {
    const items = sale.bundleItems || [];
    const inputs = document.querySelectorAll('[data-edit-bundle-idx]');
    let totalCogs = 0;
    inputs.forEach(inp => {
      const idx = +inp.getAttribute('data-edit-bundle-idx');
      const bp  = +inp.value || 0;
      if (items[idx]) {
        items[idx].buyPrice = bp;
        items[idx].cogs = bp * (items[idx].qty || 0);
        totalCogs += items[idx].cogs;
      }
    });
    sale.cogs = totalCogs;
    sale.finalPrice = newFinal;
    sale.finalSellPrice = newFinal;
    sale.profit = newFinal - totalCogs;
    const totalQty = items.reduce((s,i)=>s+(i.qty||0),0) || 1;
    sale.buyPrice = Math.round(totalCogs / totalQty);
  } else {
    const newBuyP = +document.getElementById('edit-buy-price')?.value || 0;
    if (newBuyP < 0) { showToast('Modal tidak boleh negatif', 'err'); return; }
    sale.buyPrice = newBuyP;
    sale.cogs = newBuyP * (sale.qty || 0);
    sale.finalPrice = newFinal;
    sale.finalSellPrice = newFinal;
    sale.profit = newFinal * (sale.qty || 0) - sale.cogs;
  }

  // Append editNote dengan prefix tanggal
  const stamp = `[${today()}] ${editNote}`;
  sale.editNote = sale.editNote ? `${sale.editNote}\n${stamp}` : stamp;

  S.save();
  closeModal();
  _render();
  openStockReminderModal();
}

function openStockReminderModal() {
  openModal(`
    <div class="modal-title">✓ Transaksi di-update</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text2);margin-bottom:16px">
      Perubahan harga modal/final di transaksi udah tersimpan.<br><br>
      <strong>Reminder:</strong> kalau perubahan harga modal ini juga berlaku untuk <strong>stok yang masih ada</strong> (batch belum kejual), edit manual di menu <strong>Stok</strong> ya — sale yang udah lewat gak otomatis sync ke batch.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Nanti</button>
      <button class="btn btn-primary" onclick="closeModal(); goTab('stok')">Buka Menu Stok</button>
    </div>
  `);
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
    const { cogs, details } = fifoDeduct(item.bookId, item.qty);
    totalCogs += cogs;
    deductions.push({ bookId: item.bookId, qty: item.qty, cogs, details });
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
      const bc = (d?.details || []).map(x => ({ batchId: x.batchId, qty: x.qty, buyPrice: x.buyPrice }));
      return { bookId: item.bookId, bookTitle: item.book.title, qty: item.qty, cogs: d?.cogs||0, buyPrice: d ? Math.round(d.cogs/item.qty) : 0, batchConsumption: bc };
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
  setTimeout(() => document.getElementById('bundle-search-input')?.focus(), 50);
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
      <div class="search-input-wrap">
        <input class="inp" id="bundle-search-input" type="text" placeholder="Ketik judul buku..." autocomplete="off"
          oninput="bundleSearchFilter(this.value)">
        <button class="search-clear-btn" onclick="clearInputField('bundle-search-input')" type="button">✕ Clear</button>
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
      onclick='bundleAddById(${JSON.stringify(b.id)})'>
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
    const { cogs, details } = fifoDeduct(item.bookId, item.qty);
    totalCogs += cogs;
    deductions.push({ bookId: item.bookId, qty: item.qty, cogs, details });
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
      const bc = (d?.details || []).map(x => ({ batchId: x.batchId, qty: x.qty, buyPrice: x.buyPrice }));
      return {
        bookId:    item.bookId,
        bookTitle: b?.title || '?',
        qty:       item.qty,
        cogs:      d?.cogs || 0,
        buyPrice:  d ? Math.round(d.cogs / item.qty) : 0,
        batchConsumption: bc,
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
  // Kembalikan stok tiap item — pakai batchConsumption per-item kalau ada
  let restoredToOrigin = 0, fallbackCount = 0;
  if (sale.bundleItems) {
    for (const item of sale.bundleItems) {
      const b = S.books.find(x => x.id === item.bookId);
      if (!b) continue;
      const avgBuyP = item.buyPrice || Math.round((item.cogs||0)/(item.qty||1));
      const hasBC = Array.isArray(item.batchConsumption) && item.batchConsumption.length > 0;
      const canRestoreToOrigin = hasBC && item.batchConsumption.every(bc =>
        b.batches.find(bt => String(bt.id) === String(bc.batchId))
      );
      if (canRestoreToOrigin) {
        for (const bc of item.batchConsumption) {
          const bt = b.batches.find(bt => String(bt.id) === String(bc.batchId));
          bt.remaining += bc.qty;
        }
        S.restocks.push({ id:uid(), bookId:b.id, bookTitle:b.title, qty:item.qty, buyPrice:avgBuyP, date:today(), note:`Retur bundle ke batch asal (trx tgl ${sale.date})` });
        restoredToOrigin++;
      } else {
        b.batches.push({ id:uid(), qty:item.qty, remaining:item.qty, buyPrice:avgBuyP, date:today(), note:`Retur bundle ${sale.date}` });
        S.restocks.push({ id:uid(), bookId:b.id, bookTitle:b.title, qty:item.qty, buyPrice:avgBuyP, date:today(), note:'Retur bundling' });
        fallbackCount++;
      }
    }
  }
  S.set.sales(S.sales.filter(s => s.id !== saleId));
  S.save();
  const msg = fallbackCount === 0
    ? `Bundle dihapus · stok dikembalikan ke batch asal ✓`
    : restoredToOrigin === 0
      ? `Bundle dihapus · stok dikembalikan ✓`
      : `Bundle dihapus · ${restoredToOrigin} ke batch asal, ${fallbackCount} batch baru ✓`;
  showToast(msg);
  _render();
}
