// ═══════════════════════════════════════════════════════════════════════════
// import.js — CSV/Excel import for books (stok) + bulk sales upload
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { showToast, uid, today, fmt, getNormalPrice } from './helpers.js';
import { totalStock, fifoDeduct, fifoSim } from './fifo.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING: Book/Stok Import (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

export function downloadTemplate() {
  if (window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet([
      ['judul','penulis','penerbit','kategori','barcode','harga_beli','harga_normal','stok_awal'],
      ['Laskar Pelangi','Andrea Hirata','Bentang Pustaka','Sastra','9789799225589',58000,89000,20],
      ['Perahu Kertas','Dee Lestari','Bentang Pustaka','Fiksi','9789799222367',50000,79000,15],
      ['Filosofi Teras','Henry Manampiring','Kompas','Self-Help','9786024125356',65000,98000,10],
    ]);
    ws['!cols'] = [22,20,24,14,18,12,12,12].map(w=>({wch:w}));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Buku');
    window.XLSX.writeFile(wb, 'template-import-buku.xlsx');
    showToast('Template Excel (.xlsx) didownload ✓');
  } else {
    const headers = ['judul','penulis','penerbit','kategori','barcode','harga_beli','harga_normal','stok_awal'];
    const examples = [
      ['Laskar Pelangi','Andrea Hirata','Bentang Pustaka','Sastra','9789799225589','58000','89000','20'],
      ['Perahu Kertas','Dee Lestari','Bentang Pustaka','Fiksi','9789799222367','50000','79000','15'],
      ['Filosofi Teras','Henry Manampiring','Kompas','Self-Help','9786024125356','65000','98000','10'],
    ];
    const csv = [headers.join(','), ...examples.map(r => r.map(v=>`"${v}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'}));
    a.download = 'template-import-buku.csv'; a.click();
    showToast('Template CSV didownload ✓');
  }
}

export function buildImportRows(rawHeaders, dataRows) {
  const COL = {
    judul:        rawHeaders.indexOf('judul'),
    penulis:      rawHeaders.indexOf('penulis'),
    penerbit:     rawHeaders.indexOf('penerbit'),
    kategori:     rawHeaders.indexOf('kategori'),
    barcode:      rawHeaders.indexOf('barcode'),
    harga_normal: rawHeaders.indexOf('harga_normal') >= 0 ? rawHeaders.indexOf('harga_normal') : rawHeaders.indexOf('harga_jual'),
    stok_awal:    rawHeaders.indexOf('stok_awal'),
    harga_beli:   rawHeaders.indexOf('harga_beli'),
  };

  if (COL.judul < 0 || COL.barcode < 0 || COL.harga_normal < 0) {
    showToast('Kolom wajib tidak ditemukan: judul, barcode, harga_normal (atau harga_jual)', 'err');
    return null;
  }

  const rows = dataRows.map((cells, idx) => {
    const get = col => col >= 0 ? String(cells[col] ?? '').trim() : '';
    const barcode      = get(COL.barcode);
    const judul        = get(COL.judul);
    const hargaNormal  = parseInt(get(COL.harga_normal).replace(/\D/g,'')) || 0;
    const stokAwal     = parseInt(get(COL.stok_awal).replace(/\D/g,''))    || 0;
    const hargaBeli    = parseInt(get(COL.harga_beli).replace(/\D/g,''))   || 0;

    const existing = S.books.find(b => b.barcode === barcode);
    let status = 'new', statusNote = 'Buku baru';
    if (existing) { status = 'batch'; statusNote = `Batch baru → "${existing.title}" (stok +${stokAwal})`; }
    if (!judul)      { status = 'error'; statusNote = 'Judul kosong'; }
    if (!barcode)    { status = 'error'; statusNote = 'Barcode kosong'; }
    if (!hargaNormal){ status = 'error'; statusNote = 'Harga normal tidak valid'; }

    return {
      _row: idx+2, _status: status, _note: statusNote,
      judul, penulis: get(COL.penulis), penerbit: get(COL.penerbit),
      kategori: get(COL.kategori), barcode, hargaNormal, stokAwal, hargaBeli,
      _checked: status !== 'error',
    };
  }).filter(r => r.judul || r.barcode);

  return rows;
}

export function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const isXLSX = /\.(xlsx|xls|ods)$/i.test(file.name);
  if (isXLSX) {
    if (!window.XLSX) { showToast('Memuat library Excel, coba lagi sebentar...', 'err'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb    = window.XLSX.read(e.target.result, { type: 'array' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const data  = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (data.length < 2) { showToast('File kosong atau tidak valid', 'err'); return; }
        const rawHeaders = data[0].map(h => String(h).trim().toLowerCase());
        const rows = buildImportRows(rawHeaders, data.slice(1));
        if (!rows) return;
        S.set.importRows(rows); S.set.importDone(false); _render();
        showToast(`${S.importRows.length} baris berhasil dibaca dari Excel ✓`);
      } catch(err) { showToast('Gagal membaca file Excel: ' + err.message, 'err'); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result.replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { showToast('File kosong atau tidak valid', 'err'); return; }
        const rawHeaders = lines[0].split(',').map(h => h.replace(/^"|"$/g,'').trim().toLowerCase());
        function parseCSVLine(line) {
          const result = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]; if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
            else cur += ch;
          }
          result.push(cur.trim());
          return result.map(v => v.replace(/^"|"$/g,''));
        }
        const dataRows = lines.slice(1).map(l => parseCSVLine(l));
        const rows = buildImportRows(rawHeaders, dataRows);
        if (!rows) return;
        S.set.importRows(rows); S.set.importDone(false); _render();
        showToast(`${S.importRows.length} baris berhasil dibaca dari CSV ✓`);
      } catch(err) { showToast('Gagal membaca file: ' + err.message, 'err'); }
    };
    reader.readAsText(file, 'UTF-8');
  }
}

export function toggleImportRow(idx) {
  if (S.importRows[idx]._status === 'error') return;
  S.importRows[idx]._checked = !S.importRows[idx]._checked;
  _render();
}

export function commitImport() {
  const toProcess = S.importRows.filter(r => r._checked && r._status !== 'error');
  if (!toProcess.length) { showToast('Tidak ada baris yang dipilih', 'err'); return; }
  let added=0, batched=0;
  for (const r of toProcess) {
    const existing = S.books.find(b => b.barcode === r.barcode);
    if (existing) {
      if (r.stokAwal > 0) {
        existing.batches.push({ id:uid(), qty:r.stokAwal, remaining:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
        S.restocks.push({ id:uid(), bookId:existing.id, bookTitle:existing.title, qty:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
      }
      batched++;
    } else {
      const book = {
        id:uid(), barcode:r.barcode, title:r.judul, author:r.penulis,
        publisher:r.penerbit, category:r.kategori,
        normalPrice: r.hargaNormal||r.hargaJual||0, sellPrice: r.hargaNormal||r.hargaJual||0, batches:[]
      };
      if (r.stokAwal > 0) {
        book.batches.push({ id:uid(), qty:r.stokAwal, remaining:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
        S.restocks.push({ id:uid(), bookId:book.id, bookTitle:book.title, qty:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
      }
      S.books.push(book); added++;
    }
  }
  S.save(); S.set.importRows([]); S.set.importDone(true);
  showToast(`✓ ${added} buku baru · ${batched} batch ditambahkan`); _render();
}


// ═══════════════════════════════════════════════════════════════════════════
// NEW: Bulk Sales Upload (inline panel, same pattern as stok import)
// ═══════════════════════════════════════════════════════════════════════════

export function downloadBulkSalesTemplate() {
  if (window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet([
      ['barcode','qty','harga_jual','tanggal','catatan','customer'],
      ['9789799225589', 2, 45000, '2026-04-20', 'diskon event', 'Budi Santoso'],
      ['9789799222367', 1, '',    '2026-04-20', '',             'Budi Santoso'],
      ['9786024125356', 3, 85000, '2026-04-20', 'promo bundel', 'Ani 2'],
    ]);
    ws['!cols'] = [18, 8, 14, 14, 24, 20].map(w => ({ wch: w }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Penjualan');
    window.XLSX.writeFile(wb, 'template-bulk-penjualan.xlsx');
    showToast('Template Excel (.xlsx) didownload ✓');
  } else {
    const headers = ['barcode','qty','harga_jual','tanggal','catatan','customer'];
    const examples = [
      ['9789799225589','2','45000','2026-04-20','diskon event','Budi Santoso'],
      ['9789799222367','1','','2026-04-20','','Budi Santoso'],
      ['9786024125356','3','85000','2026-04-20','promo bundel','Ani 2'],
    ];
    const csv = [headers.join(','), ...examples.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'template-bulk-penjualan.csv'; a.click();
    showToast('Template CSV didownload ✓');
  }
}

export function handleBulkSalesFile(input) {
  const file = input.files[0];
  if (!file) return;
  const isXLSX = /\.(xlsx|xls|ods)$/i.test(file.name);
  if (isXLSX) {
    if (!window.XLSX) { showToast('Memuat library Excel, coba lagi sebentar...', 'err'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = window.XLSX.read(e.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (data.length < 2) { showToast('File kosong atau tidak valid', 'err'); return; }
        const rawHeaders = data[0].map(h => String(h).trim().toLowerCase());
        const parsed = buildBulkSalesRows(rawHeaders, data.slice(1));
        if (!parsed) return;
        S.set.bulkSalesRows(parsed); S.set.bulkSalesDone(false); _render();
        showToast(`${parsed.length} baris berhasil dibaca ✓`);
      } catch (err) { showToast('Gagal membaca file Excel: ' + err.message, 'err'); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result.replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { showToast('File kosong atau tidak valid', 'err'); return; }
        const sep = file.name.endsWith('.tsv') ? '\t' : ',';
        const rawHeaders = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
        function parseCSVLine(line) {
          const result = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]; if (ch === '"') { inQ = !inQ; }
            else if (ch === sep && !inQ) { result.push(cur.trim()); cur = ''; }
            else cur += ch;
          }
          result.push(cur.trim());
          return result.map(v => v.replace(/^"|"$/g, ''));
        }
        const dataRows = lines.slice(1).map(l => parseCSVLine(l));
        const parsed = buildBulkSalesRows(rawHeaders, dataRows);
        if (!parsed) return;
        S.set.bulkSalesRows(parsed); S.set.bulkSalesDone(false); _render();
        showToast(`${parsed.length} baris berhasil dibaca ✓`);
      } catch (err) { showToast('Gagal membaca file: ' + err.message, 'err'); }
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function buildBulkSalesRows(rawHeaders, dataRows) {
  const COL = {
    barcode:    rawHeaders.indexOf('barcode'),
    qty:        rawHeaders.indexOf('qty'),
    harga_jual: rawHeaders.indexOf('harga_jual'),
    tanggal:    rawHeaders.indexOf('tanggal'),
    catatan:    rawHeaders.indexOf('catatan'),
    customer:   rawHeaders.indexOf('customer'),
  };
  if (COL.barcode < 0 || COL.qty < 0) {
    showToast('Kolom wajib tidak ditemukan: barcode, qty', 'err'); return null;
  }
  const stockTracker = {};
  S.books.forEach(b => { if (b.barcode) stockTracker[b.barcode] = { book: b, available: totalStock(b) }; });

  return dataRows.map((cells, idx) => {
    const get = col => col >= 0 ? String(cells[col] ?? '').trim() : '';
    const getRaw = col => col >= 0 ? cells[col] : '';
    const barcode = get(COL.barcode), qtyRaw = get(COL.qty), priceRaw = get(COL.harga_jual);
    const catatan = get(COL.catatan);
    const customer = get(COL.customer);
    if (!barcode && !qtyRaw) return null;

    // ── Fix tanggal: handle Excel serial number, Date object, string ──
    let tanggal = null;
    const rawDate = getRaw(COL.tanggal);
    if (rawDate) {
      if (typeof rawDate === 'number' && rawDate > 30000 && rawDate < 100000) {
        // Excel serial date → convert to JS Date
        // Excel epoch is 1899-12-30, serial 1 = 1900-01-01
        const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
        tanggal = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      } else if (rawDate instanceof Date) {
        tanggal = rawDate.getFullYear()+'-'+String(rawDate.getMonth()+1).padStart(2,'0')+'-'+String(rawDate.getDate()).padStart(2,'0');
      } else {
        const s = String(rawDate).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          tanggal = s;
        } else {
          // Try parsing as Date string (e.g. "4/21/2026", "21 Apr 2026")
          const parsed = new Date(s);
          if (!isNaN(parsed)) {
            tanggal = parsed.getFullYear()+'-'+String(parsed.getMonth()+1).padStart(2,'0')+'-'+String(parsed.getDate()).padStart(2,'0');
          }
        }
      }
    }

    const qty = parseInt(String(qtyRaw).replace(/\D/g, '')) || 0;
    const hargaJual = priceRaw ? (parseInt(String(priceRaw).replace(/\D/g, '')) || null) : null;
    const r = { _row: idx+2, _status:'valid', _error:'', _book:null, _checked:true, barcode, qty, harga_jual:hargaJual, tanggal:tanggal, catatan:catatan||'', customer:customer||'' };

    if (!barcode) { r._status='error'; r._error='Barcode kosong'; r._checked=false; return r; }
    const entry = stockTracker[barcode];
    if (!entry) { r._status='error'; r._error='Barcode tidak ditemukan'; r._checked=false; return r; }
    r._book = entry.book;
    if (qty <= 0) { r._status='error'; r._error='Qty harus > 0'; r._checked=false; return r; }
    if (qty > entry.available) { r._status='error'; r._error=`Stok tidak cukup (sisa: ${entry.available})`; r._checked=false; return r; }
    entry.available -= qty;

    if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) { r._status='warning'; r._error='Format tanggal salah → pakai hari ini'; r.tanggal=null; }
    if (hargaJual !== null && hargaJual <= 0) { r._status='warning'; r._error='Harga jual ≤ 0 → pakai harga normal'; r.harga_jual=null; }
    if (hargaJual !== null && r._book && r._status === 'valid') {
      const { cogs } = fifoSim(r._book, qty);
      const hpp = qty > 0 ? Math.round(cogs / qty) : 0;
      if (hargaJual < hpp) { r._status='warning'; r._error=`Harga < modal (${fmt(hpp)}/pcs)`; }
    }
    return r;
  }).filter(Boolean);
}

export function toggleBulkSalesRow(idx) {
  if (S.bulkSalesRows[idx]._status === 'error') return;
  S.bulkSalesRows[idx]._checked = !S.bulkSalesRows[idx]._checked;
  _render();
}

export function processBulkSales() {
  const toProcess = S.bulkSalesRows.filter(r => r._checked && r._status !== 'error');
  if (!toProcess.length) { showToast('Tidak ada transaksi yang dipilih', 'err'); return; }

  const stockCheck = {};
  S.books.forEach(b => { if (b.barcode) stockCheck[b.barcode] = { book: b, available: totalStock(b) }; });

  // Pre-pass: count customer name occurrences (case-insensitive, trimmed).
  // Customer yang muncul > 1x di batch ini → assign satu groupId bareng.
  const custCount = {};
  for (const row of toProcess) {
    const key = (row.customer || '').toLowerCase().trim();
    if (!key) continue;
    custCount[key] = (custCount[key] || 0) + 1;
  }
  const custGroupId = {};
  Object.keys(custCount).forEach(key => {
    if (custCount[key] > 1) custGroupId[key] = 'mg_' + uid();
  });

  const processed = [], skipped = [];
  for (const row of toProcess) {
    const entry = stockCheck[row.barcode];
    if (!entry || row.qty > entry.available) { skipped.push({ row: row._row, reason: 'Stok tidak cukup saat proses' }); continue; }

    const book = entry.book, normalP = getNormalPrice(book);
    const finP = row.harga_jual || normalP, date = row.tanggal || today();
    const note = row.catatan || '', isDiskon = finP !== normalP;
    const { cogs } = fifoDeduct(book.id, row.qty);
    const profit = row.qty * finP - cogs;
    entry.available -= row.qty;

    const custKey = (row.customer || '').toLowerCase().trim();
    const groupId = custKey ? custGroupId[custKey] : null;

    S.sales.push({
      id: uid(), bookId: book.id, bookTitle: book.title, qty: row.qty,
      buyPrice: Math.round(cogs / row.qty), normalPrice: normalP, sellPrice: normalP,
      finalPrice: finP, finalSellPrice: finP, cogs, profit, date,
      via: 'bulk', priceOverride: isDiskon,
      note: note || (isDiskon ? 'bulk upload (harga event)' : 'bulk upload'),
      customer: row.customer || '',
      ...(groupId ? { groupId } : {}),
    });
    processed.push({ row: row._row, title: book.title, qty: row.qty });
  }

  S.save(); S.set.bulkSalesRows([]); S.set.bulkSalesDone(true); _render();

  if (skipped.length > 0) {
    showToast(`${processed.length} transaksi berhasil, ${skipped.length} dilewati`, 'ok');
    setTimeout(() => alert(`⚠️ ${skipped.length} baris dilewati:\n\n${skipped.map(s => `Baris ${s.row}: ${s.reason}`).join('\n')}`), 500);
  } else {
    showToast(`✓ ${processed.length} transaksi bulk berhasil diproses!`);
  }
}
