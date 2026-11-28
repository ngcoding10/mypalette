// Accuracy of the intake + training flow on synthetic people (test/personas.mjs): they type their likes,
// dislikes, allergies and cuisines with typos, then do up to all 26 sample menus in the app's order,
// picking their top 3 after seeing the app's guess. Each person also has a "will pick it out"
// tolerance: about half barely mind a disliked food that is only a garnish or side, the rest mind a lot.
// SYNTHETIC PEOPLE ONLY: the numbers say the learner works as designed on people built to have
// consistent tastes, not how real people behave.
//
//   node tools/evaluate-intake.mjs [people per persona, default 30] [--old-people]
//
// Reports, for a learner trained on the first k menus (k = 0, 3, 10, 25), the top-3 guess on menus it
// has not seen: "hit" = at least one of their picks was in its 3; "guessed" = how many of their picks
// it guessed, out of the picks (the "it guessed 2 of your 3" shown in the app). Columns:
//   learner      the current learner (disliked foods scored by their role: core, cooked in, removable)
//   old scoring  the same learner with the previous dislike scoring (any disliked food, one big penalty)
//   no learning  the intake alone, never updated
//   popular      each menu's most popular dishes;  random
// --old-people: people without the tolerance (any disliked food bothers them fully), as before.
import { MENUS, menuById } from '../js/menus.js';
import { TUNING, dislikeHits, prefsOf, train, topK } from '../js/learner.js';
import { allowed } from '../js/rules.js';
import { PERSONAS, makePerson, playSession, rng } from '../test/personas.mjs';
import { expand, randomHitRate } from './eval-lib.mjs';

const PER = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);
const PICK_OUT = !process.argv.includes('--old-people');
const KS = [0, 3, 10, 25];
const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(5);
const MODES = { learner: true, old: false };
/** Run fn with the dislike scoring of a mode (true = by role). */
const withMode = (roles, fn) => { const keep = TUNING.roles; TUNING.roles = roles; try { return fn(); } finally { TUNING.roles = keep; } };

const people = [];
let seed = 9000;
for (const name of Object.keys(PERSONAS)) for (let i = 0; i < PER; i++, seed++) {
  const p = makePerson(name, seed, { pickOut: PICK_OUT });
  // picks do not depend on the app's guesses, so play once and replay each mode's guesses on top
  const picks = playSession(p, seed);
  const sessions = {};
  for (const [mode, roles] of Object.entries(MODES)) {
    const intake = { ...p.intake }; // its own caches per mode
    const rounds = [];
    withMode(roles, () => { for (const r of picks) rounds.push({ ...r, predicted: topK(train(intake, expand(rounds)), menuById(r.menu).dishes, intake, 3) }); });
    sessions[mode] = { intake, rounds };
  }
  people.push({ p, seed, picks, sessions });
}

// most popular dishes per menu, leaving the person out
const counts = new Map();
for (const { picks } of people) for (const r of picks) { const m = counts.get(r.menu) ?? new Map(); for (const id of r.picked) m.set(id, (m.get(id) ?? 0) + 1); counts.set(r.menu, m); }
const popular = (menu, intake, own) => {
  const m = counts.get(menu.id) ?? new Map();
  return menu.dishes.map((d, i) => ({ d, i, c: (m.get(d.id) ?? 0) - (own.includes(d.id) ? 1 : 0) })).filter((x) => allowed(x.d, intake))
    .sort((a, b) => b.c - a.c || a.i - b.i).slice(0, 3).map((x) => x.d.id);
};

const blank = () => ({ n: 0, hit: 0, got: 0 });
const add = (acc, guess, picked) => { const g = guess.filter((id) => picked.includes(id)).length; acc.n++; acc.hit += g ? 1 : 0; acc.got += g / picked.length; };
const table = {};
let unsafe = 0, guesses = 0;
// how often guesses and picks contain a food the person typed as disliked, by its role in the dish
const disliked = { learner: { core: 0, mixed: 0, removable: 0, n: 0 }, old: { core: 0, mixed: 0, removable: 0, n: 0 }, picked: { core: 0, mixed: 0, removable: 0, n: 0 } };
const tally = (acc, intake, dishes) => {
  const prefs = prefsOf(intake);
  for (const d of dishes) {
    acc.n++;
    const hits = withMode(true, () => dislikeHits(d, prefs));
    if (!hits.length) continue;
    const k = hits.some((h) => h.role === 'core') ? 'core' : hits.some((h) => !h.removable) ? 'mixed' : 'removable';
    acc[k]++;
  }
};
for (const k of KS) table[k] = { learner: blank(), old: blank(), none: blank(), popular: blank(), random: blank() };
// of the picks that have a disliked food as a garnish or side: how many each mode guessed, by tolerance
const roleOfPick = (intake, d) => { const hits = withMode(true, () => dislikeHits(d, prefsOf(intake))); return !hits.length ? 'none' : hits.some((h) => !h.removable) ? 'firm' : 'removable'; };
const recall = {}; // `${k}|${group}|${kind}` -> { learner: [got, n], old: [got, n] }
const bump = (key, mode, got) => { const x = (recall[key] ??= { learner: [0, 0], old: [0, 0] }); x[mode][0] += got ? 1 : 0; x[mode][1]++; };

for (const { p, seed, picks, sessions } of people) {
  const r = rng(seed * 13 + 5);
  for (const k of KS) {
    const out = k >= picks.length - 1 ? Math.floor(r() * picks.length) : -1;
    const split = (rounds) => (out >= 0 ? [rounds.filter((_, i) => i !== out), [rounds[out]]] : [rounds.slice(0, k), rounds.slice(k)]);
    const t = table[k];
    for (const [mode, roles] of Object.entries(MODES)) {
      const { intake, rounds } = sessions[mode];
      const [trainOn, testOn] = split(rounds);
      withMode(roles, () => {
        const model = train(intake, expand(trainOn));
        const none = train(intake, []);
        for (const round of testOn) {
          const menu = menuById(round.menu);
          const guess = topK(model, menu.dishes, intake, 3);
          add(t[mode], guess, round.picked);
          if (mode === 'learner') {
            add(t.none, topK(none, menu.dishes, intake, 3), round.picked);
            add(t.popular, popular(menu, p.truth, round.picked), round.picked);
            const n = menu.dishes.filter((d) => allowed(d, p.truth)).length;
            t.random.n++; t.random.hit += randomHitRate(n, round.picked.length, 3); t.random.got += 3 / Math.max(3, n);
          }
          for (const id of guess) { guesses++; if (!allowed(menu.dishes.find((d) => d.id === id), p.truth)) unsafe++; }
          if (k === 0 || k === 10) {
            const group = p.tolerance >= 0.6 ? 'pick it out' : 'mind it';
            for (const id of round.picked) { const kind = roleOfPick(intake, menu.dishes.find((d) => d.id === id)); if (kind !== 'none') bump(`${k}|${group}|${kind}`, mode, guess.includes(id)); }
          }
          if (k === 10) {
            tally(disliked[mode], intake, guess.map((id) => menu.dishes.find((d) => d.id === id)));
            if (mode === 'learner') tally(disliked.picked, intake, round.picked.map((id) => menu.dishes.find((d) => d.id === id)));
          }
        }
      });
    }
  }
}

// prequential: what people see in the app, round by round (guess made before they picked)
const byRound = { learner: [], old: [] };
for (const { sessions } of people) for (const mode of Object.keys(MODES)) sessions[mode].rounds.forEach((r, i) => {
  const g = r.predicted.filter((id) => r.picked.includes(id)).length;
  const row = (byRound[mode][i] ??= blank()); row.n++; row.hit += g ? 1 : 0; row.got += g / r.picked.length;
});
const span = (mode, a, b) => { const s = blank(); for (const x of byRound[mode].slice(a - 1, b)) { s.n += x.n; s.hit += x.hit; s.got += x.got; } return s; };

console.log(`MyPalette learner: ${people.length} SYNTHETIC people (${Object.keys(PERSONAS).length} personas x ${PER}), ${MENUS.length} menus, ${PICK_OUT ? 'with a "will pick it out" tolerance' : 'old people: no pick-it-out tolerance'}.`);
console.log('Each cell: hit rate (at least 1 of their picks in its top 3) / share of their picks it guessed.\n');
console.log('after k menus   learner       old scoring   no learning   popular       random');
for (const k of KS) {
  const t = table[k];
  const cell = (a) => `${pct(a.hit / a.n)} /${pct(a.got / a.n)}`;
  console.log(`k = ${String(k).padEnd(11)} ${cell(t.learner)}  ${cell(t.old)}  ${cell(t.none)}  ${cell(t.popular)}  ${cell(t.random)}`);
}
console.log('\nIn the app (guess shown before they pick, learned from earlier menus only), learner / old scoring:');
for (const [a, b] of [[1, 3], [4, 10], [11, 25]]) {
  const s = span('learner', a, b), o = span('old', a, b);
  console.log(`  menus ${String(a).padStart(2)}-${String(b).padEnd(2)}  hit ${pct(s.hit / s.n)} / ${pct(o.hit / o.n)}   guessed ${pct(s.got / s.n)} / ${pct(o.got / o.n)} of their picks`);
}
const share = (acc, k) => pct(acc[k] / acc.n);
console.log('\nDishes with a food they typed as disliked (after 10 menus, on menus not trained on):');
console.log('                         built on it   cooked in   garnish/side');
for (const [label, acc] of [['what they picked', disliked.picked], ['learner guesses', disliked.learner], ['old scoring guesses', disliked.old]]) console.log(`  ${label.padEnd(22)} ${share(acc, 'core')}        ${share(acc, 'mixed')}      ${share(acc, 'removable')}`);
console.log('\nTheir picks that have a disliked food: share the guess included (learner / old scoring):');
for (const k of [0, 10]) for (const group of ['pick it out', 'mind it']) for (const kind of ['removable', 'firm']) {
  const x = recall[`${k}|${group}|${kind}`];
  if (!x) continue;
  const f = ([g, n]) => (n ? pct(g / n) : '   -');
  console.log(`  after ${String(k).padStart(2)} menus, people who ${group.padEnd(11)}, ${kind === 'removable' ? 'garnish/side' : 'built on / cooked in'}: ${f(x.learner)} / ${f(x.old)}  (${x.learner[1]} picks)`);
}
console.log(`\nGuesses that broke the person's real rules (allergies/diet typed with typos): ${unsafe} of ${guesses}.`);
console.log('Synthetic people only. Real people are less consistent; expect lower numbers.');
