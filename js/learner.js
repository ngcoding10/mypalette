// The "teachable" part: a small, explainable preference model that runs in the browser.
//
// Each dish becomes a handful of named features (cuisine:thai, carb:noodle, ing:peanut, heat:3 ...).
// A person's taste is one weight per feature; a dish's score is the sum of its features' weights.
// Training treats every round as "from this menu, they picked these": a softmax choice model
// (multinomial logit) fitted by gradient ascent, pulled towards a starting point built from the
// intake answers (L2 regularisation), so a few rounds move it a little and many rounds a lot.
// Allergies, diets and must-avoid foods are hard filters (js/rules.js), not weights.
// Foods the person typed as liked become a personal feature, "like" (how many of their liked foods a
// dish has). Disliked foods are soft, never a filter, and count by the part they play in the dish
// (js/roles.js): "dislike" when the dish is built around it (a large penalty), "dislikeMixed" when it is
// cooked in and hard to take out (a medium one), "dislikePick" when it is a garnish, topping or side
// they could ask to leave out (a small one). All start from the intake and are then fitted like any
// other weight, never above zero: if someone keeps picking dishes with a disliked garnish, they do not
// mind picking it out, so that penalty shrinks for them.
// Each round also says what the learner guessed. Besides the choice model, every guessed dish the
// person did not pick is compared with each dish they did pick (a pairwise "this, not that" term),
// so it learns most from where its guess and the person differ.
// No DOM, no dependencies: it also runs in Node for the tests and tools/evaluate.mjs.
import { LABELS } from './schema.js';
import { allowed, conflicts, rulesOf } from './rules.js';
import { chipLabel, cuisineKeys, featureHints, matchDetail, tasteMatcher } from './foods.js';
import { REMOVABLE, mostCentral, rolesAreGuess, rolesOf } from './roles.js';

export const LEARNER_VERSION = 3;
// Tuned on synthetic people with tools/evaluate-intake.mjs; exported so tools can try other values.
export const TUNING = {
  lambda: 1.0,      // pull towards the intake prior; higher = slower to change its mind
  never: 0.5,       // a "would never order" counts half as much as a pick
  pair: 0.5,        // the guessed-but-not-picked vs picked comparison, per pair
  iterations: 120,
  roles: true,      // false = the old scoring: every disliked food counts the same, whatever its role
  lambdaDislike: 0.5, // the dislike weights move faster than the rest: tolerance is personal
};
export const PRIOR = { like: 0.9, dislike: -2.0, dislikeMixed: -1.1, dislikePick: -0.45, likeHint: 0.3, dislikeHint: -0.4, cuisine: 0.5 };
const DISLIKE_KEYS = ['dislike', 'dislikeMixed', 'dislikePick'];

const centred = (v) => (v - 1.5) / 1.5; // 0..3 -> -1..1

// ───────── personal preferences from the intake ─────────
const prefCache = new WeakMap();
/** Liked and disliked foods as tests over dishes, compiled once per intake. */
export function prefsOf(intake = {}) {
  let p = prefCache.get(intake);
  if (!p) {
    const chips = (list) => (Array.isArray(list) ? list : []);
    p = {
      like: chips(intake.likes).map((c) => ({ label: chipLabel(c, 'food'), test: tasteMatcher(c, 'food') })),
      dislike: chips(intake.dislikes).map((c) => ({ label: chipLabel(c, 'food'), detail: matchDetail(c, 'food') })),
      cache: [new WeakMap(), new WeakMap()], // per scoring mode (TUNING.roles off / on)
    };
    prefCache.set(intake, p);
  }
  return p;
}

/**
 * Which of their disliked foods a dish has, and the part each plays in it.
 * @returns {{ label: string, role: 'core'|'component'|'garnish'|'side', removable: boolean, ing: string|null, guess: boolean }[]}
 */
export function dislikeHits(d, prefs) {
  const out = [];
  for (const x of prefs?.dislike ?? []) {
    const m = x.detail(d);
    if (!m) continue;
    let role, ing = null;
    if (m.via === 'tag' || m.inName) role = 'core';
    else if (m.ings.length) {
      const roles = rolesOf(d);
      role = mostCentral(m.ings.map((i) => roles[i] ?? 'component'));
      ing = m.ings.find((i) => (roles[i] ?? 'component') === role) ?? m.ings[0];
    } else role = 'component'; // only in the description: assume it is cooked in
    out.push({ label: x.label, role, removable: REMOVABLE.has(role), ing, guess: m.via === 'word' && !m.inName && rolesAreGuess(d) });
  }
  return out;
}

function personal(d, prefs) {
  if (!prefs || (!prefs.like.length && !prefs.dislike.length)) return null;
  const cache = prefs.cache[TUNING.roles ? 1 : 0];
  let v = cache.get(d);
  if (!v) {
    let like = 0;
    for (const t of prefs.like) if (t.test(d)) like++;
    const n = { dislike: 0, dislikeMixed: 0, dislikePick: 0 };
    for (const h of dislikeHits(d, prefs)) {
      const k = !TUNING.roles || h.role === 'core' ? 'dislike' : h.removable ? 'dislikePick' : 'dislikeMixed';
      n[k]++;
    }
    v = [['like', Math.min(2, like)], ...DISLIKE_KEYS.map((k) => [k, Math.min(2, n[k])])].filter(([, x]) => x > 0);
    cache.set(d, v);
  }
  return v;
}

const featCache = new WeakMap();
/** Named features of one (normalised) dish, plus "like" and "dislike" for a person when given. */
export function features(d, prefs = null) {
  let f = featCache.get(d);
  if (!f) { f = dishFeatures(d); featCache.set(d, f); }
  const p = personal(d, prefs);
  if (!p || !p.length) return f;
  const out = new Map(f);
  for (const [k, v] of p) out.set(k, v);
  return out;
}

function dishFeatures(d) {
  const f = new Map();
  const add = (k, v = 1) => f.set(k, (f.get(k) ?? 0) + v);
  add(`cuisine:${d.cuisine}`);
  add(`course:${d.course}`);
  add(`protein:${d.protein}`);
  if (d.diet === 'vegan' || d.diet === 'vegetarian') add('veg');
  add(`method:${d.method}`);
  add(`heat:${d.heat}`);
  add('rich', centred(d.richness));
  add('sweet', centred(d.sweetness));
  add('sour', centred(d.sourness));
  add('umami', centred(d.umami));
  for (const t of d.texture) add(`tex:${t}`, 0.6);
  const ingW = d.ingredients.length ? Math.min(0.6, 1.6 / d.ingredients.length) : 0;
  for (const i of d.ingredients) add(`ing:${i}`, ingW);
  add(`carb:${d.carb}`);
  if (d.familiarity === 'adventurous') add('adventurous');
  if (d.temperature === 'cold') add('cold');
  return f;
}

/** Starting weights from the intake answers (the cold start). */
export function priorFromIntake(intake = {}) {
  const w = {};
  const spice = Number.isFinite(intake.spice) ? intake.spice : 1;
  for (let k = 0; k <= 3; k++) {
    const over = Math.max(0, k - spice);
    w[`heat:${k}`] = over ? -0.9 * over ** 1.3 : (spice >= 2 ? 0.25 * k : 0);
  }
  const adventure = Number.isFinite(intake.adventure) ? intake.adventure : 1;
  w.adventurous = (adventure - 1) * 0.7;
  if (adventure === 0) w['method:raw'] = -0.6;
  const cuisines = new Set([...(intake.cuisines ?? []), ...cuisineKeys(intake.cuisineChips)]);
  for (const c of cuisines) if (c !== 'other') w[`cuisine:${c}`] = PRIOR.cuisine;
  // most people order a main; desserts, sides and drinks are rarely "what to get"
  Object.assign(w, { 'course:main': 0.6, 'course:starter': 0, 'course:soup': -0.1, 'course:salad': -0.2, 'course:side': -0.6, 'course:dessert': -0.6, 'course:drink': -1.5 });
  // typed likes and dislikes: the personal features, plus a nudge to what each food stands for
  const likes = Array.isArray(intake.likes) ? intake.likes : [], dislikes = Array.isArray(intake.dislikes) ? intake.dislikes : [];
  if (likes.length) w.like = PRIOR.like;
  if (dislikes.length) {
    w.dislike = PRIOR.dislike;
    if (TUNING.roles) { w.dislikeMixed = PRIOR.dislikeMixed; w.dislikePick = PRIOR.dislikePick; }
  }
  for (const c of likes) for (const k of featureHints(c)) w[k] = (w[k] ?? 0) + PRIOR.likeHint;
  for (const c of dislikes) for (const k of featureHints(c)) w[k] = (w[k] ?? 0) + PRIOR.dislikeHint;
  return w;
}

const dot = (w, f) => { let s = 0; for (const [k, v] of f) s += (w[k] ?? 0) * v; return s; };

/**
 * Fit the weights to everything this person has told us.
 * @param intake  the intake answers
 * @param rounds  [{ options: dish[], picked: id[], never?: id[], weight?: number }]
 * @returns {{ w: Record<string, number>, w0: Record<string, number>, n: number, evidence: Record<string, number> }}
 */
export function train(intake = {}, rounds = []) {
  const w0 = priorFromIntake(intake);
  const prefs = prefsOf(intake);
  const evidence = {};
  // Number the features once so the inner loop works on plain arrays.
  const index = new Map(Object.keys(w0).map((k, i) => [k, i]));
  const id = (k) => { let i = index.get(k); if (i === undefined) { i = index.size; index.set(k, i); } return i; };
  const data = [];
  let lipschitz = TUNING.lambda;
  for (const r of rounds) {
    const opts = r.options.filter((d) => allowed(d, intake) || r.picked.includes(d.id));
    if (opts.length < 2) continue;
    const fs = opts.map((d) => { const f = features(d, prefs); return { k: Int32Array.from([...f.keys()].map(id)), v: Float64Array.from(f.values()), raw: f }; });
    const idx = (ids) => (ids ?? []).map((x) => opts.findIndex((d) => d.id === x)).filter((i) => i >= 0);
    const picked = idx(r.picked), never = idx(r.never);
    if (!picked.length && !never.length) continue;
    const scale = r.weight ?? 1;
    // "this, not that": each dish it guessed that the person passed over, against each dish they picked
    const missed = idx(r.predicted).filter((i) => !picked.includes(i));
    const pairs = [];
    for (const g of missed) for (const p of picked) pairs.push([p, g]);
    data.push({ fs, picked, never, scale, pairs });
    let maxNorm = 0;
    for (const f of fs) { let s = 0; for (const v of f.v) s += v * v; maxNorm = Math.max(maxNorm, s); }
    lipschitz += 0.5 * maxNorm * scale * (picked.length + TUNING.never * never.length + TUNING.pair * pairs.length * 2);
    for (const i of picked) for (const [k, v] of fs[i].raw) evidence[k] = (evidence[k] ?? 0) + v * scale;
  }
  const n = index.size;
  const prior = new Float64Array(n), w = new Float64Array(n), g = new Float64Array(n);
  for (const [k, i] of index) prior[i] = w0[k] ?? 0;
  w.set(prior);
  const step = 1 / lipschitz;
  const lam = new Float64Array(n).fill(TUNING.lambda);
  const capped = DISLIKE_KEYS.map((k) => index.get(k)).filter((i) => i !== undefined);
  for (const i of capped) lam[i] = TUNING.lambdaDislike;
  const sc = (f) => { let s = 0; for (let j = 0; j < f.k.length; j++) s += w[f.k[j]] * f.v[j]; return s; };
  const addG = (f, c) => { for (let j = 0; j < f.k.length; j++) g[f.k[j]] += c * f.v[j]; };
  for (let it = 0; it < (data.length ? TUNING.iterations : 0); it++) {
    g.fill(0);
    for (const { fs, picked, never, scale, pairs } of data) {
      const s = fs.map(sc);
      for (const [p, q] of pairs) {
        const c = TUNING.pair * scale / (1 + Math.exp(s[p] - s[q])); // gradient of log sigmoid(s_p - s_q)
        addG(fs[p], c); addG(fs[q], -c);
      }
      if (picked.length) {
        const p = softmax(s);
        for (const i of picked) addG(fs[i], scale);
        for (let j = 0; j < fs.length; j++) addG(fs[j], -scale * picked.length * p[j]);
      }
      if (never.length) {
        const q = softmax(s.map((x) => -x));
        for (const i of never) addG(fs[i], -TUNING.never * scale);
        for (let j = 0; j < fs.length; j++) addG(fs[j], TUNING.never * scale * never.length * q[j]);
      }
    }
    for (let i = 0; i < n; i++) w[i] += step * (g[i] - lam[i] * (w[i] - prior[i]));
    for (const i of capped) if (w[i] > 0) w[i] = 0; // a disliked food never becomes a reason to pick
  }
  const out = {};
  for (const [k, i] of index) if (Math.abs(w[i]) >= 1e-4 || k in w0) out[k] = w[i];
  return { w: out, w0, n: data.length, evidence, prefs };
}

function softmax(s) {
  const m = Math.max(...s);
  const e = s.map((x) => Math.exp(x - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

export const score = (model, dish) => dot(model.w, features(dish, model.prefs));

/**
 * Every dish with its score and anything that rules it out, best first.
 * @returns {{ dish, score: number, blocked: {kind,text}[] }[]}
 */
export function rank(model, dishes, intake = {}) {
  return dishes
    .map((dish, i) => ({ dish, i, score: score(model, dish), blocked: conflicts(dish, intake) }))
    .sort((a, b) => (a.blocked.length > 0) - (b.blocked.length > 0) || b.score - a.score || a.i - b.i)
    .map(({ i, ...r }) => r);
}

/** The model's top `k` dish ids among dishes that break none of the person's rules. */
export function topK(model, dishes, intake, k = 3) {
  return rank(model, dishes, intake).filter((r) => !r.blocked.length).slice(0, k).map((r) => r.dish.id);
}

// ───────── Words: why a dish, what it learned ─────────
const PROTEIN = { chicken: 'chicken', beef: 'beef', pork: 'pork', lamb: 'lamb', duck: 'duck', fish: 'fish', shellfish: 'shellfish', egg: 'egg dishes', tofu: 'tofu', legumes: 'beans and lentils', cheese: 'cheese', mixed: 'mixed meats', none: 'dishes without much meat' };
const METHOD = { fried: 'fried food', stir_fried: 'stir-fries', grilled: 'grilled food', roasted: 'roasts', baked: 'baked dishes', braised: 'slow-cooked dishes', simmered: 'curries and stews', steamed: 'steamed food', raw: 'raw fish and tartares', fresh: 'fresh, uncooked dishes' };
const CARB = { rice: 'rice', noodle: 'noodles', bread: 'bread and wraps', potato: 'potatoes', none: 'dishes without a starch' };
const COURSE = { starter: 'small plates', soup: 'soups', salad: 'salads', main: 'mains', side: 'sides', dessert: 'desserts', drink: 'drinks' };
const HEAT = ['no heat', 'mild heat', 'some heat', 'real heat'];

/** A short phrase for a feature, given the sign of its weight. */
export function phrase(key, positive = true) {
  const [kind, val] = key.split(':');
  switch (kind) {
    case 'cuisine': return `${LABELS.cuisine[val] ?? val} food`;
    case 'protein': return PROTEIN[val] ?? val;
    case 'veg': return 'vegetarian dishes';
    case 'method': return METHOD[val] ?? val;
    case 'heat': return HEAT[Number(val)] ?? 'heat';
    case 'rich': return positive ? 'rich, indulgent food' : 'lighter food';
    case 'sweet': return positive ? 'a sweet note' : 'less sweet food';
    case 'sour': return positive ? 'tangy, sour flavours' : 'mellow, not sour flavours';
    case 'umami': return positive ? 'deep savoury flavour' : 'clean, simple flavours';
    case 'tex': return `${val} textures`;
    case 'ing': return val;
    case 'carb': return CARB[val] ?? val;
    case 'adventurous': return positive ? 'adventurous dishes' : 'familiar dishes';
    case 'cold': return positive ? 'cold dishes' : 'hot dishes';
    case 'course': return COURSE[val] ?? val;
    case 'like': return positive ? 'foods you said you like' : 'foods you said you like, less than you thought';
    case 'dislike': return 'foods you said you dislike';
    case 'dislikeMixed': return 'foods you dislike, cooked in';
    case 'dislikePick': return 'foods you dislike, as a garnish or side';
    default: return key;
  }
}

const SKIP_IN_WHY = new Set(['course:main', 'course:starter', 'carb:none', 'protein:none', 'heat:0', 'heat:1']);
/** Up to `k` reasons this person may like this dish, from the features that lift its score most. */
export function explain(model, dish, k = 3) {
  const out = [];
  for (const [key, v] of features(dish, model.prefs)) {
    if (SKIP_IN_WHY.has(key)) continue;
    const c = (model.w[key] ?? 0) * v;
    if (c > 0.12) out.push([c, key, v]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, k).map(([, key, v]) => phrase(key, v > 0));
}

/** What the model has learned overall: the strongest likes and dislikes, in words. */
export function summary(model, { likes = 8, dislikes = 6 } = {}) {
  const entries = Object.entries(model.w).filter(([k]) => !k.startsWith('course:') && k !== 'like' && !DISLIKE_KEYS.includes(k));
  // "rich" with a negative weight is a like of lighter food, so turn signed scalars into phrases by sign
  const scored = entries.map(([k, w]) => ({ k, w, scalar: !k.includes(':') && !['veg', 'adventurous', 'cold'].includes(k) }));
  const seen = (k) => (model.evidence?.[k] ?? 0) >= 2 || (model.w0?.[k] ?? 0) > 0.3; // a like needs real picks behind it
  const like = scored.filter((x) => (x.w > 0.4 && (x.scalar || seen(x.k))) || (x.scalar && x.w < -0.3)).sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .map((x) => phrase(x.k, x.w > 0));
  const dislike = scored.filter((x) => x.w < -0.4 && !x.scalar).sort((a, b) => a.w - b.w).map((x) => phrase(x.k, true));
  return { likes: [...new Set(like)].slice(0, likes), dislikes: [...new Set(dislike)].slice(0, dislikes) };
}

// ───────── Why this, why not ─────────
// Foods that read better in the plural ("Has mushrooms"); the rest stay as they are ("Has cilantro").
const COUNTABLE = new Set(['mushroom', 'olive', 'onion', 'tomato', 'peanut', 'pepper', 'bell pepper', 'caper', 'anchovy', 'egg', 'bean', 'chickpea', 'lentil', 'pea', 'pickle', 'raisin', 'walnut', 'almond', 'cashew', 'pistachio', 'nut', 'radish', 'carrot', 'potato', 'beet', 'bean sprout', 'clam', 'mussel', 'oyster', 'scallop', 'crouton', 'date', 'fig', 'cherry', 'berry', 'strawberry', 'apple', 'noodle', 'chili pepper', 'jalapeno', 'cornichon', 'sausage']);
function noun(label) {
  const l = String(label).toLowerCase();
  if (!COUNTABLE.has(l)) return { text: l, many: /s$/.test(l) && !/ss$/.test(l) };
  const plural = /[^aeiou]y$/.test(l) ? `${l.slice(0, -1)}ies` : /(o|ch|sh|x)$/.test(l) ? `${l}es` : `${l}s`;
  return { text: plural, many: true };
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** True when this person has shown they pick dishes with a disliked garnish anyway (their penalty shrank). */
export const picksAroundGarnish = (model) => !!model?.w0?.dislikePick && (model.w.dislikePick ?? 0) > PRIOR.dislikePick * 0.5;

/**
 * One plain sentence about a disliked food on a dish, e.g. "Has mushrooms, which you don't like. They're a
 * garnish here, so you could ask to leave them out." `skipped`: the dish was not recommended.
 */
export function dislikeNote(h, { skipped = false, model = null } = {}) {
  const n = noun(h.label);
  const [they, them, are] = n.many ? ['they', 'them', 'are'] : ['it', 'it', 'is'];
  const theyre = n.many ? "they're" : "it's";
  if (h.role === 'core') {
    if (!h.ing && !COUNTABLE.has(h.label.toLowerCase()) && / food$|^spicy|^fried|^salad|^sweet/.test(h.label.toLowerCase())) return skipped ? `Skipped: it's ${n.text}, which you don't like.` : `It's ${n.text}, which you said you don't like.`;
    return skipped ? `Skipped: ${n.text} ${are} the main ingredient.` : `${cap(n.text)} ${are} the main ingredient, and you said you don't like ${them}.`;
  }
  if (h.role === 'component') return `${skipped ? 'Skipped: has' : 'Has'} ${n.text} cooked in, which you don't like, so ${they} can't easily be left out.`;
  const where = h.role === 'side'
    ? `${h.guess ? `${cap(they)} seem${n.many ? '' : 's'} to come` : `${cap(they)} come${n.many ? '' : 's'}`} on the side, so you could leave ${them} or ask to swap`
    : `${h.guess ? `${cap(they)} look${n.many ? '' : 's'} like a garnish here (a guess from the menu wording)` : `${cap(theyre)} a garnish here`}, so you could ask to leave ${them} out`;
  const learned = model && picksAroundGarnish(model) ? ' You often pick dishes like this anyway, so it counts for less.' : '';
  return `Has ${n.text}, which you don't like. ${where}.${learned}`;
}

/** Disliked foods on a dish, in words (most central first). */
export function dislikeNotes(model, dish, opts = {}) {
  const order = { core: 0, component: 1, side: 2, garnish: 3 };
  return dislikeHits(dish, model.prefs).sort((a, b) => order[a.role] - order[b.role]).map((h) => ({ ...h, text: dislikeNote(h, { ...opts, model }) }));
}

/**
 * "Why this": the 1 to 3 strongest reasons the learner likes this dish for this person, in plain words:
 * foods they like, a cuisine they love or keep picking, heat, adventurousness, what they often pick.
 */
export function whyThis(model, dish, intake = {}, k = 3) {
  const w = model.w, f = features(dish, model.prefs);
  const out = []; // [strength, text]
  const used = new Set(['like', ...DISLIKE_KEYS, `cuisine:${dish.cuisine}`, `heat:${dish.heat}`, 'adventurous', ...SKIP_IN_WHY]);
  if (f.get('like') && (w.like ?? 0) > 0) {
    const names = (model.prefs?.like ?? []).filter((t) => t.test(dish)).map((t) => noun(t.label).text);
    if (names.length) out.push([w.like * f.get('like') + 0.3, `has ${andList([...new Set(names)].slice(0, 3))}, which you like`]);
  }
  const ck = `cuisine:${dish.cuisine}`;
  if (dish.cuisine !== 'other' && (w[ck] ?? 0) > 0.15) {
    const loved = new Set([...(intake.cuisines ?? []), ...cuisineKeys(intake.cuisineChips)]).has(dish.cuisine);
    out.push([w[ck], loved ? `${LABELS.cuisine[dish.cuisine]} food, a cuisine you love` : `${LABELS.cuisine[dish.cuisine]} food, which you often pick`]);
  }
  const hk = `heat:${dish.heat}`;
  if (dish.heat >= 1 && (w[hk] ?? 0) > 0.15) out.push([w[hk], dish.heat >= 2 ? 'real chili heat, the way you like it' : 'a gentle bit of heat']);
  else if (dish.heat === 0 && (intake.spice ?? 1) === 0) out.push([0.3, 'no chili heat']);
  if (dish.familiarity === 'adventurous' && (w.adventurous ?? 0) > 0.15) out.push([w.adventurous, 'something new to try, as you like']);
  else if (dish.familiarity === 'common' && (w.adventurous ?? 0) < -0.15) out.push([-0.6 * w.adventurous, 'a familiar dish']);
  const extra = [];
  for (const [key, v] of f) {
    if (used.has(key)) continue;
    const c = (w[key] ?? 0) * v;
    if (c <= 0.15) continue;
    const ph = phrase(key, v > 0);
    if ((model.evidence?.[key] ?? 0) >= 2) out.push([c, `you often pick ${ph}`]);
    else extra.push([c, `${ph}, from your answers`]);
  }
  if (!out.length && extra.length) out.push(extra.sort((a, b) => b[0] - a[0])[0]);
  const said = [];
  const fresh = (t) => { const words = t.replace(/^you often pick /, '').replace(/, from your answers$/, ''); if (said.some((x) => x.includes(words))) return false; said.push(t); return true; };
  return out.sort((a, b) => b[0] - a[0]).map(([, t]) => t).filter(fresh).slice(0, k);
}

/**
 * "Why not": one plain sentence on why a dish was not among its picks.
 * @param ctx { cutoff: the score of its last pick }
 */
export function whyNot(model, dish, intake = {}, ctx = {}) {
  const blocked = conflicts(dish, intake);
  if (blocked.length) return `Not for you: ${blocked.map((b) => b.text).join(', ')}.`;
  const hits = dislikeNotes(model, dish, { skipped: true });
  const firm = hits.find((h) => !h.removable);
  if (firm) return firm.text;
  if (dish.heat > (intake.spice ?? 1) + 0) return dish.heat - (intake.spice ?? 1) >= 2 ? 'Skipped: much hotter than you like.' : 'Skipped: a bit hotter than you like.';
  const gap = Number.isFinite(ctx.cutoff) ? ctx.cutoff - score(model, dish) : Infinity;
  if (hits.length) return `${hits[0].text.replace(/\.$/, '')}${gap < 0.8 ? '. Close, but its picks fit you a little better.' : '. Its picks fit you better.'}`;
  if (gap < 0.5) return 'Close call: its 3 picks fit you a little better.';
  const f = features(dish, model.prefs);
  if ((model.prefs?.like?.length ?? 0) > 0 && !f.get('like') && gap < 1.5) return 'Fine, but it has none of the foods you said you like.';
  const neg = [...f].filter(([key]) => !SKIP_IN_WHY.has(key) && !DISLIKE_KEYS.includes(key) && key !== 'like').map(([key, v]) => [(model.w[key] ?? 0) * v, key, v]).filter(([c]) => c < -0.15).sort((a, b) => a[0] - b[0]);
  if (neg.length) return `Less your style: ${andList(neg.slice(0, 2).map(([, key, v]) => phrase(key, v > 0)))}.`;
  return 'Fine, but other dishes fit you better.';
}

/**
 * The dishes worth explaining that it did not pick, each with a "why not": the closest runners-up,
 * dishes with a food they dislike, then dishes their allergies or diet rule out.
 * @returns {{ dish, text: string, kind: 'close'|'dislike'|'blocked' }[]}
 */
export function skippedWithReasons(model, dishes, intake = {}, topIds = [], { runnersUp = 2 } = {}) {
  const ranked = rank(model, dishes, intake).filter((r) => !topIds.includes(r.dish.id) && r.dish.course !== 'drink');
  const last = dishes.find((d) => d.id === topIds[topIds.length - 1]);
  const cutoff = last ? score(model, last) : Infinity;
  const out = [], seen = new Set();
  const push = (r, kind) => { if (seen.has(r.dish.id)) return; seen.add(r.dish.id); out.push({ dish: r.dish, kind, text: whyNot(model, r.dish, intake, { cutoff }) }); };
  for (const r of ranked.filter((x) => !x.blocked.length && !dislikeHits(x.dish, model.prefs).length).slice(0, runnersUp)) push(r, 'close');
  for (const r of ranked) if (!r.blocked.length && dislikeHits(r.dish, model.prefs).length) push(r, 'dislike');
  for (const r of ranked) if (r.blocked.length) push(r, 'blocked');
  return out;
}

const BASE_KINDS = ['carb', 'protein', 'veg', 'cuisine', 'method'];
const WITH_KINDS = ['ing', 'heat', 'sour', 'sweet', 'rich', 'umami', 'tex'];
const ADJ = {
  carb: { rice: 'rice', noodle: 'noodle', bread: 'bread-based', potato: 'potato' },
  method: { fried: 'fried', stir_fried: 'stir-fried', grilled: 'grilled', roasted: 'roasted', baked: 'baked', braised: 'slow-cooked', simmered: 'saucy, simmered', steamed: 'steamed', raw: 'raw', fresh: 'fresh' },
};
function adjective(key) {
  const [kind, val] = key.split(':');
  if (kind === 'cuisine') return LABELS.cuisine[val] ?? val;
  if (kind === 'protein') return { legumes: 'bean and lentil', mixed: 'mixed meat', none: 'meat-free', egg: 'egg' }[val] ?? val;
  if (kind === 'veg') return 'vegetarian';
  return ADJ[kind]?.[val] ?? null;
}
const withPhrase = (key) => {
  const [kind, val] = key.split(':');
  if (kind === 'ing') return val;
  if (kind === 'heat') return ['no heat', 'gentle heat', 'some heat', 'real heat'][Number(val)];
  if (kind === 'tex') return `a ${val} texture`;
  return { sour: 'a sour tang', sweet: 'a sweet edge', rich: 'plenty of richness', umami: 'deep savoury flavour' }[kind] ?? null;
};

/**
 * One line about what it has learned, built from what keeps showing up in the person's picks.
 * e.g. "You keep choosing noodle dishes with peanut and lime."
 * @param picks  every dish they have picked so far (normalised dishes)
 */
export function learnedLine(model, picks) {
  if (picks.length < 2) return picks.length ? `Noted: ${picks[0].name}. One round is a start; a few more and patterns show up.` : 'Pick at least one dish so it has something to learn from.';
  const count = new Map();
  for (const d of picks) for (const [k, v] of features(d)) if (v > 0) count.set(k, (count.get(k) ?? 0) + 1);
  const strength = (k) => (model.w[k] ?? 0) * Math.sqrt(count.get(k) ?? 0);
  const repeated = [...count.keys()].filter((k) => count.get(k) >= 2 && (model.w[k] ?? 0) > 0.15);
  const base = repeated.filter((k) => BASE_KINDS.includes(k.split(':')[0]) && adjective(k) && !['carb:none', 'protein:none'].includes(k))
    .sort((a, b) => strength(b) - strength(a))[0];
  const withs = repeated.filter((k) => WITH_KINDS.includes(k.split(':')[0]) && withPhrase(k) && !['heat:0', 'heat:1'].includes(k))
    .sort((a, b) => strength(b) - strength(a)).slice(0, 2).map(withPhrase);
  const neg = Object.entries(model.w).filter(([k, w]) => w < -0.5 && w < (model.w0[k] ?? 0) - 0.4 && !k.startsWith('course:') && (count.get(k) ?? 0) === 0)
    .sort((a, b) => a[1] - b[1])[0];
  let line = base
    ? `You keep choosing ${adjective(base)} dishes${withs.length ? ` with ${withs.join(' and ')}` : ''}`
    : withs.length ? `You keep going for ${withs.join(' and ')}` : 'Your picks are varied so far';
  if (neg) line += `${base || withs.length ? ', and' : ', but'} steering away from ${phrase(neg[0], true)}`;
  return `${line}.`;
}

/**
 * Profile summary sent to the menu reader: the foods they typed (as recognised, or as typed), what the
 * rounds taught it, and their rules. No name. Lists are capped at 12 short items by the backend.
 */
export function profileForServer(model, intake) {
  const s = summary(model);
  const typed = (chips) => (Array.isArray(chips) ? chips : []).map((c) => chipLabel(c, 'food').slice(0, 60));
  const r = rulesOf(intake);
  // rules the backend has no tag for (halal, kosher, foods to avoid, other allergies) go in "never eats"
  const never = [
    ...(r.halal ? ['halal: no pork or alcohol, ask if meat is halal'] : []),
    ...(r.kosher ? ['kosher: no pork or shellfish, no meat with dairy'] : []),
    ...r.avoid.map((v) => v.label.slice(0, 60)),
  ];
  const uniq = (list) => [...new Set(list.filter(Boolean))].slice(0, 12);
  return {
    likes: uniq([...typed(intake.likes), ...s.likes]), dislikes: uniq([...typed(intake.dislikes), ...s.dislikes]),
    diet: [...r.diets], allergies: [...r.allergens], never: uniq(never),
    spice: intake.spice ?? 1, adventure: intake.adventure ?? 1, rounds: model.n,
  };
}

/** Weights worth keeping (for sync): the strongest 300. */
export function compactWeights(w, max = 300) {
  return Object.fromEntries(Object.entries(w).filter(([, v]) => Math.abs(v) >= 0.01)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, max).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
}
