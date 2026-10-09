/* Nexus 2.0 — Development › Item Creation.
   Every category owns its attributes, each with a fixed sequence number. An item's name is always
   ITEM TYPE + attribute values in that category sequence, so the same material cannot be named two
   ways and cannot be created twice. Attributes, values and item types are data managed in
   Item Category Configuration; only the first-run footwear defaults live in code. */
'use strict';

const IC_UI = { cat: '', type: '', vals: {}, extra: {}, dims: {}, scat: '', editAttr: null, editType: null, newCats: [] };
const icSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const squash = s => norm(s).replace(/[^a-z0-9.]/g, '');

function itemCats() {
  const s = new Set(ITEM_CATS);
  Store.all('item_types').forEach(t => { if (t.category) s.add(t.category); });
  Store.all('attributes').forEach(a => { if (a.category) s.add(a.category); });
  IC_UI.newCats.forEach(c => s.add(c));
  return Array.from(s).sort();
}
function catAttrs(cat) { return Store.all('attributes').filter(a => norm(a.category || '') === norm(cat)).sort((a, b) => (a.seq || 0) - (b.seq || 0)); }
function typesOf(cat) { return Store.all('item_types').filter(t => norm(t.category) === norm(cat)).sort((a, b) => a.name.localeCompare(b.name)); }
function usesAttr(t, name) { return (t.attrs || []).some(x => norm(x) === norm(name)); }
// the attributes a type uses, always in the category sequence (never in the order they were ticked)
function typeAttrs(t) { return catAttrs(t.category).filter(a => usesAttr(t, a.name)); }
// an attribute can depend on another one ("only when FOAM = WITH FOAM"); otherwise it is always asked
function attrOn(a, vals, t) { return !a.when_attr || (t && !usesAttr(t, a.when_attr)) || norm(vals[a.when_attr] || '') === norm(a.when_val || ''); }
function activeAttrs(t, vals) { return typeAttrs(t).filter(a => attrOn(a, vals, t)); }
function whenLabel(a) { return a.when_attr ? a.when_attr + ' = ' + a.when_val : ''; }
// "nothing" values (NONE, NA, NO FOAM, WITHOUT …) stay in the item's attributes but are left out of its name
const blankVal = v => /^(NONE|NA|N\/A|NIL|NO|NO .+|WITHOUT .+)$/.test(String(v || '').trim().toUpperCase().replace(/\s+/g, ' '));
// how an attribute is filled: one value from its list, several values (a foxing in up to 5 colours),
// a brand from CDB, an article from the Articles master, or a size typed as length × width × height
const AT_KINDS = [['list', 'One value'], ['multi', 'Many values'], ['brand', 'Brand (CDB)'], ['article', 'Article (Articles master)'], ['dims', 'Size L × W × H']];
const AT_MAX = 5, DIM_UNITS = ['MM', 'CM', 'INCH'];
const atKind = a => a.kind || 'list';
const atMax = a => Math.max(1, num(a.max) || AT_MAX);
const atKindLabel = a => (AT_KINDS.find(k => k[0] === atKind(a)) || AT_KINDS[0])[1] + (atKind(a) === 'multi' ? ' (up to ' + atMax(a) + ')' : '');
function atValues(a, vals, t) {
  const k = atKind(a);
  if (k === 'brand') return Store.all('customers').map(c => String(c.name || '').trim().toUpperCase()).filter(Boolean).sort();
  if (k === 'article') {
    // only the articles of the brand chosen above (articles without a brand are shown for every brand)
    const b = t ? typeAttrs(t).find(x => atKind(x) === 'brand' && vals[x.name]) : null; const bv = b ? vals[b.name] : '';
    return Store.all('items').filter(i => !bv || !i.brand || norm(i.brand) === norm(bv)).map(i => String(i.code || '').trim().toUpperCase()).filter(Boolean).sort();
  }
  if (isColourAttr(a)) return Array.from(new Set((a.values || []).concat(Object.keys(COLOUR_LIB))));
  return a.values || [];
}
/* ---- colour swatch grid: colour attributes are picked from coloured boxes grouped by family ---- */
// every colour attribute offers this library (about 290 named colours) on top of its own values
const COLOUR_LIB = {'ALICE BLUE': '#f0f8ff', 'AMBER': '#ffbf00', 'ANTHRACITE': '#383e42', 'ANTIQUE GOLD': '#b5a642', 'ANTIQUE WHITE': '#faebd7', 'APPLE GREEN': '#8db600', 'APRICOT': '#fbceb1', 'AQUA': '#00ffff', 'AQUAMARINE': '#7fffd4', 'ARMY GREEN': '#4b5320', 'ASH': '#b2beb5', 'AUBERGINE': '#3d0734', 'AZURE': '#f0ffff', 'BABY BLUE': '#89cff0', 'BABY PINK': '#f4c2c2', 'BEIGE': '#d9c3a0', 'BISCUIT': '#d8b98b', 'BISQUE': '#ffe4c4', 'BLACK': '#000000', 'BLANCHED ALMOND': '#ffebcd', 'BLOOD RED': '#8a0303', 'BLUE': '#1e66d0', 'BLUE VIOLET': '#8a2be2', 'BLUSH': '#de5d83', 'BLUSH PINK': '#fe828c', 'BOTTLE GREEN': '#006a4e', 'BRICK RED': '#9c3a2b', 'BRONZE': '#a97142', 'BROWN': '#795548', 'BUBBLEGUM': '#ffc1cc', 'BURGUNDY': '#800020', 'BURLYWOOD': '#deb887', 'BURNT ORANGE': '#cc5500', 'BUTTER': '#fbe7a1', 'CADET BLUE': '#5f9ea0', 'CAMEL': '#c19a6b', 'CAMOUFLAGE': '#78866b', 'CANARY': '#ffef00', 'CANDY PINK': '#e4717a', 'CARDINAL': '#c41e3a', 'CERULEAN': '#007ba7', 'CHAMPAGNE': '#f7e7ce', 'CHARCOAL': '#36454f', 'CHARTREUSE': '#7fff00', 'CHERRY': '#b11226', 'CHOCOLATE': '#d2691e', 'CINNAMON': '#a0522d', 'COBALT': '#0047ab', 'COFFEE': '#6f4e37', 'COGNAC': '#9a463d', 'COPPER': '#b87333', 'CORAL': '#ff7f50', 'CORAL PINK': '#f88379', 'CORNFLOWER BLUE': '#6495ed', 'CORNSILK': '#fff8dc', 'CREAM': '#f3e5c0', 'CRIMSON': '#dc143c', 'CRYSTAL': '#e8f4f8', 'CYAN': '#00ffff', 'DARK BLUE': '#00008b', 'DARK BROWN': '#4e342e', 'DARK CYAN': '#008b8b', 'DARK DENIM': '#1f3a5f', 'DARK GOLDENROD': '#b8860b', 'DARK GRAY': '#a9a9a9', 'DARK GREEN': '#006400', 'DARK GREY': '#555555', 'DARK KHAKI': '#bdb76b', 'DARK MAGENTA': '#8b008b', 'DARK OLIVEGREEN': '#556b2f', 'DARK ORANGE': '#ff8c00', 'DARK ORCHID': '#9932cc', 'DARK PINK': '#c2185b', 'DARK PURPLE': '#301934', 'DARK RED': '#8b0000', 'DARK SALMON': '#e9967a', 'DARK SEA GREEN': '#8fbc8f', 'DARK SLATE BLUE': '#483d8b', 'DARK SLATE GRAY': '#2f4f4f', 'DARK TURQUOISE': '#00ced1', 'DARK VIOLET': '#9400d3', 'DEEP PINK': '#ff1493', 'DEEP SKY BLUE': '#00bfff', 'DENIM': '#1560bd', 'DIM GRAY': '#696969', 'DODGER BLUE': '#1e90ff', 'DOVE GREY': '#8f8f8f', 'DUCK EGG': '#96c8c2', 'DUSTY PINK': '#d58a94', 'DUSTY ROSE': '#c08081', 'ECRU': '#e8dcc2', 'EGGPLANT': '#614051', 'ELECTRIC BLUE': '#0892d0', 'EMERALD': '#50c878', 'ESPRESSO': '#4b3426', 'FIREBRICK': '#b22222', 'FLAMINGO': '#fc8eac', 'FLORAL WHITE': '#fffaf0', 'FOREST': '#0b5d1e', 'FOREST GREEN': '#228b22', 'FUCHSIA': '#ff00ff', 'GAINSBORO': '#dcdcdc', 'GHOST WHITE': '#f8f8ff', 'GLITTER': '#c9c0bb', 'GOLD': '#ffd700', 'GOLDENROD': '#daa520', 'GRAPE': '#6f2da8', 'GRAPHITE': '#41424c', 'GRAY': '#808080', 'GREEN': '#2e9d4a', 'GREEN YELLOW': '#adff2f', 'GREY': '#9e9e9e', 'GUNMETAL': '#53565b', 'HAZEL': '#8e7618', 'HOLOGRAPHIC': '#c8d4e8', 'HONEY': '#e8b24a', 'HONEYDEW': '#f0fff0', 'HOT PINK': '#ff69b4', 'HUNTER GREEN': '#355e3b', 'ICE BLUE': '#d6ecef', 'INDIAN RED': '#cd5c5c', 'INDIGO': '#4b0082', 'INK BLUE': '#1c2a48', 'IVORY': '#fffff0', 'JADE': '#00a86b', 'JET BLACK': '#0a0a0a', 'KHAKI': '#b9a77a', 'KHAKI GREEN': '#8a865d', 'LATTE': '#c5a582', 'LAVENDER': '#e6e6fa', 'LAVENDER BLUSH': '#fff0f5', 'LAWN GREEN': '#7cfc00', 'LEMON': '#fff44f', 'LEMON CHIFFON': '#fffacd', 'LEOPARD': '#c8a165', 'LIGHT BLUE': '#add8e6', 'LIGHT CORAL': '#f08080', 'LIGHT CYAN': '#e0ffff', 'LIGHT DENIM': '#6f8fbf', 'LIGHT GOLDENROD YELLOW': '#fafad2', 'LIGHT GRAY': '#d3d3d3', 'LIGHT GREEN': '#90ee90', 'LIGHT GREY': '#cfcfcf', 'LIGHT PINK': '#ffb6c1', 'LIGHT SALMON': '#ffa07a', 'LIGHT SEA GREEN': '#20b2aa', 'LIGHT SKY BLUE': '#87cefa', 'LIGHT SLATE GRAY': '#778899', 'LIGHT STEEL BLUE': '#b0c4de', 'LIGHT YELLOW': '#ffffe0', 'LILAC': '#c8a2c8', 'LIME': '#b5e61d', 'LIME GREEN': '#32cd32', 'LINEN': '#faf0e6', 'MAGENTA': '#ff00ff', 'MAGENTA PINK': '#cc338b', 'MANGO': '#ffa62b', 'MAROON': '#7b1e2b', 'MARSALA': '#964f4c', 'MATT BLACK': '#1e1e1e', 'MAUVE': '#e0b0ff', 'MEDIUM AQUAMARINE': '#66cdaa', 'MEDIUM BLUE': '#0000cd', 'MEDIUM ORCHID': '#ba55d3', 'MEDIUM PURPLE': '#9370db', 'MEDIUM SEA GREEN': '#3cb371', 'MEDIUM SLATE BLUE': '#7b68ee', 'MEDIUM SPRING GREEN': '#00fa9a', 'MEDIUM TURQUOISE': '#48d1cc', 'MEDIUM VIOLET RED': '#c71585', 'METALLIC GOLD': '#d4af37', 'METALLIC SILVER': '#a8a9ad', 'MID GREY': '#808080', 'MIDNIGHT BLUE': '#191970', 'MILITARY GREEN': '#667c3e', 'MINT': '#98e0c0', 'MINT CREAM': '#f5fffa', 'MISTY ROSE': '#ffe4e1', 'MOCCASIN': '#ffe4b5', 'MOCHA': '#7b5d4a', 'MOSS': '#8a9a5b', 'MULTI': '#999999', 'MUSHROOM': '#a69886', 'MUSTARD': '#d4a017', 'NATURAL': '#e6d5b8', 'NAVAJO WHITE': '#ffdead', 'NAVY': '#000080', 'NAVY BLUE': '#000080', 'NEON GREEN': '#39ff14', 'NEON MULTI': '#999999', 'NEON ORANGE': '#ff5f1f', 'NEON PINK': '#ff3fa4', 'NEON YELLOW': '#ffff33', 'NUDE': '#e3bc9a', 'OATMEAL': '#d8cbb0', 'OCHRE': '#cc7722', 'OFF WHITE': '#f4f1e8', 'OLD LACE': '#fdf5e6', 'OLIVE': '#6b7a2a', 'OLIVE DRAB': '#6b8e23', 'OLIVE GREEN': '#708238', 'ONION PINK': '#e7b7c2', 'OPTIC WHITE': '#fbfcff', 'ORANGE': '#fb8c00', 'ORANGE RED': '#ff4500', 'ORCHID': '#da70d6', 'OXBLOOD': '#4a0000', 'PALE GOLDENROD': '#eee8aa', 'PALE GREEN': '#98fb98', 'PALE TURQUOISE': '#afeeee', 'PALE VIOLET RED': '#db7093', 'PAPAYA WHIP': '#ffefd5', 'PARROT GREEN': '#12ad2b', 'PEACH': '#ffcba4', 'PEACH PUFF': '#ffdab9', 'PEACOCK BLUE': '#016795', 'PEARL WHITE': '#f8f6f0', 'PERIWINKLE': '#ccccff', 'PERU': '#cd853f', 'PETROL': '#005f6a', 'PEWTER': '#899499', 'PINE': '#01796f', 'PINK': '#ec5f97', 'PISTA': '#93c572', 'PISTA GREEN': '#93c572', 'PLATINUM': '#e5e4e2', 'PLUM': '#dda0dd', 'POPPY RED': '#e35335', 'POWDER BLUE': '#b0e0e6', 'PRINTED': '#999999', 'PRUSSIAN BLUE': '#003153', 'PUMPKIN': '#ff7518', 'PURPLE': '#7b1fa2', 'RANI PINK': '#e5097f', 'REBECCA PURPLE': '#663399', 'RED': '#d32f2f', 'ROSE': '#e8a0b0', 'ROSE GOLD': '#b76e79', 'ROSY BROWN': '#bc8f8f', 'ROYAL BLUE': '#4169e1', 'ROYAL PURPLE': '#7851a9', 'RUBY': '#9b111e', 'RUST': '#b7410e', 'SADDLE BROWN': '#8b4513', 'SAGE': '#9caf88', 'SALMON': '#fa8072', 'SAND': '#c2b280', 'SANDY BROWN': '#f4a460', 'SCARLET': '#ff2400', 'SEA FOAM': '#93e9be', 'SEA GREEN': '#2e8b57', 'SEASHELL': '#fff5ee', 'SIENNA': '#a0522d', 'SILVER': '#c0c0c0', 'SILVER GREY': '#b6b6b4', 'SKIN': '#e6b89c', 'SKY BLUE': '#87ceeb', 'SLATE': '#708090', 'SLATE BLUE': '#6a5acd', 'SLATE GRAY': '#708090', 'SNAKE': '#9b8d6a', 'SNOW': '#fffafa', 'SOFT WHITE': '#f5f5f0', 'SPRING GREEN': '#00ff7f', 'STEEL BLUE': '#4682b4', 'STEEL GREY': '#71797e', 'STONE': '#a39e93', 'TAN': '#c8a165', 'TANGERINE': '#f28500', 'TAUPE': '#8b7d6b', 'TEAL': '#008080', 'TERRACOTTA': '#e2725b', 'THISTLE': '#d8bfd8', 'TIE DYE': '#999999', 'TIFFANY': '#0abab5', 'TOBACCO': '#71543b', 'TOMATO': '#ff6347', 'TOMATO RED': '#ff4d2e', 'TRANSPARENT': '#ffffff', 'TURQUOISE': '#40e0d0', 'VIOLET': '#ee82ee', 'WALNUT': '#773f1a', 'WATERMELON': '#fc6c85', 'WHEAT': '#f5deb3', 'WHITE': '#ffffff', 'WHITE SMOKE': '#f5f5f5', 'WINE': '#722f37', 'YELLOW': '#fdd835', 'YELLOW GREEN': '#9acd32', 'ZEBRA': '#777777'};
const isColourAttr = a => /COLOU?RS?\b/.test(String(a.name || '').toUpperCase());
const SW_HEX = { BLACK: '#1b1b1b', WHITE: '#ffffff', 'OFF WHITE': '#f4f1e8', IVORY: '#fffbea', CREAM: '#f3e5c0', BEIGE: '#d9c3a0', NUDE: '#e3bc9a', TAN: '#c8a165', CAMEL: '#c19a6b', KHAKI: '#b9a77a', TAUPE: '#8b7d6b', STONE: '#a39e93', NATURAL: '#e6d5b8',
  BROWN: '#795548', 'DARK BROWN': '#4e342e', COFFEE: '#6f4e37', RUST: '#b7410e', NAVY: '#1f2a5a', BLUE: '#1e66d0', 'SKY BLUE': '#87ceeb', TEAL: '#00808a', TURQUOISE: '#30c5c5', MINT: '#98e0c0',
  GREY: '#9e9e9e', 'DARK GREY': '#555', 'LIGHT GREY': '#cfcfcf', CHARCOAL: '#36454f', GUNMETAL: '#53565b', RED: '#d32f2f', MAROON: '#7b1e2b', WINE: '#722f37', CHERRY: '#b11226',
  PINK: '#ec5f97', 'DARK PINK': '#c2185b', 'LIGHT PINK': '#f8bbd0', 'NEON PINK': '#ff3fa4', PEACH: '#ffcba4', LILAC: '#c8a2c8', PURPLE: '#7b1fa2', YELLOW: '#fdd835', 'LIGHT YELLOW': '#fff59d', MUSTARD: '#d4a017',
  ORANGE: '#fb8c00', GREEN: '#2e9d4a', 'LIGHT GREEN': '#a5d6a7', 'PISTA GREEN': '#93c572', OLIVE: '#6b7a2a', LIME: '#b5e61d', 'NEON GREEN': '#39ff14',
  SILVER: '#c0c0c0', GOLD: '#d4af37', 'ROSE GOLD': '#b76e79', BRONZE: '#a97142', COPPER: '#b87333' };
// family order and the words that put a shade in it ("RED 101", "DARK RED" -> RED)
const SW_FAM = [['BLACK', /BLACK|CHARCOAL|JET/], ['WHITE', /WHITE|IVORY/], ['GREY', /GR[AE]Y|GUNMETAL|ASH|SMOKE/], ['BEIGE', /BEIGE|CREAM|NUDE|TAN\b|CAMEL|KHAKI|TAUPE|STONE|NATURAL|SAND/],
  ['BROWN', /BROWN|COFFEE|RUST|CHOCO|COGNAC/], ['RED', /RED|MAROON|WINE|CHERRY|BURGUNDY/], ['PINK', /PINK|PEACH|ROSE(?! GOLD)|FUCHSIA|MAGENTA/], ['ORANGE', /ORANGE|CORAL/], ['YELLOW', /YELLOW|MUSTARD|LEMON/],
  ['GREEN', /GREEN|OLIVE|LIME|MINT|PISTA|SAGE/], ['BLUE', /BLUE|NAVY|TEAL|TURQUOISE|AQUA|DENIM|COBALT/], ['PURPLE', /PURPLE|LILAC|VIOLET|LAVENDER|MAUVE/],
  ['METALLIC', /SILVER|GOLD|BRONZE|COPPER|METAL|PLATINUM|PEWTER|CHAMPAGNE/], ['SPECIAL', /MULTI|TRANSPARENT|CRYSTAL|CAMO|LEOPARD|SNAKE|ZEBRA|TIE DYE|GLITTER|HOLOGRAPHIC|PRINT/], ['OTHER', /./]];
function swFamily(v) {
  const u = String(v).toUpperCase(); const f = (SW_FAM.find(x => x[1].test(u)) || SW_FAM[SW_FAM.length - 1])[0];
  const hx = COLOUR_LIB[u] || (typeof COLOUR_MORE !== 'undefined' && COLOUR_MORE[u]);
  return f !== 'OTHER' || !hx ? f : hueFamily(hx);
}
// family from the colour itself, for names that say nothing (PERU, TIFFANY, AMBER)
function hueFamily(hex) {
  const n = parseInt(hex.slice(1), 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15 || d < 0.08) return l < 0.2 ? 'BLACK' : l > 0.9 ? 'WHITE' : 'GREY';
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  if (h < 45 && l < 0.45) return 'BROWN';
  if (h < 50 && l > 0.75 && sat < 0.6) return 'BEIGE';
  return h < 15 || h >= 345 ? 'RED' : h < 45 ? 'ORANGE' : h < 70 ? 'YELLOW' : h < 165 ? 'GREEN' : h < 255 ? 'BLUE' : h < 290 ? 'PURPLE' : 'PINK';
}
function swHex(v) {
  const u = String(v).toUpperCase().trim(); if (SW_HEX[u]) return SW_HEX[u]; if (COLOUR_LIB[u]) return COLOUR_LIB[u]; if (typeof COLOUR_MORE !== 'undefined' && COLOUR_MORE[u]) return COLOUR_MORE[u];
  const base = Object.keys(SW_HEX).sort((a, b) => b.length - a.length).find(k => new RegExp('\\b' + k + '\\b').test(u));
  let h = base ? SW_HEX[base] : (SW_HEX[swFamily(u)] || '#bbb');
  if (/\b(DARK|DEEP)\b/.test(u) && base && !/DARK/.test(base)) h = swShade(h, -0.3); else if (/\b(LIGHT|PALE|BABY)\b/.test(u) && base && !/LIGHT/.test(base)) h = swShade(h, 0.45);
  return h;
}
function swShade(hex, f) { const n = parseInt(hex.slice(1).padEnd(6, hex.slice(1)), 16); const c = [16, 8, 0].map(sh => (n >> sh) & 255).map(x => Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f)); return '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''); }
function swInk(hex) { const n = parseInt(hex.slice(1), 16); const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)); return l > 150 ? '#111' : '#fff'; }
function swGrid(a, values, picked, disabled) {
  const q = (IC_UI.swq || {})[a.name] || ''; const fams = {};
  values.forEach(v => { (fams[swFamily(v)] = fams[swFamily(v)] || []).push(v); });
  return '<div class="icsw"' + (disabled ? ' data-off="1"' : '') + '><div class="icsw-top"><input data-swq="' + esc(a.name) + '" placeholder="Search colour…" value="' + esc(q) + '"' + (disabled ? ' disabled' : '') + '><button type="button" class="btn sm" data-act="cm-open" data-a="' + esc(a.name) + '"' + (disabled ? ' disabled' : '') + '>Colour Matcher</button></div>' +
    SW_FAM.map(f => f[0]).filter(f => fams[f]).map(f => '<div class="icsw-row" data-fam="' + f + '"><span class="icsw-f">' + f + '</span><div class="icsw-bs">' + fams[f].map(v => {
      const hx = swHex(v); const on = picked.includes(v); const hide = q && !String(v).toUpperCase().includes(q.toUpperCase()) && !f.includes(q.toUpperCase());
      const bg = /MULTI|TIE DYE|HOLOGRAPHIC/.test(String(v).toUpperCase()) ? 'linear-gradient(90deg,#e53935,#fdd835,#43a047,#1e88e5,#8e24aa)' : /TRANSPARENT|CRYSTAL/.test(String(v).toUpperCase()) ? 'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/10px 10px' : hx;
      return '<button type="button" class="icsw-b' + (on ? ' on' : '') + '" data-act="ic-col" data-a="' + esc(a.name) + '" data-v="' + esc(v) + '" style="background:' + bg + ';color:' + (bg === hx ? swInk(hx) : '#111') + (hide ? ';display:none' : '') + '"' + (disabled ? ' disabled' : '') + ' title="' + esc(v) + '">' + esc(v) + '</button>';
    }).join('') + '</div></div>').join('') + '</div>';
}
const dimVal = d => d && num(d.l) > 0 && num(d.w) > 0 && num(d.h) > 0 ? num(d.l) + 'X' + num(d.w) + 'X' + num(d.h) + (d.u || 'MM') : '';
function lwhAt(A) {
  const i = A.findIndex(a => /(^| )LENGTH$/.test(String(a.name).toUpperCase()));
  return i >= 0 && A[i + 2] && /(^| )WIDTH$/.test(String(A[i + 1].name).toUpperCase()) && /(^| )HEIGHT$/.test(String(A[i + 2].name).toUpperCase()) ? i : -1;
}
const lwhText = (l, w, h) => [l, w, h].map(v => String(v || '').replace(/[A-Z\s]+$/i, '') || '?').join('*');
function itemNameOf(t, vals) {
  const A = typeAttrs(t); const parts = A.map(a => vals[a.name] || '');
  // LENGTH, WIDTH, HEIGHT one after another are written as one size: 585*210*320
  const i = lwhAt(A);
  if (i >= 0 && parts[i] && parts[i + 1] && parts[i + 2]) parts.splice(i, 3, lwhText(parts[i], parts[i + 1], parts[i + 2]));
  return [t.name].concat(parts.filter(v => !blankVal(v))).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
}
function itemKeyOf(cat, typeName, vals) {
  return norm(cat) + '|' + norm(typeName) + '|' + Object.keys(vals).filter(k => vals[k]).map(k => norm(k) + '=' + norm(vals[k])).sort().join(',');
}
// duplicate = same category + type + attribute values, or the same name ignoring spaces/punctuation
function itemDuplicate(cat, t, vals) {
  const key = itemKeyOf(cat, t.name, vals); const nm = squash(itemNameOf(t, vals));
  return Store.all('materials').find(m => (m.attr_key && m.attr_key === key) || squash(m.name) === nm) || null;
}
function renumber(cat) { catAttrs(cat).forEach((a, i) => { if (a.seq !== i + 1) { a.seq = i + 1; Store.put('attributes', a); } }); }

function icRender() { (VIEWS[curView().v] === VIEWS.itemconfig ? VIEWS.itemconfig : VIEWS.itemcreate).render(); }
function icBind() {
  onSeg(e => {
    if (e.target.dataset.seg === 'iccat') { IC_UI.scat = e.detail; IC_UI.editAttr = IC_UI.editType = null; }
    icRender();
  });
}
VIEWS.itemcreate = {
  mod: 'development', render() {
    const edit = can('development', 'edit');
    setMain(subTitle('Item Creation') + icCreateHtml(edit));
    icBind();
    const m = $('#main');
    m.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'icCat') { IC_UI.cat = t.value; IC_UI.type = ''; IC_UI.vals = {}; IC_UI.dims = {}; IC_UI.extra = {}; IC_UI.photo = ''; icRender(); }
      if (t.id === 'icType') { IC_UI.type = t.value; IC_UI.vals = {}; IC_UI.dims = {}; IC_UI.extra = {}; icRender(); }
      if (t.id === 'icPhoto') readImg(t.files[0], src => { IC_UI.photo = src; icRender(); });
      if (t.dataset.icmp) { const mt = Store.get('materials', t.dataset.icmp); if (mt) readImg(t.files[0], src => { mt.photo = src; Store.put('materials', mt); audit('item.photo', '', mt.code); flash('Photo saved.'); icRender(); }); }
      if (t.dataset.icMulti && t.value) {
        const k = t.dataset.icMulti; const cur = (IC_UI.vals[k] || '').split('/').filter(Boolean);
        const at = catAttrs(IC_UI.cat).find(x => x.name === k); if (!cur.includes(t.value) && cur.length < (at ? atMax(at) : AT_MAX)) cur.push(t.value);
        IC_UI.vals[k] = cur.join('/'); icRender(); return;
      }
      if (t.dataset.icDim) {
        const k = t.dataset.icDim; const d = IC_UI.dims[k] || (IC_UI.dims[k] = { u: 'MM' }); d[t.dataset.d] = t.value;
        IC_UI.vals[k] = dimVal(d); icRender(); return;
      }
      if (t.dataset.icAttr) {
        IC_UI.vals[t.dataset.icAttr] = t.value;
        const ty = Store.get('item_types', IC_UI.type); if (ty) typeAttrs(ty).forEach(a => { if (!attrOn(a, IC_UI.vals, ty)) delete IC_UI.vals[a.name]; });
        icRender(); const nx = $$('select[data-ic-attr]').find(s => !s.value && !s.disabled); if (nx) nx.focus(); }
    });
    m.addEventListener('input', e => {
      if (e.target.dataset.icx) IC_UI.extra[e.target.dataset.icx] = e.target.value;
      if (e.target.dataset.swq != null) {
        const q = e.target.value.trim().toUpperCase(); (IC_UI.swq = IC_UI.swq || {})[e.target.dataset.swq] = e.target.value;
        const box = e.target.closest('.icsw');
        $$('.icsw-b', box).forEach(b => { b.style.display = !q || b.dataset.v.toUpperCase().includes(q) || b.closest('.icsw-row').dataset.fam.includes(q) ? '' : 'none'; });
        $$('.icsw-row', box).forEach(r => { r.style.display = $$('.icsw-b', r).some(b => b.style.display !== 'none') ? '' : 'none'; });
      }
    });
  }
};
VIEWS.itemconfig = {
  mod: 'development', render() {
    setMain(subTitle('Item Category Configuration') + icSetupHtml(can('development', 'edit')));
    icBind();
  }
};

/* ================= Create Item (document layout) ================= */
function icCreateHtml(edit) {
  const cats = itemCats().filter(c => typesOf(c).length);
  const types = IC_UI.cat ? typesOf(IC_UI.cat) : [];
  const t = types.find(x => x.id === IC_UI.type);
  const attrs = t ? activeAttrs(t, IC_UI.vals) : [];
  const X = IC_UI.extra;
  let rows = '<tr><td class="k">Category *</td><td><select id="icCat"><option value="">Select category…</option>' + cats.map(c => '<option' + (c === IC_UI.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></td></tr>' +
    '<tr><td class="k">Item Type *</td><td><select id="icType"' + (types.length ? '' : ' disabled') + '><option value="">' + (IC_UI.cat ? 'Select item type…' : '—') + '</option>' + types.map(x => '<option value="' + esc(x.id) + '"' + (x.id === IC_UI.type ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></td></tr>';
  // attributes open one by one, strictly in the category sequence
  let open = true; const lwh = lwhAt(attrs);
  attrs.forEach((a, i) => {
    if (lwh >= 0 && (i === lwh + 1 || i === lwh + 2)) return;
    if (i === lwh) {
      // length, width and height on one line: L * W * H
      const three = [a, attrs[i + 1], attrs[i + 2]]; let o = open;
      rows += '<tr><td class="k"><span class="seqn">' + (i + 1) + '</span>L * W * H (MM) *</td><td><div class="icdim lwh">' + three.map((x, n) => {
        const xv = IC_UI.vals[x.name] || ''; const h = (n ? '<span>*</span>' : '') + '<select data-ic-attr="' + esc(x.name) + '"' + (o ? '' : ' disabled') + ' title="' + esc(x.name) + '"><option value="">' + esc(x.name.slice(0, 1)) + '</option>' +
          atValues(x, IC_UI.vals, t).map(y => '<option value="' + esc(y) + '"' + (y === xv ? ' selected' : '') + '>' + esc(String(y).replace(/[A-Z\s]+$/i, '') || y) + '</option>').join('') + '</select>';
        if (!xv) o = false; return h; }).join('') + '</div></td></tr>';
      if (three.some(x => !IC_UI.vals[x.name])) open = false;
      return;
    }
    const v = IC_UI.vals[a.name] || ''; const k = atKind(a); const dis = open ? '' : ' disabled';
    const lab = '<td class="k"><span class="seqn">' + (i + 1) + '</span>' + esc(a.name) + ' *</td>';
    if (k === 'multi') {
      const cur = v.split('/').filter(Boolean);
      rows += '<tr>' + lab + '<td>' + cur.map((x, j) => '<span class="chip">' + (isColourAttr(a) ? '<span class="icsw-dot" style="background:' + swHex(x) + '"></span>' : '') + (j + 1) + '. ' + esc(x) + ' <a data-act="ic-mrem" data-a="' + esc(a.name) + '" data-i="' + j + '">×</a></span> ').join('') +
        (isColourAttr(a) ? (cur.length < atMax(a) ? swGrid(a, atValues(a, IC_UI.vals, t).filter(x => !cur.includes(x)), [], !open) : '') : cur.length < atMax(a) ? '<select data-ic-multi="' + esc(a.name) + '"' + dis + '><option value="">' + (open ? (cur.length ? 'Add ' + (cur.length + 1) + ' of ' + atMax(a) + '…' : 'Select…') : 'select step ' + i + ' first') + '</option>' +
          atValues(a, IC_UI.vals, t).filter(x => !cur.includes(x)).map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' : '') + '</td></tr>';
    } else if (k === 'dims') {
      const d = IC_UI.dims[a.name] || { u: 'MM' };
      const box = (p, ph) => '<input type="number" min="0" step="any" data-ic-dim="' + esc(a.name) + '" data-d="' + p + '" value="' + esc(d[p] || '') + '" placeholder="' + ph + '"' + dis + '>';
      rows += '<tr>' + lab + '<td><div class="icdim">' + box('l', 'Length') + '<span>×</span>' + box('w', 'Width') + '<span>×</span>' + box('h', 'Height') + '<select data-ic-dim="' + esc(a.name) + '" data-d="u"' + dis + '>' + DIM_UNITS.map(u => '<option' + (u === (d.u || 'MM') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div></td></tr>';
    } else if (isColourAttr(a)) {
      rows += '<tr>' + lab + '<td>' + (v ? '<span class="chip"><span class="icsw-dot" style="background:' + swHex(v) + '"></span>' + esc(v) + ' <a data-act="ic-col-x" data-a="' + esc(a.name) + '">×</a></span>' : swGrid(a, atValues(a, IC_UI.vals, t), [], !open)) + '</td></tr>';
    } else {
      rows += '<tr>' + lab + '<td><select data-ic-attr="' + esc(a.name) + '"' + dis + '><option value="">' + (open ? 'Select…' : 'select step ' + i + ' first') + '</option>' +
        atValues(a, IC_UI.vals, t).map(x => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></td></tr>';
    }
    if (!v) open = false;
  });
  if (t) {
    const inp = (k, label, def, type) => '<tr><td class="k">' + label + '</td><td><input data-icx="' + k + '"' + (type ? ' type="' + type + '" min="0" step="any"' : '') + ' value="' + esc(X[k] != null ? X[k] : def) + '"></td></tr>';
    rows += '<tr><td class="k">Photo</td><td>' + attachBox('id="icPhoto" accept="image/*"', IC_UI.photo, 'Attach photo') + (IC_UI.photo ? ' <a class="small" data-act="ic-photo-clear">Remove</a>' : '') + '</td></tr>' +
      '<tr><td class="k">UOM</td><td><select data-icx="uom">' + UOMS.map(u => '<option' + (u === (X.uom || t.uom || 'PCS') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></td></tr>' +
      inp('price', 'Price ₹', '', 'number') + inp('gst', 'GST %', t.gst || '', 'number') + inp('hsn', 'HSN', t.hsn || '') + inp('rack', 'Rack No.', '') + inp('min', 'Min Level', '', 'number');
  }
  const missing = attrs.filter(a => !IC_UI.vals[a.name]);
  const dup = t && !missing.length ? itemDuplicate(IC_UI.cat, t, IC_UI.vals) : null;
  const name = t ? itemNameOf(t, IC_UI.vals) : '';
  let right = '<div class="icres"><div class="icres-h">GENERATED ITEM NAME</div><div class="icres-name">' + (name ? esc(name) : '<span class="muted">Select category and item type</span>') + '</div>';
  if (t) {
    right += '<table class="jcbom"><tr class="hd"><th style="width:60px">Seq</th><th>Name Part</th><th>Value</th></tr>' +
      '<tr><td class="c">—</td><td>ITEM TYPE</td><td><b>' + esc(t.name) + '</b></td></tr>' +
      (() => { const j = lwhAt(attrs); const V = IC_UI.vals; const cell = v => v ? '<b>' + esc(v) + '</b>' : '<span class="muted">pending</span>'; return attrs.map((a, i) => {
        if (j >= 0 && (i === j + 1 || i === j + 2)) return '';
        if (i === j) return '<tr><td class="c">' + (i + 1) + '-' + (i + 3) + '</td><td>LENGTH * WIDTH * HEIGHT</td><td>' + cell(V[a.name] && V[attrs[i + 1].name] && V[attrs[i + 2].name] ? lwhText(V[a.name], V[attrs[i + 1].name], V[attrs[i + 2].name]) : '') + '</td></tr>';
        return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(a.name) + '</td><td>' + cell(V[a.name]) + '</td></tr>'; }).join(''); })() + '</table>' +
      '<div class="icres-f"><span>Item Code <b>' + esc(itemCodeAuto(IC_UI.cat)) + '</b></span>' +
      (missing.length ? '<span class="st Pending">Next: select ' + esc(missing[0].name) + '</span>'
        : dup ? '<span class="st Late">Already exists: ' + esc(dup.code) + '</span>' : '<span class="st Done">New item — ready</span>') +
      '<span class="grow"></span><button class="btn primary" data-act="ic-create"' + (!edit || missing.length || dup ? ' disabled' : '') + '>Create Item</button></div>';
  }
  right += '</div>';
  let h = '<div class="jcdoc"><div class="jcban">ITEM CREATION</div><div class="jcmid"><div class="jcl icl"><table class="jckv">' + rows + '</table></div>' + right + '</div></div>';

  // existing items: one column per attribute so values line up
  if (t) {
    const list = Store.all('materials').filter(m => norm(m.group) === norm(IC_UI.cat) && norm(m.item_type || '') === norm(t.name)).sort((a, b) => a.code.localeCompare(b.code));
    const attrs = typeAttrs(t); const hasCol = attrs.some(isColourAttr);
    h += '<h2>' + esc(t.name) + ' — existing items (' + list.length + ')</h2><div class="tbl-wrap"><table><tr><th>Photo</th>' + (hasCol ? '<th>Colour</th>' : '') + '<th>Item Code</th><th>Item Name</th>' + attrs.map((a, i) => '<th>' + (i + 1) + '. ' + esc(a.name) + '</th>').join('') + '<th>UOM</th><th class="num">Price</th></tr>' +
      (list.length ? list.map(m => '<tr><td>' + (can('development', 'edit') ? '<label class="icphoto sm" title="Add / change photo">' + (m.photo ? '<img src="' + m.photo + '">' : '<span class="muted small">+ Photo</span>') + '<input type="file" accept="image/*" data-icmp="' + esc(m.id) + '" style="display:none"></label>' : photoThumb(m.photo)) + '</td>' + (hasCol ? '<td>' + photoThumb(m.colour_photo) + '</td>' : '') + '<td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td>' + attrs.map(a => '<td>' + esc((m.attrs || {})[a.name] || '') + '</td>').join('') + '<td>' + esc(m.uom || '') + '</td><td class="num">' + (m.price ? money(m.price) : '') + '</td></tr>').join('')
        : '<tr><td colspan="' + (attrs.length + 5 + (hasCol ? 1 : 0)) + '" class="empty">No items of this type yet</td></tr>') + '</table></div>';
  } else if (IC_UI.cat) {
    h += '<h2>' + esc(IC_UI.cat) + ' — item types</h2>' + icTypeMatrix(IC_UI.cat, false);
  }
  return h;
}
// picture of the chosen colour(s), saved with the item: one stripe per colour, names under it
function colourSwatchImg(cols) {
  if (!cols.length) return '';
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 150; const g = cv.getContext('2d');
  const w = cv.width / cols.length;
  cols.forEach((c, i) => { g.fillStyle = c.hex; g.fillRect(Math.round(i * w), 0, Math.ceil(w), 118); });
  g.fillStyle = '#fff'; g.fillRect(0, 118, cv.width, 32); g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
  g.fillStyle = '#111'; g.font = 'bold 12px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let txt = cols.map(c => c.name).join(' / '); while (g.measureText(txt).width > cv.width - 10 && txt.length > 4) txt = txt.slice(0, -2);
  g.fillText(txt + (txt.length < cols.map(c => c.name).join(' / ').length ? '…' : ''), cv.width / 2, 134);
  return cv.toDataURL('image/png');
}
function itemColours(t, vals) { const out = []; typeAttrs(t).filter(isColourAttr).forEach(a => String(vals[a.name] || '').split('/').filter(Boolean).forEach(n => out.push({ name: n, hex: swHex(n) }))); return out; }
ACTIONS['ic-create'] = () => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', IC_UI.type); if (!t) return;
  const attrs = activeAttrs(t, IC_UI.vals); const vals = {};
  attrs.forEach(a => { vals[a.name] = IC_UI.vals[a.name] || ''; });
  if (attrs.some(a => !vals[a.name])) { flash('Select every attribute first.', 'err'); return; }
  const dup = itemDuplicate(IC_UI.cat, t, vals);
  if (dup) { flash('Already exists as ' + esc(dup.code) + ' · ' + esc(dup.name), 'err'); return; }
  const X = IC_UI.extra;
  const m = Store.put('materials', {
    id: uid(), code: itemCodeAuto(IC_UI.cat), name: itemNameOf(t, vals), group: IC_UI.cat, item_type: t.name,
    attrs: vals, attr_key: itemKeyOf(IC_UI.cat, t.name, vals), uom: X.uom || t.uom || 'PCS',
    price: num(X.price) || 0, gst: num(X.gst != null ? X.gst : t.gst) || 0, hsn: String(X.hsn != null ? X.hsn : t.hsn || '').trim(),
    rack: String(X.rack || '').trim().toUpperCase(), min_level: num(X.min) || 0, photo: IC_UI.photo || '', colours: itemColours(t, vals), colour_photo: colourSwatchImg(itemColours(t, vals)), created_at: nowIso(), created_by: ME.name
  });
  audit('item.create', m.code, m.name);
  flash('Created ' + esc(m.code) + ' · ' + esc(m.name));
  IC_UI.vals = {}; IC_UI.dims = {}; IC_UI.extra = {}; IC_UI.photo = ''; icRender();
};
/* ---- Colour Matcher: every named colour in big tiles, a large / full-screen preview to hold a swatch against,
   and matching from a photo of the swatch (tap the photo → nearest named colours) ---- */
const CM = { a: '', sel: '' };
function cmAll(a) {
  const m = new Map(); const add = (n, h) => { const k = String(n).toUpperCase().trim(); if (k && !m.has(k)) m.set(k, h || swHex(k)); };
  (a.values || []).forEach(v => add(v)); Object.keys(COLOUR_LIB).forEach(k => add(k, COLOUR_LIB[k]));
  if (typeof COLOUR_MORE !== 'undefined') Object.keys(COLOUR_MORE).forEach(k => add(k, COLOUR_MORE[k]));
  return Array.from(m, ([n, hex]) => ({ n, hex, fam: swFamily(n) }));
}
const cmRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// perceptual-ish distance ("redmean")
function cmDist(a, b) { const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db); }
ACTIONS['cm-open'] = el => {
  const at = catAttrs(IC_UI.cat).find(x => x.name === el.dataset.a); if (!at) return;
  CM.a = at.name; CM.sel = ''; const all = cmAll(at); CM.all = all;
  const old = $('#cmDlg'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'cmDlg'; d.className = 'dlg-back';
  const fams = SW_FAM.map(f => f[0]).filter(f => all.some(c => c.fam === f));
  d.innerHTML = '<div class="dlg cm"><div class="dlg-h">Colour Matcher · ' + esc(at.name) + ' <span class="muted small">' + all.length + ' colours</span><span class="grow"></span><a data-cm="x" class="cm-x">×</a></div>' +
    '<div class="cm-bar"><input id="cmQ" placeholder="Search colour…"><select id="cmFam"><option value="">All families</option>' + fams.map(f => '<option>' + f + '</option>').join('') + '</select>' +
    '<label class="btn sm">Match from photo<input id="cmPhoto" type="file" accept="image/*" capture="environment" style="display:none"></label></div>' +
    '<div class="cm-body"><div class="cm-grid" id="cmGrid">' + all.map(c => '<div class="cm-t" data-n="' + esc(c.n) + '" data-f="' + c.fam + '" title="' + esc(c.n) + '"><i style="background:' + c.hex + '"></i><span>' + esc(c.n) + '</span></div>').join('') + '</div>' +
    '<div class="cm-side"><div id="cmBig" class="cm-big"><span>Tap a colour</span></div><div id="cmName" class="cm-name"></div>' +
    '<div class="cm-btns"><button class="btn" data-cm="full" disabled>Full screen</button><button class="btn primary" data-cm="use" disabled>Use this colour</button></div>' +
    '<canvas id="cmCan" class="cm-can hidden"></canvas><div id="cmNear" class="cm-near"></div></div></div></div>';
  document.body.appendChild(d);
  const pick = n => { CM.sel = n; const c = CM.all.find(x => x.n === n); if (!c) return; $('#cmBig', d).style.background = c.hex; $('#cmBig', d).innerHTML = '';
    $('#cmName', d).innerHTML = '<b>' + esc(c.n) + '</b> <span class="muted">' + c.hex.toUpperCase() + ' · ' + c.fam + '</span>'; $$('[data-cm=full],[data-cm=use]', d).forEach(b => { b.disabled = false; });
    $$('.cm-t.on', d).forEach(t => t.classList.remove('on')); const t = $('.cm-t[data-n="' + CSS.escape(n) + '"]', d); if (t) t.classList.add('on'); };
  const filt = () => { const q = $('#cmQ', d).value.trim().toUpperCase(), f = $('#cmFam', d).value;
    $$('.cm-t', d).forEach(t => { t.style.display = (!f || t.dataset.f === f) && (!q || t.dataset.n.includes(q) || t.dataset.f.includes(q)) ? '' : 'none'; }); };
  $('#cmQ', d).addEventListener('input', filt); $('#cmFam', d).addEventListener('change', filt);
  const use = () => { if (!CM.sel) return; d.remove(); ACTIONS['ic-col']({ dataset: { a: CM.a, v: CM.sel } }); };
  d.addEventListener('click', ev => {
    const t = ev.target.closest('.cm-t'); if (t) { pick(t.dataset.n); return; }
    const nr = ev.target.closest('[data-near]'); if (nr) { pick(nr.dataset.near); return; }
    const b = ev.target.closest('[data-cm]'); if (!b) { if (ev.target === d) d.remove(); return; }
    if (b.dataset.cm === 'x') d.remove();
    if (b.dataset.cm === 'use') use();
    if (b.dataset.cm === 'full' && CM.sel) {
      const c = CM.all.find(x => x.n === CM.sel); const fs = document.createElement('div'); fs.className = 'cm-fs'; fs.style.background = c.hex;
      fs.innerHTML = '<span style="color:' + swInk(c.hex) + '">' + esc(c.n) + ' · tap to close</span>'; document.body.appendChild(fs);
      const close = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); fs.remove(); };
      fs.addEventListener('click', close); if (fs.requestFullscreen) fs.requestFullscreen().catch(() => {});
      document.addEventListener('fullscreenchange', function h() { if (!document.fullscreenElement) { fs.remove(); document.removeEventListener('fullscreenchange', h); } });
    }
  });
  d.addEventListener('dblclick', ev => { const t = ev.target.closest('.cm-t'); if (t) { pick(t.dataset.n); use(); } });
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') d.remove(); });
  // photo of the swatch: tap a spot, get the nearest named colours
  $('#cmPhoto', d).addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return; const img = new Image();
    img.onload = () => { const cv = $('#cmCan', d); const w = Math.min(360, img.width); cv.width = w; cv.height = Math.round(img.height * w / img.width); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); cv.classList.remove('hidden');
      $('#cmNear', d).innerHTML = '<span class="small muted">Tap the swatch in the photo</span>'; URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(f);
  });
  $('#cmCan', d).addEventListener('click', e => {
    const cv = e.target; const r = cv.getBoundingClientRect(); const x = Math.round((e.clientX - r.left) * cv.width / r.width), y = Math.round((e.clientY - r.top) * cv.height / r.height);
    const px = cv.getContext('2d').getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9).data; let s3 = [0, 0, 0], n = 0;
    for (let i = 0; i < px.length; i += 4) { s3[0] += px[i]; s3[1] += px[i + 1]; s3[2] += px[i + 2]; n++; }
    const rgb = s3.map(v => Math.round(v / n)); const hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    const near = CM.all.map(c => ({ c, dd: cmDist(rgb, cmRgb(c.hex)) })).sort((p1, p2) => p1.dd - p2.dd).slice(0, 8);
    $('#cmNear', d).innerHTML = '<div class="small">From photo <i class="cm-dot" style="background:' + hex + '"></i> ' + hex.toUpperCase() + ' — nearest:</div>' +
      near.map(o => '<button type="button" class="cm-nb" data-near="' + esc(o.c.n) + '"><i class="cm-dot" style="background:' + o.c.hex + '"></i>' + esc(o.c.n) + '</button>').join('');
    pick(near[0].c.n);
  });
  $('#cmQ', d).focus();
};
ACTIONS['ic-col'] = el => {
  const k = el.dataset.a, v = el.dataset.v; const at = catAttrs(IC_UI.cat).find(x => x.name === k); if (!at) return;
  if (atKind(at) === 'multi') { const cur = (IC_UI.vals[k] || '').split('/').filter(Boolean); if (!cur.includes(v) && cur.length < atMax(at)) cur.push(v); IC_UI.vals[k] = cur.join('/'); }
  else { IC_UI.vals[k] = v; const ty = Store.get('item_types', IC_UI.type); if (ty) typeAttrs(ty).forEach(a => { if (!attrOn(a, IC_UI.vals, ty)) delete IC_UI.vals[a.name]; }); }
  if (IC_UI.swq) delete IC_UI.swq[k];
  icRender(); const nx = $$('select[data-ic-attr]').find(s2 => !s2.value && !s2.disabled); if (nx) nx.focus();
};
ACTIONS['ic-col-x'] = el => { delete IC_UI.vals[el.dataset.a]; icRender(); };
ACTIONS['ic-mrem'] = el => { const k = el.dataset.a; const cur = (IC_UI.vals[k] || '').split('/').filter(Boolean); cur.splice(+el.dataset.i, 1); IC_UI.vals[k] = cur.join('/'); icRender(); };
ACTIONS['ic-photo-clear'] = () => { IC_UI.photo = ''; icRender(); };

/* ================= Category Setup ================= */
function icSetupHtml(edit) {
  const cats = itemCats();
  if (!IC_UI.scat || !cats.includes(IC_UI.scat)) IC_UI.scat = cats[0];
  const cat = IC_UI.scat;
  const A = catAttrs(cat);
  let h = '<div class="toolbar">' + seg('iccat', cats, cat) + (edit ? '<span class="grow"></span><input id="icNewCat" placeholder="New category" style="width:160px"><button class="btn sm" data-act="ic-addcat">Add Category</button>' : '') + '</div>';

  // attributes of this category, in name sequence
  h += '<div class="card"><div class="card-h"><b>' + esc(cat) + ' — Attributes</b></div><div class="card-b">' +
    '<table class="jcbom icgrid"><tr class="hd"><th style="width:56px">Seq</th><th style="width:180px">Attribute</th><th style="width:170px">Type</th><th>Allowed Values</th><th style="width:190px">Only when</th><th style="width:220px">Used in Item Types</th>' + (edit ? '<th style="width:190px">Actions</th>' : '') + '</tr>';
  A.forEach((a, i) => {
    const used = typesOf(cat).filter(t => usesAttr(t, a.name));
    if (edit && IC_UI.editAttr === a.id) {
      h += '<tr data-arow="' + esc(a.id) + '"><td class="c">' + (i + 1) + '</td><td><input data-af="name" value="' + esc(a.name) + '"></td><td>' + kindSel(a) + '</td><td><textarea data-af="vals" rows="3">' + esc(a.values.join(', ')) + '</textarea></td><td>' + whenSel(A, a) + '</td><td class="wrap small">' + used.map(t => esc(t.name)).join(', ') + '</td>' +
        '<td class="c"><button class="btn sm primary" data-act="at-save" data-id="' + esc(a.id) + '">Save</button> <button class="btn sm" data-act="at-cancel">Cancel</button></td></tr>';
    } else {
      h += '<tr><td class="c"><span class="seqn">' + (i + 1) + '</span></td><td><b>' + esc(a.name) + '</b></td><td class="small">' + esc(atKindLabel(a)) + '</td><td class="wrap small">' + (['brand', 'article', 'dims'].includes(atKind(a)) ? '<span class="muted">' + (atKind(a) === 'dims' ? 'Typed at item creation' : 'From master') + '</span>' : a.values.map(esc).join(', ') + ' <span class="muted">(' + a.values.length + ')</span>') + '</td><td class="small">' + (a.when_attr ? '<b>' + esc(whenLabel(a)) + '</b>' : '<span class="muted">Always</span>') + '</td><td class="wrap small">' + (used.map(t => esc(t.name)).join(', ') || '—') + '</td>' +
        (edit ? '<td class="c nowrap"><button class="btn sm" data-act="at-move" data-id="' + esc(a.id) + '" data-dir="-1" title="Move up"' + (i ? '' : ' disabled') + '>↑</button> <button class="btn sm" data-act="at-move" data-id="' + esc(a.id) + '" data-dir="1" title="Move down"' + (i < A.length - 1 ? '' : ' disabled') + '>↓</button> ' +
          '<button class="btn sm" data-act="at-edit" data-id="' + esc(a.id) + '">Edit</button> ' + '<button class="btn sm ghost danger" data-act="at-del" data-id="' + esc(a.id) + '" data-confirm="' + (used.length ? 'Delete? Removes from ' + used.length + ' item type' + (used.length > 1 ? 's' : '') : 'Delete?') + '">×</button>' + '</td>' : '') + '</tr>';
    }
  });
  if (!A.length) h += '<tr><td colspan="7" class="empty">No attributes for ' + esc(cat) + ' yet</td></tr>';
  if (edit) h += '<tr class="addrow" data-arow="new"><td class="c">' + (A.length + 1) + '</td><td><input data-af="name" placeholder="e.g. COLOUR"></td><td>' + kindSel(null) + '</td><td><textarea data-af="vals" rows="2" placeholder="Values, comma separated: BLACK, WHITE, NAVY"></textarea></td><td>' + whenSel(A, null) + '</td><td></td><td class="c"><button class="btn sm primary" data-act="at-add">Add Attribute</button></td></tr>';
  h += '</table></div></div>';

  // item types of this category: one tick column per attribute, in sequence
  h += '<div class="card"><div class="card-h"><b>' + esc(cat) + ' — Item Types</b></div><div class="card-b">' + icTypeMatrix(cat, edit) + '</div></div>';
  return h;
}
function icTypeMatrix(cat, edit) {
  const A = catAttrs(cat); const T = typesOf(cat);
  const uomSel = v => '<select data-tf="uom">' + UOMS.map(u => '<option' + (u === (v || 'PCS') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>';
  let h = '<div style="overflow-x:auto"><table class="jcbom icgrid"><tr class="hd"><th style="width:170px">Item Type</th>' + A.map((a, i) => '<th class="c">' + (i + 1) + '. ' + esc(a.name) + '</th>').join('') +
    '<th style="width:90px">UOM</th><th style="width:80px">HSN</th><th style="width:60px">GST %</th><th style="width:60px">Items</th>' + (edit ? '<th style="width:130px">Actions</th>' : '') + '</tr>';
  T.forEach(t => {
    const n = Store.all('materials').filter(m => norm(m.item_type || '') === norm(t.name) && norm(m.group) === norm(cat)).length;
    if (edit && IC_UI.editType === t.id) {
      h += '<tr data-trow="' + esc(t.id) + '"><td><input data-tf="name" value="' + esc(t.name) + '"></td>' + A.map(a => '<td class="c"><input type="checkbox" data-tatt="' + esc(a.name) + '"' + (usesAttr(t, a.name) ? ' checked' : '') + '></td>').join('') +
        '<td>' + uomSel(t.uom) + '</td><td><input data-tf="hsn" value="' + esc(t.hsn || '') + '"></td><td><input data-tf="gst" type="number" value="' + esc(t.gst || '') + '"></td><td class="c">' + (n || '—') + '</td>' +
        '<td class="c nowrap"><button class="btn sm primary" data-act="it-save" data-id="' + esc(t.id) + '">Save</button> <button class="btn sm" data-act="it-cancel">Cancel</button></td></tr>';
    } else {
      h += '<tr><td><b>' + esc(t.name) + '</b></td>' + A.map(a => '<td class="c">' + (usesAttr(t, a.name) ? '<span class="tick">✓</span>' : '') + '</td>').join('') +
        '<td>' + esc(t.uom || '') + '</td><td>' + esc(t.hsn || '') + '</td><td class="c">' + (t.gst || '') + '</td><td class="c">' + (n || '—') + '</td>' +
        (edit ? '<td class="c nowrap"><button class="btn sm" data-act="it-edit" data-id="' + esc(t.id) + '">Edit</button> ' + (n ? '' : '<button class="btn sm ghost danger" data-act="it-del" data-id="' + esc(t.id) + '" data-confirm="Delete?">×</button>') + '</td>' : '') + '</tr>';
    }
  });
  if (!T.length) h += '<tr><td colspan="' + (A.length + 6) + '" class="empty">No item types for ' + esc(cat) + ' yet</td></tr>';
  if (edit) h += '<tr class="addrow" data-trow="new"><td><input data-tf="name" placeholder="New item type"></td>' + A.map(a => '<td class="c"><input type="checkbox" data-tatt="' + esc(a.name) + '"></td>').join('') +
    '<td>' + uomSel('') + '</td><td><input data-tf="hsn"></td><td><input data-tf="gst" type="number"></td><td></td><td class="c"><button class="btn sm primary" data-act="it-add">Add Type</button></td></tr>';
  return h + '</table></div>';
}

/* ---- category / attribute / type actions ---- */
ACTIONS['ic-addcat'] = () => {
  const c = ($('#icNewCat').value || '').trim().replace(/\s+/g, ' ');
  if (!c) return;
  const ex = itemCats().find(x => norm(x) === norm(c));
  if (!ex) IC_UI.newCats.push(c);
  IC_UI.scat = ex || c; icRender();
};
// "Only when" choices: every value of every other attribute of the category
function whenSel(A, a) {
  const cur = a && a.when_attr ? a.when_attr + '|' + a.when_val : '';
  return '<select data-af="when"><option value="">Always</option>' + A.filter(x => !a || x.id !== a.id).map(x => '<optgroup label="' + esc(x.name) + '">' + (x.values || []).map(v => '<option value="' + esc(x.name + '|' + v) + '"' + (cur === x.name + '|' + v ? ' selected' : '') + '>' + esc(x.name + ' = ' + v) + '</option>').join('') + '</optgroup>').join('') + '</select>';
}
function kindSel(a) { return '<select data-af="kind">' + AT_KINDS.map(k => '<option value="' + k[0] + '"' + ((a ? atKind(a) : 'list') === k[0] ? ' selected' : '') + '>' + k[1] + '</option>').join('') + '</select>' +
  '<label class="small">Max (many values) <input data-af="max" type="number" min="1" max="20" value="' + esc(a ? atMax(a) : AT_MAX) + '" style="width:60px"></label>'; }
function atRead(tr) {
  const name = $('[data-af="name"]', tr).value.trim().toUpperCase().replace(/\s+/g, ' ');
  const values = Array.from(new Set($('[data-af="vals"]', tr).value.split(/[,\n]/).map(x => x.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean)));
  const w = ($('[data-af="when"]', tr) || { value: '' }).value; const k = w.indexOf('|');
  const kind = ($('[data-af="kind"]', tr) || { value: 'list' }).value || 'list';
  const max = Math.min(20, Math.max(1, num(($('[data-af="max"]', tr) || { value: '' }).value) || AT_MAX));
  return { name, kind, max, values: ['brand', 'article', 'dims'].includes(kind) ? [] : values, when_attr: k > 0 ? w.slice(0, k) : '', when_val: k > 0 ? w.slice(k + 1) : '' };
}
ACTIONS['at-add'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const cat = IC_UI.scat; const r = atRead(el.closest('tr'));
  if (!r.name || (!r.values.length && ['list', 'multi'].includes(r.kind))) { flash('Attribute name and at least one value are required.', 'err'); return; }
  if (catAttrs(cat).some(a => norm(a.name) === norm(r.name))) { flash(esc(r.name) + ' already exists in ' + esc(cat) + '.', 'err'); return; }
  if (norm(r.when_attr) === norm(r.name)) { flash('An attribute cannot depend on itself.', 'err'); return; }
  Store.put('attributes', { id: uid(), category: cat, name: r.name, kind: r.kind, max: r.max, seq: catAttrs(cat).length + 1, values: r.values, when_attr: r.when_attr, when_val: r.when_val });
  audit('attribute.add', cat + ' · ' + r.name, r.values.length + ' values'); icRender();
};
ACTIONS['at-edit'] = el => { IC_UI.editAttr = el.dataset.id; icRender(); };
ACTIONS['at-cancel'] = () => { IC_UI.editAttr = null; icRender(); };
ACTIONS['at-save'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id); const r = atRead(el.closest('tr'));
  if (!r.name || (!r.values.length && ['list', 'multi'].includes(r.kind))) { flash('Attribute name and at least one value are required.', 'err'); return; }
  if (catAttrs(a.category).some(x => x.id !== a.id && norm(x.name) === norm(r.name))) { flash(esc(r.name) + ' already exists in ' + esc(a.category) + '.', 'err'); return; }
  if (norm(r.when_attr) === norm(r.name)) { flash('An attribute cannot depend on itself.', 'err'); return; }
  const old = a.name; a.name = r.name; a.kind = r.kind; a.max = r.max; a.values = r.values; a.when_attr = r.when_attr; a.when_val = r.when_val; Store.put('attributes', a);
  if (norm(old) !== norm(r.name)) {
    typesOf(a.category).forEach(t => { if (usesAttr(t, old)) { t.attrs = t.attrs.map(x => norm(x) === norm(old) ? r.name : x); Store.put('item_types', t); } });
    catAttrs(a.category).forEach(x => { if (norm(x.when_attr || '') === norm(old)) { x.when_attr = r.name; Store.put('attributes', x); } });
  }
  audit('attribute.edit', a.category + ' · ' + r.name, atKindLabel(a) + ' · ' + r.values.length + ' values' + (a.when_attr ? ' · only when ' + whenLabel(a) : ''));
  IC_UI.editAttr = null; icRender();
};
ACTIONS['at-move'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id); const list = catAttrs(a.category);
  const i = list.findIndex(x => x.id === a.id); const j = i + num(el.dataset.dir);
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { if (x.seq !== k + 1) { x.seq = k + 1; Store.put('attributes', x); } });
  audit('attribute.sequence', a.category, list.map(x => x.name).join(' > ')); icRender();
};
ACTIONS['at-del'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const a = Store.get('attributes', el.dataset.id);
  const used = typesOf(a.category).filter(t => usesAttr(t, a.name));
  used.forEach(t => { t.attrs = (t.attrs || []).filter(n => norm(n) !== norm(a.name)); Store.put('item_types', t); });
  Store.del('attributes', a.id); renumber(a.category);
  catAttrs(a.category).forEach(x => { if (norm(x.when_attr || '') === norm(a.name)) { x.when_attr = ''; x.when_val = ''; Store.put('attributes', x); } });
  audit('attribute.delete', a.category + ' · ' + a.name, used.map(t => t.name).join(', ')); icRender();
};
function itRead(tr) {
  return {
    name: $('[data-tf="name"]', tr).value.trim().toUpperCase().replace(/\s+/g, ' '),
    attrs: $$('[data-tatt]', tr).filter(c => c.checked).map(c => c.dataset.tatt),
    uom: $('[data-tf="uom"]', tr).value, hsn: $('[data-tf="hsn"]', tr).value.trim(), gst: num($('[data-tf="gst"]', tr).value) || 0
  };
}
function itCheck(r, cat, selfId) {
  if (!r.name) return 'Item type name is required.';
  if (!r.attrs.length) return 'Tick at least one attribute.';
  if (typesOf(cat).some(t => t.id !== selfId && norm(t.name) === norm(r.name))) return r.name + ' already exists in ' + cat + '.';
  return '';
}
ACTIONS['it-add'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const cat = IC_UI.scat; const r = itRead(el.closest('tr')); const err = itCheck(r, cat);
  if (err) { flash(esc(err), 'err'); return; }
  Store.put('item_types', Object.assign({ id: uid(), category: cat }, r));
  audit('itemtype.add', cat + ' · ' + r.name, r.attrs.join(', ')); icRender();
};
ACTIONS['it-edit'] = el => { IC_UI.editType = el.dataset.id; icRender(); };
ACTIONS['it-cancel'] = () => { IC_UI.editType = null; icRender(); };
ACTIONS['it-save'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', el.dataset.id); const r = itRead(el.closest('tr')); const err = itCheck(r, t.category, t.id);
  if (err) { flash(esc(err), 'err'); return; }
  Object.assign(t, r); Store.put('item_types', t);
  audit('itemtype.edit', t.category + ' · ' + t.name, r.attrs.join(', ')); IC_UI.editType = null; icRender();
};
ACTIONS['it-del'] = el => {
  if (!requirePerm('development', 'edit')) return;
  const t = Store.get('item_types', el.dataset.id); Store.del('item_types', t.id); audit('itemtype.delete', t.category + ' · ' + t.name, ''); icRender();
};

/* ================= first-run footwear defaults ================= */
const COLOURS = 'BLACK, WHITE, OFF WHITE, BEIGE, CREAM, TAN, BROWN, DARK BROWN, NAVY, BLUE, SKY BLUE, GREY, DARK GREY, RED, MAROON, PINK, PEACH, LILAC, PURPLE, YELLOW, MUSTARD, ORANGE, GREEN, OLIVE, KHAKI, SILVER, GOLD, NATURAL, TRANSPARENT, MULTI';
const SIZE_RUNS = '1X5, 1X4, 4X8, 5X9, 6X10, 7X11, 8X12, 10X13, 11X13';
// category -> attributes in name sequence [name, values]
const IC_DEFAULT_ATTRS = {
  'Compound': [['THICKNESS', '1MM, 2MM, 3MM, 4MM, 5MM, 6MM, 8MM, 10MM, 12MM, 15MM, 20MM'], ['HARDNESS', '20 SHORE A, 25 SHORE A, 30 SHORE A, 35 SHORE A, 40 SHORE A, 45 SHORE A, 50 SHORE A, 55 SHORE A, 60 SHORE A, 65 SHORE A, 70 SHORE A'], ['COLOUR', COLOURS], ['SHEET SIZE', '1X1 MTR, 1X2 MTR, 1.1X1.5 MTR, 1.2X2.4 MTR, 1.4X1.4 MTR']],
  'Fabric': [['GSM', '100GSM, 120GSM, 150GSM, 180GSM, 200GSM, 250GSM, 300GSM, 350GSM, 400GSM'], ['THICKNESS', '1MM, 2MM, 3MM, 4MM, 5MM'], ['COLOUR', COLOURS], ['WIDTH', '36 INCH, 44 INCH, 54 INCH, 58 INCH, 60 INCH, 64 INCH']],
  'Synthetic': [['THICKNESS', '0.6MM, 0.8MM, 1.0MM, 1.2MM, 1.4MM, 1.6MM, 1.8MM, 2MM'], ['FINISH', 'MATT, GLOSSY, PATENT, NUBUCK, SUEDE, EMBOSSED, PRINTED, METALLIC, CRINKLE, NAPPA, MILLED'], ['COLOUR', COLOURS], ['WIDTH', '44 INCH, 54 INCH, 58 INCH, 60 INCH']],
  'Leather': [['THICKNESS', '0.8MM, 1.0MM, 1.2MM, 1.4MM, 1.6MM, 1.8MM, 2MM, 2.5MM'], ['FINISH', 'MATT, GLOSSY, PATENT, NUBUCK, SUEDE, NAPPA, MILLED, CRUNCH'], ['COLOUR', COLOURS]],
  'Sole': [['MATERIAL', 'EVA, PU, PVC, TPR, TPU, RUBBER, PHYLON, LATEX, MEMORY FOAM'], ['THICKNESS', '3MM, 4MM, 5MM, 6MM, 8MM, 10MM, 12MM, 15MM, 20MM, 25MM'], ['SIZE RUN', SIZE_RUNS], ['COLOUR', COLOURS]],
  'Upper': [['MATERIAL', 'CHEMICAL SHEET, TPU, LEATHERBOARD, NONWOVEN'], ['THICKNESS', '0.6MM, 0.8MM, 1.0MM, 1.2MM, 1.5MM, 2MM'], ['SIZE RUN', SIZE_RUNS], ['COLOUR', COLOURS]],
  'Grinderies': [['MATERIAL', 'NYLON, POLYESTER, COTTON, PVC, TPU, METAL'], ['THREAD TKT', 'TKT 10, TKT 20, TKT 30, TKT 40, TKT 60, TKT 80'], ['LACE SHAPE', 'FLAT, ROUND, OVAL, WAXED ROUND'], ['LACE LENGTH', '80CM, 90CM, 100CM, 110CM, 120CM, 140CM, 160CM'], ['EYELET SIZE', '3MM, 4MM, 5MM, 6MM, 8MM, 10MM'], ['TAPE WIDTH', '10MM, 12MM, 16MM, 20MM, 25MM, 32MM, 38MM, 50MM'], ['SIZE RUN', SIZE_RUNS], ['FINISH', 'MATT, GLOSSY, ANTIQUE, NICKEL, BLACK OXIDE'], ['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']],
  'Packaging': [['BOX SIZE', 'NO.1, NO.2, NO.3, NO.4, NO.5, NO.6, KIDS'], ['BAG SIZE', '8X10, 10X14, 12X16, 14X18, 16X20'], ['LABEL SIZE', '38X25MM, 50X25MM, 50X38MM, 75X50MM, 100X50MM'], ['PLY', '3 PLY, 5 PLY, 7 PLY'], ['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']],
  'Consumable Item': [['MATERIAL', 'PU, NEOPRENE, LATEX, WATER BASED, SOLVENT BASED'], ['PACK SIZE', '1 LTR, 5 LTR, 15 LTR, 20 LTR, 1 KG, 5 KG, 25 KG']],
  'Silicon': [['COLOUR', COLOURS], ['PRINT', 'PLAIN, 1 COLOUR PRINT, 2 COLOUR PRINT, MULTI COLOUR PRINT']]
};
const IC_DEFAULT_TYPES = [
  ['Compound', 'EVA SHEET', 'THICKNESS, HARDNESS, COLOUR, SHEET SIZE', 'SHEET', '3921'], ['Compound', 'PU COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3909'],
  ['Compound', 'TPR COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3902'], ['Compound', 'RUBBER COMPOUND', 'HARDNESS, COLOUR', 'KGS', '4005'], ['Compound', 'PVC COMPOUND', 'HARDNESS, COLOUR', 'KGS', '3904'],
  ['Fabric', 'KNIT MESH', 'GSM, COLOUR, WIDTH', 'MTR', '6006'], ['Fabric', 'SANDWICH MESH', 'THICKNESS, COLOUR, WIDTH', 'MTR', '6005'],
  ['Fabric', 'LINING FABRIC', 'GSM, COLOUR, WIDTH', 'MTR', '5407'], ['Fabric', 'CANVAS', 'GSM, COLOUR, WIDTH', 'MTR', '5209'],
  ['Synthetic', 'PU SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'], ['Synthetic', 'PVC SYNTHETIC', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5903'], ['Synthetic', 'MICROFIBRE', 'THICKNESS, FINISH, COLOUR, WIDTH', 'MTR', '5603'],
  ['Leather', 'LEATHER', 'THICKNESS, FINISH, COLOUR', 'SQFT', '4107'],
  ['Sole', 'OUTSOLE', 'MATERIAL, SIZE RUN, COLOUR', 'PAIR', '6406'], ['Sole', 'MIDSOLE', 'MATERIAL, THICKNESS, SIZE RUN, COLOUR', 'PAIR', '6406'], ['Sole', 'INSOLE', 'MATERIAL, THICKNESS, SIZE RUN', 'PAIR', '6406'],
  ['Upper', 'TOE PUFF', 'MATERIAL, THICKNESS', 'SHEET', '5603'], ['Upper', 'COUNTER STIFFENER', 'MATERIAL, THICKNESS', 'SHEET', '5603'],
  ['Grinderies', 'THREAD', 'MATERIAL, THREAD TKT, COLOUR', 'ROLL', '5401'], ['Grinderies', 'SHOE LACE', 'LACE SHAPE, LACE LENGTH, COLOUR', 'PAIR', '6307'],
  ['Grinderies', 'EYELET', 'EYELET SIZE, FINISH, COLOUR', 'PCS', '8308'], ['Grinderies', 'VELCRO TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'],
  ['Grinderies', 'ELASTIC TAPE', 'TAPE WIDTH, COLOUR', 'MTR', '5806'], ['Grinderies', 'STRAP', 'MATERIAL, SIZE RUN, COLOUR, PRINT', 'PAIR', '3926'],
  ['Packaging', 'SHOE BOX', 'BOX SIZE, PLY, PRINT', 'PCS', '4819'], ['Packaging', 'CARTON', 'BOX SIZE, PLY', 'PCS', '4819'], ['Packaging', 'POLY BAG', 'BAG SIZE', 'PCS', '3923'],
  ['Packaging', 'TISSUE PAPER', 'COLOUR', 'PCS', '4803'], ['Packaging', 'BARCODE LABEL', 'LABEL SIZE', 'ROLL', '4821'],
  ['Consumable Item', 'ADHESIVE', 'MATERIAL, PACK SIZE', 'LTR', '3506'], ['Consumable Item', 'PRIMER', 'MATERIAL, PACK SIZE', 'LTR', '3208'], ['Consumable Item', 'HARDENER', 'PACK SIZE', 'LTR', '3208'],
  ['Silicon', 'SILICON LABEL', 'COLOUR, PRINT', 'PCS', '3926']
];
function icSeedDefaults() {
  Object.keys(IC_DEFAULT_ATTRS).forEach(cat => IC_DEFAULT_ATTRS[cat].forEach(([n, v], i) =>
    Store.put('attributes', { id: 'ca_' + icSlug(cat) + '_' + icSlug(n), category: cat, name: n, seq: i + 1, values: v.split(',').map(x => x.trim()) })));
  IC_DEFAULT_TYPES.forEach(r => Store.put('item_types', { id: 'it_' + icSlug(r[0] + '_' + r[1]), category: r[0], name: r[1], attrs: r[2].split(',').map(x => x.trim()), uom: r[3], hsn: r[4], gst: r[0] === 'Fabric' || r[0] === 'Packaging' ? 12 : 18 }));
}
// called from migrateDb on every login; fixed ids keep two browsers seeding at once consistent
function seedItemMasters() {
  // build 35 stored attributes globally (no category): move them under categories with a sequence
  const legacy = Store.all('attributes').filter(a => !a.category);
  if (legacy.length) {
    const byName = {}; legacy.forEach(a => { byName[norm(a.name)] = a; });
    legacy.forEach(a => Store.del('attributes', a.id));
    icSeedDefaults();
    Store.all('item_types').forEach(t => (t.attrs || []).forEach(n => {
      if (catAttrs(t.category).some(a => norm(a.name) === norm(n))) return;
      const src = byName[norm(n)];
      Store.put('attributes', { id: uid(), category: t.category, name: n, seq: catAttrs(t.category).length + 1, values: src ? src.values : [] });
    }));
    return;
  }
  if (!Store.all('attributes').length && !Store.all('item_types').length) icSeedDefaults();
}
