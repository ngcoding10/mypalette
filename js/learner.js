// The "teachable" part: a small, explainable preference model that runs in the browser.
//
// Each dish becomes a handful of named features (cuisine:thai, carb:noodle, ing:peanut, heat:3 ...).
// A person's taste is one weight per feature; a dish's score is the sum of its features' weights.
// Training treats every round as "from this menu, they picked these": a softmax choice model
// (multinomial logit) fitted by gradient ascent, pulled towards a starting point built from the
// intake answers (L2 regularisation), so a few rounds move it a little and many rounds a lot.
// Allergies, diets and must-avoid foods are hard filters (js/rules.js), not weights.
// Foods the person typed as liked or disliked become two personal features, "like" and "dislike"
// (how many of their liked or disliked foods a dish has), which start strongly positive and
// negative and are then fitted like any other weight: if someone says they dislike onion but keeps
// picking dishes with onion, the dislike weight shrinks.
// Each round also says what the learner guessed. Besides the choice model, every guessed dish the
// person did not pick is compared with each dish they did pick (a pairwise "this, not that" term),
// so it learns most from where its guess and the person differ.
// No DOM, no dependencies: it also runs in Node for the tests and tools/evaluate.mjs.
import { LABELS } from './schema.js';
import { allowed, conflicts, rulesOf } from './rules.js';
import { chipLabel, cuisineKeys, featureHints, matcher } from './foods.js';

export const LEARNER_VERSION = 2;
// Tuned on synthetic people with tools/evaluate-intake.mjs; exported so tools can try other values.
export const TUNING = {
  lambda: 1.0,      // pull towards the intake prior; higher = slower to change its mind
  never: 0.5,       // a "would never order" counts half as much as a pick
  pair: 0.5,        // the guessed-but-not-picked vs picked comparison, per pair
  iterations: 120,
};
export const PRIOR = { like: 0.9, dislike: -2.0, likeHint: 0.3, dislikeHint: -0.4, cuisine: 0.5 };

const centred = (v) => (v - 1.5) / 1.5; // 0..3 -> -1..1

// ───────── personal preferences from the intake ─────────
const prefCache = new WeakMap();
/** Liked and disliked foods as tests over dishes, compiled once per intake. */
export function prefsOf(intake = {}) {
  let p = prefCache.get(intake);
  if (!p) {
    const tests = (chips) => (Array.isArray(chips) ? chips : []).map((c) => matcher(c, 'food'));
    p = { like: tests(intake.likes), dislike: tests(intake.dislikes), cache: new WeakMap() };
    prefCache.set(intake, p);
  }
  return p;
}
function personal(d, prefs) {
  if (!prefs || (!prefs.like.length && !prefs.dislike.length)) return null;
  let v = prefs.cache.get(d);
  if (!v) {
    const count = (tests) => { let n = 0; for (const t of tests) if (t(d)) n++; return Math.min(2, n); };
    v = [count(prefs.like), count(prefs.dislike)];
    prefs.cache.set(d, v);
  }
  return v;
}

const featCache = new WeakMap();
/** Named features of one (normalised) dish, plus "like" and "dislike" for a person when given. */
export function features(d, prefs = null) {
  let f = featCache.get(d);
  if (!f) { f = dishFeatures(d); featCache.set(d, f); }
  const p = personal(d, prefs);
  if (!p || (!p[0] && !p[1])) return f;
  const out = new Map(f);
  if (p[0]) out.set('like', p[0]);
  if (p[1]) out.set('dislike', p[1]);
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
  if (dislikes.length) w.dislike = PRIOR.dislike;
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
    for (let i = 0; i < n; i++) w[i] += step * (g[i] - TUNING.lambda * (w[i] - prior[i]));
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
  const entries = Object.entries(model.w).filter(([k]) => !k.startsWith('course:') && k !== 'like' && k !== 'dislike');
  // "rich" with a negative weight is a like of lighter food, so turn signed scalars into phrases by sign
  const scored = entries.map(([k, w]) => ({ k, w, scalar: !k.includes(':') && !['veg', 'adventurous', 'cold'].includes(k) }));
  const seen = (k) => (model.evidence?.[k] ?? 0) >= 2 || (model.w0?.[k] ?? 0) > 0.3; // a like needs real picks behind it
  const like = scored.filter((x) => (x.w > 0.4 && (x.scalar || seen(x.k))) || (x.scalar && x.w < -0.3)).sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .map((x) => phrase(x.k, x.w > 0));
  const dislike = scored.filter((x) => x.w < -0.4 && !x.scalar).sort((a, b) => a.w - b.w).map((x) => phrase(x.k, true));
  return { likes: [...new Set(like)].slice(0, likes), dislikes: [...new Set(dislike)].slice(0, dislikes) };
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
