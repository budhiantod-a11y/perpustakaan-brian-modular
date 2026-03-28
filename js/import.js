// ═══════════════════════════════════════════════════════════════════════════
// import.js — CSV/Excel import, template download
// ═══════════════════════════════════════════════════════════════════════════
import * as S from './state.js';
import { showToast, uid, today } from './helpers.js';

let _render = () => {};
export function init(renderFn) { _render = renderFn; }

export function downloadTemplate() {
  // Download as .xlsx using SheetJS if available, else fall back to CSV
  if (window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet([
      ['judul','penulis','penerbit','kategori','barcode','harga_beli','harga_normal','stok_awal'],
      ['Laskar Pelangi','Andrea Hirata','Bentang Pustaka','Sastra','9789799225589',58000,89000,20],
      ['Perahu Kertas','Dee Lestari','Bentang Pustaka','Fiksi','9789799222367',50000,79000,15],
      ['Filosofi Teras','Henry Manampiring','Kompas','Self-Help','9786024125356',65000,98000,10],
    ]);
    // Set column widths
    ws['!cols'] = [22,20,24,14,18,12,12,12].map(w=>({wch:w}));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Buku');
    window.XLSX.writeFile(wb, 'template-import-buku.xlsx');
    showToast('Template Excel (.xlsx) didownload ✓');
  } else {
    // Fallback CSV
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
    // ── Excel path via SheetJS ──
    if (!window.XLSX) {
      showToast('Memuat library Excel, coba lagi sebentar...', 'err');
      return;
    }
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
        S.set.importRows(rows);
        S.set.importDone(false);
        _render();
        showToast(`${S.importRows.length} baris berhasil dibaca dari Excel ✓`);
      } catch(err) {
        showToast('Gagal membaca file Excel: ' + err.message, 'err');
      }
    };
    reader.readAsArrayBuffer(file);

  } else {
    // ── CSV path ──
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
            const ch = line[i];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
            else cur += ch;
          }
          result.push(cur.trim());
          return result.map(v => v.replace(/^"|"$/g,''));
        }

        const dataRows = lines.slice(1).map(l => parseCSVLine(l));
        const rows = buildImportRows(rawHeaders, dataRows);
        if (!rows) return;
        S.set.importRows(rows);
        S.set.importDone(false);
        _render();
        showToast(`${S.importRows.length} baris berhasil dibaca dari CSV ✓`);
      } catch(err) {
        showToast('Gagal membaca file: ' + err.message, 'err');
      }
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
      // Add as new batch
      if (r.stokAwal > 0) {
        existing.batches.push({ id:uid(), qty:r.stokAwal, remaining:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
        S.restocks.push({ id:uid(), bookId:existing.id, bookTitle:existing.title, qty:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
      }
      batched++;
    } else {
      // New book
      const book = {
        id:uid(), barcode:r.barcode, title:r.judul, author:r.penulis,
        publisher:r.penerbit, category:r.kategori,
        normalPrice: r.hargaNormal||r.hargaJual||0,
        sellPrice: r.hargaNormal||r.hargaJual||0,
        batches:[]
      };
      if (r.stokAwal > 0) {
        book.batches.push({ id:uid(), qty:r.stokAwal, remaining:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
        S.restocks.push({ id:uid(), bookId:book.id, bookTitle:book.title, qty:r.stokAwal, buyPrice:r.hargaBeli||0, date:today() });
      }
      S.books.push(book);
      added++;
    }
  }
  S.save();
  S.set.importRows([]);
  S.set.importDone(true);
  showToast(`✓ ${added} buku baru · ${batched} batch ditambahkan`);
  _render();
}

