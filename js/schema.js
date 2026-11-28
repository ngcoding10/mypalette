// The dish feature schema: every dish (from the training menus or read from a photo by the
// backend) is described with these tags, and the learner works only from them.
// Keep the lists identical to functions/src/palette.js in ngcoding10/backend-combination.
// No DOM here: this file also runs in Node (tests, tools/evaluate.mjs).

export const CUISINES = ['thai', 'vietnamese', 'japanese', 'korean', 'chinese', 'indian', 'mexican', 'italian', 'middle_eastern', 'american', 'greek', 'ethiopian', 'french', 'spanish', 'other'];
export const COURSES = ['starter', 'soup', 'salad', 'main', 'side', 'dessert', 'drink'];
export const PROTEINS = ['chicken', 'beef', 'pork', 'lamb', 'duck', 'fish', 'shellfish', 'egg', 'tofu', 'legumes', 'cheese', 'mixed', 'none'];
export const DIETS = ['vegan', 'vegetarian', 'pescatarian', 'meat'];
export const METHODS = ['fried', 'stir_fried', 'grilled', 'roasted', 'baked', 'braised', 'simmered', 'steamed', 'raw', 'fresh'];
export const TEXTURES = ['crispy', 'crunchy', 'creamy', 'chewy', 'tender', 'soft', 'brothy', 'saucy', 'juicy', 'sticky'];
export const CARBS = ['rice', 'noodle', 'bread', 'potato', 'none'];
export const ALLERGENS = ['peanut', 'tree_nut', 'dairy', 'egg', 'gluten', 'soy', 'fish', 'shellfish', 'sesame'];
export const DIET_RULES = ['vegetarian', 'vegan', 'pescatarian', 'no_pork', 'no_beef', 'gluten_free', 'dairy_free'];
const MEATS = new Set(['chicken', 'beef', 'pork', 'lamb', 'duck', 'mixed']);

export const LABELS = {
  cuisine: { thai: 'Thai', vietnamese: 'Vietnamese', japanese: 'Japanese', korean: 'Korean', chinese: 'Chinese', indian: 'Indian', mexican: 'Mexican', italian: 'Italian', middle_eastern: 'Middle Eastern', american: 'American', greek: 'Greek', ethiopian: 'Ethiopian', french: 'French', spanish: 'Spanish', other: 'other' },
  allergen: { peanut: 'peanut', tree_nut: 'tree nuts', dairy: 'dairy', egg: 'egg', gluten: 'gluten (wheat)', soy: 'soy', fish: 'fish', shellfish: 'shellfish', sesame: 'sesame' },
  diet: { vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian', no_pork: 'No pork', no_beef: 'No beef', gluten_free: 'Gluten free', dairy_free: 'Dairy free' },
  heat: ['not spicy', 'mild', 'medium', 'hot'],
};

/** Things people often never eat. Each one is a rule over a dish's tags. */
export const NEVER_OPTIONS = [
  { key: 'mushroom', label: 'Mushrooms', ing: ['mushroom', 'shiitake', 'enoki', 'porcini', 'truffle'] },
  { key: 'cilantro', label: 'Cilantro', ing: ['cilantro'] },
  { key: 'olive', label: 'Olives', ing: ['olive'] },
  { key: 'eggplant', label: 'Eggplant', ing: ['eggplant'] },
  { key: 'coconut', label: 'Coconut', ing: ['coconut', 'coconut milk', 'coconut cream'] },
  { key: 'raw_fish', label: 'Raw fish', test: (d) => d.method === 'raw' && (d.protein === 'fish' || d.protein === 'shellfish') },
  { key: 'seafood', label: 'Seafood', test: (d) => d.protein === 'fish' || d.protein === 'shellfish' || d.allergens.includes('shellfish') },
  { key: 'pork', label: 'Pork', test: (d) => d.protein === 'pork', ing: ['pork', 'bacon', 'ham', 'chorizo', 'pancetta', 'prosciutto', 'sausage'] },
  { key: 'lamb', label: 'Lamb', test: (d) => d.protein === 'lamb', ing: ['lamb', 'goat'] },
  { key: 'offal', label: 'Offal', ing: ['tripe', 'liver', 'tongue', 'kidney', 'intestine', 'blood', 'tendon', 'heart'] },
  { key: 'blue_cheese', label: 'Blue cheese', ing: ['blue cheese', 'gorgonzola', 'roquefort'] },
  { key: 'anchovy', label: 'Anchovies', ing: ['anchovy'] },
];

// Ingredient names are folded to one spelling so "coriander", "chillies" and "prawns" match.
const SYNONYMS = {
  coriander: 'cilantro', 'coriander leaf': 'cilantro', 'fresh coriander': 'cilantro',
  chilli: 'chili', chilly: 'chili', chillie: 'chili', chile: 'chili', 'chili pepper': 'chili', 'red chili': 'chili', 'green chili': 'chili', 'bird eye chili': 'chili', "bird's eye chili": 'chili',
  prawn: 'shrimp', 'king prawn': 'shrimp', aubergine: 'eggplant', courgette: 'zucchini', garbanzo: 'chickpea', 'garbanzo bean': 'chickpea',
  'spring onion': 'scallion', 'green onion': 'scallion', capsicum: 'bell pepper', 'sweet pepper': 'bell pepper',
  'peanut butter': 'peanut', groundnut: 'peanut', 'thai basil': 'basil', 'holy basil': 'basil', 'sweet basil': 'basil',
  'fish sauce': 'fish sauce', nam: 'fish sauce', 'soy sauce': 'soy sauce', shoyu: 'soy sauce', tamari: 'soy sauce',
  'coconut cream': 'coconut milk', 'lime juice': 'lime', 'lemon juice': 'lemon', yoghurt: 'yogurt', 'greek yogurt': 'yogurt',
  'rice noodles': 'rice noodle', 'egg noodles': 'egg noodle', noodles: 'noodle', 'minced pork': 'pork', 'ground pork': 'pork',
  'ground beef': 'beef', 'minced beef': 'beef', 'chicken breast': 'chicken', 'chicken thigh': 'chicken', mozzarella: 'mozzarella',
  parmigiano: 'parmesan', 'parmigiano reggiano': 'parmesan', 'pecorino romano': 'pecorino', scallops: 'scallop',
};

/** "Chillies" → "chili", "Prawns" → "shrimp". */
export function normIngredient(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (SYNONYMS[t]) return SYNONYMS[t];
  if (t.length > 3 && /ies$/.test(t)) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && /(ch|sh|x|ss|o)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && /[^s]s$/.test(t)) t = t.slice(0, -1);
  return SYNONYMS[t] ?? t;
}

const lvl = (v) => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

/**
 * A dish in the learner's shape, from either a training menu or the backend's answer.
 * Fills gaps and folds spellings so both sources look the same.
 */
export function normalizeDish(raw, fallbackCuisine = 'other') {
  const t = raw.tags ?? raw;
  const ingredients = [...new Set((t.ingredients ?? []).map(normIngredient).filter(Boolean))].slice(0, 10);
  const allergens = [...new Set((t.allergens ?? []).filter((a) => ALLERGENS.includes(a)))];
  const protein = oneOf(t.protein, PROTEINS, 'none');
  let diet = oneOf(t.diet, DIETS, null);
  if (!diet) {
    // derive: meat protein → meat; fish/shellfish anywhere → pescatarian; egg/dairy → vegetarian; else vegan
    if (MEATS.has(protein)) diet = 'meat';
    else if (protein === 'fish' || protein === 'shellfish' || allergens.includes('fish') || allergens.includes('shellfish')) diet = 'pescatarian';
    else if (protein === 'egg' || protein === 'cheese' || allergens.includes('egg') || allergens.includes('dairy') || ingredients.includes('honey')) diet = 'vegetarian';
    else diet = 'vegan';
  }
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    cuisine: oneOf(t.cuisine, CUISINES, fallbackCuisine),
    course: oneOf(t.course, COURSES, 'main'),
    protein,
    diet,
    method: oneOf(t.method, METHODS, 'simmered'),
    heat: lvl(t.heat),
    richness: lvl(t.richness),
    sweetness: lvl(t.sweetness),
    sourness: lvl(t.sourness),
    umami: lvl(t.umami),
    texture: [...new Set((t.texture ?? []).filter((x) => TEXTURES.includes(x)))].slice(0, 3),
    ingredients,
    carb: oneOf(t.carb, CARBS, 'none'),
    familiarity: t.familiarity === 'adventurous' ? 'adventurous' : 'common',
    temperature: t.temperature === 'cold' ? 'cold' : 'hot',
    allergens,
    ...rolesField(raw.roles ?? t.roles, ingredients, raw.rolesGuessed ?? t.rolesGuessed),
  };
}

const ROLE_NAMES = ['core', 'component', 'garnish', 'side'];
/** Ingredient roles (see js/roles.js), keyed by the normalised ingredient name. Absent when unknown. */
function rolesField(roles, ingredients, guessed) {
  if (!roles || typeof roles !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(roles)) { const n = normIngredient(k); if (n && ingredients.includes(n) && ROLE_NAMES.includes(v)) out[n] = v; }
  if (!Object.keys(out).length) return {};
  return guessed ? { roles: out, rolesGuessed: true } : { roles: out };
}

// ───────── Hard rules: diet, allergies, never-eat ─────────
const hasIng = (d, words) => d.ingredients.some((i) => words.some((w) => i === w || i.includes(w)));

/**
 * Why a dish breaks this person's rules, or [] when it does not.
 * @returns {{ kind: 'allergy'|'diet'|'never', text: string }[]}
 */
export function conflicts(dish, intake) {
  const out = [];
  const d = dish;
  for (const a of intake.allergies ?? []) if (d.allergens.includes(a)) out.push({ kind: 'allergy', text: `may contain ${LABELS.allergen[a] ?? a}` });
  const rules = new Set(intake.diet ?? []);
  if (rules.has('vegan') && d.diet !== 'vegan') out.push({ kind: 'diet', text: 'not vegan' });
  else if (rules.has('vegetarian') && !['vegan', 'vegetarian'].includes(d.diet)) out.push({ kind: 'diet', text: 'not vegetarian' });
  else if (rules.has('pescatarian') && d.diet === 'meat') out.push({ kind: 'diet', text: 'has meat' });
  if (rules.has('no_pork') && (d.protein === 'pork' || hasIng(d, ['pork', 'bacon', 'ham', 'chorizo', 'pancetta', 'prosciutto', 'lard']))) out.push({ kind: 'diet', text: 'has pork' });
  if (rules.has('no_beef') && (d.protein === 'beef' || hasIng(d, ['beef', 'brisket', 'oxtail']))) out.push({ kind: 'diet', text: 'has beef' });
  if (rules.has('gluten_free') && d.allergens.includes('gluten')) out.push({ kind: 'diet', text: 'likely has gluten' });
  if (rules.has('dairy_free') && d.allergens.includes('dairy')) out.push({ kind: 'diet', text: 'likely has dairy' });
  for (const key of intake.never ?? []) {
    const opt = NEVER_OPTIONS.find((o) => o.key === key);
    if (opt) {
      if ((opt.test && opt.test(d)) || (opt.ing && hasIng(d, opt.ing))) out.push({ kind: 'never', text: `has ${opt.label.toLowerCase()}` });
    } else {
      // something they typed themselves: match it against the ingredients and the name
      const w = normIngredient(key);
      if (w && (hasIng(d, [w]) || String(d.name).toLowerCase().includes(w))) out.push({ kind: 'never', text: `has ${w}` });
    }
  }
  return out;
}

export const allowed = (dish, intake) => conflicts(dish, intake).length === 0;
