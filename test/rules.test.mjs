// The allergy and diet hard filter, and warnings for unclear dishes: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENUS } from '../js/menus.js';
import { ALLERGENS, normalizeDish } from '../js/schema.js';
import { parseList } from '../js/foods.js';
import { allowed, cautions, conflicts, noteVerdict } from '../js/rules.js';
import { rank, topK, train } from '../js/learner.js';
import { deriveIntake } from '../js/store.js';

const intakeFor = (text, extra = {}) => deriveIntake({ v: 2, likes: [], dislikes: [], cuisineChips: [], spice: 1, adventure: 1, restrictions: parseList(text, 'restriction'), ...extra });
const dish = (menu, id) => MENUS.find((m) => m.id === menu).dishes.find((d) => d.id === id);
const all = MENUS.flatMap((m) => m.dishes);
const CHIP = { peanut: 'peanuts', tree_nut: 'tree nuts', dairy: 'dairy', egg: 'egg', gluten: 'gluten', soy: 'soy', fish: 'fish', shellfish: 'shellfish', sesame: 'sesame' };

test('allergies are hard filters: no dish tagged with the allergen is ever allowed or guessed', () => {
  for (const a of ALLERGENS) {
    const intake = intakeFor(CHIP[a]);
    assert.ok(intake.allergies.includes(a), a);
    for (const d of all) if (d.allergens.includes(a)) assert.ok(!allowed(d, intake), `${a}: ${d.id}`);
    // even a model that has learned to love those dishes cannot pick them
    const model = train(intake, []);
    for (const d of all) if (d.allergens.includes(a)) model.w[`ing:${d.ingredients[0]}`] = 50;
    for (const m of MENUS) for (const id of topK(model, m.dishes, intake, 3)) assert.ok(!m.dishes.find((d) => d.id === id).allergens.includes(a), `${a} guessed ${id}`);
  }
});

test('"nut allergy" blocks peanuts and tree nuts; typos in allergies still block', () => {
  const nuts = intakeFor('nut allergy');
  assert.ok(!allowed(dish('thai', 'pad-thai'), nuts) && !allowed(dish('greek', 'loukoumades'), nuts) && !allowed(dish('italian', 'risotto'), intakeFor('dairy')));
  const typo = intakeFor('peanut alergy, shelfish, celiak');
  for (const [m, id] of [['thai', 'satay'], ['italian', 'scoglio'], ['italian', 'margherita']]) assert.ok(!allowed(dish(m, id), typo), id);
});

test('ingredient words block even when the allergen tag is missing (for example a menu photo read badly)', () => {
  const untagged = (name, desc, ingredients) => normalizeDish({ id: 'x', name, tags: { course: 'main', protein: 'none', method: 'simmered', ingredients, allergens: [] } });
  const pesto = { ...untagged('Trofie al pesto', '', ['pasta', 'basil', 'pine nut']), desc: 'Pasta with basil pesto' };
  assert.match(conflicts(pesto, intakeFor('tree nuts'))[0].text, /tree nuts/);
  assert.ok(!allowed(untagged('Pad see ew', '', ['rice noodle', 'soy sauce']), intakeFor('gluten')), 'soy sauce has wheat');
  assert.ok(!allowed(untagged('Larb', '', ['chicken', 'fish sauce']), intakeFor('fish')));
  assert.ok(!allowed(untagged('Hummus', '', ['chickpea', 'tahini']), intakeFor('sesame')));
  assert.ok(allowed(untagged('Rice noodle salad', '', ['rice noodle', 'lime']), intakeFor('gluten')), 'rice noodles are not wheat');
  assert.ok(allowed(untagged('Eggplant stew', '', ['eggplant', 'tomato']), intakeFor('egg')), 'eggplant is not egg');
  assert.ok(allowed(untagged('Butternut soup', '', ['butternut squash']), intakeFor('dairy')), 'butternut is not butter');
});

test('menu reading: the allergen note blocks when sure, warns when unsure', () => {
  assert.equal(noteVerdict('Usually contains peanuts and fish sauce; recipes vary.', 'peanut'), 'block');
  assert.equal(noteVerdict('May contain sesame.', 'sesame'), 'warn');
  assert.equal(noteVerdict('Often made with butter, but some kitchens use oil.', 'dairy'), 'block');
  assert.equal(noteVerdict('Contains peanuts.', 'tree_nut'), null, 'peanut is not a tree nut');
  assert.equal(noteVerdict('No obvious nuts, but ask about the frying oil.', 'tree_nut'), 'warn', 'a "no" is never taken as safe');
  const read = normalizeDish({ id: 'd0', name: 'Green curry', tags: { cuisine: 'thai', course: 'main', protein: 'chicken', ingredients: ['chicken', 'coconut milk'], allergens: [] } });
  assert.ok(!allowed({ ...read, allergenNote: 'Usually contains shrimp paste.' }, intakeFor('shellfish')));
  const unsure = { ...read, allergenNote: 'May contain peanuts depending on the kitchen.' };
  assert.ok(allowed(unsure, intakeFor('peanut')));
  assert.match(cautions(unsure, intakeFor('peanut'))[0].text, /peanut/);
});

test('ambiguous dishes get a warning instead of silence', () => {
  const shell = intakeFor('shellfish');
  const panang = dish('thai', 'panang-tofu');
  assert.ok(allowed(panang, shell));
  assert.match(cautions(panang, shell)[0].text, /shellfish/i, 'Thai curry paste often has shrimp');
  assert.match(cautions(dish('indian', 'onion-bhaji'), intakeFor('gluten'))[0].text, /fried/);
  assert.match(cautions(dish('thai', 'mango-sticky'), intakeFor('tree nuts'))[0].text, /tree nut/i);
  assert.match(cautions(dish('thai', 'mango-sticky'), intakeFor('egg'))[0].text, /dessert/i);
  assert.equal(cautions(dish('thai', 'satay'), intakeFor('peanut')).length, 0, 'blocked dishes are not "unclear"');
  assert.equal(cautions(dish('greek', 'greek-salad'), intakeFor('peanut')).length, 0, 'clear dishes stay quiet');
});

test('diets: vegetarian, vegan, pescatarian, halal, kosher', () => {
  const veg = intakeFor('vegetarian');
  assert.ok(!allowed(dish('thai', 'som-tam'), veg), 'fish sauce');
  assert.ok(allowed(dish('indian', 'palak-paneer'), veg));
  const vegan = intakeFor('vegan');
  assert.ok(!allowed(dish('indian', 'palak-paneer'), vegan) && allowed(dish('indian', 'chana-masala'), vegan));
  const pesc = intakeFor('pescatarian');
  assert.ok(allowed(dish('greek', 'sea-bass'), pesc) && !allowed(dish('greek', 'souvlaki'), pesc));
  const halal = intakeFor('halal');
  assert.ok(!allowed(dish('italian', 'carbonara'), halal), 'pork');
  assert.ok(!allowed(dish('italian', 'risotto'), halal), 'white wine');
  assert.match(cautions(dish('greek', 'souvlaki'), halal)[0].text, /halal/);
  const kosher = intakeFor('kosher');
  assert.ok(!allowed(dish('italian', 'scoglio'), kosher), 'shellfish');
  assert.ok(!allowed(dish('diner', 'cheeseburger'), kosher), 'meat with dairy');
  assert.ok(allowed(dish('greek', 'sea-bass'), kosher));
  assert.deepEqual(halal.diet, ['no_pork']);
});

test('foods typed as restrictions are avoided; unknown words are matched as typed', () => {
  const noMush = intakeFor('mushrooms');
  assert.ok(!allowed(dish('italian', 'risotto'), noMush) && allowed(dish('italian', 'margherita'), noMush));
  const custom = intakeFor('guanciale');
  assert.ok(!allowed(dish('italian', 'carbonara'), custom));
  const mustard = intakeFor('mustard');
  assert.ok(!allowed(dish('korean', 'naengmyeon'), mustard));
});

test('older intakes (v1 checkboxes) still filter the same way', () => {
  const v1 = { diet: ['vegetarian'], allergies: ['peanut'], never: ['coconut', 'basil'], spice: 3, adventure: 2 };
  assert.deepEqual(conflicts(dish('thai', 'pad-thai'), v1).map((c) => c.kind).sort(), ['allergy', 'diet']);
  assert.ok(!allowed(dish('thai', 'mango-sticky'), v1));
  assert.ok(!allowed(dish('thai', 'kee-mao'), v1));
  const ranked = rank(train(v1, []), MENUS[0].dishes, v1);
  assert.ok(ranked.slice(-3).every((r) => r.blocked.length), 'blocked dishes sort last');
});
