// Synthetic people for testing the learner. Each has a hidden taste (weights over the same dish
// features the learner uses, plus a private like or dislike for every single dish that no feature
// explains) and answers the intake the way such a person would. They pick 1-3 dishes per menu
// with random noise, so they are not perfectly predictable, like real people.
import { features } from '../js/learner.js';
import { allowed } from '../js/schema.js';
import { MENUS } from '../js/menus.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const gumbel = (r) => -Math.log(-Math.log(r() || 1e-9));
export function shuffle(list, r) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const PERSONAS = {
  'spice-loving vegetarian': {
    intake: { diet: ['vegetarian'], allergies: [], never: [], spice: 3, adventure: 2, cuisines: ['indian'] },
    w: { 'heat:3': 1.5, 'heat:2': 1.0, 'heat:0': -0.8, 'cuisine:indian': 0.8, 'cuisine:thai': 0.6, 'cuisine:ethiopian': 0.5, 'protein:legumes': 0.7, 'protein:tofu': 0.5, 'protein:cheese': 0.6, 'tex:creamy': 0.5, sour: 0.4, 'course:main': 1.0, 'course:dessert': -0.8 },
  },
  'plain eater': {
    intake: { diet: [], allergies: [], never: ['cilantro', 'raw_fish'], spice: 0, adventure: 0, cuisines: ['american'] },
    w: { 'heat:0': 1.0, 'heat:2': -1.5, 'heat:3': -2.5, adventurous: -1.5, 'method:fried': 0.8, 'carb:bread': 0.6, 'carb:potato': 0.7, 'protein:chicken': 0.8, 'protein:cheese': 0.6, 'cuisine:american': 1.0, 'cuisine:italian': 0.7, 'method:raw': -2, cold: -0.6, sour: -0.6, 'tex:crispy': 0.5, 'course:main': 1.0, 'course:dessert': -0.5 },
  },
  'seafood lover': {
    intake: { diet: [], allergies: [], never: [], spice: 1, adventure: 2, cuisines: ['japanese'] },
    w: { 'protein:fish': 1.5, 'protein:shellfish': 1.5, 'method:raw': 0.8, 'method:grilled': 0.6, sour: 0.5, 'ing:lime': 0.5, 'ing:lemon': 0.5, 'cuisine:japanese': 0.7, 'cuisine:greek': 0.5, rich: -0.4, 'course:main': 0.6, 'course:starter': 0.4, 'course:dessert': -0.8 },
  },
  'noodle and peanut fan': {
    intake: { diet: [], allergies: [], never: [], spice: 2, adventure: 1, cuisines: ['vietnamese'] },
    w: { 'carb:noodle': 1.6, 'ing:peanut': 0.8, 'ing:lime': 0.8, sour: 0.5, sweet: 0.3, 'cuisine:vietnamese': 0.6, 'cuisine:thai': 0.6, 'tex:chewy': 0.5, 'course:main': 0.8, 'course:dessert': -0.8 },
  },
  'comfort meat eater': {
    intake: { diet: [], allergies: [], never: [], spice: 1, adventure: 1, cuisines: [] },
    w: { 'protein:beef': 1.2, 'protein:pork': 1.0, rich: 0.8, 'method:braised': 0.6, 'method:grilled': 0.5, umami: 0.6, veg: -1.0, 'course:main': 1.0, 'course:salad': -0.8, 'course:dessert': -0.5 },
  },
  'light, dairy-free eater': {
    intake: { diet: ['dairy_free'], allergies: ['dairy'], never: [], spice: 1, adventure: 1, cuisines: [] },
    w: { rich: -1.0, 'method:fried': -1.0, 'method:steamed': 0.6, 'method:fresh': 0.6, 'method:grilled': 0.5, 'course:salad': 0.8, 'course:soup': 0.4, 'tex:brothy': 0.4, sour: 0.4, 'protein:fish': 0.5, 'protein:chicken': 0.4, 'course:main': 0.5, 'course:dessert': -0.8 },
  },
};

/** One synthetic person: a persona plus their own random variations. */
export function makePerson(name, seed) {
  const r = rng(seed);
  const base = PERSONAS[name];
  const w = Object.fromEntries(Object.entries(base.w).map(([k, v]) => [k, v + 0.25 * gauss(r)]));
  const quirks = new Map(); // a private like or dislike for each dish that no feature explains
  for (const m of MENUS) for (const d of m.dishes) quirks.set(`${m.id}/${d.id}`, 0.6 * gauss(r));
  const utility = (menuId, d) => { let s = quirks.get(`${menuId}/${d.id}`) ?? 0; for (const [k, v] of features(d)) s += (w[k] ?? 0) * v; return s; };
  return {
    name, intake: base.intake, utility,
    /** What they mark on this menu: 1-3 picks, and sometimes a "would never order". */
    choose(menu) {
      const ok = menu.dishes.filter((d) => allowed(d, base.intake));
      const noisy = ok.map((d) => ({ d, u: utility(menu.id, d) + 0.7 * gumbel(r) })).sort((a, b) => b.u - a.u);
      const k = r() < 0.4 ? 1 : r() < 0.6 ? 2 : 3;
      const picked = noisy.slice(0, k).map((x) => x.d.id);
      const never = r() < 0.5 ? [noisy[noisy.length - 1].d.id] : [];
      return { picked, never };
    },
  };
}

/** A whole training session for one person: every menu, in a random order. */
export function playSession(person, seed, predictor = null) {
  const r = rng(seed * 7 + 1);
  const rounds = [];
  for (const menu of shuffle(MENUS, r)) {
    const predicted = predictor ? predictor(rounds, menu) : [];
    const { picked, never } = person.choose(menu);
    rounds.push({ menu: menu.id, predicted, picked, never });
  }
  return rounds;
}
