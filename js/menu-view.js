// Menus drawn like printed ones: a paper sheet with the restaurant's name and tagline, sections in
// menu order (starters, mains, sides, desserts), each dish with dot leaders to its price, a line of
// key ingredients and small dietary marks (V, VG, GF, chili heat) explained in a legend.
// One system, a print style per kind of place (a trattoria, a ramen bar, a taqueria ...), set by
// data-style on the sheet and coloured in css/style.css. Returns HTML strings; no DOM access here.
import { LABELS } from './schema.js';
import { allowed, cautions } from './rules.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────── sections ─────────
const ORDER = ['starter', 'soup', 'salad', 'pizza', 'noodles', 'main', 'side', 'dessert', 'drink'];
const TITLES = { starter: 'Starters', soup: 'Soups', salad: 'Salads', pizza: 'Pizza', noodles: 'Pasta', main: 'Mains', side: 'Sides', dessert: 'Desserts', drink: 'Drinks' };
// a small line above some section titles, in the menu's own language or voice
const KICKERS = {
  trattoria: { starter: 'Antipasti', soup: 'Zuppe', salad: 'Insalate', pizza: 'Pizze', noodles: 'Primi', main: 'Secondi', side: 'Contorni', dessert: 'Dolci' },
  bistro: { starter: 'Entrées', soup: 'Soupes', salad: 'Salades', main: 'Plats', side: 'Garnitures', dessert: 'Desserts' },
  taqueria: { starter: 'Para empezar', soup: 'Sopas', salad: 'Ensaladas', main: 'Platos fuertes', side: 'Acompañantes', dessert: 'Postres' },
  bodega: { starter: 'Tapas', main: 'Raciones', dessert: 'Postres' },
  izakaya: { starter: 'Otsumami', soup: 'Shiru', salad: 'Sarada', noodles: 'Men', main: 'Gohan & more', dessert: 'Amami' },
};
const STYLE_TITLES = {
  bodega: { starter: 'Small plates', main: 'Larger plates' },
  izakaya: { starter: 'Small plates', noodles: 'Ramen & noodles', main: 'Rice & mains' },
  taverna: { starter: 'Meze & starters' },
  chophouse: { main: 'From the grill', side: 'Sides to share' },
};

const ID_TITLES = {
  'dim-sum': { starter: 'Dim sum', main: 'Larger plates' }, bbq: { main: 'From the pit' }, brunch: { starter: 'To start', main: 'Plates' },
  'seafood-house': { starter: 'Raw bar & starters', main: 'From the sea' }, japanese: { main: 'Sushi & mains' },
};

/** Which section a sample-menu dish goes in. Pizza and pasta get their own, as on real menus. */
function sectionKey(d, menu) {
  if (d.course !== 'main') return d.course;
  if (d.ingredients.includes('pizza dough')) return 'pizza';
  if (d.carb === 'noodle' && ['trattoria', 'izakaya'].includes(menu.style) && menu.id !== 'japanese') return 'noodles';
  return 'main';
}

/** A sample menu's dishes grouped into sections, in menu order. */
export function sectionsOf(menu) {
  const groups = new Map();
  for (const d of menu.dishes) { const k = sectionKey(d, menu); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  return ORDER.filter((k) => groups.has(k)).map((k) => ({
    key: k,
    title: ID_TITLES[menu.id]?.[k] ?? STYLE_TITLES[menu.style]?.[k] ?? TITLES[k],
    kicker: KICKERS[menu.style]?.[k] ?? '',
    dishes: groups.get(k),
  }));
}

const COURSE_SECTION = { starter: 'Starters', soup: 'Soups', salad: 'Salads', main: 'Mains', side: 'Sides', dessert: 'Desserts', drink: 'Drinks' };
/** A menu read from a photo: its own printed sections when it had them, otherwise by course. */
export function sectionsOfReading(dishes) {
  const out = [];
  const printed = dishes.some((d) => d.section);
  for (const d of dishes) {
    const title = (printed && d.section) || COURSE_SECTION[d.course] || 'Dishes';
    let g = out.find((x) => x.title.toLowerCase() === title.toLowerCase());
    if (!g) out.push(g = { key: `s${out.length}`, title, kicker: '', dishes: [] });
    g.dishes.push(d);
  }
  if (!printed) out.sort((a, b) => ORDER.indexOf(a.dishes[0].course) - ORDER.indexOf(b.dishes[0].course));
  return out;
}

/** A print style for a menu read from a photo, from the cuisine it guessed. */
export function styleForCuisine(text) {
  const t = String(text ?? '').toLowerCase();
  const rules = [
    [/pizz|trattoria|italian/, 'trattoria'], [/french|bistro|brasserie/, 'bistro'], [/mexic|taco|peru|latin/, 'taqueria'], [/spanish|tapas/, 'bodega'],
    [/japan|ramen|sushi|izakaya/, 'izakaya'], [/chinese|dim sum|cantonese|sichuan/, 'teahouse'], [/greek|turkish|lebanese|middle eastern|mediterranean|levant/, 'taverna'],
    [/indian|ethiopian|nepal|sri lank/, 'tiffin'], [/steak|chophouse/, 'chophouse'], [/diner|american|burger|bbq|barbecue|seafood/, 'diner'],
    [/thai|vietnam|korean|noodle/, 'noodle'], [/caribbean|jamaican/, 'island'], [/vegan|plant|cafe|brunch/, 'garden'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'plain';
}

// ───────── marks ─────────
const GLUTEN = { allergies: ['gluten'] };
/** Small dietary marks: VG or V, GF (no gluten ingredients and nothing unclear), heat 0-3. */
export function marksOf(d) {
  return {
    veg: d.diet === 'vegan' ? 'VG' : d.diet === 'vegetarian' ? 'V' : '',
    gf: allowed(d, GLUTEN) && cautions(d, GLUTEN).length === 0,
    heat: d.heat ?? 0,
  };
}
const chili = '<svg class="chili" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.9 1.1c.4-.2.9 0 1 .4.2.4 0 .8-.4 1l-.9.4c.5.5.8 1.2.8 2 0 3.9-4 8.7-10 9.9-.7.1-1.1-.8-.5-1.2 3-2.1 4.4-4.6 5.1-7.1.4-1.5 1.7-2.6 3.3-2.7.4 0 .8 0 1.1.1z"/><path d="M11.6 2.7c-.6-.9-.4-1.9.2-2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const HEAT_WORD = ['', 'mild', 'medium heat', 'hot'];
export function marksHtml(d) {
  const m = marksOf(d);
  const bits = [];
  if (m.veg) bits.push(`<abbr class="mk" title="${m.veg === 'VG' ? 'vegan' : 'vegetarian'}"><span aria-hidden="true">${m.veg}</span><span class="sr">${m.veg === 'VG' ? 'vegan' : 'vegetarian'}</span></abbr>`);
  if (m.gf) bits.push('<abbr class="mk" title="no gluten ingredients"><span aria-hidden="true">GF</span><span class="sr">no gluten ingredients</span></abbr>');
  if (m.heat) bits.push(`<span class="mk-heat" title="${HEAT_WORD[m.heat]}">${chili.repeat(m.heat)}<span class="sr">${HEAT_WORD[m.heat]}</span></span>`);
  return bits.length ? `<span class="marks">${bits.join('')}</span>` : '';
}
export const legendHtml = () => `<p class="legend"><span><b>V</b> vegetarian</span><span><b>VG</b> vegan</span><span><b>GF</b> no gluten ingredients (ask about the kitchen)</span><span>${chili}<span class="sr">chili icon:</span> heat, 1 to 3</span></p>`;

export const priceText = (p) => (typeof p === 'number' ? `$${p}` : String(p ?? '').trim());

// ───────── the sheet ─────────
/**
 * @param head { name, tagline, kicker, style }
 * @param sections from sectionsOf / sectionsOfReading
 * @param entry (dish) -> the <li> for one dish
 */
export function sheetHtml(head, sections, entry, { id = 'menu', after = '' } = {}) {
  return `<article class="sheet" data-style="${esc(head.style || 'plain')}" aria-labelledby="${id}-name">
    <header class="sheet-head">
      ${head.kicker ? `<p class="sheet-kicker">${esc(head.kicker)}</p>` : ''}
      <h2 class="sheet-name" id="${id}-name">${esc(head.name)}</h2>
      ${head.tagline ? `<p class="sheet-tag">${esc(head.tagline)}</p>` : ''}
      <div class="orn" aria-hidden="true"><i></i><b></b><i></i></div>
    </header>
    ${legendHtml()}
    ${sections.map((s, i) => `<section class="msec" aria-labelledby="${id}-s${i}">
      <h3 class="msec-h" id="${id}-s${i}">${s.kicker ? `<span class="msec-k">${esc(s.kicker)}</span>` : ''}<span class="msec-t">${esc(s.title)}</span></h3>
      <ul class="entries">${s.dishes.map(entry).join('')}</ul>
    </section>`).join('')}
    ${after}
  </article>`;
}

/**
 * One dish on the sheet.
 * @param o { mode: 'pick'|'view', picked: 0-based pick number or -1, ours: 0-based "our pick" or -1,
 *            blocked: [{text}], notes: [{cls, text}], sub: extra line under the name, after: html after }
 */
export function entryHtml(d, o = {}) {
  const ours = o.ours ?? -1, picked = o.picked ?? -1;
  const blocked = o.blocked ?? [];
  const price = priceText(d.price);
  const desc = d.desc || d.whatItIs || '';
  const cls = ['entry', picked >= 0 ? 'on' : '', ours >= 0 ? 'ours' : '', blocked.length ? 'blocked' : ''].filter(Boolean).join(' ');
  const body = `${ours >= 0 ? `<span class="ours-tag">Our pick #${ours + 1}</span>` : ''}
      <span class="line"><span class="dname">${esc(d.name)}</span><span class="leader" aria-hidden="true"></span>${price ? `<span class="dprice">${esc(price)}</span>` : ''}</span>
      ${o.sub ? `<span class="dsub">${esc(o.sub)}</span>` : ''}
      ${desc ? `<span class="ddesc">${esc(desc)}</span>` : ''}
      ${marksHtml(d)}`;
  const notes = [...blocked.map((b) => ({ cls: 'n-flag', text: `Not for you: ${b.text}` })), ...(o.notes ?? [])]
    .map((n) => `<p class="enote ${n.cls ?? ''}">${esc(n.text)}</p>`).join('');
  if (o.mode === 'pick' && !blocked.length) {
    return `<li class="${cls}" data-dish="${esc(d.id)}">
      <button class="entry-tap" type="button" data-action="pick" data-id="${esc(d.id)}" aria-pressed="${picked >= 0}">
        <span class="check" aria-hidden="true">${picked >= 0 ? picked + 1 : ''}</span>${body}
        <span class="yours">${picked >= 0 ? `Your pick #${picked + 1}` : ''}</span>
      </button>${notes}${o.after ?? ''}</li>`;
  }
  return `<li class="${cls}" data-dish="${esc(d.id)}"><div class="entry-body">${body}</div>${notes}${o.after ?? ''}</li>`;
}

const KIND = {
  pizzeria: 'Pizzeria', 'ramen-bar': 'Ramen bar', japanese: 'Sushi bar', 'dim-sum': 'Dim sum teahouse', peruvian: 'Cevichería', mexican: 'Taquería',
  italian: 'Trattoria', 'french-bistro': 'Bistro', tapas: 'Tapas bar', greek: 'Taverna', turkish: 'Charcoal grill', steakhouse: 'Steakhouse',
  bbq: 'Texas smokehouse', 'seafood-house': 'Oyster bar', diner: 'Diner', brunch: 'Brunch café', 'plant-cafe': 'Plant-based café', caribbean: 'Caribbean takeaway',
  'south-indian': 'Tiffin house', ethiopian: 'Ethiopian kitchen', korean: 'Korean barbecue', chinese: 'Cantonese & Sichuan', thai: 'Thai kitchen',
  vietnamese: 'Noodle house', indian: 'Indian kitchen', 'middle-eastern': 'Levantine grill',
};
const CUISINE_WORD = { turkish: 'Turkish', bbq: '', 'seafood-house': 'New England', steakhouse: '', brunch: '', 'plant-cafe': '', peruvian: 'Peruvian', caribbean: '' };
/** The small line above a sample menu's name: "Trattoria · Italian · $$". */
export function kickerOf(menu) {
  const kind = KIND[menu.id] ?? '';
  const cuisine = CUISINE_WORD[menu.id] ?? (LABELS.cuisine[menu.cuisine] && menu.cuisine !== 'other' ? LABELS.cuisine[menu.cuisine] : menu.title);
  const said = kind.toLowerCase();
  return [kind, !cuisine || said.includes(cuisine.toLowerCase().split(' ')[0]) || kind === 'Cantonese & Sichuan' ? '' : cuisine, menu.tier].filter(Boolean).join(' · ');
}
