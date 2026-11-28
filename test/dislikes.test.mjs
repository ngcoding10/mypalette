// Soft dislikes: a disliked food counts by the part it plays in a dish (core, cooked in, a garnish or
// side someone could leave out), with plain "why this / why not" text. Allergies and diets stay hard
// filters. Also the printed-menu markup (sections, marks, tap targets). `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENUS, menuById } from '../js/menus.js';
import { parseList } from '../js/foods.js';
import { allowed, cautions, conflicts } from '../js/rules.js';
import { ROLES, inferRoles, parseMarked } from '../js/roles.js';
import { PRIOR, dislikeHits, dislikeNote, dislikeNotes, picksAroundGarnish, score, skippedWithReasons, topK, train, whyNot, whyThis } from '../js/learner.js';
import { deriveIntake, dishesFromReading } from '../js/store.js';
import { entryHtml, kickerOf, legendHtml, marksOf, sectionsOf, sectionsOfReading, sheetHtml } from '../js/menu-view.js';

const dish = (menu, id) => menuById(menu).dishes.find((d) => d.id === id);
const person = ({ likes = '', dislikes = '', rules = '', cuisines = '', spice = 1, adventure = 1 } = {}) => deriveIntake({
  v: 2, likes: parseList(likes), dislikes: parseList(dislikes), restrictions: parseList(rules, 'restriction'), cuisineChips: parseList(cuisines, 'cuisine'), spice, adventure,
});

test('every sample-menu ingredient has a role; every dish has a core (a meze platter is all removable)', () => {
  let n = 0;
  for (const m of MENUS) for (const d of m.dishes) {
    assert.ok(d.roles, `${m.id}/${d.id} has roles`);
    assert.deepEqual(Object.keys(d.roles).sort(), [...d.ingredients].sort(), `${m.id}/${d.id}: one role per ingredient`);
    for (const r of Object.values(d.roles)) assert.ok(ROLES.includes(r));
    if (`${m.id}/${d.id}` !== 'turkish/meze') assert.ok(Object.values(d.roles).includes('core'), `${m.id}/${d.id} has a core ingredient`);
    n += d.ingredients.length;
  }
  assert.ok(n > 1800, `${n} ingredients annotated`);
  // spot checks of the hand annotation
  assert.equal(dish('italian', 'risotto').roles.mushroom, 'core');
  assert.equal(dish('pizzeria', 'garden-pizza').roles.mushroom, 'garnish');
  assert.equal(dish('thai', 'satay').roles.cucumber, 'side');
  assert.equal(dish('thai', 'tom-kha').roles.mushroom, 'component');
  assert.equal(dish('diner', 'cheeseburger').roles.onion, 'garnish');
  assert.deepEqual(parseMarked(['chicken!', 'peanut^', 'cucumber~', 'onion']), { ingredients: ['chicken', 'peanut', 'cucumber', 'onion'], roles: { chicken: 'core', peanut: 'garnish', cucumber: 'side', onion: 'component' } });
});

test('dislikes are scored by role: core is a large penalty, cooked in a medium one, a garnish or side a small one', () => {
  const intake = person({ dislikes: 'mushrooms' });
  const model = train(intake, []);
  const hit = (m, id) => dislikeHits(dish(m, id), model.prefs)[0];
  assert.equal(hit('italian', 'risotto').role, 'core');
  assert.equal(hit('thai', 'tom-kha').role, 'component');
  assert.equal(hit('pizzeria', 'garden-pizza').role, 'garnish');
  assert.ok(hit('pizzeria', 'garden-pizza').removable);
  assert.equal(dislikeHits(dish('italian', 'carbonara'), model.prefs).length, 0);
  // the same dish scored with and without the dislike: the penalty is exactly the role's weight
  const plain = train(person(), []);
  const penalty = (m, id) => score(plain, dish(m, id)) - score(model, dish(m, id));
  assert.ok(Math.abs(penalty('italian', 'risotto') + PRIOR.dislike) < 1e-9, 'core');
  assert.ok(Math.abs(penalty('thai', 'tom-kha') + PRIOR.dislikeMixed) < 1e-9, 'cooked in');
  assert.ok(Math.abs(penalty('pizzeria', 'garden-pizza') + PRIOR.dislikePick) < 1e-9, 'garnish');
  assert.ok(-PRIOR.dislike > -PRIOR.dislikeMixed && -PRIOR.dislikeMixed > -PRIOR.dislikePick && PRIOR.dislikePick < 0);
  // never a filter: dislikes do not rule a dish out
  assert.ok(allowed(dish('italian', 'risotto'), intake) && conflicts(dish('pizzeria', 'garden-pizza'), intake).length === 0);
});

test('a dish with a disliked garnish can still be a top pick when it is otherwise a strong match', () => {
  const intake = person({ likes: 'bacon, eggs, sausage, toast, beans', dislikes: 'mushrooms' });
  const model = train(intake, []);
  const brunch = menuById('brunch');
  const top = topK(model, brunch.dishes, intake, 3);
  const withGarnish = top.filter((id) => dislikeHits(dish('brunch', id), model.prefs).some((h) => h.removable));
  assert.ok(withGarnish.length >= 1, `a dish with mushrooms as a garnish is still in its top 3: ${top}`);
  const note = dislikeNotes(model, dish('brunch', withGarnish[0]))[0].text;
  assert.match(note, /^Has mushrooms, which you don't like\. They're a garnish here, so you could ask to leave them out\.$/);
  // but a dish built on it is not, even when it has foods they like
  const risotto = person({ likes: 'rice, parmesan, butter', dislikes: 'mushrooms' });
  assert.ok(!topK(train(risotto, []), menuById('italian').dishes, risotto, 3).includes('risotto'));
});

test('the "leave out" notes, in plain words', () => {
  const note = (label, role, extra = {}, opts = {}) => dislikeNote({ label, role, removable: role === 'garnish' || role === 'side', ...extra }, opts);
  assert.equal(note('mushroom', 'garnish'), "Has mushrooms, which you don't like. They're a garnish here, so you could ask to leave them out.");
  assert.equal(note('cilantro', 'garnish'), "Has cilantro, which you don't like. It's a garnish here, so you could ask to leave it out.");
  assert.equal(note('cucumber', 'side'), "Has cucumber, which you don't like. It comes on the side, so you could leave it or ask to swap.");
  assert.equal(note('onion', 'component'), "Has onions cooked in, which you don't like, so they can't easily be left out.");
  assert.equal(note('mushroom', 'core', {}, { skipped: true }), 'Skipped: mushrooms are the main ingredient.');
  assert.equal(note('mushroom', 'core'), "Mushrooms are the main ingredient, and you said you don't like them.");
  assert.equal(dislikeNote({ label: 'mushroom', role: 'core', removable: false, ing: 'mushroom' }, { skipped: true }), 'Skipped: mushrooms are the main ingredient.');
  assert.match(note('mushroom', 'garnish', { guess: true }), /look like a garnish here \(a guess from the menu wording\)/);
  assert.equal(dislikeNote({ label: 'fried food', role: 'core', removable: false, ing: null }, { skipped: true }), "Skipped: it's fried food, which you don't like.");
  // olive oil is not olives
  const olives = train(person({ dislikes: 'olives' }), []);
  assert.equal(dislikeHits(dish('italian', 'bruschetta'), olives.prefs).length, 0);
  assert.equal(dislikeHits(dish('greek', 'greek-salad'), olives.prefs)[0].role, 'garnish');
});

test('it learns per person: picking dishes with a disliked garnish again and again lowers that penalty only', () => {
  const intake = person({ dislikes: 'onion' });
  const withOnionGarnish = [['diner', 'cheeseburger'], ['greek', 'gyros'], ['mexican', 'al-pastor'], ['mexican', 'carne-asada'], ['pizzeria', 'bbq-pizza'], ['brunch', 'salmon-bagel'], ['diner', 'cheesesteak'], ['diner', 'bean-burger']];
  const rounds = withOnionGarnish.map(([m, id]) => ({ options: menuById(m).dishes, picked: [id] }));
  const before = train(intake, []), after = train(intake, rounds);
  assert.ok(after.w.dislikePick > before.w.dislikePick + 0.1, `garnish penalty shrinks: ${before.w.dislikePick} -> ${after.w.dislikePick}`);
  assert.ok(after.w.dislikePick <= 0, 'a disliked food never becomes a reason to pick');
  assert.ok(after.w.dislike < -1.5, `the core penalty stays large: ${after.w.dislike}`);
  assert.ok(picksAroundGarnish(after) && !picksAroundGarnish(before));
  assert.match(dislikeNotes(after, dish('diner', 'cheeseburger'))[0].text, /You often pick dishes like this anyway, so it counts for less\./);
});

test('"why this" and "why not" text', () => {
  const intake = person({ likes: 'noodles, peanuts, lime', dislikes: 'mushrooms, onion', rules: 'shellfish', cuisines: 'thai', spice: 2 });
  const model = train(intake, []);
  const thai = menuById('thai');
  const top = topK(model, thai.dishes, intake, 3);
  for (const id of top) {
    const why = whyThis(model, dish('thai', id), intake);
    assert.ok(why.length >= 1 && why.length <= 3, `${id}: ${why}`);
    for (const w of why) assert.ok(w.length < 80 && !/undefined|NaN/.test(w), w);
  }
  assert.ok(top.some((id) => whyThis(model, dish('thai', id), intake).some((w) => /which you like/.test(w))), 'names foods they like');
  assert.ok(top.some((id) => whyThis(model, dish('thai', id), intake).some((w) => /Thai food, a cuisine you love/.test(w))), 'names a cuisine they love');
  const cutoff = score(model, dish('thai', top[2]));
  assert.equal(whyNot(model, dish('thai', 'tom-yum'), intake, { cutoff }), 'Not for you: may contain shellfish.');
  assert.equal(whyNot(model, dish('thai', 'tom-kha'), intake, { cutoff }), "Skipped: has mushrooms cooked in, which you don't like, so they can't easily be left out.");
  assert.equal(whyNot(model, dish('italian', 'risotto'), intake, { cutoff }), 'Skipped: mushrooms are the main ingredient.');
  assert.match(whyNot(model, dish('thai', 'mango-sticky'), intake, { cutoff }), /\.$/);
  const skipped = skippedWithReasons(model, thai.dishes, intake, top);
  assert.ok(skipped.every((x) => !top.includes(x.dish.id) && x.text.length > 10));
  assert.deepEqual([...new Set(skipped.map((x) => x.kind))], ['close', 'dislike', 'blocked'], 'runners-up, then dislikes, then rule-outs');
  assert.ok(skipped.some((x) => x.dish.id === 'tom-kha' && x.kind === 'dislike'));
});

test('allergies and diets are unchanged hard filters, also next to dislikes; "may contain" warnings stay', () => {
  const intake = person({ likes: 'shrimp, peanuts, pork', dislikes: 'mushrooms', rules: 'shellfish, peanut allergy, halal' });
  const model = train(intake, []);
  for (const m of MENUS) for (const id of topK(model, m.dishes, intake, 3)) {
    const d = m.dishes.find((x) => x.id === id);
    assert.ok(allowed(d, intake), `${m.id}/${id} breaks a rule`);
    assert.ok(!d.allergens.includes('shellfish') && !d.allergens.includes('peanut') && d.protein !== 'pork');
  }
  assert.match(whyNot(model, dish('thai', 'pad-thai'), intake), /^Not for you: may contain (shellfish|peanut)/);
  assert.ok(cautions(dish('thai', 'panang-tofu'), person({ rules: 'shellfish' })).some((w) => /shellfish/i.test(w.text)), 'unclear dishes still warn');
  // a food typed under allergies and restrictions is still a hard "avoid", unlike a dislike
  assert.ok(!allowed(dish('pizzeria', 'garden-pizza'), person({ rules: 'mushrooms' })));
  assert.ok(allowed(dish('pizzeria', 'garden-pizza'), person({ dislikes: 'mushrooms' })));
});

test('menus read from a photo: roles are guessed from the wording and the notes say it is a guess', () => {
  const [d] = dishesFromReading({ dishes: [{ name: 'Grilled chicken plate', englishName: '', section: 'Mains', price: '$15', whatItIs: 'Grilled chicken topped with fried shallots and cilantro, served with rice and a cucumber salad.', mainIngredients: ['chicken'], heatNote: '', allergenNote: '', tags: { cuisine: 'thai', course: 'main', protein: 'chicken', method: 'grilled', ingredients: ['chicken', 'shallot', 'cilantro', 'rice', 'cucumber', 'garlic'], allergens: [] } }] });
  assert.equal(d.rolesGuessed, true);
  assert.deepEqual(d.roles, { chicken: 'core', shallot: 'garnish', cilantro: 'garnish', rice: 'side', cucumber: 'side', garlic: 'component' });
  const model = train(person({ dislikes: 'cilantro' }), []);
  assert.match(dislikeNotes(model, d)[0].text, /^Has cilantro, which you don't like\. It looks like a garnish here \(a guess from the menu wording\), so you could ask to leave it out\.$/);
  assert.equal(inferRoles({ name: 'Mushroom soup', ingredients: ['mushroom', 'cream'], whatItIs: 'Creamy soup.' }).mushroom, 'core');
});

test('printed menus: a name, tagline and sections in menu order, dot-leader prices, marks and a legend', () => {
  for (const m of MENUS) {
    assert.ok(m.name && m.tagline && m.style, m.id);
    const sections = sectionsOf(m);
    assert.equal(sections.reduce((a, s) => a + s.dishes.length, 0), m.dishes.length, `${m.id}: every dish once`);
    const order = ['Starters', 'Small plates', 'Meze & starters', 'Dim sum', 'To start', 'Raw bar & starters', 'Soups', 'Salads', 'Pizza', 'Pasta', 'Ramen & noodles', 'Mains', 'Sushi & mains', 'Rice & mains', 'Larger plates', 'From the grill', 'From the pit', 'From the sea', 'Plates', 'Sides', 'Sides to share', 'Desserts'];
    const idx = sections.map((s) => order.indexOf(s.title));
    assert.ok(idx.every((i) => i >= 0), `${m.id}: known titles ${sections.map((s) => s.title)}`);
    assert.ok(sections.findIndex((s) => /Dessert/.test(s.title)) === -1 || sections.at(-1).title === 'Desserts', `${m.id}: desserts last`);
    assert.ok(kickerOf(m).includes(m.tier));
  }
  // no real restaurant brands: the names are made up for this app (spot check against well-known chains)
  const names = MENUS.map((m) => m.name.toLowerCase()).join('|');
  for (const brand of ['olive garden', 'nando', 'wagamama', 'pf chang', 'panda express', 'chipotle', 'denny', 'ihop', 'benihana', 'outback', 'ruth', 'domino', 'pizza hut', 'din tai fung']) assert.ok(!names.includes(brand), brand);
  const italian = menuById('italian');
  const html = sheetHtml({ name: italian.name, tagline: italian.tagline, kicker: kickerOf(italian), style: italian.style }, sectionsOf(italian), (d) => entryHtml(d, { mode: 'pick', picked: d.id === 'carbonara' ? 0 : -1, ours: d.id === 'ragu' ? 0 : -1, blocked: d.id === 'scoglio' ? [{ text: 'may contain shellfish' }] : [] }));
  assert.match(html, /<article class="sheet" data-style="trattoria" aria-labelledby="menu-name">/);
  assert.match(html, /<h2 class="sheet-name" id="menu-name">Trattoria Nonna Pina<\/h2>/);
  const heads = [...html.matchAll(/<span class="msec-t">([^<]+)<\/span>/g)].map((x) => x[1]);
  assert.deepEqual(heads, ['Starters', 'Soups', 'Salads', 'Pizza', 'Pasta', 'Mains', 'Desserts']);
  assert.equal((html.match(/<h3 class="msec-h"/g) ?? []).length, heads.length);
  assert.equal((html.match(/data-action="pick"/g) ?? []).length, italian.dishes.length - 1, 'every dish but the ruled-out one is a button');
  assert.match(html, /aria-pressed="true"[^]*?Spaghetti carbonara[^]*?Your pick #1/);
  assert.match(html, /<span class="ours-tag">Our pick #1<\/span>\s*<span class="line"><span class="dname">Tagliatelle al ragu<\/span><span class="leader" aria-hidden="true"><\/span><span class="dprice">\$17<\/span>/);
  assert.match(html, /Linguine allo scoglio[^]*?Not for you: may contain shellfish/);
  assert.ok(html.includes(legendHtml()));
  assert.deepEqual(marksOf(dish('italian', 'arrabbiata')), { veg: 'VG', gf: false, heat: 2 });
  assert.equal(marksOf(dish('thai', 'som-tam')).gf, true);
  assert.equal(marksOf(dish('thai', 'pad-see-ew')).gf, false, 'soy sauce has wheat');
  assert.match(entryHtml(dish('indian', 'chana-masala'), {}), /title="vegan"/);
  // a menu read from a photo keeps its own printed sections
  const read = sectionsOfReading([{ id: 'a', section: 'Noodles', course: 'main' }, { id: 'b', section: 'Starters', course: 'starter' }, { id: 'c', section: 'Noodles', course: 'main' }]);
  assert.deepEqual(read.map((s) => [s.title, s.dishes.length]), [['Noodles', 2], ['Starters', 1]]);
  assert.deepEqual(sectionsOfReading([{ id: 'a', course: 'dessert' }, { id: 'b', course: 'starter' }]).map((s) => s.title), ['Starters', 'Desserts']);
});
