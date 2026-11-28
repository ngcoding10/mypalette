// Synthetic people for testing the learner with the new intake. Each one has a hidden taste:
//   - weights over the learner's dish features (cuisine, protein, heat ...),
//   - real likes and dislikes for particular foods (checked against a dish's ingredient list and
//     name, independently of the app's food dictionary),
//   - a private like or dislike for every single dish that nothing explains.
//   - a "will pick it out" tolerance: how much a disliked food still bothers them when it is only a
//     garnish, topping or side they could leave (about half the people barely mind, the rest mind a
//     lot); a disliked food the dish is built around, or cooked into it, always counts in full.
// They fill in the intake the way a person might: they type only some of their likes and dislikes,
// sometimes add a food they do not really care about, make typos, and sometimes forget commas.
// Then they pick their top 3 (sometimes 2) on each menu, with random noise. Synthetic only: they say
// nothing about how real people behave.
import { features } from '../js/learner.js';
import { allowed } from '../js/rules.js';
import { normIngredient } from '../js/schema.js';
import { parseList } from '../js/foods.js';
import { MENUS, menuPlan } from '../js/menus.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const gumbel = (r) => -Math.log(-Math.log(r() || 1e-9));
export function shuffle(list, r) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// likes / dislikes: [food as they would type it, how much it really matters to them]. Each persona has
// at least one everyday dislike (onion, cilantro, egg, pickles, mushrooms...) that often comes as a
// garnish or side, so the "will pick it out" tolerance has something to act on.
export const PERSONAS = {
  'spice-loving vegetarian': {
    restrictions: 'vegetarian', spice: 3, adventure: 2, cuisines: 'indian, thai',
    likes: [['paneer', 1.2], ['chickpeas', 0.9], ['spinach', 0.7], ['lentils', 0.8], ['eggplant', 0.6], ['coconut', 0.5]],
    dislikes: [['mushrooms', -1.5], ['olives', -1.0], ['egg', -0.9]],
    w: { 'heat:3': 1.5, 'heat:2': 1.0, 'heat:0': -0.8, 'cuisine:indian': 0.8, 'cuisine:thai': 0.6, 'cuisine:ethiopian': 0.5, 'protein:legumes': 0.7, 'protein:tofu': 0.5, 'protein:cheese': 0.6, 'tex:creamy': 0.5, sour: 0.4, 'course:main': 1.0, 'course:dessert': -0.8 },
  },
  'plain eater': {
    restrictions: '', spice: 0, adventure: 0, cuisines: 'american, italian',
    likes: [['chicken', 1.0], ['cheese', 0.8], ['potatoes', 0.8], ['burger', 0.9], ['pasta', 0.7], ['bacon', 0.6]],
    dislikes: [['cilantro', -1.2], ['olives', -1.0], ['raw fish', -2.0], ['spicy food', -1.5], ['onion', -0.9], ['mushrooms', -0.8]],
    w: { 'heat:0': 1.0, 'heat:2': -1.5, 'heat:3': -2.5, adventurous: -1.5, 'method:fried': 0.8, 'carb:bread': 0.6, 'carb:potato': 0.7, 'cuisine:american': 1.0, 'cuisine:italian': 0.7, 'method:raw': -2, cold: -0.6, sour: -0.6, 'tex:crispy': 0.5, 'course:main': 1.0, 'course:dessert': -0.5 },
  },
  'seafood lover': {
    restrictions: '', spice: 1, adventure: 2, cuisines: 'japanese, greek, spanish',
    likes: [['salmon', 1.2], ['shrimp', 1.2], ['tuna', 1.0], ['lime', 0.6], ['scallops', 1.0], ['octopus', 0.8]],
    dislikes: [['lamb', -1.2], ['cream', -0.8], ['cilantro', -0.8]],
    w: { 'protein:fish': 1.3, 'protein:shellfish': 1.3, 'method:raw': 0.8, 'method:grilled': 0.6, sour: 0.5, 'cuisine:japanese': 0.7, 'cuisine:greek': 0.5, rich: -0.4, 'course:main': 0.6, 'course:starter': 0.4, 'course:dessert': -0.8 },
  },
  'noodle and peanut fan': {
    restrictions: '', spice: 2, adventure: 1, cuisines: 'vietnamese, thai',
    likes: [['noodles', 1.4], ['peanuts', 0.9], ['lime', 0.8], ['pork', 0.6], ['basil', 0.5]],
    dislikes: [['olives', -1.0], ['blue cheese', -1.2], ['beets', -0.8], ['egg', -0.8]],
    w: { 'carb:noodle': 1.2, sour: 0.5, sweet: 0.3, 'cuisine:vietnamese': 0.6, 'cuisine:thai': 0.6, 'tex:chewy': 0.5, 'course:main': 0.8, 'course:dessert': -0.8 },
  },
  'comfort meat eater': {
    restrictions: '', spice: 1, adventure: 1, cuisines: 'american, korean',
    likes: [['beef', 1.2], ['pork', 1.0], ['bacon', 0.8], ['steak', 1.0], ['ribs', 0.9]],
    dislikes: [['tofu', -1.2], ['salad', -1.0], ['eggplant', -0.8], ['tomato', -0.8], ['pickles', -0.8]],
    w: { 'protein:beef': 0.8, 'protein:pork': 0.6, rich: 0.8, 'method:braised': 0.6, 'method:grilled': 0.5, 'method:roasted': 0.5, umami: 0.6, veg: -1.0, 'course:main': 1.0, 'course:salad': -0.8, 'course:dessert': -0.5 },
  },
  'light, lactose-intolerant eater': {
    restrictions: 'lactose intolerant', spice: 1, adventure: 1, cuisines: 'japanese, vietnamese',
    likes: [['fish', 1.0], ['lemon', 0.6], ['chicken', 0.7], ['rice', 0.6], ['ginger', 0.5]],
    dislikes: [['fried food', -1.2], ['bacon', -0.8], ['onion', -0.8]],
    w: { rich: -1.0, 'method:fried': -0.8, 'method:steamed': 0.6, 'method:fresh': 0.6, 'method:grilled': 0.5, 'course:salad': 0.6, 'course:soup': 0.4, 'tex:brothy': 0.4, sour: 0.4, 'protein:fish': 0.5, 'course:main': 0.5, 'course:dessert': -0.8 },
  },
  'nut-allergic adventurer': {
    restrictions: 'peanut allergy, tree nuts', spice: 2, adventure: 2, cuisines: 'middle eastern, ethiopian, indian',
    likes: [['lamb', 1.2], ['eggplant', 0.8], ['chickpeas', 0.8], ['yogurt', 0.6], ['cumin', 0.5]],
    dislikes: [['sweet', -0.8], ['mayonnaise', -1.0], ['scallion', -0.7]],
    w: { 'protein:lamb': 0.8, adventurous: 0.8, 'cuisine:middle_eastern': 0.7, 'cuisine:ethiopian': 0.6, 'cuisine:indian': 0.5, 'heat:2': 0.6, umami: 0.4, sweet: -0.6, 'course:main': 0.9, 'course:dessert': -0.6 },
  },
  'vegan': {
    restrictions: 'vegan', spice: 2, adventure: 1, cuisines: 'thai, mexican',
    likes: [['tofu', 1.0], ['avocado', 1.0], ['rice', 0.5], ['beans', 0.8], ['curry', 0.8]],
    dislikes: [['mushrooms', -1.2], ['seitan', -0.8], ['onion', -0.7]],
    w: { 'protein:tofu': 0.6, 'protein:legumes': 0.7, 'heat:2': 0.5, 'cuisine:thai': 0.5, 'cuisine:mexican': 0.5, 'tex:saucy': 0.4, 'course:main': 1.0, 'course:dessert': -0.5 },
  },
  'celiac with a shellfish allergy': {
    restrictions: 'celiac, shellfish', spice: 1, adventure: 1, cuisines: 'mexican, indian',
    likes: [['rice', 0.8], ['chicken', 0.9], ['tomato', 0.6], ['cheese', 0.7], ['corn', 0.6]],
    dislikes: [['liver', -1.5], ['anchovies', -1.2], ['cilantro', -1.0], ['olives', -0.8]],
    w: { 'carb:rice': 0.6, 'protein:chicken': 0.5, 'cuisine:mexican': 0.6, 'cuisine:indian': 0.5, 'tex:saucy': 0.3, 'course:main': 1.0, 'course:dessert': -0.6 },
  },
  'halal grill fan': {
    restrictions: 'halal', spice: 2, adventure: 1, cuisines: 'turkish, indian',
    likes: [['lamb', 1.0], ['chicken', 0.9], ['rice', 0.6], ['kebab', 1.0], ['spicy food', 0.8]],
    dislikes: [['tofu', -1.0], ['raw fish', -1.5], ['mushrooms', -0.9], ['pickles', -0.7]],
    w: { 'method:grilled': 0.9, 'protein:lamb': 0.6, 'protein:chicken': 0.5, 'cuisine:middle_eastern': 0.8, 'cuisine:indian': 0.6, 'heat:2': 0.5, 'course:main': 1.0, 'course:dessert': -0.6 },
  },
};

// ───────── typing like a person ─────────
const VOWELS = 'aeiou';
function typo(word, r) {
  if (word.length < 5) return word;
  const i = 1 + Math.floor(r() * (word.length - 2));
  const kind = Math.floor(r() * 4);
  if (kind === 0) return word.slice(0, i) + word.slice(i + 1);                          // drop a letter
  if (kind === 1) return word.slice(0, i) + word[i] + word.slice(i);                    // double a letter
  if (kind === 2) return word.slice(0, i - 1) + word[i] + word[i - 1] + word.slice(i + 1); // swap two
  const v = [...word].map((c, k) => (VOWELS.includes(c) ? k : -1)).filter((k) => k > 0);
  if (!v.length) return word;
  const k = v[Math.floor(r() * v.length)];
  return word.slice(0, k) + VOWELS[(VOWELS.indexOf(word[k]) + 1 + Math.floor(r() * 4)) % 5] + word.slice(k + 1); // wrong vowel
}
/** What they type: a few of the items, with typos, usually comma separated. */
export function typeList(items, r, { typoRate = 0.25, commaRate = 0.7 } = {}) {
  const words = items.map((s) => s.split(' ').map((w) => (r() < typoRate ? typo(w, r) : w)).join(' '));
  return words.join(r() < commaRate || words.some((w) => w.includes(' ')) ? ', ' : ' ');
}

const NOISE_LIKES = ['broccoli', 'carrots', 'cucumber', 'garlic', 'onion', 'apples'];

/**
 * Does a dish really have this food (for the hidden taste), and how much of it? A plain check on
 * ingredients and name, independent of the app's food dictionary: 0 no, 1 only as a garnish or side
 * (they could leave it), 2 cooked in, 3 the dish is built around it.
 */
const ROLE_WEIGHT = { garnish: 1, side: 1, component: 2, core: 3 };
function hasFood(d, food) {
  const w = normIngredient(food.replace(/ food$/, ''));
  if (food === 'spicy food') return d.heat >= 2 ? 3 : 0;
  if (food === 'fried food') return d.method === 'fried' ? 3 : 0;
  if (food === 'sweet') return d.sweetness >= 2 ? 3 : 0;
  if (food === 'salad') return d.course === 'salad' ? 3 : 0;
  if (food === 'noodles') return d.carb === 'noodle' ? 3 : 0;
  if (food === 'raw fish') return d.method === 'raw' && ['fish', 'shellfish'].includes(d.protein) ? 3 : 0;
  if (food === 'curry') return /curry|masala|korma|wat/.test(d.name.toLowerCase()) || d.ingredients.some((i) => i.includes('curry')) ? 3 : 0;
  const ings = d.ingredients.filter((i) => (i === w || i.includes(w)) && !(w === 'olive' && i === 'olive oil'));
  if (d.name.toLowerCase().split(' with ')[0].includes(w)) return 3;
  if (!ings.length) return d.name.toLowerCase().includes(w) ? 2 : 0;
  return Math.max(...ings.map((i) => ROLE_WEIGHT[d.roles?.[i] ?? 'component']));
}
/** The check people had before the tolerance was added (pickOut: false): any mention counts in full. */
function hadFood(d, food) {
  const w = normIngredient(food.replace(/ food$/, ''));
  if (['spicy food', 'fried food', 'sweet', 'salad', 'noodles', 'raw fish', 'curry'].includes(food)) return hasFood(d, food) ? 3 : 0;
  return d.ingredients.some((i) => i === w || i.includes(w)) || d.name.toLowerCase().includes(w) ? 3 : 0;
}

/** One synthetic person: a persona plus their own random variations. */
export function makePerson(name, seed, { typoRate = 0.25, statedShare = 0.7, legacy = false, pickOut = true } = {}) {
  const r = rng(seed);
  const base = PERSONAS[name];
  const w = Object.fromEntries(Object.entries(base.w).map(([k, v]) => [k, v + 0.25 * gauss(r)]));
  const likes = base.likes.map(([f, v]) => [f, v * (0.7 + 0.6 * r())]);
  const dislikes = base.dislikes.map(([f, v]) => [f, v * (0.7 + 0.6 * r())]);
  // "will pick it out": 0 = a garnish of it bothers them as much as the dish being built on it, 1 = not at all
  // (its own random stream, so everything else about each person is the same as before it was added)
  const rt = rng(seed * 7 + 3);
  const tolerance = rt() < 0.5 ? 0.6 + 0.35 * rt() : 0.3 * rt();
  const roleFactor = { 0: 0, 1: 1 - tolerance, 2: 0.9, 3: 1 };
  const amount = pickOut ? hasFood : hadFood;
  const quirks = new Map();
  for (const m of MENUS) for (const d of m.dishes) quirks.set(`${m.id}/${d.id}`, 0.6 * gauss(r));
  const foodCache = new Map();
  const foodScore = (d) => {
    let s = foodCache.get(d);
    if (s === undefined) {
      s = 0;
      for (const [f, v] of likes) if (amount(d, f)) s += v;
      for (const [f, v] of dislikes) s += v * (pickOut ? roleFactor[amount(d, f)] : amount(d, f) ? 1 : 0);
      foodCache.set(d, s);
    }
    return s;
  };
  const utility = (menuId, d) => { let s = (quirks.get(`${menuId}/${d.id}`) ?? 0) + foodScore(d); for (const [k, v] of features(d)) s += (w[k] ?? 0) * v; return s; };

  // the intake they fill in: some of their likes and dislikes, maybe one they don't mean, with typos
  const pick = (list) => list.filter(() => r() < statedShare).map(([f]) => f);
  const said = { likes: pick(likes), dislikes: pick(dislikes) };
  if (r() < 0.3) said.likes.push(NOISE_LIKES[Math.floor(r() * NOISE_LIKES.length)]);
  const text = {
    likes: typeList(said.likes, r, { typoRate }), dislikes: typeList(said.dislikes, r, { typoRate }),
    restrictions: typeList(base.restrictions ? base.restrictions.split(', ') : [], r, { typoRate: typoRate / 2, commaRate: 1 }),
    cuisines: typeList(base.cuisines.split(', '), r, { typoRate }),
  };
  // their real rules come from the correctly spelled restrictions; the app sees what they typed
  const truth = { restrictions: parseList(base.restrictions, 'restriction') };
  const intake = legacy
    ? { diet: [], allergies: [], never: [], spice: base.spice, adventure: base.adventure, cuisines: [], restrictions: parseList(text.restrictions, 'restriction') }
    : {
      v: 2, likes: parseList(text.likes, 'food'), dislikes: parseList(text.dislikes, 'food'),
      restrictions: parseList(text.restrictions, 'restriction'), cuisineChips: parseList(text.cuisines, 'cuisine'),
      spice: base.spice, adventure: base.adventure,
    };
  return {
    name, intake, truth, text, said, utility, tolerance,
    /** Their top 3 (sometimes 2) on this menu, among dishes they can really eat. */
    choose(menu) {
      const ok = menu.dishes.filter((d) => allowed(d, truth));
      const noisy = ok.map((d) => ({ d, u: utility(menu.id, d) + 0.7 * gumbel(r) })).sort((a, b) => b.u - a.u);
      const k = r() < 0.8 ? 3 : 2;
      return { picked: noisy.slice(0, k).map((x) => x.d.id), never: [] };
    },
  };
}

/**
 * A whole training session for one person, in the order the app offers menus.
 * predictor(roundsSoFar, menu) -> the 3 dish ids the app guessed before they picked.
 */
export function playSession(person, seed, predictor = null, { max = MENUS.length, order = null } = {}) {
  const rounds = [];
  const plan = order ?? menuPlan(person.intake);
  for (const id of plan.slice(0, max)) {
    const menu = MENUS.find((m) => m.id === id);
    const predicted = predictor ? predictor(rounds, menu) : [];
    const { picked, never } = person.choose(menu);
    if (picked.length) rounds.push({ menu: menu.id, predicted, picked, never }); // nothing they can eat: they skip it
  }
  return rounds;
}
