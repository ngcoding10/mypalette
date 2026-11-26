// Everything MyPalette knows about this person, kept in this browser (localStorage, keys start
// with "mypalette."). Signed in, the same data is also synced to their private cloud profile.
import { MENUS, menuById } from './menus.js';
import { NEVER_OPTIONS, normalizeDish, DIET_RULES, ALLERGENS, CUISINES } from './schema.js';
import { train, compactWeights } from './learner.js';

const KEY = 'mypalette.state.v1';
const MAX_FEEDBACK = 25, MAX_MEALS = 20;

const randomId = (n = 20) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
};
export const newId = randomId;

function blank() {
  return { v: 1, intake: null, rounds: [], pending: null, feedback: [], meals: [], consent: false, sessionId: randomId(24), order: null, syncOffFor: null, updated: 0 };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && raw.v === 1) return { ...blank(), ...raw };
  } catch { /* private mode or broken data: start fresh */ }
  return blank();
}

export const store = new EventTarget();
let state = load();
let model = null;

export const get = () => state;

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep going in memory */ }
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
  state = { ...blank(), ...next };
  model = null;
  persist();
  store.dispatchEvent(new CustomEvent('change', { detail: { sync: false } }));
}

// ───────── learning input ─────────
/** Rounds and meal feedback, in the learner's input shape. */
export function learnerRounds(s = state) {
  const out = [];
  for (const r of s.rounds) {
    const m = menuById(r.menu);
    if (m) out.push({ options: m.dishes, picked: r.picked, never: r.never ?? [] });
  }
  for (const f of s.feedback) out.push({ options: f.options, picked: f.liked, never: f.disliked, weight: 1.5 });
  return out;
}

/** The fitted model (cached until something changes). */
export function getModel() {
  if (!model) model = train(state.intake ?? {}, learnerRounds());
  return model;
}

export function stats(s = state) {
  const n = s.rounds.length;
  const hits = s.rounds.filter((r) => r.hit).length;
  return { rounds: n, hits, rate: n ? hits / n : 0, meals: s.meals.length, feedback: s.feedback.length };
}

/** A random but fixed menu order for this person, so everyone does not start with the same menu. */
export function menuOrder() {
  if (!state.order || state.order.length !== MENUS.length || MENUS.some((m) => !state.order.includes(m.id))) {
    const ids = MENUS.map((m) => m.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    update((s) => { s.order = ids; }, { retrain: false, sync: false });
  }
  return state.order;
}

export function nextMenuId() {
  const done = new Set(state.rounds.map((r) => r.menu));
  return menuOrder().find((id) => !done.has(id)) ?? null;
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
export const compactDish = (d) => ({ id: d.id, name: String(d.name).slice(0, 80), cuisine: d.cuisine, course: d.course, protein: d.protein, diet: d.diet, method: d.method, heat: d.heat, richness: d.richness, sweetness: d.sweetness, sourness: d.sourness, umami: d.umami, texture: d.texture, ingredients: d.ingredients, carb: d.carb, familiarity: d.familiarity, temperature: d.temperature, allergens: d.allergens });

/** The private cloud profile document (palette_users/{uid}). */
export function cloudProfile(s = state) {
  const m = getModel();
  let feedback = s.feedback.slice(-MAX_FEEDBACK);
  let history = JSON.stringify({ v: 1, rounds: s.rounds, feedback, meals: s.meals.slice(-MAX_MEALS) });
  while (history.length > 590_000 && feedback.length) { feedback = feedback.slice(1); history = JSON.stringify({ v: 1, rounds: s.rounds, feedback, meals: [] }); }
  const st = stats(s);
  return { intake: s.intake ?? {}, weights: compactWeights(m.w), stats: { rounds: st.rounds, hits: st.hits, meals: st.meals }, history };
}

/** Merge a cloud profile into this browser's data: union of rounds, feedback and meals; newer intake wins. */
export function mergeCloud(doc) {
  if (!doc) return false;
  let remote;
  try { remote = JSON.parse(doc.history || '{}'); } catch { remote = {}; }
  const byId = (a = [], b = []) => { const m = new Map(); for (const x of [...a, ...b]) if (x?.id && !m.has(x.id)) m.set(x.id, x); return [...m.values()].sort((x, y) => (x.at ?? 0) - (y.at ?? 0)); };
  const before = JSON.stringify([state.rounds, state.feedback, state.meals, state.intake]);
  update((s) => {
    // one round per menu: keep the earliest answer for each
    const rounds = byId(s.rounds, remote.rounds).filter((r, i, all) => all.findIndex((x) => x.menu === r.menu) === i);
    s.rounds = rounds;
    s.feedback = byId(s.feedback, remote.feedback).slice(-MAX_FEEDBACK);
    s.meals = byId(s.meals, remote.meals).slice(-MAX_MEALS);
    const ri = doc.intake && Object.keys(doc.intake).length ? doc.intake : null;
    if (ri && (!s.intake || (ri.at ?? 0) > (s.intake.at ?? 0))) s.intake = ri;
    if (s.pending && s.rounds.some((r) => r.menu === s.pending.menu)) s.pending = null;
  }, { sync: false });
  return before !== JSON.stringify([state.rounds, state.feedback, state.meals, state.intake]);
}

/** A menu read by the backend, turned into dishes the learner understands, with their display text kept. */
export function dishesFromReading(menu) {
  return (menu.dishes ?? []).map((d, i) => ({
    ...normalizeDish({ ...d.tags, id: `d${i}`, name: d.name }),
    englishName: d.englishName ?? '', section: d.section ?? '', price: d.price ?? '', whatItIs: d.whatItIs ?? '',
    mainIngredients: d.mainIngredients ?? [], heatNote: d.heatNote ?? '', allergenNote: d.allergenNote ?? '',
  }));
}

export { MAX_MEALS };
