# MyPalette

Learns what food you like, then reads a restaurant menu photo and tells you the 3 dishes you are
most likely to enjoy, with every dish explained in plain words. Live at
https://ngcoding10.github.io/mypalette/ (GitHub Pages from `main`, repo root).

Static site: plain HTML, CSS and ES modules, no build step. The backend (Firestore rules, Cloud
Functions, tests) lives in [ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination)
on branch `mypalette` until it is merged.

## How it works

- **Intake** (`#/train`, or share `?train=1`), one question per screen:
  1. *Foods you like* and 2. *Foods you don't like*: one text box each. Type many foods split by commas and
     press Enter; each becomes a chip. Spelling is corrected against a food dictionary (`js/foods.js`, about
     400 foods with aliases) using the shared `js/fuzzy.js` scorer plus a looser sound-alike check:
     "broocli califlur tometo" becomes broccoli, cauliflower, tomato, even without commas. A corrected chip
     says what was typed; tap it to pick another reading or keep the word as typed. Unknown words are kept
     as typed, marked "not recognised", and matched word for word.
  3. *Allergies and dietary restrictions*: same input. Recognises peanut, tree nuts, "nut allergy" (both),
     shellfish, fish, seafood, gluten / celiac, dairy / lactose, egg, soy, sesame, vegetarian, vegan,
     pescatarian, halal, kosher, no pork, no beef, alcohol, mustard, celery, sulphites, lupin. A food typed
     here ("mushrooms") means avoid it.
  4. *Heat* and *how adventurous*, and 5. *Cuisines you love* (chips).
- **Sample menus**: 26 restaurants (`js/menus.js`) across 14+ cuisines and every price level ($ to $$$$),
  offered in a fixed order that covers the most cuisines, proteins, starches and cooking methods first
  (`tools/menu-order.mjs`); menus where little is left after someone's allergies and diet move to the end.
  For each menu the app first shows its top 3, then the person picks their own top 3, then it shows
  "it guessed 2 of your 3", what it learned and a running score. After 10 menus it offers to keep going up
  to 25. "Finish" stops at any time; whatever was answered is used.
- **The learner** (`js/learner.js`, no dependencies): each dish is a set of named features (cuisine, protein,
  method, heat, richness, ingredients...). A person's taste is one weight per feature, fitted as a softmax
  choice model to their picks, plus a pairwise term between each guessed-but-not-picked dish and each pick,
  pulled towards a prior built from the intake. Typed likes and dislikes become two personal features
  (how many liked or disliked foods a dish has) that start at +0.9 and -2.0 and are then fitted like the rest.
- **Allergies and diets are hard filters** (`js/rules.js`): a dish is ruled out when its allergen tags, the
  words in its name, description or ingredients ("pesto", "fish sauce", "soy sauce"), or, for a menu photo,
  the allergen note say it likely contains the allergen. Unclear dishes (a Thai curry for a shellfish
  allergy, a fried dish for celiac, "may contain" in the note) get a visible warning and rank below clear
  ones. Nothing is ever called safe.
- **Reading a menu** (signed in only): the photo is shrunk to ~1600 px JPEG in the browser and sent to the
  `paletteReadMenu` function, which asks Claude to read, explain and tag every dish, with the typed likes,
  dislikes and rules in the profile. The browser then ranks the dishes with the same learned model, blends in
  Claude's own picks, and removes anything that breaks the rules, with the same hard filter as training.
- **Data**: signed out, everything stays in `localStorage` under `mypalette.state.v1` (the data inside now
  carries `v: 2`; v1 data from earlier testers is migrated on load). Signed in, it syncs to
  `palette_users/{uid}` in the same document shape as before (the intake map now holds chips). Training
  sessions are shared only with consent, through `paletteShareSession`, anonymously; typed foods are not
  shared (the backend's session format has no field for them).

## Run locally

```bash
python3 -m http.server 8000        # or any static server, then open http://localhost:8000/
npm test                           # chip input, rules, training loop and learner tests (Node 22, no install)
npm run evaluate:intake            # accuracy on synthetic people who fill in the new intake
```

Intake, training and learning work fully signed out. To try the signed-in parts, start the emulators from the backend repo
(`FAKE_AI=1 npx firebase emulators:start --project demo-apps --only auth,firestore,functions`) and open
`http://localhost:8000/?emulator`.

End-to-end (global Playwright): `NODE_PATH=$(npm root -g) node tools/e2e.cjs [--emulator]`.
Icons and the share image: `NODE_PATH=$(npm root -g) node tools/make-assets.cjs`.

## Turning collected answers into tests

1. In the backend repo, run the **Export MyPalette sessions** workflow (Actions tab) and download
   `palette-sessions.json` (kept for 1 day), or run `scripts/export-palette-sessions.mjs` with the deploy key.
2. Here: `node tools/evaluate.mjs palette-sessions.json`. It replays each person's rounds in order,
   predicts each round only from the rounds before it, and prints top-1 and top-3 hit rates by round
   number and overall, next to "random" and "most popular dish" baselines.

`tools/sample-sessions.json` is synthetic (made by `tools/make-sample-sessions.mjs`) so `npm run evaluate`
works today. It is not real data.

## Accuracy (synthetic people only)

`node tools/evaluate-intake.mjs 30` builds 300 synthetic people (10 personas: a spice-loving vegetarian, a
plain eater, a nut-allergic adventurer, a celiac with a shellfish allergy, a halal grill fan...). Each one has
a hidden taste, types only some of their likes and dislikes, with typos, and picks their top 3 on each menu
with noise. These people are built to be consistent, so the numbers show the learner works as designed, not
how well it predicts real people. See the commit message or rerun the tool for the current numbers.

## Known limits

- The learner is linear over hand-made tags: it cannot learn "I like X only with Y".
- Spelling correction is a dictionary plus heuristics. It can pick a wrong but similar food ("lettis" reads
  as lentils, not lettuce); the chip shows what it chose and can be tapped to fix it. Foods missing from the
  dictionary are kept as typed and matched word for word.
- Allergy flags are a best guess from tags, words and the photo reading. The app says so next to results and
  never calls a dish safe. Unclear-dish warnings are heuristics (cuisine, course, cooking method, words).
- The real Claude call and real camera capture have not been tested (no API key in development); the
  emulator tests use a canned menu.
- Sample menus are written by hand; tags and prices are judgement calls.
- Only desktop Chromium at phone and desktop sizes has been tested, not real phones or Safari.
