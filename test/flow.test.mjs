// The training loop without a browser: guess -> pick -> learn -> next menu, the offer after 10,
// stopping early, and loading older saved data. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../js/foods.js';
import { menuById } from '../js/menus.js';
import { allowed } from '../js/rules.js';
import { profileForServer, topK } from '../js/learner.js';

// a localStorage for Node, shared by every copy of the store loaded below
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const KEY = 'mypalette.state.v1';
let copies = 0;
const freshStore = () => import(`../js/store.js?copy=${++copies}`);

const answers = () => ({
  likes: parseList('noodles, broocli, lime, peanuts'), dislikes: parseList('olives, blue cheese'),
  restrictions: parseList('shellfish', 'restriction'), cuisineChips: parseList('thai, vietnamese', 'cuisine'), spice: 2, adventure: 1,
});
const noodlesFirst = (menu) => [...menu.dishes].filter((d) => allowed(d, { restrictions: parseList('shellfish', 'restriction') }))
  .sort((a, b) => (b.carb === 'noodle') - (a.carb === 'noodle') || (b.course === 'main') - (a.course === 'main')).slice(0, 3).map((d) => d.id);

test('guess -> pick -> learn: the guess is made before picking, the round is scored and learned from', async () => {
  mem.clear();
  const S = await freshStore();
  assert.equal(S.phase(), 'intake');
  S.saveIntake(answers());
  assert.equal(S.phase(), 'round');
  const p = S.startRound();
  const menu = menuById(p.menu);
  assert.equal(p.predicted.length, 3, 'its top 3 is ready before any pick');
  for (const id of p.predicted) assert.ok(allowed(menu.dishes.find((d) => d.id === id), S.get().intake), 'never guesses an allergen');
  assert.deepEqual(S.startRound(), p, 'the same guess after a reload, not a new one');
  const mine = noodlesFirst(menu);
  for (const id of mine) assert.ok(S.togglePick(id));
  assert.equal(S.togglePick(menu.dishes.find((d) => !mine.includes(d.id)).id), false, 'a 4th pick is refused');
  assert.ok(S.togglePick(mine[2]) && S.togglePick(mine[2]), 'tapping again takes it out and puts it back');
  const before = S.getModel();
  const round = S.finishRound();
  assert.deepEqual(round.picked, mine);
  assert.deepEqual(round.predicted, p.predicted);
  const sc = S.roundScore(round);
  assert.equal(sc.got, p.predicted.filter((id) => mine.includes(id)).length);
  assert.equal(sc.of, 3);
  assert.notEqual(S.getModel(), before, 'retrained');
  assert.equal(S.getModel().n, 1);
  assert.equal(S.get().pending, null);
  assert.equal(S.stats().of, 3);
});

test('it learns from the difference: after picking noodle dishes, its guesses lean to noodles', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake({ ...answers(), likes: [], cuisineChips: [] }); // nothing typed about noodles
  const noodleShare = () => { let n = 0, t = 0; for (const id of ['thai', 'vietnamese', 'japanese', 'chinese', 'korean', 'italian']) { const m = menuById(id); for (const g of topK(S.getModel(), m.dishes, S.get().intake, 3)) { t++; if (m.dishes.find((d) => d.id === g).carb === 'noodle') n++; } } return n / t; };
  const start = noodleShare();
  for (let i = 0; i < 6; i++) {
    const p = S.startRound();
    for (const id of noodlesFirst(menuById(p.menu))) S.togglePick(id);
    S.finishRound();
  }
  const after = noodleShare();
  assert.ok(after > start + 0.15, `noodle share of guesses ${start.toFixed(2)} -> ${after.toFixed(2)}`);
});

test('after 10 menus it offers to keep going (up to 25), and the person can stop at any time', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake(answers());
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    assert.equal(S.phase(), 'round', `menu ${i + 1}`);
    const p = S.startRound();
    assert.ok(!seen.has(p.menu), 'a new menu each time'); seen.add(p.menu);
    for (const id of noodlesFirst(menuById(p.menu))) S.togglePick(id);
    S.finishRound();
  }
  assert.equal(S.phase(), 'offer');
  assert.equal(S.nextMenuId(), null);
  S.keepGoing();
  assert.equal(S.get().target, 25);
  assert.equal(S.phase(), 'round');
  for (let i = 0; i < 15; i++) {
    const p = S.startRound();
    if (!p) break;
    for (const id of noodlesFirst(menuById(p.menu))) S.togglePick(id);
    S.finishRound();
  }
  assert.equal(S.get().rounds.length, 25);
  assert.equal(S.phase(), 'done', 'stops at 25');
  assert.equal(new Set(S.get().rounds.map((r) => r.menu)).size, 25, '25 different menus');
});

test('stop early: after 2 menus it is done, keeps what it learned, and reading a menu uses it', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake(answers());
  for (let i = 0; i < 2; i++) { const p = S.startRound(); for (const id of noodlesFirst(menuById(p.menu))) S.togglePick(id); S.finishRound(); }
  S.startRound(); // a third menu is on screen, then they press Finish
  S.stopTraining();
  assert.equal(S.phase(), 'done');
  assert.equal(S.get().pending, null);
  assert.equal(S.nextMenuId(), null);
  assert.equal(S.getModel().n, 2);
  const prof = profileForServer(S.getModel(), S.get().intake);
  assert.equal(prof.rounds, 2);
  assert.ok(prof.allergies.includes('shellfish'));
  assert.ok(prof.likes.includes('noodles') && prof.likes.includes('broccoli'));
  // the saved data survives a reload
  const again = await freshStore();
  assert.equal(again.phase(), 'done');
  assert.equal(again.get().rounds.length, 2);
  // and they can come back for more later
  again.trainMore();
  assert.equal(again.phase(), 'round');
});

test('stopping before any menu still works: the intake alone ranks dishes', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake(answers());
  S.stopTraining();
  assert.equal(S.phase(), 'done');
  const m = menuById('thai');
  const top = topK(S.getModel(), m.dishes, S.get().intake, 3);
  assert.equal(top.length, 3);
  assert.ok(top.every((id) => allowed(m.dishes.find((d) => d.id === id), S.get().intake)));
});

test('skipping a menu moves on without learning from it', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake(answers());
  const first = S.startRound().menu;
  S.skipMenu();
  assert.notEqual(S.startRound().menu, first);
  assert.equal(S.get().rounds.length, 0);
});

test('older saved data (v1) loads without crashing and keeps the person\'s rules and rounds', async () => {
  mem.clear();
  mem.set(KEY, JSON.stringify({
    v: 1, intake: { name: 'Sam', diet: ['vegetarian'], allergies: ['peanut'], never: ['mushroom', 'capers'], spice: 2, adventure: 0, cuisines: ['thai'], at: 5 },
    rounds: [{ id: 'r1', menu: 'thai', predicted: ['green-curry', 'pad-thai', 'massaman'], picked: ['panang-tofu'], never: [], at: 1, hit: false }, { id: 'r2', menu: 'nope', predicted: [], picked: ['x'] }],
    pending: { menu: 'indian', predicted: [], picked: [], never: [] }, feedback: [], meals: [], consent: false, sessionId: 'abcdefghijklmnopqrstuvwx', order: ['thai'], syncOffFor: null, updated: 1,
  }));
  const S = await freshStore();
  const s = S.get();
  assert.equal(s.v, 3);
  assert.equal(s.intake.name, 'Sam');
  const ks = s.intake.restrictions.map((c) => c.k);
  assert.ok(ks.includes('vegetarian') && ks.includes('peanuts') && ks.includes('food:mushroom'), ks.join());
  assert.ok(s.intake.restrictions.some((c) => c.t === 'capers'), 'a typed never-eat word is kept');
  assert.deepEqual(s.intake.diet, ['vegetarian']);
  assert.deepEqual(s.intake.allergies, ['peanut']);
  assert.deepEqual(s.intake.cuisines, ['thai']);
  assert.equal(s.rounds.length, 1, 'rounds for menus that no longer exist are dropped');
  assert.equal(S.getModel().n, 1);
  assert.equal(S.phase(), 'round');
  assert.notEqual(S.startRound().menu, 'thai');
  // garbage or a future version starts fresh instead of crashing
  for (const bad of ['{not json', JSON.stringify({ v: 99 }), JSON.stringify({ v: 1, intake: 7, rounds: 'x' })]) {
    mem.set(KEY, bad);
    const T = await freshStore();
    assert.ok(['intake', 'round'].includes(T.phase()));
  }
});

test('what is synced and shared keeps the shapes the backend accepts', async () => {
  mem.clear();
  const S = await freshStore();
  S.saveIntake(answers());
  for (let i = 0; i < 3; i++) { const p = S.startRound(); for (const id of noodlesFirst(menuById(p.menu))) S.togglePick(id); S.finishRound(); }
  const doc = S.cloudProfile();
  assert.deepEqual(Object.keys(doc).sort(), ['history', 'intake', 'stats', 'weights']);
  assert.ok(Object.keys(doc.intake).length <= 20, 'firestore rule: intake map has at most 20 keys');
  assert.ok(Object.keys(doc.weights).length <= 400 && Object.keys(doc.stats).length <= 20 && doc.history.length <= 600000);
  assert.ok(!JSON.stringify(doc.intake).includes('undefined'));
  const shared = S.sharedSession();
  assert.equal(shared.v, 1);
  assert.deepEqual(Object.keys(shared.intake).sort(), ['adventure', 'allergies', 'cuisines', 'diet', 'never', 'spice']);
  assert.deepEqual(shared.intake.allergies, ['shellfish']);
  assert.ok(!JSON.stringify(shared).includes('broccoli'), 'typed foods are not shared');
  for (const r of shared.rounds) assert.ok(r.picked.length >= 1 && r.picked.length <= 3 && r.predicted.length <= 3 && /^[a-z0-9_-]{1,40}$/.test(r.menu));
  // a cloud copy with an older (v1) intake merges and is migrated
  const merged = S.mergeCloud({ intake: { diet: ['vegan'], allergies: [], never: [], spice: 0, adventure: 1, cuisines: [], at: Date.now() + 1000 }, history: JSON.stringify({ v: 1, rounds: [], feedback: [], meals: [] }) });
  assert.ok(merged);
  assert.equal(S.get().intake.v, 2);
  assert.deepEqual(S.get().intake.diet, ['vegan']);
});

test('v2 data → v3: menus read from photos (and their feedback) get guessed ingredient roles; nothing else changes', async () => {
  mem.clear();
  const dish = { id: 'd0', name: 'Grilled chicken', cuisine: 'thai', course: 'main', protein: 'chicken', diet: 'meat', method: 'grilled', heat: 1, richness: 1, sweetness: 1, sourness: 1, umami: 1, texture: [], ingredients: ['chicken', 'cilantro', 'rice'], carb: 'rice', familiarity: 'common', temperature: 'hot', allergens: [], whatItIs: 'Grilled chicken topped with cilantro, served with rice.' };
  const v2 = {
    v: 2, intake: { v: 2, likes: [], dislikes: [{ t: 'cilantro', k: 'cilantro', s: 'ok' }], restrictions: [], cuisineChips: [], spice: 1, adventure: 1, at: 1 },
    rounds: [{ id: 'r1', menu: 'thai', predicted: ['green-curry', 'pad-thai', 'massaman'], picked: ['panang-tofu'], never: [], at: 1, hit: false }],
    pending: null, skipped: [], target: 10, finished: false, consent: false, sessionId: 'abcdefghijklmnopqrstuvwx', syncOffFor: null, updated: 1,
    meals: [{ id: 'm1', at: 1, title: 'Thai menu', cuisine: 'Thai', readable: 'clear', problem: '', dishes: [dish], claude: [], ordered: ['d0'], ratings: {} }],
    feedback: [{ id: 'm1', at: 1, options: [{ ...dish, whatItIs: undefined }, { ...dish, id: 'd1', name: 'Plain rice', protein: 'none', ingredients: ['rice'], whatItIs: undefined }], liked: ['d0'], disliked: [] }],
  };
  mem.set(KEY, JSON.stringify(v2));
  const S = await freshStore();
  const s = S.get();
  assert.equal(s.v, 3);
  assert.deepEqual(s.meals[0].dishes[0].roles, { chicken: 'core', cilantro: 'garnish', rice: 'side' });
  assert.equal(s.meals[0].dishes[0].rolesGuessed, true);
  assert.deepEqual(s.feedback[0].options[0].roles, { chicken: 'core', cilantro: 'garnish', rice: 'side' }, 'feedback takes the roles from its meal');
  assert.equal(s.rounds.length, 1);
  assert.deepEqual(s.feedback[0].options[1].roles, { rice: 'core' }, 'a feedback dish without a meal copy gets a guess from its own words');
  assert.equal(S.getModel().n, 2, 'the round and the meal both teach it');
  // stored compact dishes keep their roles, and the saved copy is v3
  assert.deepEqual(S.compactDish(s.meals[0].dishes[0]).roles, { chicken: 'core', cilantro: 'garnish', rice: 'side' });
  S.update(() => {});
  assert.equal(JSON.parse(mem.get(KEY)).v, 3);
  assert.equal(JSON.parse(S.cloudProfile().history).v, 3);
});
