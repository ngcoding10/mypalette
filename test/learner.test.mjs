// Learner tests on synthetic people: `node --test` (no browser, no network).
// They check that guesses get better as people answer more rounds, and that after training the
// learner beats simply suggesting each menu's most popular dishes on menus it has not seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENUS } from '../js/menus.js';
import { ALLERGENS, CARBS, COURSES, CUISINES, DIETS, METHODS, PROTEINS, TEXTURES, allowed, conflicts, normIngredient, normalizeDish } from '../js/schema.js';
import { explain, learnedLine, priorFromIntake, profileForServer, rank, summary, topK, train } from '../js/learner.js';
import { PERSONAS, makePerson, playSession } from './personas.mjs';
import { expand, popularTop, popularity, randomHitRate, replay } from '../tools/eval-lib.mjs';

const PER_PERSONA = 15;
const people = [];
let seed = 100;
for (const name of Object.keys(PERSONAS)) for (let i = 0; i < PER_PERSONA; i++, seed++) {
  const p = makePerson(name, seed);
  people.push({ id: `p${seed}`, persona: name, intake: p.intake, rounds: playSession(p, seed) });
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const dish = (menu, id) => MENUS.find((m) => m.id === menu).dishes.find((d) => d.id === id);

test('menus: 12 cuisines, 12-18 dishes each, every dish fully tagged with the schema', () => {
  assert.equal(MENUS.length, 12);
  assert.equal(new Set(MENUS.map((m) => m.id)).size, 12);
  for (const m of MENUS) {
    assert.ok(m.dishes.length >= 12 && m.dishes.length <= 18, `${m.id} has ${m.dishes.length}`);
    assert.equal(new Set(m.dishes.map((d) => d.id)).size, m.dishes.length, `${m.id} ids unique`);
    for (const d of m.dishes) {
      assert.match(d.id, /^[a-z0-9_-]{1,40}$/);
      assert.ok(CUISINES.includes(d.cuisine) && COURSES.includes(d.course) && PROTEINS.includes(d.protein) && DIETS.includes(d.diet), d.id);
      assert.ok(METHODS.includes(d.method) && CARBS.includes(d.carb), d.id);
      assert.ok(d.texture.every((t) => TEXTURES.includes(t)) && d.allergens.every((a) => ALLERGENS.includes(a)), d.id);
      assert.ok(d.ingredients.length >= 2 && d.desc.length > 20 && d.desc.length < 160, d.id);
      assert.ok(!/—/.test(d.desc + d.name), `no em dashes: ${d.id}`);
      for (const k of ['heat', 'richness', 'sweetness', 'sourness', 'umami']) assert.ok(d[k] >= 0 && d[k] <= 3);
    }
    assert.ok(m.dishes.filter((d) => d.course === 'main').length >= 5, `${m.id} has enough mains`);
  }
  // diet is derived sensibly
  assert.equal(dish('thai', 'som-tam').diet, 'pescatarian');
  assert.equal(dish('indian', 'chana-masala').diet, 'vegan');
  assert.equal(dish('chinese', 'mapo-tofu').diet, 'meat');
});

test('schema: spellings fold together and backend answers normalise to the same shape', () => {
  assert.equal(normIngredient('Chillies'), 'chili');
  assert.equal(normIngredient('Prawns'), 'shrimp');
  assert.equal(normIngredient('coriander'), 'cilantro');
  assert.equal(normIngredient('Tomatoes'), 'tomato');
  const d = normalizeDish({ name: 'X', tags: { cuisine: 'thai', course: 'main', protein: 'chicken', diet: 'meat', method: 'grilled', heat: 7, richness: 1, sweetness: 1, sourness: 1, umami: 1, texture: ['crispy', 'bogus'], ingredients: ['Limes', 'Peanuts'], carb: 'rice', familiarity: 'common', temperature: 'hot', allergens: ['peanut', 'plutonium'] } });
  assert.equal(d.heat, 3);
  assert.deepEqual(d.texture, ['crispy']);
  assert.deepEqual(d.ingredients, ['lime', 'peanut']);
  assert.deepEqual(d.allergens, ['peanut']);
});

test('hard rules: diet, allergies and never-eat items are never suggested', () => {
  const thai = MENUS.find((m) => m.id === 'thai');
  const intake = { diet: ['vegetarian'], allergies: ['peanut'], never: ['coconut', 'basil'], spice: 3, adventure: 2 };
  assert.deepEqual(conflicts(dish('thai', 'pad-thai'), intake).map((c) => c.kind).sort(), ['allergy', 'diet']);
  assert.ok(conflicts(dish('thai', 'massaman'), { allergies: ['peanut'] }).some((c) => /peanut/.test(c.text)));
  assert.ok(!allowed(dish('thai', 'mango-sticky'), { never: ['coconut'] }));
  assert.ok(!allowed(dish('thai', 'kee-mao'), { never: ['basil'] })); // typed word, matched to ingredients
  assert.ok(!allowed(dish('japanese', 'sashimi'), { never: ['raw_fish'] }));
  for (const p of people.slice(0, 30)) {
    const model = train(p.intake, expand(p.rounds));
    for (const m of MENUS) for (const id of topK(model, m.dishes, p.intake)) assert.ok(allowed(m.dishes.find((d) => d.id === id), p.intake));
  }
  const ranked = rank(train(intake, []), thai.dishes, intake);
  assert.ok(ranked.slice(-3).every((r) => r.blocked.length), 'blocked dishes sort last');
});

test('cold start: the intake alone already steers away from heat for a plain eater', () => {
  const w = priorFromIntake({ spice: 0, adventure: 0 });
  assert.ok(w['heat:3'] < w['heat:2'] && w['heat:2'] < w['heat:1'] && w['heat:1'] < 0);
  assert.ok(w.adventurous < 0);
  const hot = priorFromIntake({ spice: 3 });
  assert.ok(hot['heat:3'] > 0);
});

test('learning: top-3 hit rate rises across rounds and beats both baselines', (t) => {
  const rep = replay(people);
  const early = rep.byRound.slice(0, 3), late = rep.byRound.slice(-4);
  const mean = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  const e3 = mean(early, 'top3'), l3 = mean(late, 'top3');
  t.diagnostic(`${people.length} synthetic people x 12 rounds. top-3 hit rate: rounds 1-3 ${pct(e3)}, rounds 9-12 ${pct(l3)}; overall learner ${pct(rep.overall.top3)} vs most-popular ${pct(rep.overall.pop3)} vs random ${pct(rep.overall.rand3)}`);
  t.diagnostic(`top-1: learner ${pct(rep.overall.top1)} vs most-popular ${pct(rep.overall.pop1)} vs random ${pct(rep.overall.rand1)}`);
  assert.ok(l3 > e3 + 0.08, `late ${l3} should beat early ${e3}`);
  assert.ok(rep.overall.top3 > rep.overall.rand3 + 0.15);
  assert.ok(mean(late, 'top3') > mean(late, 'pop3') + 0.05);
});

test('held-out menus: after 8 rounds it beats the most-popular baseline on 4 unseen menus', (t) => {
  const counts = popularity(people);
  let learner = 0, pop = 0, cold = 0, n = 0;
  for (const p of people) {
    const model = train(p.intake, expand(p.rounds.slice(0, 8)));
    const start = train(p.intake, []);
    for (const r of p.rounds.slice(8)) {
      const menu = MENUS.find((m) => m.id === r.menu);
      const hit = (ids) => (ids.some((id) => r.picked.includes(id)) ? 1 : 0);
      learner += hit(topK(model, menu.dishes, p.intake));
      cold += hit(topK(start, menu.dishes, p.intake));
      pop += hit(popularTop(counts, menu, p.intake, r.picked));
      n++;
    }
  }
  t.diagnostic(`held-out top-3 hit rate: learner ${pct(learner / n)}, most-popular ${pct(pop / n)}, intake only ${pct(cold / n)} (${n} menus)`);
  assert.ok(learner / n > pop / n + 0.05);
  assert.ok(learner / n > cold / n + 0.05);
});

test('words: it explains picks and says what it learned', (t) => {
  const fans = people.filter((x) => x.persona === 'noodle and peanut fan');
  let mentions = 0, likes = 0;
  for (const p of fans) {
    const model = train(p.intake, expand(p.rounds));
    const picks = p.rounds.flatMap((r) => r.picked.map((id) => dish(r.menu, id)));
    const line = learnedLine(model, picks);
    assert.match(line, /^You (keep|r)/);
    assert.match(line, /\.$/);
    if (/noodle/.test(line)) mentions++;
    if (summary(model).likes.includes('noodles')) likes++;
  }
  t.diagnostic(`noodle fans: ${mentions}/${fans.length} learned lines mention noodles; ${likes}/${fans.length} summaries list noodles as a like`);
  assert.ok(mentions >= fans.length * 0.6 && likes >= fans.length * 0.6);
  const p = fans[0];
  const model = train(p.intake, expand(p.rounds));
  assert.ok(explain(model, dish('vietnamese', 'bun-thit-nuong')).length > 0);
  const server = profileForServer(model, p.intake);
  assert.deepEqual(Object.keys(server).sort(), ['adventure', 'allergies', 'diet', 'dislikes', 'likes', 'never', 'rounds', 'spice']);
  assert.match(learnedLine(train({}, []), [dish('thai', 'pad-thai')]), /Noted: Pad thai/);
});

test('random baseline maths', () => {
  assert.ok(Math.abs(randomHitRate(10, 1, 1) - 0.1) < 1e-9);
  assert.ok(Math.abs(randomHitRate(10, 1, 3) - 0.3) < 1e-9);
  assert.equal(randomHitRate(3, 1, 3), 1);
});
