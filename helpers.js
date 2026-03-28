// ═══════════════════════════════════════════════════════════════════════════
// helpers.js — Formatting, date, ID gen, toast, modal, data helpers
// ═══════════════════════════════════════════════════════════════════════════
import { books } from './state.js';

export const fmt = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
export const today = () => new Date().toISOString().slice(0,10);
export const uid = () => Date.now() + Math.floor(Math.random()*1000);
export const getNormalPrice = b => b.normalPrice || b.sellPrice || 0;
export const allPubs = () => [...new Set(books.map(b=>b.publisher).filter(Boolean))].sort();
export const allCats = () => [...new Set(books.map(b=>b.category).filter(Boolean))].sort();

export function showToast(msg, type='ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.className = 'toast toast-'+type; t.style.display = 'block';
  clearTimeout(t._to); t._to = setTimeout(()=>t.style.display='none', 3000);
}

export function openModal(html) {
  closeModal();
  const d = document.createElement('div');
  d.className='modal-overlay'; d.id='modal';
  d.innerHTML=`<div class="modal">${html}</div>`;
  d.addEventListener('click', e=>{ if(e.target===d) closeModal(); });
  document.body.appendChild(d);
}

export function closeModal() { document.getElementById('modal')?.remove(); }
