// The food dictionary and the typo-tolerant chip input behind "Foods I like", "Foods I don't like",
// "Allergies and dietary restrictions" and "Cuisines you love".
//
// parseList("broocli califlur tometo", 'food') -> three chips: broccoli, cauliflower, tomato.
// It first tries the whole comma-separated piece, then splits it into the best run of known foods
// (so "ice cream" stays one chip but "broccoli tomato" becomes two). Each word is matched with the
// shared js/fuzzy.js scorer, then with a looser sound-alike check for misspellings fuzzy.js is too
// strict for ("califlur" -> cauliflower). Anything still unknown is kept exactly as typed.
//
// Each food also says how to find it on a dish (words in the name, description or ingredients, and
// tags such as protein:chicken or carb:noodle), so likes and dislikes feed the learner and the rules.
// No DOM here: this file also runs in Node (tests, tools).
import { createFuzzyIndex, editDistance, foldText, wordScore } from './fuzzy.js';

// ───────── dictionaries ─────────
// One entry per line: "name; alias, alias | spec". The name is what the chip shows.
// spec (all optional, space separated):
//   w=a,b    words to look for on a dish (default: the name and aliases)
//   p= c= q= m= t= k=   protein, carb, cuisine, method, texture, course tags that also count as a match
//   h=2      heat 2 or more;  s=sour|sweet|rich|umami  that flavour at 2 or more;  d=veg  vegetarian dishes
//   a=1      adventurous dishes;  x=1  only the tags count, not the words
const FOOD_TEXT = `
broccoli; brocoli, brocolli, broccolini, chinese broccoli
cauliflower; cauli, caulifower
tomato; tomatos, tomatoe, cherry tomato
potato; potatos, spud, jacket potato | c=potato w=potato
sweet potato; yam, kumara
carrot
onion; red onion
garlic; garlicky
ginger
mushroom; mushies, shiitake, portobello, enoki, porcini, chanterelle, oyster mushroom, wood ear mushroom
spinach
kale
lettuce; romaine, iceberg
cabbage; red cabbage, coleslaw, slaw
cucumber; cuke
zucchini; courgette
eggplant; aubergine, brinjal
bell pepper; capsicum, peppers, sweet pepper, red pepper, green pepper
chili; chilli, chilies, chillies, chile, hot pepper, chili pepper, dried chili | w=chili,chilli,chile,jalapeno,chipotle,gochujang,gochugaru,sriracha,chili oil,habanero,poblano
jalapeno; jalapenos, jalapeño
corn; sweetcorn, sweet corn, maize, corn on the cob, elote
peas; green peas, garden peas, pea | w=pea,snow pea
green beans; string beans, french beans | w=green bean
asparagus
celery
beetroot; beet, beets
radish; radishes
daikon; mooli
okra; bhindi, ladies fingers
pumpkin
squash; butternut squash, butternut
leek; leeks
scallion; spring onion, green onion, scallions
shallot; shallots
artichoke; artichokes
brussels sprouts; brussel sprouts, sprouts | w=brussels sprout
bok choy; pak choi, bok choi, pak choy
bean sprouts; beansprouts | w=bean sprout
avocado; avo, guacamole, guac
olive; olives, kalamata
pickles; pickle, gherkin, gherkins, pickled vegetables | w=pickle,pickled
kimchi; kimchee
seaweed; nori, wakame, kelp
bamboo shoots | w=bamboo shoot
fennel
parsnip
turnip
watercress; cress
arugula; rocket
collard greens; collards | w=collard green
plantain; plantains, maduros, tostones
cassava; yuca, manioc
taro
lotus root
edamame; soybeans
vegetables; veggies, veg, vegetable, greens, veggie | d=veg w=vegetable,greens
apple; apples
banana
mango; mangoes
pineapple
lemon; lemons
lime; limes
orange; oranges
strawberry; strawberries
raspberry; raspberries
blueberry; blueberries
berries; berry | w=berry,strawberry,raspberry,blueberry
cherry; cherries
grape; grapes
peach; peaches
pear; pears
fig; figs
dates; date
coconut; coconut milk, coconut cream
papaya; green papaya
watermelon
melon
pomegranate
lychee
raisins; raisin, sultana
fruit; fruits | w=fruit,mango,apple,berry,pineapple,peach
cilantro; coriander, coriander leaf, chinese parsley
basil; thai basil, holy basil
mint
parsley
dill
rosemary
thyme
oregano
lemongrass; lemon grass
cumin
cinnamon
turmeric
saffron
cardamom
black pepper; pepper, peppery
sichuan pepper; szechuan pepper
star anise; anise
paprika; smoked paprika
wasabi
horseradish
mustard; dijon
truffle; truffles
vanilla
sumac
zaatar; za atar
harissa
gochujang
miso
herbs; fresh herbs | w=herb,basil,mint,cilantro,parsley,dill
spices; spice, spiced | w=spice,cumin,garam masala,berbere,cardamom,cinnamon
chicken; chicken breast, chicken thigh, poultry | p=chicken w=chicken
chicken wings; wings, buffalo wings | w=wing
fried chicken | w=fried chicken
beef | p=beef w=beef,steak,brisket,short rib,veal
steak; steaks, ribeye, sirloin, filet, filet mignon | w=steak,ribeye,sirloin,filet
pork | p=pork w=pork
bacon; pancetta, guanciale
ham; prosciutto, jamon
sausage; sausages, bratwurst, hot dog | w=sausage,chorizo,salami,bratwurst,hot dog
chorizo
salami; pepperoni
lamb; mutton | p=lamb w=lamb,mutton
goat
duck | p=duck w=duck
turkey
veal
ribs; rib, spare ribs | w=rib
brisket
meatballs; meatball, kofta | w=meatball,kofta
meat; meats | p=chicken,beef,pork,lamb,duck,mixed x=1
red meat | p=beef,lamb x=1
fish | p=fish w=fish
salmon
tuna; ahi
cod
sea bass; seabass, branzino, bass
trout
mackerel
sardines; sardine
anchovies; anchovy
eel; unagi
catfish
white fish | w=cod,sea bass,halibut,white fish,haddock,tilapia
shrimp; prawn, prawns, shrimps, king prawns | w=shrimp,prawn
crab; crab meat, crabmeat
lobster
scallops; scallop
mussels; mussel
clams; clam
oysters; oyster
squid; calamari
octopus
seafood; sea food | p=fish,shellfish
shellfish; shell fish | p=shellfish
tofu; bean curd, beancurd
tempeh
seitan
eggs; egg, fried egg, boiled egg | w=egg
lentils; lentil, dal, dhal, daal | w=lentil,dal
chickpeas; chickpea, garbanzo, garbanzo beans, chana | w=chickpea,chana,hummus,falafel
beans; bean, black beans, kidney beans, pinto beans, refried beans | p=legumes w=bean
peanuts; peanut, peanut butter, satay | w=peanut,satay
nuts; nut | w=almond,cashew,walnut,pecan,pistachio,hazelnut,peanut,pine nut
almonds; almond
cashews; cashew
walnuts; walnut
pistachios; pistachio
sesame; sesame seeds, tahini
liver; foie gras
offal; tripe, tongue, kidney, intestine, blood sausage, black pudding | w=tripe,tongue,liver,kidney,intestine,blood,offal a=1
bone marrow; marrow
cheese; cheesy | p=cheese w=cheese,mozzarella,parmesan,cheddar,feta,halloumi,paneer,ricotta,pecorino,provolone,cotija,queso
mozzarella; mozz, burrata
parmesan; parmigiano, parm, pecorino
cheddar
feta
goat cheese; chevre, goats cheese
blue cheese; gorgonzola, roquefort, stilton
halloumi
paneer
cream; creamy, cream sauce | t=creamy w=cream
butter; buttery
yogurt; yoghurt, greek yogurt, raita, tzatziki | w=yogurt,raita,tzatziki
sour cream; crema
milk
ice cream; gelato
rice; fried rice, white rice, brown rice, sticky rice, basmati | c=rice w=rice
noodles; noodle | c=noodle
rice noodles; vermicelli | w=rice noodle
pasta; spaghetti, penne, linguine, tagliatelle, macaroni, fettuccine, rigatoni | w=pasta,spaghetti,penne,linguine,tagliatelle,macaroni,lasagna,ravioli,gnocchi,fettuccine,rigatoni
bread; breads, sourdough, baguette, flatbread | c=bread w=bread,baguette
naan; nan bread, naan bread
pita; pitta
tortilla; tortillas
fries; french fries, chips, frites, wedges | w=fries,frites,potato
mashed potato; mash, mashed potatoes | w=mashed potato
quinoa
couscous
bulgur; bulgar
polenta; grits
dumplings; dumpling, gyoza, mandu, jiaozi, potstickers, momo, dim sum, wontons, wonton | w=dumpling,gyoza,mandu,jiaozi,wonton,dim sum,har gow,siu mai,bao
bao; bao buns, steamed buns, gua bao
udon
ramen
soba
gnocchi
lasagna; lasagne
ravioli
risotto
pizza; pizzas | w=pizza
sandwich; sandwiches, sub, panini | w=sandwich,roll,panini,banh mi,club
burger; burgers, hamburger, cheeseburger | w=burger
wrap; wraps
croissant
pancakes; pancake, crepes, crepe | w=pancake,crepe
waffles; waffle
toast; french toast
bagel
oats; oatmeal, porridge, granola
pad thai; phad thai
curry; curries | w=curry,masala,korma,vindaloo,wat,massaman,panang,rendang
green curry
red curry
massaman
tikka masala; chicken tikka masala, tikka | w=tikka
butter chicken; murgh makhani
biryani; biriyani
samosa; samosas
dosa; masala dosa
sushi; maki, nigiri, sushi roll, california roll | w=sushi,nigiri,maki,california roll
sashimi
tempura
teriyaki
katsu; tonkatsu
pho; phở
banh mi; bahn mi
spring rolls; spring roll, egg rolls, summer rolls | w=spring roll,egg roll,imperial roll
fried rice | w=fried rice
kung pao; kung pao chicken
mapo tofu
peking duck; roast duck
bibimbap
bulgogi
korean bbq; korean barbecue, galbi, kalbi | w=galbi,bulgogi,samgyeopsal
tacos; taco | w=taco
burrito; burritos
quesadilla; quesadillas
enchiladas; enchilada
nachos
salsa
ceviche; cebiche
fajitas
tamales; tamale
mole
carbonara
bolognese; ragu
pesto
tiramisu
paella
tapas
gazpacho
patatas bravas; bravas
croquetas; croquettes
hummus; houmous
falafel
shawarma; shawarma wrap
kebab; kebabs, kabob, souvlaki, skewers | w=kebab,souvlaki,skewer,kofta,shish
tabbouleh; tabouli
baba ganoush; baba ghanoush
moussaka
gyros; gyro
spanakopita
greek salad
baklava
injera
mac and cheese; mac n cheese, macaroni cheese, mac & cheese | w=mac and cheese,macaroni
bbq; barbecue, barbeque, bar b q, smoked meat | m=grilled,roasted w=barbecue,bbq,smoked
hot dog; hotdog
meatloaf
omelette; omelet, frittata
eggs benedict; benedict
quiche
ratatouille
coq au vin
bourguignon; beef bourguignon
french onion soup
crepes
soup; soups, broth | k=soup t=brothy
salad; salads | k=salad
stew; stews, casserole | m=braised,simmered w=stew
chili con carne
poke; poke bowl
jerk chicken; jerk
empanadas; empanada
churros; churro
cheesecake
chocolate
cake; cakes
brownies; brownie
cookies; cookie, biscuits
pie; pies
mochi
custard; creme brulee, flan, pudding | w=custard,creme brulee,flan,pudding
dessert; desserts, sweets, puddings | k=dessert
thai food; thai | q=thai x=1
vietnamese food; vietnamese | q=vietnamese x=1
japanese food; japanese | q=japanese x=1
korean food; korean | q=korean x=1
chinese food; chinese, cantonese, sichuan | q=chinese x=1
indian food; indian | q=indian x=1
mexican food; mexican, tex mex | q=mexican x=1
italian food; italian | q=italian x=1
middle eastern food; middle eastern, lebanese, turkish, persian | q=middle_eastern x=1
american food; american, southern food | q=american x=1
greek food; greek | q=greek x=1
ethiopian food; ethiopian | q=ethiopian x=1
french food; french | q=french x=1
spanish food; spanish | q=spanish x=1
al pastor; tacos al pastor
spicy; spicy food, hot food, heat, spice, fiery | h=2
mild; mild food, not spicy | L=1 x=1
sweet; sweet things, sugary | s=sweet
sour; tangy, tart, sour food | s=sour
savory; savoury, umami | s=umami
rich food; rich, indulgent, heavy food | s=rich
fried food; fried, deep fried, fried stuff | m=fried
grilled food; grilled, chargrilled, char grilled, barbecued | m=grilled
roasted; roast, roast dinner | m=roasted
steamed; steamed food | m=steamed
raw; raw food, raw fish | m=raw
crispy; crunchy, crispy food | t=crispy,crunchy
smoky; smoked | w=smoked,smoky,chipotle
healthy; light, light food, fresh food, clean | m=fresh,steamed,grilled x=1
sauces; saucy, gravy | t=saucy
`;

const RESTRICTION_TEXT = `
peanuts; peanut, peanut allergy, groundnut, groundnuts, arachis, peanut butter | A=peanut
tree nuts; tree nut, almond, almonds, cashew, cashews, walnut, walnuts, pecan, pecans, pistachio, pistachios, hazelnut, hazelnuts, macadamia, brazil nut, pine nut, pine nuts, chestnut | A=tree_nut
all nuts; nut, nuts, nut allergy, any nuts | A=peanut,tree_nut
shellfish; shell fish, crustacean, crustaceans, shrimp, prawn, prawns, crab, lobster, crayfish, mollusc, molluscs, mollusk, clam, clams, mussel, mussels, oyster, oysters, scallop, scallops, squid, octopus | A=shellfish
fish; finfish, fish allergy | A=fish
seafood; sea food | A=fish,shellfish
gluten; wheat, gluten free, celiac, coeliac, celiac disease, coeliac disease, barley, rye, gluten intolerance | A=gluten
dairy; milk, lactose, lactose intolerant, lactose intolerance, dairy free, lactose free, cows milk | A=dairy
egg; eggs | A=egg
soy; soya, soybean, soybeans, soy beans | A=soy
sesame; sesame seed, sesame seeds, tahini | A=sesame
vegetarian; veggie, veg, vegetarian diet, lacto ovo | D=vegetarian
vegan; plant based, vegan diet | D=vegan
pescatarian; pescetarian, pescatarian diet, pesco | D=pescatarian
halal | D=halal
kosher | D=kosher
no pork; pork | D=no_pork
no beef; beef | D=no_beef
alcohol; no alcohol, wine, beer, liquor, alcohol free | W=wine,beer,sake,mirin,rum,brandy,sherry,bourbon,whisky,whiskey,vodka,marsala,cognac,liqueur,vermouth,cider,alcohol,shaoxing
mustard; mustard seed | W=mustard
celery; celeriac | W=celery,celeriac
sulphites; sulfites, sulphite, sulfite | W=sulphite,sulfite
lupin; lupine | W=lupin
`;

const CUISINE_TEXT = `
Thai; thailand | q=thai
Vietnamese; viet, vietnam | q=vietnamese
Japanese; japan, sushi | q=japanese
Korean; korea, kbbq | q=korean
Chinese; china, cantonese, sichuan, szechuan, szechwan, dim sum | q=chinese
Indian; india, north indian, south indian, punjabi, curry house | q=indian
Mexican; mexico, tex mex, texmex | q=mexican
Italian; italy, pizza, pasta | q=italian
Middle Eastern; middle east, lebanese, turkish, persian, israeli, levantine, arabic, syrian | q=middle_eastern
American; usa, us, diner, southern, bbq, soul food, burgers | q=american
Greek; greece | q=greek
Ethiopian; ethiopia, eritrean, east african | q=ethiopian
French; france, bistro | q=french
Spanish; spain, tapas | q=spanish
Mediterranean; med | q=greek,middle_eastern,italian,spanish
Asian; east asian, southeast asian, south east asian | q=thai,vietnamese,japanese,korean,chinese
Peruvian; peru | q=other
Caribbean; jamaican, cuban, puerto rican, trinidadian | q=other
`;

// Words people add around food names that are not foods themselves.
const FILLER = new Set('i im a an the some any all and n or with of in on my like likes love loves really very much lots lot especially esp eg etc food foods dish dishes stuff thing things kind kinds type types also too plus please basically mostly anything everything'.split(' '));
const RESTRICTION_FILLER = new Set('allergy allergies allergic intolerant intolerance intolerances sensitive sensitivity to free no not cant cannot dont do eat eating avoid avoiding diet strict am i im a an the of and or with any all please severe mild'.split(' '));

// ───────── parsing the dictionaries ─────────
function parseSpec(spec) {
  const out = {};
  for (const tok of spec.trim().split(/\s+/).filter(Boolean)) {
    const [k, v = ''] = tok.split('=');
    out[k] = v.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

/** Simple singular form, matching the way ingredient names are folded in js/schema.js. */
export function singular(w) {
  if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ch|sh|x|ss|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /[^su]s$/.test(w)) return w.slice(0, -1);
  return w;
}
export const foldWords = (s) => foldText(s).split(' ').filter(Boolean);
const keyOf = (s) => foldText(s).replace(/ /g, '_');

function build(text, kind) {
  const entries = [];
  for (const line of text.trim().split('\n')) {
    const [left, spec = ''] = line.split('|');
    const [name, aliasText = ''] = left.split(';');
    const aliases = aliasText.split(',').map((x) => x.trim()).filter(Boolean);
    const sp = parseSpec(spec);
    const label = name.trim();
    entries.push({ key: keyOf(label), label, aliases, spec: sp, kind, rank: entries.length });
  }
  // every spelling an entry can be found by, folded: "Brussel sprouts" -> "brussel sprouts"
  const exact = new Map();
  const add = (form, e) => { const f = foldText(form); if (!f) return; for (const v of [f, f.split(' ').map(singular).join(' '), f.replace(/ /g, '')]) if (!exact.has(v)) exact.set(v, e); };
  for (const e of entries) add(e.label, e);
  for (const e of entries) for (const a of e.aliases) add(a, e);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  // single words for the sound-alike pass, and the fuzzy.js index over every form
  const forms = [];
  for (const e of entries) for (const f of [e.label, ...e.aliases]) forms.push({ e, words: foldWords(f) });
  const fuzzy = createFuzzyIndex(forms, (x) => x.words.join(' '), { weight: (x) => -x.e.rank });
  return { kind, entries, exact, byKey, forms, fuzzy };
}

export const FOODS = build(FOOD_TEXT, 'food');
export const RESTRICTIONS = build(RESTRICTION_TEXT, 'restriction');
export const CUISINE_DICT = build(CUISINE_TEXT, 'cuisine');
const DICTS = { food: FOODS, restriction: RESTRICTIONS, cuisine: CUISINE_DICT };

// ───────── matching one typed word ─────────
/** A rough sound-alike key: "califlur" and "cauliflower" both become "klflr". */
export function skeleton(w) {
  let s = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[cq]/g, 'k').replace(/z/g, 's').replace(/x/g, 'ks');
  const first = s[0] ?? '';
  s = s.slice(1).replace(/[aeiouyhw]/g, '');
  s = (/[aeiouy]/.test(first) ? 'a' : first) + s;
  return s.replace(/(.)\1+/g, '$1');
}

/**
 * How well a typed word matches a dictionary word, 0..1. fuzzy.js first (exact, prefix, one or two
 * typos, scrambles); then a looser pass for longer words: same first sound and the same consonant
 * skeleton, or close enough in edit distance.
 */
export function matchWord(typed, word) {
  if (typed === word) return 1;
  const t = singular(typed), w = singular(word);
  if (t === w) return 0.98;
  let s = wordScore(typed, word);
  // a list is typed in full, so a short start of a longer word is only a weak hint ("porc" is not porcini)
  if (word.startsWith(typed) && typed !== word) s = typed.length < 4 ? 0 : word.length - typed.length > 2 ? Math.min(s, 0.5) : s;
  if (s > 0.6 || typed.length < 4) return s;
  const sameStart = skeleton(typed)[0] === skeleton(word)[0];
  if (!sameStart) return s;
  const ratio = typed.length / word.length;
  if (ratio < 0.6 || ratio > 1.6) return s;
  const kt = skeleton(typed), kw = skeleton(word);
  const max = typed.length >= 7 ? 3 : 2;
  const d = editDistance(typed, word, max);
  if (kt === kw && kt.length >= 3 && editDistance(typed, word, 5) <= Math.ceil(typed.length * 0.55)) return Math.max(s, 0.64 - 0.02 * Math.min(d, 4));
  if (d <= max && kt.length >= 3 && editDistance(kt, kw, 1) <= 1) return Math.max(s, 0.6 - 0.02 * d);
  return s;
}

/** The best entries for a run of typed words (same number of words, in order), best first. */
function candidates(words, dict, n = 5) {
  const joined = words.join(' ');
  const hit = dict.exact.get(joined) ?? dict.exact.get(words.map(singular).join(' ')) ?? dict.exact.get(words.join(''));
  if (hit) return [{ e: hit, score: 1 }];
  const best = new Map();
  const consider = (e, score) => { if (score > (best.get(e) ?? 0)) best.set(e, score); };
  for (const f of dict.forms) {
    if (f.words.length === words.length) {
      let total = 0;
      for (let i = 0; i < words.length && total >= 0; i++) { const s = matchWord(words[i], f.words[i]); total = s > 0.3 ? total + s : -1; }
      if (total > 0) consider(f.e, total / words.length);
    }
    // "padthai" typed as one word, or "pad tai" against "padthai"
    if (f.words.length > 1 && words.length === 1 && words[0].length >= 6) { const s = matchWord(words[0], f.words.join('')); if (s > 0.45) consider(f.e, s * 0.95); }
  }
  return [...best.entries()].map(([e, score]) => ({ e, score })).sort((a, b) => b.score - a.score || a.e.rank - b.e.rank).slice(0, n);
}

const MIN_SCORE = 0.55;

/**
 * Split one comma-separated piece into chips: the best run of known foods, with unknown words kept
 * together as typed. Dynamic programming over spans of up to 3 words; longer known spans win ties.
 */
function segment(raw, dict, filler) {
  const words = foldWords(raw);
  if (!words.length) return [];
  // the whole piece first, so "fish and chips" or "mac and cheese" are not split
  const whole = words.length <= 4 ? candidates(words, dict, 1)[0] : null;
  if (whole && whole.score >= 0.8) return [{ e: whole.e, score: whole.score, typed: raw.trim() }];
  const kept = words.filter((w) => !filler.has(w));
  if (!kept.length) return [];
  const n = kept.length;
  const best = Array(n + 1).fill(null);
  best[0] = { total: 0, parts: [] };
  for (let i = 1; i <= n; i++) {
    for (let L = 1; L <= Math.min(3, i); L++) {
      const prev = best[i - L];
      if (!prev) continue;
      const span = kept.slice(i - L, i);
      const c = candidates(span, dict, 1)[0];
      const known = c && c.score >= MIN_SCORE;
      if (!known && L > 1) continue;
      const total = prev.total + (known ? c.score * L + 0.15 * (L - 1) : 0);
      if (!best[i] || total > best[i].total + 1e-9) best[i] = { total, parts: [...prev.parts, known ? { e: c.e, score: c.score, typed: span.join(' ') } : { e: null, score: 0, typed: span[0] }] };
    }
  }
  // join neighbouring unknown words back into one chip: "grandmas lasagna" -> "grandmas", lasagna
  const out = [];
  for (const p of best[n].parts) {
    const last = out[out.length - 1];
    if (!p.e && last && !last.e) last.typed += ` ${p.typed}`;
    else out.push({ ...p });
  }
  // nothing known at all: keep the piece exactly as typed (minus filler) as a single chip
  if (out.every((p) => !p.e)) return [{ e: null, score: 0, typed: kept.join(' ') }];
  return out;
}

/**
 * Turn what someone typed into chips.
 * @param {string} text  e.g. "broocli califlur tometo, mushrooms"
 * @param {'food'|'restriction'|'cuisine'} kind
 * @returns {{ t: string, k: string|null, s: 'ok'|'fixed'|'unknown' }[]}
 *   t = the words as typed, k = dictionary key (null when not recognised), s = exact, corrected or unknown
 */
export function parseList(text, kind = 'food') {
  const dict = DICTS[kind];
  const pieces = String(text ?? '').split(/[,;\n/+]|\.(?:\s|$)|\s&\s/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  const filler = kind === 'restriction' ? new Set([...RESTRICTION_FILLER, ...FILLER]) : FILLER;
  for (const piece of pieces.slice(0, 40)) {
    let parts = segment(piece, dict, filler);
    // a restriction that is a food ("mushrooms", "garlic") means: avoid that food
    if (kind === 'restriction') {
      parts = parts.flatMap((p) => {
        if (p.e) return [p];
        const f = segment(p.typed, FOODS, filler);
        return f.map((x) => (x.e ? { ...x, food: true } : x));
      });
    }
    for (const p of parts) {
      const typed = p.typed.slice(0, 40);
      if (!foldText(typed)) continue;
      const k = p.e ? (p.food ? `food:${p.e.key}` : p.e.key) : null;
      const s = !p.e ? 'unknown' : p.score >= 0.97 ? 'ok' : 'fixed';
      const chip = { t: typed, k, s };
      if (!out.some((c) => (c.k && c.k === chip.k) || (!c.k && !chip.k && foldText(c.t) === foldText(chip.t)))) out.push(chip);
    }
  }
  return out;
}

/** Other things a chip could mean, for the "did you mean" list when someone taps it. */
export function suggest(typed, kind = 'food', n = 4) {
  const dict = DICTS[kind];
  const words = foldWords(typed).filter((w) => !(kind === 'restriction' ? RESTRICTION_FILLER : FILLER).has(w));
  if (!words.length) return [];
  const seen = new Set(), out = [];
  const push = (e, prefix = '') => { const k = prefix + e.key; if (!seen.has(k)) { seen.add(k); out.push({ k, label: e.label }); } };
  for (const c of candidates(words, dict, n + 2)) if (c.score >= 0.35) push(c.e);
  for (const w of words) for (const c of candidates([w], dict, 3)) if (c.score >= 0.4) push(c.e);
  if (kind === 'restriction') for (const c of candidates(words, FOODS, 3)) if (c.score >= 0.45) push(c.e, 'food:');
  for (const r of dict.fuzzy.search(words.join(' '), { limit: 6 })) if (r.score >= 0.6) push(r.item.e);
  return out.slice(0, n);
}

/** The entry behind a chip key, or null. */
export function entryOf(k, kind = 'food') {
  if (!k) return null;
  if (k.startsWith('food:')) return FOODS.byKey.get(k.slice(5)) ?? null;
  return DICTS[kind].byKey.get(k) ?? null;
}

/** What a chip shows: the dictionary name when recognised, otherwise exactly what was typed. */
export function chipLabel(chip, kind = 'food') {
  const e = entryOf(chip?.k, kind);
  if (!e) return chip?.t ?? '';
  return kind === 'restriction' && chip.k.startsWith('food:') ? `No ${e.label}` : e.label;
}

/** A chip for an entry someone chose from the suggestions. */
export const chipFor = (k, typed) => ({ t: String(typed ?? '').slice(0, 40), k, s: 'ok' });

// ───────── matching a food against a dish ─────────
const reCache = new Map();
function wordRe(w) {
  let re = reCache.get(w);
  if (!re) { re = new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?= |$)`); reCache.set(w, re); }
  return re;
}
const hayCache = new WeakMap();
/** Everything written about a dish, folded into one string of words. */
export function dishText(d) {
  let h = hayCache.get(d);
  if (h === undefined) {
    h = ` ${foldText([d.name, d.englishName, d.desc, d.whatItIs, ...(d.ingredients ?? []), ...(d.mainIngredients ?? [])].filter(Boolean).join(' '))} `;
    hayCache.set(d, h);
  }
  return h;
}
/** True when a folded word or phrase appears in the dish's text as whole words (plurals allowed). */
export const mentions = (d, w) => !!w && wordRe(w).test(dishText(d).trim());

/** The words and tag test behind a chip: what "this dish has this food" checks. */
function matchParts(chip, kind) {
  const e = entryOf(chip.k, kind);
  if (!e) {
    const w = foldWords(chip.t).filter((x) => !FILLER.has(x)).map(singular).join(' ');
    return { words: w.length >= 3 ? [w] : [], tag: null };
  }
  const sp = e.spec;
  const words = sp.x ? [] : (sp.w ?? [e.label, ...e.aliases]).map((x) => foldWords(x).map(singular).join(' ')).filter((x) => x.length >= 3);
  const set = (k) => (sp[k] ? new Set(sp[k]) : null);
  const p = set('p'), c = set('c'), q = set('q'), m = set('m'), t = set('t'), k = set('k');
  const h = sp.h ? Number(sp.h[0]) : null;
  const sc = sp.s?.[0];
  const field = { sour: 'sourness', sweet: 'sweetness', rich: 'richness', umami: 'umami' }[sc];
  const tag = (d) => (p && p.has(d.protein)) || (c && c.has(d.carb)) || (q && q.has(d.cuisine)) || (m && m.has(d.method))
    || (t && d.texture?.some((x) => t.has(x))) || (k && k.has(d.course)) || (h !== null && d.heat >= h)
    || (field && d[field] >= 2) || (sp.d && (d.diet === 'vegan' || d.diet === 'vegetarian') && d.course !== 'dessert')
    || (sp.a && d.familiarity === 'adventurous') || (sp.L && d.heat <= Number(sp.L[0]));
  return { words, tag };
}

/** A test for "this dish has this food", built from a dictionary entry or from words typed. */
export function matcher(chip, kind = 'food') {
  const { words, tag } = matchParts(chip, kind);
  if (!tag && !words.length) return () => false;
  return (d) => (tag ? !!tag(d) : false) || words.some((w) => mentions(d, w));
}
/** matcher() for likes: the same, but "olive oil" is not olives (see TASTE_EXCEPT). */
export function tasteMatcher(chip, kind = 'food') {
  const detail = matchDetail(chip, kind);
  return (d) => !!detail(d);
}

/** The part of a dish name before "with ...": "Pad kra pao with fried egg" -> "pad kra pao". */
const nameHead = (d) => foldText(String(d.name ?? '').split(/\bwith\b|\bw\//i)[0]);

// For taste (not for allergies or rules): phrases where a word names a different food. Someone who
// dislikes olives can still enjoy olive oil; egg noodles do not taste of egg.
const TASTE_EXCEPT = { olive: ['olive oil'], egg: ['egg noodle', 'egg wrapper'], peanut: ['peanut oil'], 'bell pepper': ['black pepper', 'white pepper'], pepper: ['black pepper', 'white pepper', 'sichuan pepper'] };
const exceptOf = (words) => [...new Set(words.flatMap((w) => TASTE_EXCEPT[w] ?? []))];
const without = (text, phrases) => { let t = text; for (const p of phrases) t = t.split(p).join(' '); return t; };

/**
 * Like matcher(), but for taste: says how the food shows up on a dish, or null when it does not:
 * { via: 'tag' } for what the dish is (fried, spicy, a salad, its protein), or
 * { via: 'word', ings: [ingredients that name it], inName: true when the dish is named after it }.
 */
export function matchDetail(chip, kind = 'food') {
  const { words, tag } = matchParts(chip, kind);
  const except = exceptOf(words);
  return (d) => {
    if (tag && tag(d)) return { via: 'tag', ings: [], inName: false };
    const hay = except.length ? without(dishText(d), except).trim() : dishText(d).trim();
    const hit = words.filter((w) => wordRe(w).test(hay));
    if (!hit.length) return null;
    const ings = (d.ingredients ?? []).filter((i) => { const f = without(` ${foldText(i)} `, except).trim(); return hit.some((w) => wordRe(w).test(f)); });
    const head = without(` ${nameHead(d)} `, except).trim();
    return { via: 'word', ings, inName: hit.some((w) => wordRe(w).test(head)) };
  };
}

/** Learner features a liked or disliked food points to (used for the starting weights). */
export function featureHints(chip, kind = 'food') {
  const e = entryOf(chip.k, kind);
  if (!e) return [];
  const sp = e.spec, out = [];
  for (const v of sp.p ?? []) out.push(`protein:${v}`);
  for (const v of sp.c ?? []) out.push(`carb:${v}`);
  for (const v of sp.q ?? []) out.push(`cuisine:${v}`);
  for (const v of sp.m ?? []) out.push(`method:${v}`);
  for (const v of sp.t ?? []) out.push(`tex:${v}`);
  if (sp.d) out.push('veg');
  if (sp.a) out.push('adventurous');
  if (sp.h) out.push('heat:2', 'heat:3');
  return out;
}

/** Cuisine keys (from js/schema.js CUISINES) for cuisine chips. */
export function cuisineKeys(chips) {
  const out = new Set();
  for (const c of chips ?? []) for (const q of entryOf(c.k, 'cuisine')?.spec.q ?? []) out.add(q);
  return [...out];
}
