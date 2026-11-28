// What part each ingredient plays in a dish, so a disliked food can be judged fairly:
//   core       the dish is built around it (mushrooms in a mushroom risotto)
//   component  cooked into the dish, hard to take out (onion in a curry sauce)
//   garnish    a topping, garnish or single optional piece (peanuts on pad thai, a fried egg on top)
//   side       served alongside: a dip, a sauce on the side, rice or fries next to it
// Garnishes and sides are "removable": someone can ask to leave them out or just leave them.
// The sample menus carry hand-written roles (js/menus.js). A menu read from a photo has none, so
// inferRoles() guesses from the wording ("topped with", "served with", "on the side") and says so.
// No DOM: also runs in Node.
import { normIngredient } from './schema.js';

export const ROLES = ['core', 'component', 'garnish', 'side'];
export const REMOVABLE = new Set(['garnish', 'side']);
const MARK = { '!': 'core', '^': 'garnish', '~': 'side' };

/** "chicken!, peanut^, cucumber~, onion" → ingredient names and their roles (unmarked = component). */
export function parseMarked(list) {
  const ingredients = [], roles = {};
  for (const raw of list) {
    const s = String(raw).trim();
    if (!s) continue;
    const role = MARK[s.slice(-1)];
    const name = role ? s.slice(0, -1).trim() : s;
    ingredients.push(name);
    roles[name] = role ?? 'component';
  }
  return { ingredients, roles };
}

const fold = (s) => ` ${String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (text, ing) => { const w = ing.trim(); return text.includes(` ${w} `) || text.includes(` ${w}s `) || text.includes(` ${w}es `) || (w.endsWith('y') && text.includes(` ${w.slice(0, -1)}ies `)); };
const PROTEIN_WORDS = {
  chicken: ['chicken'], beef: ['beef', 'steak', 'brisket', 'short rib', 'oxtail', 'veal'], pork: ['pork', 'pork belly', 'bacon', 'ham', 'chorizo', 'sausage'],
  lamb: ['lamb', 'goat', 'mutton'], duck: ['duck'], fish: ['fish', 'salmon', 'tuna', 'cod', 'catfish', 'eel', 'sea bass', 'snapper', 'trout', 'mackerel', 'haddock', 'halibut', 'swordfish'],
  shellfish: ['shrimp', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster', 'squid', 'octopus'], egg: ['egg'], tofu: ['tofu'],
  legumes: ['lentil', 'chickpea', 'bean', 'dal'], cheese: ['cheese', 'paneer', 'halloumi', 'mozzarella', 'feta', 'burrata'],
};
// words that introduce removable things; each clause runs to the next such phrase or the end of the sentence
const CUES = [
  ['garnish', /\b(?:topped with|garnished with|sprinkled with|scattered with|finished with|dusted with|drizzled with|crowned with|with a sprinkle of|with crushed|with fresh herbs)\b/g],
  ['side', /\b(?:served with|on the side|alongside|with a side of|side of|for dipping|to dip|dipping sauce|with (?:a |an )?(?=[a-z ]*?\b(?:dip|salsa|chutney|relish|slaw|salad|rice|fries|chips|bread|pita|naan|toast|tortillas)\b))/g],
];
/** { garnish: "...", side: "..." }: the words in each kind of clause, folded. */
function cueClauses(text) {
  const out = { garnish: '', side: '' };
  for (const sentence of text.split(/[.;]/)) {
    const marks = [];
    for (const [kind, re] of CUES) for (const m of sentence.matchAll(re)) marks.push({ kind, at: m.index, end: m.index + m[0].length });
    marks.sort((a, b) => a.at - b.at);
    marks.forEach((m, i) => { out[m.kind] += fold(sentence.slice(m.end, marks[i + 1]?.at ?? sentence.length)); });
  }
  return out;
}
const GARNISH_WORDS = new Set(['cilantro', 'scallion', 'parsley', 'mint', 'dill', 'chive', 'sesame', 'fried shallot', 'crouton', 'bonito', 'nori', 'lime', 'lemon', 'sumac', 'pomegranate']);

/**
 * Best guess at each ingredient's role from a dish's name and description, for menus read from a photo.
 * @returns {Record<string, string>} normalised ingredient -> role
 */
export function inferRoles(d) {
  const ings = d.ingredients ?? [];
  const name = fold(String(d.name ?? '').split(/\bwith\b|\bw\/|,/i)[0]);
  const english = fold(String(d.englishName ?? '').split(/\bwith\b|,/i)[0]);
  const text = String([d.whatItIs, d.desc].filter(Boolean).join('. ')).toLowerCase();
  const { garnish: garnishText, side: sideText } = cueClauses(text);
  const main = new Set((d.mainIngredients ?? []).slice(0, 2).map((x) => normIngredient(x)));
  const prot = PROTEIN_WORDS[d.protein] ?? [];
  const roles = {};
  for (const ing of ings) {
    let role = 'component';
    if (has(name, ing) || has(english, ing) || prot.some((p) => ing === p || ing.endsWith(` ${p}`))) role = 'core';
    else if (has(garnishText, ing)) role = 'garnish';
    else if (has(sideText, ing)) role = 'side';
    else if (GARNISH_WORDS.has(ing)) role = 'garnish';
    else if (main.has(ing)) role = 'core';
    roles[ing] = role;
  }
  if (ings.length && !Object.values(roles).includes('core') && roles[ings[0]] === 'component') roles[ings[0]] = 'core';
  return roles;
}

/** The dish's roles: the hand-written ones, or a guess (cached) for a dish read from a photo. */
const guessed = new WeakMap();
export function rolesOf(d) {
  if (d.roles && typeof d.roles === 'object') return d.roles;
  let r = guessed.get(d);
  if (!r) { r = inferRoles(d); guessed.set(d, r); }
  return r;
}
/** True when the roles were guessed from the wording rather than written down. */
export const rolesAreGuess = (d) => !!d.rolesGuessed || !d.roles;

/** The most central of several roles: core > component > side > garnish. */
export function mostCentral(list) {
  for (const r of ['core', 'component', 'side', 'garnish']) if (list.includes(r)) return r;
  return null;
}
