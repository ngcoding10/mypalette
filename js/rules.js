// Hard rules and warnings: allergies, diets and foods someone must avoid.
//
// conflicts(dish, intake) -> reasons a dish is ruled out. A dish is ruled out when it likely contains
//   something the person is allergic to or cannot eat: from its allergen tags (hand-written for the
//   sample menus, Claude's best guess for a photo), from words in its name, description and
//   ingredients ("pesto" means pine nuts, "fish sauce" means fish), or from the allergen note.
// cautions(dish, intake) -> warnings for dishes that are not ruled out but are unclear: a fried dish
//   for someone avoiding gluten (batter, shared fryers), a Thai curry for someone allergic to
//   shellfish (shrimp paste), "may contain" in the allergen note. Shown next to the dish, never silent.
// Neither ever says a dish is safe. No DOM: also runs in Node.
import { ALLERGENS, DIET_RULES, LABELS, NEVER_OPTIONS, normIngredient } from './schema.js';
import { RESTRICTIONS, chipLabel, entryOf, foldWords, matcher, mentions, dishText } from './foods.js';

const MEAT_PROTEINS = new Set(['chicken', 'beef', 'pork', 'lamb', 'duck', 'mixed']);

// Words that mean a dish very likely has the allergen (block), or might (warn).
const A = {
  peanut: {
    strong: ['peanut', 'groundnut', 'satay', 'peanut sauce', 'peanut butter'],
    caution: ['mole', 'praline', 'nougat', 'chili crisp', 'nut', 'gado gado', 'kung pao'],
    cuisines: ['thai', 'vietnamese', 'chinese', 'indian'], cuisineNote: 'peanuts and peanut oil are common in this cuisine',
  },
  tree_nut: {
    strong: ['almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'brazil nut', 'chestnut', 'marzipan', 'frangipane', 'praline', 'nutella', 'pesto', 'baklava', 'gianduja', 'amaretti', 'nougat', 'romesco', 'muhammara', 'dukkah'],
    caution: ['nut', 'korma', 'mole', 'biryani', 'granola', 'coconut', 'kibbeh', 'butter chicken', 'tikka masala'],
    except: ['water chestnut', 'nutmeg', 'butternut'],
    cuisines: ['indian', 'middle_eastern'], cuisineNote: 'cashews, almonds or pistachios are common in sauces and sweets here',
  },
  dairy: {
    strong: ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'ghee', 'paneer', 'mozzarella', 'parmesan', 'pecorino', 'ricotta', 'feta', 'halloumi', 'mascarpone', 'burrata', 'cheddar', 'provolone', 'cotija', 'queso', 'buttermilk', 'custard', 'ice cream', 'gelato', 'bechamel', 'labneh', 'raita', 'tzatziki', 'creme fraiche', 'sour cream', 'crema', 'kefalograviera', 'brie', 'gorgonzola', 'gruyere', 'goat cheese', 'whey', 'spiced butter', 'alfredo', 'fresh cheese', 'milk solids'],
    caution: ['creamy', 'gratin', 'mash', 'mashed', 'pastry', 'cake', 'chocolate', 'pancake', 'korma'],
    except: ['peanut butter', 'coconut milk', 'coconut cream', 'almond milk', 'oat milk', 'soy milk', 'cocoa butter', 'butter bean', 'cream of tartar', 'fish cake', 'rice cake', 'blood cake'],
    cuisines: ['indian', 'french'], cuisineNote: 'butter, ghee or cream often go into sauces here',
  },
  egg: {
    strong: ['egg', 'mayonnaise', 'mayo', 'aioli', 'meringue', 'custard', 'hollandaise', 'carbonara', 'frittata', 'omelette', 'omelet', 'egg noodle', 'quiche', 'brioche', 'ladyfinger', 'egg tart', 'tamagoyaki', 'shakshuka'],
    caution: ['batter', 'battered', 'breaded', 'tempura', 'noodle', 'pastry', 'cake', 'dumpling', 'fried rice', 'pancake', 'waffle', 'glaze', 'pasta', 'meatball', 'croquette', 'katsu'],
    except: ['eggplant'],
  },
  gluten: {
    strong: ['wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'penne', 'linguine', 'tagliatelle', 'macaroni', 'lasagna', 'ravioli', 'gnocchi', 'couscous', 'bulgur', 'seitan', 'barley', 'rye', 'soy sauce', 'naan', 'pita', 'baguette', 'bun', 'croissant', 'pastry', 'filo', 'phyllo', 'breadcrumb', 'panko', 'batter', 'battered', 'breaded', 'tempura', 'udon', 'ramen', 'dumpling', 'wonton', 'pizza', 'pie', 'cake', 'cookie', 'biscuit', 'cracker', 'toast', 'sandwich', 'beer', 'malt', 'semolina', 'orzo', 'farro', 'spelt', 'hoisin', 'teriyaki', 'pancake', 'waffle', 'flour tortilla', 'croquette', 'churro', 'brioche', 'focaccia', 'crouton', 'wheat wrapper', 'katsu', 'injera', 'roux', 'gravy', 'bechamel', 'yakisoba', 'egg noodle', 'wheat noodle', 'ramen noodle', 'udon noodle'],
    caution: ['noodle', 'tortilla', 'soba', 'gravy', 'stock', 'dressing', 'crumble', 'marinade', 'glaze', 'buckwheat', 'oyster sauce', 'miso', 'fish cake', 'blood cake'],
    except: ['rice noodle', 'glass noodle', 'corn tortilla', 'rice paper', 'rice flour', 'chickpea flour', 'chickpea batter', 'rice batter', 'fish cake', 'blood cake', 'corn flour', 'cassava flour', 'rice cake', 'bun cha', 'bun bo', 'bun thit', 'bun bo hue', 'bun thit nuong', 'teff', 'tamari', 'gluten free', 'sweet potato noodle', 'cauliflower', 'bread fruit', 'breadfruit'],
  },
  soy: {
    strong: ['soy', 'soya', 'tofu', 'edamame', 'miso', 'tempeh', 'soy sauce', 'shoyu', 'tamari', 'soybean', 'natto', 'bean curd', 'hoisin', 'teriyaki', 'gochujang', 'doenjang', 'ssamjang', 'chili bean paste'],
    caution: ['marinade', 'glaze', 'vegan cheese', 'stir fried', 'oyster sauce', 'black bean sauce'],
    cuisines: ['chinese', 'japanese', 'korean', 'vietnamese', 'thai'], cuisineNote: 'soy sauce is common in this cuisine',
  },
  fish: {
    strong: ['fish', 'salmon', 'tuna', 'cod', 'anchovy', 'sardine', 'mackerel', 'trout', 'sea bass', 'halibut', 'haddock', 'tilapia', 'catfish', 'eel', 'bonito', 'fish sauce', 'nam pla', 'caviar', 'roe', 'swordfish', 'snapper', 'branzino', 'yellowtail', 'dashi', 'fish cake', 'imitation crab', 'surimi', 'bacalao', 'salt cod', 'hamachi', 'unagi', 'worcestershire', 'caesar'],
    caution: ['curry paste', 'stock', 'broth', 'kimchi', 'xo sauce'],
    cuisines: ['thai', 'vietnamese', 'korean'], cuisineNote: 'fish sauce is common in this cuisine',
  },
  shellfish: {
    strong: ['shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster', 'squid', 'calamari', 'octopus', 'crayfish', 'langoustine', 'shrimp paste', 'oyster sauce', 'dried shrimp', 'shellfish', 'seafood', 'xo sauce', 'bisque'],
    caution: ['curry paste', 'surimi', 'imitation crab', 'sambal', 'stock', 'kimchi', 'fish cake'],
    except: ['oyster mushroom'],
    cuisines: ['thai', 'vietnamese', 'korean', 'chinese'], cuisineNote: 'shrimp paste, dried shrimp or oyster sauce are common in this cuisine',
  },
  sesame: {
    strong: ['sesame', 'tahini', 'hummus', 'halva', 'gomasio', 'baba ganoush', 'baba ghanoush', 'sesame oil', 'zaatar', 'za atar', 'sesame paste', 'furikake'],
    caution: ['bun', 'dressing', 'bibimbap', 'dukkah', 'seed', 'bagel'],
    cuisines: ['korean', 'japanese', 'chinese', 'middle_eastern'], cuisineNote: 'sesame oil or tahini is common in this cuisine',
  },
};
const COURSE_CAUTION = { dessert: { peanut: 1, tree_nut: 1, dairy: 1, egg: 1, gluten: 1 } };

const MEAT_WORDS = ['chicken', 'beef', 'pork', 'lamb', 'duck', 'bacon', 'ham', 'sausage', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'pancetta', 'guanciale', 'veal', 'turkey', 'goat', 'mutton', 'brisket', 'steak', 'lard', 'gelatin', 'chicken stock', 'beef stock', 'bone broth', 'pate', 'foie gras', 'oxtail', 'tripe', 'liver'];
const SEA_WORDS = ['fish sauce', 'anchovy', 'bonito', 'dashi', 'shrimp paste', 'oyster sauce', 'dried shrimp', 'fish', 'shrimp', 'prawn', 'crab', 'squid', 'clam', 'mussel', 'worcestershire'];
const PORK_WORDS = ['pork', 'bacon', 'ham', 'chorizo', 'pancetta', 'prosciutto', 'lard', 'guanciale', 'salami', 'pepperoni', 'char siu', 'jamon', 'carnitas', 'al pastor', 'tonkotsu', 'samgyeopsal', 'pork belly'];
const BEEF_WORDS = ['beef', 'brisket', 'oxtail', 'veal', 'steak', 'short rib', 'bulgogi', 'galbi', 'pastrami', 'corned beef', 'carne asada'];
const ALCOHOL_WORDS = ['wine', 'beer', 'sake', 'mirin', 'rum', 'brandy', 'sherry', 'bourbon', 'whisky', 'whiskey', 'vodka', 'marsala', 'cognac', 'liqueur', 'vermouth', 'cider', 'shaoxing', 'beer battered', 'tiramisu', 'coq au vin', 'bourguignon', 'sangria'];

const strip = (text, phrases = []) => { let t = text; for (const p of phrases) for (const f of [p, `${p}s`, `${p}es`]) t = t.split(` ${f} `).join(' '); return t; };
const textHas = (hay, w) => hay.includes(` ${w} `) || hay.includes(` ${w}s `) || hay.includes(` ${w}es `);
const firstHit = (hay, words) => words.find((w) => textHas(hay, w));
// Dishes where a hidden ingredient is plausible: sauced, dressed, fried or stir-fried, or a curry.
const dressed = (d, hay) => ['fried', 'stir_fried'].includes(d.method) || d.course === 'salad' || d.texture?.includes('saucy') || !!firstHit(hay, ['sauce', 'dressing', 'dip', 'curry', 'satay', 'chutney']);
const saucy = (d, hay) => ['fried', 'stir_fried', 'simmered', 'braised'].includes(d.method) || d.texture?.includes('saucy') || !!firstHit(hay, ['sauce', 'dressing', 'dip', 'curry', 'paste', 'marinade', 'glaze']);

// ───────── what the person must avoid, compiled once per intake ─────────
const compiled = new WeakMap();
export function rulesOf(intake = {}) {
  let r = compiled.get(intake);
  if (r) return r;
  const allergens = new Set((intake.allergies ?? []).filter((a) => ALLERGENS.includes(a)));
  const diets = new Set((intake.diet ?? []).filter((d) => DIET_RULES.includes(d)));
  const avoid = []; // { label, test(dish) }
  let halal = false, kosher = false;
  if (Array.isArray(intake.restrictions)) {
    for (const chip of intake.restrictions) {
      const e = entryOf(chip.k, 'restriction');
      if (chip.k?.startsWith('food:')) { avoid.push({ label: chipLabel(chip, 'restriction').replace(/^No /, '').toLowerCase(), test: matcher({ k: chip.k.slice(5), t: chip.t }, 'food') }); continue; }
      if (!e) { const m = matcher({ k: null, t: chip.t }, 'food'); avoid.push({ label: chip.t.toLowerCase(), test: m }); continue; }
      for (const a of e.spec.A ?? []) allergens.add(a);
      for (const d of e.spec.D ?? []) { if (d === 'halal') halal = true; else if (d === 'kosher') kosher = true; else if (DIET_RULES.includes(d)) diets.add(d); }
      if (e.spec.W) { const words = e.spec.W.map((w) => foldWords(w).join(' ')); avoid.push({ label: e.label.toLowerCase(), test: (d) => words.some((w) => mentions(d, w)) || (e.key === 'alcohol' && !!firstHit(dishText(d), ALCOHOL_WORDS)) }); }
    }
  } else {
    // a v1 intake: never-eat options and typed words
    for (const key of intake.never ?? []) {
      const opt = NEVER_OPTIONS.find((o) => o.key === key);
      if (opt) avoid.push({ label: opt.label.toLowerCase(), test: (d) => (opt.test && opt.test(d)) || (opt.ing && d.ingredients.some((i) => opt.ing.some((w) => i === w || i.includes(w)))) });
      else { const w = normIngredient(key); if (w) avoid.push({ label: w, test: (d) => d.ingredients.some((i) => i === w || i.includes(w)) || String(d.name).toLowerCase().includes(w) }); }
    }
  }
  if (diets.has('gluten_free')) allergens.add('gluten');
  if (diets.has('dairy_free')) allergens.add('dairy');
  if (halal || kosher) diets.add('no_pork');
  if (halal) avoid.push({ label: 'alcohol', test: (d) => !!firstHit(dishText(d), ALCOHOL_WORDS) });
  r = { allergens, diets, avoid, halal, kosher };
  compiled.set(intake, r);
  return r;
}

// ───────── the allergen note from a menu reading ─────────
const ALLERGEN_TERMS = {
  peanut: ['peanut', 'groundnut'], tree_nut: ['tree nut', 'nut', 'almond', 'cashew', 'walnut', 'pistachio', 'pecan', 'hazelnut', 'pine nut'],
  dairy: ['dairy', 'milk', 'cream', 'butter', 'cheese', 'ghee', 'yogurt', 'lactose'], egg: ['egg'], gluten: ['gluten', 'wheat', 'flour'],
  soy: ['soy', 'soya'], fish: ['fish', 'anchovy', 'bonito'], shellfish: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'oyster', 'clam', 'mussel', 'squid'],
  sesame: ['sesame', 'tahini'],
};
const UNSURE = /\b(may|might|could|possibly|possible|sometimes|occasionally|can|depend\w*|var(y|ies)|trace|cross|ask|check|unclear|unsure|some (recipes|versions|places|kitchens))\b/;
const NEGATED = /\b(no|not|without|free|unlikely)\b/;
/** 'block', 'warn' or null: what an allergen note says about one allergen. */
export function noteVerdict(note, allergen) {
  const text = ` ${String(note ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  let verdict = null;
  for (const clause of text.split(/[.;]|,\s*but\b|\bbut\b/)) {
    const c = ` ${clause.replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ')} `;
    if (allergen === 'tree_nut' && !/ (tree nut|nut|nuts|almond|cashew|walnut|pistachio|pecan|hazelnut|pine nut)s? /.test(c.replace(/ peanuts? /g, ' '))) continue;
    if (allergen !== 'tree_nut' && !ALLERGEN_TERMS[allergen].some((w) => c.includes(` ${w}`))) continue;
    if (NEGATED.test(c) || UNSURE.test(c)) verdict = verdict ?? 'warn';
    else return 'block';
  }
  return verdict;
}

// ───────── per dish ─────────
const checked = new WeakMap(); // intake -> WeakMap(dish -> { blocks, warns })
function check(dish, intake) {
  let byDish = checked.get(intake);
  if (!byDish) { byDish = new WeakMap(); checked.set(intake, byDish); }
  let res = byDish.get(dish);
  if (res) return res;
  const r = rulesOf(intake);
  const d = dish;
  const hay = dishText(d);
  const blocks = [], warns = [];
  const block = (kind, text) => { if (!blocks.some((b) => b.text === text)) blocks.push({ kind, text }); };
  const warn = (kind, text) => { if (!warns.some((b) => b.text === text)) warns.push({ kind, text }); };
  const tags = d.allergens ?? [];

  for (const a of r.allergens) {
    const L = LABELS.allergen[a] ?? a;
    const words = A[a];
    const clean = strip(hay, words.except);
    const word = firstHit(clean, words.strong);
    const note = d.allergenNote ? noteVerdict(d.allergenNote, a) : null;
    if (tags.includes(a) || word || note === 'block') { block('allergy', `may contain ${L}${word && !tags.includes(a) ? ` (${word})` : ''}`); continue; }
    if (note === 'warn') { warn('allergy', `Ask about ${L}: the menu reading was not sure.`); continue; }
    const cw = firstHit(clean, words.caution);
    if (cw) warn('allergy', cw === 'coconut' ? `Ask about ${L}: coconut is sometimes counted as a tree nut.` : `Ask about ${L}: "${cw}" often means it.`);
    else if (COURSE_CAUTION[d.course]?.[a]) warn('allergy', `Ask about ${L}: desserts often contain it.`);
    else if (a === 'gluten' && d.method === 'fried') warn('allergy', `Ask about ${L}: fried food may be battered or share a fryer.`);
    else if (words.cuisines?.includes(d.cuisine) && (['peanut', 'tree_nut', 'sesame'].includes(a) ? dressed(d, hay) : saucy(d, hay))) warn('allergy', `Ask about ${L}: ${words.cuisineNote}.`);
  }

  const meatish = MEAT_PROTEINS.has(d.protein) || d.diet === 'meat';
  if (r.diets.has('vegan')) {
    if (d.diet !== 'vegan') block('diet', 'not vegan');
    else { const w = firstHit(strip(hay, A.dairy.except), ['honey', 'egg', ...A.dairy.strong, ...MEAT_WORDS, ...SEA_WORDS]); if (w) block('diet', `not vegan (${w})`); else if (firstHit(hay, ['broth', 'stock', 'bread', 'pastry', 'cake', 'noodle', 'curry paste', 'kimchi'])) warn('diet', 'Vegan: ask about broth, eggs or butter.'); }
  } else if (r.diets.has('vegetarian')) {
    if (!['vegan', 'vegetarian'].includes(d.diet)) block('diet', 'not vegetarian');
    else { const w = firstHit(hay, [...MEAT_WORDS, ...SEA_WORDS]); if (w) block('diet', `not vegetarian (${w})`); else if (firstHit(hay, ['broth', 'stock', 'soup', 'gravy', 'curry paste', 'kimchi', 'meatball', 'kofta'])) warn('diet', 'Vegetarian: broth or paste may be meat or fish based. Ask.'); }
  } else if (r.diets.has('pescatarian')) {
    if (d.diet === 'meat') block('diet', 'has meat');
    else { const w = firstHit(hay, MEAT_WORDS); if (w) block('diet', `has meat (${w})`); else if (firstHit(hay, ['broth', 'stock', 'gravy'])) warn('diet', 'Pescatarian: broth may be meat based. Ask.'); }
  }
  if (r.diets.has('no_pork')) { const w = d.protein === 'pork' ? 'pork' : firstHit(hay, PORK_WORDS); if (w) block('diet', 'has pork'); else if (d.protein === 'mixed' || firstHit(hay, ['sausage', 'gelatin', 'pate', 'meatball', 'dumpling'])) warn('diet', 'May contain pork. Ask.'); }
  if (r.diets.has('no_beef')) { const w = d.protein === 'beef' ? 'beef' : firstHit(hay, BEEF_WORDS); if (w) block('diet', 'has beef'); else if (d.protein === 'mixed' || firstHit(hay, ['meatball', 'burger', 'kofta', 'stock', 'broth'])) warn('diet', 'May contain beef or beef stock. Ask.'); }
  if (r.kosher) {
    if (d.protein === 'shellfish' || tags.includes('shellfish') || firstHit(strip(hay, A.shellfish.except), A.shellfish.strong)) block('diet', 'not kosher (shellfish)');
    else if (meatish && (tags.includes('dairy') || firstHit(strip(hay, A.dairy.except), A.dairy.strong))) block('diet', 'not kosher (meat with dairy)');
    else if (meatish) warn('diet', 'Kosher: ask if the meat is kosher.');
  }
  if (r.halal && meatish && !blocks.length) warn('diet', 'Halal: ask if the meat is halal.');
  for (const v of r.avoid) if (v.test(d)) block('never', `has ${v.label}`);

  res = { blocks, warns };
  byDish.set(dish, res);
  return res;
}

/**
 * Why a dish is ruled out for this person, or [] when it is not.
 * @returns {{ kind: 'allergy'|'diet'|'never', text: string }[]}
 */
export const conflicts = (dish, intake = {}) => check(dish, intake).blocks;
/** Warnings for a dish that is not ruled out but may not be safe. Empty for ruled-out dishes. */
export const cautions = (dish, intake = {}) => (check(dish, intake).blocks.length ? [] : check(dish, intake).warns);
export const allowed = (dish, intake = {}) => check(dish, intake).blocks.length === 0;
