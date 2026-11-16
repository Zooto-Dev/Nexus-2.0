/* Nexus 2.0 — size-wise items (sole, silicon patta, strap, insole …).
   Some things are made one per shoe size: a sole for size 6 is a different item from a sole for size 7,
   with its own stock, its own purchase order and its own price. Creating each one by hand is wasted work,
   so an item type can be marked "size-wise": the item is then built once and the size run makes the rest.
   On a job card such an item lands one row per size of the order, with that size's own quantity. */
'use strict';

const SIZE_TAG = 'SIZE';
// "6-10" · "1-7" · "6,7,8" · "6-10,12" — a range walks in whole steps, or half steps when asked
function sizeRunList(txt, half) {
  const out = [];
  const step = half ? 0.5 : 1;
  const clean = n => String(Math.round(n * 2) / 2).replace(/\.0$/, '');
  String(txt || '').split(/[,\s]+/).filter(Boolean).forEach(part => {
    // 6-10, 6 to 10, and the master's own 6X10 all mean the same run
    const m = /^(\d+(?:\.\d+)?)\s*(?:-|to|–|x)\s*(\d+(?:\.\d+)?)$/i.exec(part);
    if (m) {
      let a = parseFloat(m[1]), b = parseFloat(m[2]);
      if (!(a > 0) || !(b > 0)) return;
      if (a > b) { const t = a; a = b; b = t; }
      for (let v = a, g = 0; v <= b + 1e-9 && g < 200; v += step, g++) out.push(clean(v));
      return;
    }
    if (/^\d+(\.\d+)?$/.test(part)) out.push(clean(parseFloat(part)));
  });
  return Array.from(new Set(out)).sort((a, b) => parseFloat(a) - parseFloat(b));
}
// SIZE RUN is what makes an item size-wise: a type that has it is built one item per size.
// The run is typed (or picked) once instead of being one more value in the name.
const isRunAttr = a => /\bSIZE\s*RUN\b/i.test(String(a && a.name || ''));
const sizedType = t => !!(t && (t.sized || (t.attrs || []).some(n => isRunAttr({ name: n }))));
// the runs already in the SIZE RUN master, offered as a list before anyone types one
function runOptions(t) {
  if (!t) return [];
  const a = catAttrs(t.category).find(x => isRunAttr(x) && (t.attrs || []).some(n => norm(n) === norm(x.name)));
  return a ? (a.values || []).slice() : [];
}
const sizedAttrs = (t, list) => sizedType(t) ? list.filter(a => !isRunAttr(a)) : list;
const sizeOf = m => String((m && m.size) || '').trim();
const isSizedMat = m => !!sizeOf(m);
// one name per size: the base name with the size written at the end
const sizedName = (base, size) => (base + ' ' + SIZE_TAG + ' ' + size).replace(/\s+/g, ' ').trim().toUpperCase();
// every size of the same item, newest naming or old
const sizeFamily = key => Store.all('materials').filter(m => m.size_key && m.size_key === key).sort((a, b) => parseFloat(sizeOf(a)) - parseFloat(sizeOf(b)));
const sizeSibling = (key, size) => Store.all('materials').find(m => m.size_key === key && String(sizeOf(m)) === String(size)) || null;
const sizeLabel = m => isSizedMat(m) ? sizeOf(m) : '';
