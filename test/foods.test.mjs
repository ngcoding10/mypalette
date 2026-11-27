// The chip input's spelling correction and the food dictionary: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chipLabel, cuisineKeys, matcher, parseList, suggest, skeleton } from '../js/foods.js';
import { MENUS } from '../js/menus.js';

const labels = (text, kind = 'food') => parseList(text, kind).map((c) => chipLabel(c, kind));
const dish = (menu, id) => MENUS.find((m) => m.id === menu).dishes.find((d) => d.id === id);

test('"broocli califlur tometo" becomes broccoli, cauliflower, tomato (no commas needed)', () => {
  const chips = parseList('broocli califlur tometo');
  assert.deepEqual(chips.map((c) => chipLabel(c)), ['broccoli', 'cauliflower', 'tomato']);
  assert.deepEqual(chips.map((c) => c.s), ['fixed', 'fixed', 'fixed'], 'marked as corrected');
  assert.deepEqual(chips.map((c) => c.t), ['broocli', 'califlur', 'tometo'], 'what was typed is kept, for the "from ..." note');
  assert.equal(skeleton('califlur'), skeleton('cauliflower'));
});

test('a comma-separated list becomes one chip per food, in order, without duplicates', () => {
  assert.deepEqual(labels('mushrooms, Olives ,  pad thai,, ice cream, olives'), ['mushroom', 'olive', 'pad thai', 'ice cream']);
  assert.deepEqual(labels('salmon; tuna\nshrimp'), ['salmon', 'tuna', 'shrimp']);
  assert.deepEqual(labels(''), []);
  assert.deepEqual(labels(' , ,'), []);
});

test('common misspellings are corrected', () => {
  const cases = {
    brocoli: 'broccoli', zuchini: 'zucchini', avacado: 'avocado', spinich: 'spinach', egplant: 'eggplant', pinapple: 'pineapple',
    chiken: 'chicken', salman: 'salmon', quesadila: 'quesadilla', burito: 'burrito', hummous: 'hummus', falafal: 'falafel',
    corriander: 'cilantro', kimchee: 'kimchi', lasagne: 'lasagna', 'sweet potatos': 'sweet potato', 'brussel sprouts': 'brussels sprouts',
    padthai: 'pad thai', 'mac n cheese': 'mac and cheese', aubergine: 'eggplant', prawns: 'shrimp', porc: 'pork',
  };
  for (const [typed, want] of Object.entries(cases)) assert.deepEqual(labels(typed), [want], typed);
});

test('multi-word foods stay together; filler words are dropped', () => {
  assert.deepEqual(labels('i really love ice cream'), ['ice cream']);
  assert.deepEqual(labels('spicy food'), ['spicy']);
  assert.deepEqual(labels('thai green curry'), ['thai food', 'green curry']);
  assert.deepEqual(labels('green curry with chicken'), ['green curry', 'chicken']);
});

test('unknown words are kept exactly as typed, marked not recognised, never dropped or guessed wildly', () => {
  for (const w of ['xyzzy', 'nduja', 'jackfruit', 'durian']) {
    const [c, ...rest] = parseList(w);
    assert.equal(rest.length, 0);
    assert.deepEqual([c.t, c.k, c.s], [w, null, 'unknown'], w);
  }
  const mixed = parseList('grandmas lasagna');
  assert.deepEqual(mixed.map((c) => [chipLabel(c), c.s]), [['grandmas', 'unknown'], ['lasagna', 'ok']]);
});

test('tapping a chip offers other readings', () => {
  const s = suggest('pesta').map((x) => x.label);
  assert.ok(s.includes('pasta') && s.includes('pesto'), s.join(','));
  assert.ok(suggest('califlur').some((x) => x.label === 'cauliflower'));
});

test('allergies and diets are recognised, with typos and filler words', () => {
  const keys = (t) => parseList(t, 'restriction').map((c) => c.k);
  assert.deepEqual(keys('nut allergy, lactose intolerant'), ['all_nuts', 'dairy']);
  assert.deepEqual(keys('celiak, shelfish, vegitarian'), ['gluten', 'shellfish', 'vegetarian']);
  assert.deepEqual(keys('peanuts, tree nuts, sesame, soy, egg, fish'), ['peanuts', 'tree_nuts', 'sesame', 'soy', 'egg', 'fish']);
  assert.deepEqual(keys('vegan, halal, kosher, pescatarian'), ['vegan', 'halal', 'kosher', 'pescatarian']);
  assert.deepEqual(keys('coeliac disease'), ['gluten']);
  assert.deepEqual(keys('no pork'), ['no_pork']);
  assert.deepEqual(keys('allergic to eggs'), ['egg']);
  assert.deepEqual(keys('gluten free, diary'), ['gluten', 'dairy']);
  assert.deepEqual(keys('mushrooms'), ['food:mushroom'], 'a food typed here means: avoid it');
  assert.deepEqual(keys('mustard, alcohol'), ['mustard', 'alcohol']);
  const [u] = parseList('quinine', 'restriction');
  assert.deepEqual([u.k, u.s], [null, 'unknown']);
});

test('cuisines are recognised and map to the schema', () => {
  const chips = parseList('thia, japanes, mexcan, lebanese, mediteranean', 'cuisine');
  assert.deepEqual(chips.map((c) => chipLabel(c, 'cuisine')), ['Thai', 'Japanese', 'Mexican', 'Middle Eastern', 'Mediterranean']);
  assert.deepEqual(cuisineKeys(chips).sort(), ['greek', 'italian', 'japanese', 'mexican', 'middle_eastern', 'spanish', 'thai']);
});

test('a liked food finds the dishes that have it', () => {
  const has = (text, menu, id) => matcher(parseList(text)[0])(dish(menu, id));
  assert.ok(has('broccoli', 'chinese', 'beef-broccoli'));
  assert.ok(has('tometo', 'italian', 'margherita'));
  assert.ok(has('noodles', 'vietnamese', 'pho-bo'), 'by tag: carb noodle');
  assert.ok(has('seafood', 'italian', 'scoglio'), 'by tag: shellfish');
  assert.ok(has('spicy', 'thai', 'kee-mao'), 'by heat');
  assert.ok(!has('broccoli', 'italian', 'margherita'));
  assert.ok(has('xyzzy pesto', 'italian', 'margherita') === false);
  assert.ok(matcher({ t: 'guanciale', k: null, s: 'unknown' })(dish('italian', 'carbonara')), 'unknown words match word for word');
});

test('js/fuzzy.js is the shared copy, unchanged', () => {
  const src = readFileSync(new URL('../js/fuzzy.js', import.meta.url));
  assert.equal(createHash('sha256').update(src).digest('hex').slice(0, 16), FUZZY_SHA);
});
const FUZZY_SHA = '1aa6d4655dd6affe'; // FUZZY_VERSION 1.0.0, as copied into every app
