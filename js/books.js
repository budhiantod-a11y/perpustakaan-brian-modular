// ═══════════════════════════════════════════════════════════════════════════
// books.js — Book CRUD: add, edit, restock, delete
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { openModal, closeModal, showToast, uid, today, fmt, getNormalPrice, allPubs, allCats } from './helpers.js';
import { totalStock, avgBuy } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ── Add Book ─────────────────────────────────────────────────────────────────
export function openAddBook() {
  openModal(`
    <div class="modal-title">Tambah Buku Baru</div>
    <div class="inp-grid-2">
      <div class="field" style="grid-column:1/-1">
        <label>Judul Buku *</label>
        <input class="inp" id="f_title" placeholder="e.g. Laskar Pelangi">
      </div>
      <div class="field"><label>Penulis</label><input class="inp" id="f_author" placeholder="e.g. Andrea Hirata"></div>
      <div class="field"><label>Penerbit</label>
        <input class="inp" id="f_publisher" list="pub-dl" placeholder="e.g. Bentang Pustaka">
        <datalist id="pub-dl">${allPubs().map(p=>`<option value="${p}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Kategori</label>
        <input class="inp" id="f_category" list="cat-dl" placeholder="e.g. Fiksi">
        <datalist id="cat-dl">${allCats().map(c=>`<option value="${c}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Barcode / ISBN *</label><input class="inp" id="f_barcode" placeholder="e.g. 9786020651965"></div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-s);padding:14px;margin-bottom:4px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">💰 Harga</div>
      <div class="inp-grid-2">
        <div class="field" style="margin-bottom:0">
          <label>Harga Modal / Beli (Rp) *</label>
          <input class="inp" id="f_bp" type="number" placeholder="0">
          <div class="hint">Harga beli pertama kali</div>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Harga Normal / Jual (Rp) *</label>
          <input class="inp" id="f_sell" type="number" placeholder="0">
          <div class="hint">Default harga jual ke pembeli</div>
        </div>
      </div>
    </div>
    <div class="inp-grid-2" style="margin-top:8px">
      <div class="field"><label>Stok Awal (pcs)</label><input class="inp" id="f_stock" type="number" value="0"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="saveBook()">Simpan Buku</button>
    </div>`);
}

// ── Edit Book ────────────────────────────────────────────────────────────────
export function openEditBook(bookId) {
  const b = S.books.find(x => x.id === bookId);
  openModal(`
    <div class="modal-title">Edit Buku</div>
    <div class="inp-grid-2">
      <div class="field" style="grid-column:1/-1"><label>Judul Buku</label><input class="inp" id="f_title" value="${b.title}"></div>
      <div class="field"><label>Penulis</label><input class="inp" id="f_author" value="${b.author||''}"></div>
      <div class="field"><label>Penerbit</label>
        <input class="inp" id="f_publisher" value="${b.publisher||''}" list="pub-dl2">
        <datalist id="pub-dl2">${allPubs().map(p=>`<option value="${p}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Kategori</label>
        <input class="inp" id="f_category" value="${b.category||''}" list="cat-dl2">
        <datalist id="cat-dl2">${allCats().map(c=>`<option value="${c}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Barcode / ISBN</label><input class="inp" id="f_barcode" value="${b.barcode}"></div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-s);padding:14px;margin-bottom:4px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">💰 Harga</div>
      <div class="inp-grid-2">
        <div class="field" style="margin-bottom:0">
          <label>Harga Normal / Jual (Rp)</label>
          <input class="inp" id="f_sell" type="number" value="${b.normalPrice||b.sellPrice||0}">
          <div class="hint">Default harga jual ke pembeli</div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" onclick="updateBook(${bookId})">Simpan</button>
    </div>`);
}

// ── Save New Book ────────────────────────────────────────────────────────────
export function saveBook() {
  const v = k => document.getElementById('f_'+k)?.value?.trim();
  if (!v('title')||!v('barcode')||!v('sell')||!v('bp')) { showToast('Lengkapi field wajib (judul, barcode, harga modal, harga normal)!', 'err'); return; }
  if (S.books.find(b => b.barcode===v('barcode'))) { showToast('Barcode sudah ada!', 'err'); return; }
  const normalP = +v('sell');
  const buyP    = +v('bp')||0;
  if (normalP <= 0) { showToast('Harga normal harus lebih dari 0', 'err'); return; }
  if (buyP < 0) { showToast('Harga modal tidak boleh negatif', 'err'); return; }
  if (+v('stock') < 0) { showToast('Stok awal tidak boleh negatif', 'err'); return; }
  const book = { id:uid(), barcode:v('barcode'), title:v('title'), author:v('author'), publisher:v('publisher'), category:v('category'), normalPrice:normalP, sellPrice:normalP, batches:[] };
  if (+v('stock')>0) {
    book.batches.push({ id:uid(), qty:+v('stock'), remaining:+v('stock'), buyPrice:buyP, date:today() });
    S.restocks.push({ id:uid(), bookId:book.id, bookTitle:book.title, qty:+v('stock'), buyPrice:buyP, date:today() });
  }
  S.books.push(book); closeModal(); S.save(); showToast('Buku ditambahkan ✓'); _render();
}

// ── Update Existing Book ─────────────────────────────────────────────────────
export function updateBook(bookId) {
  const v = k => document.getElementById('f_'+k)?.value?.trim();
  const book = S.books.find(b => b.id===bookId);
  if (!v('title')||!v('barcode')) { showToast('Lengkapi field!', 'err'); return; }
  if (S.books.find(b => b.barcode===v('barcode') && b.id!==bookId)) { showToast('Barcode sudah dipakai!', 'err'); return; }
  const normalP = +v('sell')||0;
  Object.assign(book, { title:v('title'), author:v('author'), publisher:v('publisher'), category:v('category'), barcode:v('barcode'), normalPrice:normalP, sellPrice:normalP });
  closeModal(); S.save(); showToast('Buku diperbarui ✓'); _render();
}

// ── Restock ──────────────────────────────────────────────────────────────────
export function openAddRestock(bookId) {
  const book = S.books.find(b => b.id===bookId);
  openModal(`
    <div class="modal-title">Restock — ${book.title}</div>
    <div style="background:var(--accent-s);border-radius:var(--radius-s);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--accent)">
      Stok saat ini: <strong>${totalStock(book)} pcs</strong>
      ${book.batches.length ? ` &nbsp;·&nbsp; Harga beli terakhir: <strong>${fmt(book.batches[book.batches.length-1].buyPrice)}</strong>` : ''}
    </div>
    <div class="inp-grid-2">
      <div class="field"><label>Jumlah Masuk (pcs)</label><input class="inp" id="f_qty" type="number" min="1" value="1"></div>
      <div class="field">
        <label>Harga Modal / Beli per Pcs (Rp)</label>
        <input class="inp" id="f_bp" type="number" value="${avgBuy(book)||0}">
        <div class="hint">Boleh beda dari batch sebelumnya — FIFO tetap jalan</div>
      </div>
    </div>
    <div class="field"><label>Tanggal Masuk</label><input class="inp" id="f_date" type="date" value="${today()}" style="max-width:200px"></div>
    <div class="field hint" style="margin-top:-6px">Batch baru ini akan otomatis masuk antrian FIFO terbaru</div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Batal</button>
      <button class="btn btn-green" onclick="saveRestock(${bookId})">Tambah Restock</button>
    </div>`);
}

export function saveRestock(bookId) {
  const book = S.books.find(b => b.id===bookId);
  const qty = +document.getElementById('f_qty').value;
  const bp  = +document.getElementById('f_bp').value;
  const date = document.getElementById('f_date').value;
  if (!qty||!bp) { showToast('Lengkapi field!', 'err'); return; }
  if (qty <= 0) { showToast('Jumlah harus lebih dari 0', 'err'); return; }
  if (bp <= 0) { showToast('Harga modal harus lebih dari 0', 'err'); return; }
  book.batches.push({ id:uid(), qty, remaining:qty, buyPrice:bp, date });
  S.restocks.push({ id:uid(), bookId, bookTitle:book.title, qty, buyPrice:bp, date });
  closeModal(); S.save(); showToast(`+${qty} pcs batch baru ✓`); _render();
}

// ── Delete Book ──────────────────────────────────────────────────────────────
export function deleteBook(bookId) {
  const book = S.books.find(b => b.id === bookId);
  const hasSales = S.sales.some(s => s.bookId === bookId);
  const msg = hasSales
    ? `"${book.title}" masih punya ${S.sales.filter(s=>s.bookId===bookId).length} transaksi penjualan. Tetap hapus?`
    : `Hapus "${book.title}"?`;
  if (!confirm(msg)) return;
  S.set.books(S.books.filter(b => b.id !== bookId));
  S.save(); showToast('Buku dihapus'); _render();
}
