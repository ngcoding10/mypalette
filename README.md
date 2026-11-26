# MyPalette

Learns what food you like, then reads a restaurant menu photo and tells you the 3 dishes you are
most likely to enjoy, with every dish explained in plain words. Live at
https://ngcoding10.github.io/mypalette/ (GitHub Pages from `main`, repo root).

Static site: plain HTML, CSS and ES modules, no build step. The backend (Firestore rules, Cloud
Functions, tests) lives in [ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination)
on branch `mypalette` until it is merged.

## How it works

- **Training rounds** (`#/train`, or share `?train=1`): a short intake (diet rules, allergies, never-eat,
  heat, adventurousness), then 12 sample menus (`js/menus.js`). Before each menu is shown the app has
  already made its top-3 guess; the person picks 1 to 3 dishes (and optionally "never"), then sees the
  guess, whether it hit, what it learned, and the running top-3 hit rate.
- **The learner** (`js/learner.js`, no dependencies): each dish is a set of named features from the
  schema in `js/schema.js` (cuisine, protein, method, heat, richness, ingredients...). A person's taste is
  one weight per feature, fitted as a softmax choice model to their picks and pulled towards a prior built
  from the intake. Diet rules, allergies and never-eat items are hard filters.
- **Reading a menu** (signed in only): the photo is shrunk to ~1600 px JPEG in the browser and sent to the
  `paletteReadMenu` function, which asks Claude to read, explain and tag every dish. The browser then ranks
  the dishes with the learner, blends in Claude's own picks, and removes anything that breaks the rules.
- **Data**: signed out, everything stays in `localStorage` (`mypalette.*`). Signed in, it syncs to
  `palette_users/{uid}`. Training sessions are shared only if the person ticks the consent box, through
  `paletteShareSession`, anonymously.

## Run locally

```bash
python3 -m http.server 8000        # or any static server, then open http://localhost:8000/
npm test                           # learner tests on synthetic people (Node 22, no install)
```

With `js/config.js` still `null`, intake, training and learning work fully; reading a menu says sign-in is
not set up yet. To try the signed-in parts, start the emulators from the backend repo
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

## Known limits

- The learner is linear over hand-made tags: it cannot learn "I like X only with Y". It needs a few rounds
  before it beats simply suggesting popular dishes.
- Allergy flags are a best guess from a photo and general knowledge. The app says so next to results and
  never calls a dish safe.
- The real Claude call and real camera capture have not been tested (no API key in development); the
  emulator tests use a canned menu.
- Sample menus are written by hand; tags are judgement calls.
- Only desktop Chromium at phone and desktop sizes has been tested, not real phones or Safari.
