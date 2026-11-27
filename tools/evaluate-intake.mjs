// Accuracy of the new flow on synthetic people (test/personas.mjs): they type their likes,
// dislikes, allergies and cuisines with typos, then do up to all 26 sample menus in the app's order,
// picking their top 3 after seeing the app's guess. SYNTHETIC PEOPLE ONLY: the numbers say the
// learner works as designed on people built to have consistent tastes, not how real people behave.
//
//   node tools/evaluate-intake.mjs [people per persona, default 30]
//
// Reports, for a learner trained on the first k menus (k = 0, 3, 10, 25), the top-3 guess on menus it
// has not seen: "hit" = at least one of their picks was in its 3; "guessed" = how many of their picks
// it guessed, out of the picks (the "it guessed 2 of your 3" shown in the app). Baselines on the same
// menus: no learning (the intake alone, never updated), the old intake (heat, adventure and rules,
// but no typed likes or dislikes) with learning, each menu's most popular dishes, and random.
import { MENUS, menuById } from '../js/menus.js';
import { train, topK } from '../js/learner.js';
import { allowed } from '../js/rules.js';
import { PERSONAS, makePerson, playSession, rng, shuffle } from '../test/personas.mjs';
import { expand, randomHitRate } from './eval-lib.mjs';

const PER = Number(process.argv[2] ?? 30);
const KS = [0, 3, 10, 25];
const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(5);

const people = [];
let seed = 9000;
for (const name of Object.keys(PERSONAS)) for (let i = 0; i < PER; i++, seed++) {
  const p = makePerson(name, seed);
  const legacyIntake = { spice: p.intake.spice, adventure: p.intake.adventure, restrictions: p.intake.restrictions };
  // the app guesses before each pick from the rounds so far; that guess is part of what it learns from
  const rounds = playSession(p, seed, (done, menu) => topK(train(p.intake, expand(done)), menu.dishes, p.intake, 3));
  people.push({ p, seed, rounds, legacyIntake });
}

// most popular dishes per menu, leaving the person out
const counts = new Map();
for (const { rounds } of people) for (const r of rounds) { const m = counts.get(r.menu) ?? new Map(); for (const id of r.picked) m.set(id, (m.get(id) ?? 0) + 1); counts.set(r.menu, m); }
const popular = (menu, intake, own) => {
  const m = counts.get(menu.id) ?? new Map();
  return menu.dishes.map((d, i) => ({ d, i, c: (m.get(d.id) ?? 0) - (own.includes(d.id) ? 1 : 0) })).filter((x) => allowed(x.d, intake))
    .sort((a, b) => b.c - a.c || a.i - b.i).slice(0, 3).map((x) => x.d.id);
};

const blank = () => ({ n: 0, hit: 0, got: 0 });
const add = (acc, guess, picked) => { const g = guess.filter((id) => picked.includes(id)).length; acc.n++; acc.hit += g ? 1 : 0; acc.got += g / picked.length; };
const table = {};
let unsafe = 0, guesses = 0;
for (const k of KS) table[k] = { learner: blank(), none: blank(), legacy: blank(), popular: blank(), random: blank() };

for (const { p, seed, rounds, legacyIntake } of people) {
  const r = rng(seed * 13 + 5);
  for (const k of KS) {
    let trainOn, testOn;
    if (k >= rounds.length - 1) {
      // after 25: leave one random menu out, train on the other 25
      const out = Math.floor(r() * rounds.length);
      trainOn = rounds.filter((_, i) => i !== out); testOn = [rounds[out]];
    } else { trainOn = rounds.slice(0, k); testOn = rounds.slice(k); }
    const model = train(p.intake, expand(trainOn));
    const none = train(p.intake, []);
    const legacy = train(legacyIntake, expand(trainOn));
    const t = table[k];
    for (const round of testOn) {
      const menu = menuById(round.menu);
      const guess = topK(model, menu.dishes, p.intake, 3);
      add(t.learner, guess, round.picked);
      add(t.none, topK(none, menu.dishes, p.intake, 3), round.picked);
      add(t.legacy, topK(legacy, menu.dishes, legacyIntake, 3), round.picked);
      add(t.popular, popular(menu, p.truth, round.picked), round.picked);
      const n = menu.dishes.filter((d) => allowed(d, p.truth)).length;
      t.random.n++; t.random.hit += randomHitRate(n, round.picked.length, 3); t.random.got += 3 / Math.max(3, n);
      for (const id of guess) { guesses++; if (!allowed(menu.dishes.find((d) => d.id === id), p.truth)) unsafe++; }
    }
  }
}

// prequential: what people see in the app, round by round (guess made before they picked)
const byRound = [];
for (const { rounds } of people) rounds.forEach((r, i) => {
  const g = r.predicted.filter((id) => r.picked.includes(id)).length;
  (byRound[i] ??= blank()); byRound[i].n++; byRound[i].hit += g ? 1 : 0; byRound[i].got += g / r.picked.length;
});
const span = (a, b) => { const s = blank(); for (const x of byRound.slice(a - 1, b)) { s.n += x.n; s.hit += x.hit; s.got += x.got; } return s; };

console.log(`MyPalette learner, new intake: ${people.length} SYNTHETIC people (${Object.keys(PERSONAS).length} personas x ${PER}), ${MENUS.length} menus.`);
console.log('Each cell: hit rate (at least 1 of their picks in its top 3) / share of their picks it guessed.\n');
console.log('after k menus   learner      no learning   old intake    popular       random');
for (const k of KS) {
  const t = table[k];
  const cell = (a) => `${pct(a.hit / a.n)} /${pct(a.got / a.n)}`;
  console.log(`k = ${String(k).padEnd(11)} ${cell(t.learner)}  ${cell(t.none)}  ${cell(t.legacy)}  ${cell(t.popular)}  ${cell(t.random)}`);
}
console.log('\nIn the app (guess shown before they pick, learned from earlier menus only):');
for (const [a, b] of [[1, 3], [4, 10], [11, 25]]) { const s = span(a, b); console.log(`  menus ${String(a).padStart(2)}-${String(b).padEnd(2)}  hit ${pct(s.hit / s.n)}   guessed ${pct(s.got / s.n)} of their picks`); }
console.log(`\nGuesses that broke the person's real rules (allergies/diet typed with typos): ${unsafe} of ${guesses}.`);
console.log('Synthetic people only. Real people are less consistent; expect lower numbers.');
