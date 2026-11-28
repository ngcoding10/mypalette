// Everything MyPalette knows about this person, kept in this browser (localStorage, keys start
// with "mypalette."). Signed in, the same data is also synced to their private cloud profile.
// The training loop (guess, pick, learn, next menu, stop) lives here too, without any DOM, so the
// tests can run it in Node.
import { MENUS, menuById, menuPlan } from './menus.js';
import { ALLERGENS, CUISINES, DIET_RULES, NEVER_OPTIONS, normalizeDish } from './schema.js';
import { cuisineKeys, entryOf, parseList, RESTRICTIONS } from './foods.js';
import { rulesOf } from './rules.js';
import { train, compactWeights, topK } from './learner.js';
import { inferRoles } from './roles.js';

const KEY = 'mypalette.state.v1'; // the key stays; the data inside carries its own version (v)
// v3: dishes of menus read from a photo (meals, and the meal feedback the learner uses) carry ingredient
// roles (core, component, garnish, side), guessed from the menu wording. Older data gets them on load.
export const STATE_VERSION = 3;
const MAX_FEEDBACK = 25, MAX_MEALS = 20;
export const FIRST_GOAL = 10, MAX_ROUNDS = 25;

const randomId = (n = 20) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
};
export const newId = randomId;

function blank() {
  return { v: STATE_VERSION, intake: null, draft: null, rounds: [], pending: null, skipped: [], target: FIRST_GOAL, finished: false, feedback: [], meals: [], consent: false, sessionId: randomId(24), syncOffFor: null, updated: 0 };
}

// ───────── intake: chips in, plus the plain lists older code and the backend understand ─────────
const ALLERGEN_TO_CHIP = { peanut: 'peanuts', tree_nut: 'tree_nuts', dairy: 'dairy', egg: 'egg', gluten: 'gluten', soy: 'soy', fish: 'fish', shellfish: 'shellfish', sesame: 'sesame' };
const DIET_TO_CHIP = { vegetarian: 'vegetarian', vegan: 'vegan', pescatarian: 'pescatarian', no_pork: 'no_pork', no_beef: 'no_beef', gluten_free: 'gluten', dairy_free: 'dairy' };
const NEVER_TO_CHIP = { mushroom: 'food:mushroom', cilantro: 'food:cilantro', olive: 'food:olive', eggplant: 'food:eggplant', coconut: 'food:coconut', raw_fish: 'food:raw', seafood: 'food:seafood', pork: 'no_pork', lamb: 'food:lamb', offal: 'food:offal', blue_cheese: 'food:blue_cheese', anchovy: 'food:anchovies' };
const chipOf = (k) => { const e = entryOf(k, 'restriction'); return { t: e?.label ?? k, k, s: 'ok' }; };
const isChip = (c) => c && typeof c === 'object' && typeof c.t === 'string';
const chips = (list) => (Array.isArray(list) ? list.filter(isChip).slice(0, 40).map((c) => ({ t: String(c.t).slice(0, 40), k: typeof c.k === 'string' ? c.k : null, s: ['ok', 'fixed', 'unknown'].includes(c.s) ? c.s : (c.k ? 'ok' : 'unknown') })) : []);
const lvl = (v, max, d) => (Number.isInteger(v) && v >= 0 && v <= max ? v : d);

/** Any stored intake (v1 checkboxes, v2 chips, or a cloud copy from either) in the v2 shape. */
export function migrateIntake(i) {
  if (!i || typeof i !== 'object') return null;
  if (i.v === 2) return deriveIntake({ ...i, likes: chips(i.likes), dislikes: chips(i.dislikes), restrictions: chips(i.restrictions), cuisineChips: chips(i.cuisineChips) });
  // v1: diet rules, allergies and never-eat as keys; cuisines as keys
  const restrictions = [];
  const push = (c) => { if (c && !restrictions.some((x) => x.k === c.k)) restrictions.push(c); };
  for (const d of i.diet ?? []) if (DIET_TO_CHIP[d]) push(chipOf(DIET_TO_CHIP[d]));
  for (const a of i.allergies ?? []) if (ALLERGEN_TO_CHIP[a]) push(chipOf(ALLERGEN_TO_CHIP[a]));
  for (const n of i.never ?? []) {
    if (NEVER_TO_CHIP[n]) push(NEVER_TO_CHIP[n].startsWith('food:') ? { t: n.replace(/_/g, ' '), k: NEVER_TO_CHIP[n], s: 'ok' } : chipOf(NEVER_TO_CHIP[n]));
    else for (const c of parseList(String(n), 'restriction')) push(c.k ? c : { ...c, t: String(n).slice(0, 40) });
  }
  const cuisineChips = (i.cuisines ?? []).filter((c) => CUISINES.includes(c) && c !== 'other').map((c) => ({ t: c.replace('_', ' '), k: c, s: 'ok' }));
  return deriveIntake({ v: 2, name: typeof i.name === 'string' ? i.name.slice(0, 40) : '', likes: [], dislikes: [], restrictions, cuisineChips, spice: lvl(i.spice, 3, 1), adventure: lvl(i.adventure, 2, 1), at: Number(i.at) || 0 });
}

/**
 * Fill the plain lists from the chips: diet and allergies as schema keys, never as words, cuisines as
 * keys. Older copies of the app, the shared-session format and the menu reader read these.
 */
export function deriveIntake(i) {
  const r = rulesOf({ restrictions: i.restrictions });
  const never = [];
  for (const c of i.restrictions) {
    if (c.k?.startsWith('food:') || !c.k) never.push(String(c.t).toLowerCase().slice(0, 30));
    else if (entryOf(c.k, 'restriction')?.spec.W) never.push(c.k);
  }
  if (r.halal) never.push('alcohol');
  return {
    ...i,
    diet: [...r.diets].filter((d) => DIET_RULES.includes(d)),
    allergies: [...r.allergens].filter((a) => ALLERGENS.includes(a)),
    never: [...new Set(never)].slice(0, 12),
    cuisines: cuisineKeys(i.cuisineChips).filter((c) => CUISINES.includes(c)),
  };
}

/** A blank intake draft for the step-by-step questions. */
export const blankDraft = () => ({ step: 0, likes: [], dislikes: [], restrictions: [], cuisineChips: [], spice: 1, adventure: 1 });

/** A stored photo-menu dish with ingredient roles: kept when it has them, guessed from its words when not. */
export function withRoles(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.ingredients)) return d;
  if (d.roles && typeof d.roles === 'object') return d;
  return { ...d, roles: inferRoles(d), rolesGuessed: true };
}
/** v1/v2 meals and meal feedback → v3: add roles, taking a feedback dish's roles from its meal when there. */
function addRoles(s) {
  s.meals = s.meals.map((m) => (m && Array.isArray(m.dishes) ? { ...m, dishes: m.dishes.map(withRoles) } : m));
  s.feedback = s.feedback.map((f) => {
    if (!f || !Array.isArray(f.options)) return f;
    const meal = s.meals.find((m) => m?.id === f.id);
    return { ...f, options: f.options.map((o) => withRoles(o?.roles ? o : { ...o, ...(meal?.dishes?.find((x) => x.id === o?.id)?.roles ? { roles: meal.dishes.find((x) => x.id === o.id).roles, rolesGuessed: true } : {}) })) };
  });
}

/** Any stored state in the current shape. Never throws: unreadable data starts fresh. */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object' || ![1, 2, 3].includes(raw.v)) return blank();
  const s = { ...blank(), ...raw, v: STATE_VERSION };
  try { s.intake = migrateIntake(raw.intake); } catch { s.intake = null; }
  s.rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).filter((r) => r && menuById(r.menu) && Array.isArray(r.picked) && Array.isArray(r.predicted));
  s.skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((id) => menuById(id)) : [];
  s.feedback = Array.isArray(raw.feedback) ? raw.feedback : [];
  s.meals = Array.isArray(raw.meals) ? raw.meals : [];
  if (s.pending && (!menuById(s.pending.menu) || !Array.isArray(s.pending.picked))) s.pending = null;
  if (s.draft && typeof s.draft !== 'object') s.draft = null;
  if (raw.v < 3) addRoles(s);
  if (raw.v === 1) {
    // a v1 tester: they did up to 12 menus already; offer the rest without making them start over
    s.target = Math.min(MAX_ROUNDS, Math.max(FIRST_GOAL, s.rounds.length));
    s.finished = false;
    delete s.order;
  }
  s.target = [FIRST_GOAL, MAX_ROUNDS].includes(s.target) || (s.target > FIRST_GOAL && s.target <= MAX_ROUNDS) ? s.target : FIRST_GOAL;
  return s;
}

function load() {
  try {
    return migrateState(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'));
  } catch { return blank(); } // private mode or broken data: start fresh
}

export const store = new EventTarget();
let state = load();
let model = null;

export const get = () => state;

function persist() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep going in memory */ }
}

/** Change the state, save it, retrain if needed, and tell the page. */
export function update(fn, { retrain = true, sync = true } = {}) {
  fn(state);
  state.updated = Date.now();
  if (retrain) model = null;
  persist();
  store.dispatchEvent(new CustomEvent('change', { detail: { sync } }));
}

export function replaceAll(next) {
  state = migrateState({ ...blank(), ...next });
  model = null;
  persist();
  store.dispatchEvent(new CustomEvent('change', { detail: { sync: false } }));
}

/** Save the intake (from the draft or the edit page). Clears a pending guess so it is made again. */
export function saveIntake(fields) {
  const intake = deriveIntake({ v: 2, name: '', ...fields, likes: chips(fields.likes), dislikes: chips(fields.dislikes), restrictions: chips(fields.restrictions), cuisineChips: chips(fields.cuisineChips), spice: lvl(fields.spice, 3, 1), adventure: lvl(fields.adventure, 2, 1), at: Date.now() });
  delete intake.step;
  update((s) => { s.intake = intake; s.draft = null; s.pending = null; });
  return intake;
}

// ───────── learning input ─────────
/** Rounds and meal feedback, in the learner's input shape. */
export function learnerRounds(s = state) {
  const out = [];
  for (const r of s.rounds) {
    const m = menuById(r.menu);
    if (m) out.push({ options: m.dishes, picked: r.picked, predicted: r.predicted ?? [], never: r.never ?? [] });
  }
  for (const f of s.feedback) out.push({ options: f.options, picked: f.liked, never: f.disliked, weight: 1.5 });
  return out;
}

/** The fitted model (cached until something changes). */
export function getModel() {
  if (!model) model = train(state.intake ?? {}, learnerRounds());
  return model;
}

/** How a round went: how many of their picks it had guessed. */
export const roundScore = (r) => ({ got: r.predicted.filter((id) => r.picked.includes(id)).length, of: r.picked.length });

export function stats(s = state) {
  const n = s.rounds.length;
  const series = s.rounds.map(roundScore);
  const got = series.reduce((a, x) => a + x.got, 0), of = series.reduce((a, x) => a + x.of, 0);
  const hits = series.filter((x) => x.got > 0).length;
  const share = (list) => { const o = list.reduce((a, x) => a + x.of, 0); return o ? list.reduce((a, x) => a + x.got, 0) / o : 0; };
  return {
    rounds: n, hits, rate: n ? hits / n : 0, got, of, share: of ? got / of : 0, series,
    first: share(series.slice(0, 3)), last: share(series.slice(-3)),
    meals: s.meals.length, feedback: s.feedback.length,
  };
}

// ───────── the training loop ─────────
/** The next sample menu, or null when they reached their goal, stopped, or did every menu. */
export function nextMenuId(s = state) {
  if (!s.intake || s.finished || s.rounds.length >= Math.min(s.target, MAX_ROUNDS)) return null;
  const done = new Set([...s.rounds.map((r) => r.menu), ...s.skipped]);
  return menuPlan(s.intake).find((id) => !done.has(id)) ?? null;
}

/** How many sample menus they have not done or skipped yet. */
export function menusLeft(s = state) {
  if (!s.intake) return 0;
  const done = new Set([...s.rounds.map((r) => r.menu), ...s.skipped]);
  return menuPlan(s.intake).filter((id) => !done.has(id)).length;
}

/** Where the person is: answering questions, on a menu, deciding whether to go on, or done. */
export function phase(s = state) {
  if (!s.intake) return 'intake';
  if (s.pending || nextMenuId(s)) return 'round';
  const more = !s.finished && s.rounds.length < MAX_ROUNDS && s.target < MAX_ROUNDS && menuPlan(s.intake).some((id) => !s.rounds.some((r) => r.menu === id) && !s.skipped.includes(id));
  return more ? 'offer' : 'done';
}

/** Show the next menu: its top-3 guess is made now, from everything learned so far, and stored. */
export function startRound() {
  if (state.pending) return state.pending;
  const id = nextMenuId();
  if (!id) return null;
  const menu = menuById(id);
  const predicted = topK(getModel(), menu.dishes, state.intake, 3);
  const pending = { id: newId(12), menu: id, predicted, picked: [], at: Date.now() };
  update((s) => { s.pending = pending; }, { retrain: false, sync: false });
  return pending;
}

/** Tap a dish: add it to their top 3, or take it out. Returns false when 3 are already picked. */
export function togglePick(dishId) {
  const p = state.pending;
  if (!p) return false;
  if (!p.picked.includes(dishId) && p.picked.length >= 3) return false;
  update((s) => { const q = s.pending; q.picked = q.picked.includes(dishId) ? q.picked.filter((x) => x !== dishId) : [...q.picked, dishId]; }, { retrain: false, sync: false });
  return true;
}

/** Lock in their picks: the round is stored with the guess, and the model retrains on it. */
export function finishRound() {
  const p = state.pending;
  if (!p || !p.picked.length) return null;
  const round = { id: p.id, menu: p.menu, predicted: p.predicted, picked: p.picked.slice(0, 3), at: p.at, hit: p.predicted.some((id) => p.picked.includes(id)) };
  update((s) => { s.rounds.push(round); s.pending = null; });
  return round;
}

/** Nothing on this menu for them: skip it without learning anything. */
export function skipMenu() {
  const p = state.pending;
  if (!p) return;
  update((s) => { s.skipped.push(p.menu); s.pending = null; }, { retrain: false, sync: false });
}

/** Stop training now. Everything answered so far is kept and used. */
export function stopTraining() {
  update((s) => { s.finished = true; s.pending = null; }, { retrain: false });
}

/** After the first 10: carry on, up to 25 menus. */
export function keepGoing() {
  update((s) => { s.target = MAX_ROUNDS; s.finished = false; }, { retrain: false });
}

/** Start the menus again from the beginning of the plan (answers so far are kept and learned from). */
export function trainMore() {
  update((s) => { s.finished = false; if (s.rounds.length >= s.target) s.target = MAX_ROUNDS; }, { retrain: false });
}

// ───────── what may leave this browser ─────────
const known = (list, allowed) => (list ?? []).filter((x) => allowed.includes(x));

/** The anonymous session shared with consent: intake choices without free text, and the rounds. */
export function sharedSession(s = state) {
  const i = s.intake ?? {};
  return {
    v: 1,
    intake: {
      diet: known(i.diet, DIET_RULES), allergies: known(i.allergies, ALLERGENS),
      never: known(i.never, NEVER_OPTIONS.map((o) => o.key)),
      spice: Number.isInteger(i.spice) ? i.spice : 1, adventure: Number.isInteger(i.adventure) ? i.adventure : 1,
      cuisines: known(i.cuisines, CUISINES),
    },
    rounds: s.rounds.slice(0, 60).map((r) => ({ menu: r.menu, predicted: r.predicted.slice(0, 3), picked: r.picked.slice(0, 3), never: (r.never ?? []).slice(0, 20), at: r.at })),
  };
}

/** Compact dish tags for storing a meal's options in the history (no long text). */
export const compactDish = (d) => ({ id: d.id, name: String(d.name).slice(0, 80), cuisine: d.cuisine, course: d.course, protein: d.protein, diet: d.diet, method: d.method, heat: d.heat, richness: d.richness, sweetness: d.sweetness, sourness: d.sourness, umami: d.umami, texture: d.texture, ingredients: d.ingredients, carb: d.carb, familiarity: d.familiarity, temperature: d.temperature, allergens: d.allergens, ...(d.roles ? { roles: d.roles, ...(d.rolesGuessed ? { rolesGuessed: true } : {}) } : {}) });

/** The private cloud profile document (palette_users/{uid}). Same fields as before; the intake map carries v: 2. */
export function cloudProfile(s = state) {
  const m = getModel();
  let feedback = s.feedback.slice(-MAX_FEEDBACK);
  const extra = { skipped: s.skipped, target: s.target, finished: s.finished };
  let history = JSON.stringify({ v: STATE_VERSION, rounds: s.rounds, feedback, meals: s.meals.slice(-MAX_MEALS), ...extra });
  while (history.length > 590_000 && feedback.length) { feedback = feedback.slice(1); history = JSON.stringify({ v: STATE_VERSION, rounds: s.rounds, feedback, meals: [], ...extra }); }
  const st = stats(s);
  return { intake: s.intake ?? {}, weights: compactWeights(m.w), stats: { rounds: st.rounds, hits: st.hits, meals: st.meals, guessed: st.got, picks: st.of }, history };
}

/** Merge a cloud profile into this browser's data: union of rounds, feedback and meals; newer intake wins. */
export function mergeCloud(doc) {
  if (!doc) return false;
  let remote;
  try { remote = JSON.parse(doc.history || '{}'); } catch { remote = {}; }
  const byId = (a = [], b = []) => { const m = new Map(); for (const x of [...a, ...b]) if (x?.id && !m.has(x.id)) m.set(x.id, x); return [...m.values()].sort((x, y) => (x.at ?? 0) - (y.at ?? 0)); };
  const before = JSON.stringify([state.rounds, state.feedback, state.meals, state.intake, state.target, state.finished]);
  update((s) => {
    // one round per menu: keep the earliest answer for each
    s.rounds = byId(s.rounds, remote.rounds).filter((r, i, all) => menuById(r.menu) && Array.isArray(r.predicted) && all.findIndex((x) => x.menu === r.menu) === i);
    s.feedback = byId(s.feedback, remote.feedback).slice(-MAX_FEEDBACK);
    s.meals = byId(s.meals, remote.meals).slice(-MAX_MEALS);
    addRoles(s); // a cloud copy from an older version of the app has no roles yet
    s.skipped = [...new Set([...s.skipped, ...(Array.isArray(remote.skipped) ? remote.skipped : [])])].filter((id) => menuById(id));
    if (Number.isInteger(remote.target)) s.target = Math.min(MAX_ROUNDS, Math.max(s.target, remote.target));
    if (s.rounds.length > s.target) s.target = Math.min(MAX_ROUNDS, s.rounds.length);
    const ri = doc.intake && Object.keys(doc.intake).length ? migrateIntake(doc.intake) : null;
    if (ri && (!s.intake || (ri.at ?? 0) > (s.intake.at ?? 0))) s.intake = ri;
    if (s.pending && s.rounds.some((r) => r.menu === s.pending.menu)) s.pending = null;
  }, { sync: false });
  return before !== JSON.stringify([state.rounds, state.feedback, state.meals, state.intake, state.target, state.finished]);
}

/** A menu read by the backend, turned into dishes the learner understands, with their display text kept. */
export function dishesFromReading(menu) {
  // The menu reader gives ingredients but not their roles, so they are guessed from its wording
  // ("topped with", "served with", "on the side") and marked as a guess.
  return (menu.dishes ?? []).map((d, i) => withRoles({
    ...normalizeDish({ ...d.tags, id: `d${i}`, name: d.name }),
    englishName: d.englishName ?? '', section: d.section ?? '', price: d.price ?? '', whatItIs: d.whatItIs ?? '',
    mainIngredients: d.mainIngredients ?? [], heatNote: d.heatNote ?? '', allergenNote: d.allergenNote ?? '',
  }));
}

export { MAX_MEALS, MENUS, RESTRICTIONS };
