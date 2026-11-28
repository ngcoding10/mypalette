// End-to-end check in a real browser (Chromium via a global Playwright install; nothing to npm install).
//
//   NODE_PATH=$(npm root -g) node tools/e2e.cjs              the signed-out app (Firebase blocked offline)
//   NODE_PATH=$(npm root -g) node tools/e2e.cjs --emulator   also the signed-in parts, against the local
//                                                            Firebase emulators started from the backend repo:
//     FAKE_AI=1 npx firebase emulators:start --project demo-apps --only auth,firestore,functions
//
// Serves this folder on a local port. Never touches a real Firebase project: ?emulator points the app
// at 127.0.0.1, and without it the config is null. Set SHOTS=dir to save a few phone screenshots.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8766);
const EMU = process.argv.includes('--emulator');
const SHOTS = process.env.SHOTS || '';
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = http.createServer((q, s) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(root)) { s.writeHead(403); return s.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { s.writeHead(404, { 'content-type': 'text/html' }); return fs.createReadStream(path.join(root, '404.html')).pipe(s); }
  s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(s);
});
const BASE = `http://localhost:${PORT}/`;

let passed = 0, failed = 0;
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

async function newPage(browser, viewport, { proxy = false } = {}) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500,
    ...(proxy && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, ignoreHTTPSErrors: true } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); } };

async function chips(page, field, text, { enter = true } = {}) {
  await page.fill(`#in-${field}`, text);
  if (enter) await page.press(`#in-${field}`, 'Enter');
  return page.locator(`#box-${field} .ce-list`).innerText();
}

async function intake(page, { allergy = 'peanut allergy', diet = null } = {}) {
  await page.waitForSelector('#in-likes');
  const liked = await chips(page, 'likes', 'broocli califlur tometo, xyzzy');
  check('likes: "broocli califlur tometo" becomes broccoli, cauliflower, tomato', /broccoli[\s\S]*cauliflower[\s\S]*tomato/.test(liked) && /from “broocli”/.test(liked), liked);
  check('likes: an unknown word stays as typed, marked not recognised', /xyzzy\s+not recognised/.test(liked), liked);
  await page.click('#box-likes .ce-main >> nth=0');
  check('tapping a chip opens "did you mean"', await page.locator('.fix').count() === 1);
  await page.click('[data-action="chip-close"]');
  await page.click('#wizard button[type="submit"]');
  await chips(page, 'dislikes', 'olives', { enter: false }); // typed but not entered: Next adds it
  await page.click('#wizard button[type="submit"]');
  const rules = await chips(page, 'restrictions', [allergy, diet].filter(Boolean).join(', ') || 'none');
  if (allergy) check('allergy recognised', /peanuts/i.test(rules), rules);
  await page.click('#wizard button[type="submit"]');
  await page.locator('input[name="spice"][value="2"]').check({ force: true });
  await page.click('#wizard button[type="submit"]');
  await chips(page, 'cuisineChips', 'thia');
  await page.click('#wizard button[type="submit"]');
}

async function playRound(page, k = 3) {
  await page.waitForSelector('.guesscard');
  const guess = await page.locator('.guesscard li').count();
  const taps = page.locator('.entry-tap');
  for (let i = 0; i < k; i++) await taps.nth(i * 2).click();
  await page.click('[data-action="lock"]');
  await page.waitForSelector('.verdict');
  return { guess, text: await page.locator('main').innerText() };
}

/** The sample menu reads like a printed one, picks are big tap targets, and every guess says why. */
async function printedMenuChecks(page) {
  const name = await page.locator('.sheet-name').innerText();
  check('menu has a restaurant name, tagline and kicker', name.length > 3 && await page.locator('.sheet-tag').count() === 1 && /\$/.test(await page.locator('.sheet-kicker').innerText()), name);
  const heads = await page.locator('.sheet h3.msec-h .msec-t').allInnerTexts();
  const rank = (t) => ['STARTERS', 'SMALL PLATES', 'MEZE', 'DIM SUM', 'TO START', 'RAW BAR', 'SOUPS', 'SALADS', 'PIZZA', 'PASTA', 'RAMEN', 'MAINS', 'SUSHI', 'RICE', 'LARGER', 'FROM', 'PLATES', 'SIDES', 'DESSERTS'].findIndex((w) => t.toUpperCase().startsWith(w));
  check('menu sections are headings, in menu order (starters ... mains ... desserts)', heads.length >= 3 && heads.every((h, i) => rank(h) >= 0 && (i === 0 || rank(h) >= rank(heads[i - 1]))), heads.join(' / '));
  check('a legend explains the marks', /vegetarian/.test(await page.locator('.sheet .legend').innerText()));
  check('every dish line has a price', await page.locator('.sheet .entry .dprice').count() === await page.locator('.sheet .entry').count());
  const sizes = await page.locator('.entry-tap').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
  check('phone tap targets: every dish is a button at least 48 px tall and most of the screen wide', sizes.length > 5 && sizes.every(([w, h]) => h >= 48 && w >= 300), JSON.stringify(sizes.slice(0, 3)));
  check('our top 3 are marked "Our pick #1-3" on the menu', (await page.locator('.ours-tag').allInnerTexts()).map((t) => t.replace(/[^#\d]/g, '')).sort().join() === '#1,#2,#3');
  const whys = await page.locator('.guesscard .why').allInnerTexts();
  check('each of its 3 says "Why this"', whys.length === 3 && whys.every((w) => /^Why this: \S/.test(w)), whys.join(' | '));
  const first = page.locator('.entry-tap').first();
  await first.click();
  check('tapping a dish picks it: pressed, numbered "Your pick #1"', await first.getAttribute('aria-pressed') === 'true' && /Your pick #1/i.test(await first.innerText()) && await page.locator('.entry.on').count() === 1);
  await first.click();
  check('tapping again un-picks it', await first.getAttribute('aria-pressed') === 'false' && await page.locator('.entry.on').count() === 0);
  await page.locator('details.skipped summary').click();
  const skipped = await page.locator('.skiplist li').allInnerTexts();
  check('"Show dishes we skipped and why" lists dishes with a reason', skipped.length >= 2 && skipped.every((t) => t.split('\n').length >= 2), skipped.slice(0, 2).join(' | '));
  await page.locator('details.skipped summary').click();
}

/** Open a given sample menu with given answers (through the app's own modules), on a fresh page. */
async function openMenu(browser, menuId, answers, viewport = { width: 390, height: 844 }) {
  const n = await newPage(browser, viewport);
  await n.page.goto(`${BASE}#/`);
  await n.page.waitForSelector('.hero');
  await n.page.evaluate(async ([id, a]) => {
    const S = await import('./js/store.js'); const F = await import('./js/foods.js'); const M = await import('./js/menus.js'); const L = await import('./js/learner.js');
    S.saveIntake({ likes: F.parseList(a.likes), dislikes: F.parseList(a.dislikes), restrictions: F.parseList(a.rules, 'restriction'), cuisineChips: F.parseList(a.cuisines ?? '', 'cuisine'), spice: a.spice ?? 1, adventure: 1 });
    const menu = M.menuById(id);
    S.update((s) => { s.pending = { id: 'e2e', menu: id, predicted: L.topK(S.getModel(), menu.dishes, S.get().intake, 3), picked: [], at: Date.now() }; }, { retrain: false });
  }, [menuId, answers]);
  await n.page.goto(`${BASE}#/train`);
  await n.page.waitForSelector('.sheet');
  return n;
}

async function dislikeChecks(browser) {
  console.log('Soft dislikes, phone 390x844');
  // brunch, someone who loves a cooked breakfast but not mushrooms
  const b = await openMenu(browser, 'brunch', { likes: 'bacon, eggs, sausage, toast, beans', dislikes: 'mushrooms', rules: 'peanut allergy' });
  const guess = await b.page.locator('.guesscard').innerText();
  check('a dish with a disliked garnish can still be in its top 3, with a "leave it out" note', /Has mushrooms, which you don't like\. They're a garnish here, so you could ask to leave them out\./.test(guess), guess.slice(0, 300));
  const notes = await b.page.locator('.sheet .enote.n-leave').allInnerTexts();
  check('the menu marks dishes where the disliked food could be left out', notes.length >= 2 && notes.every((t) => /leave them out/.test(t)), notes.join(' | '));
  if (SHOTS) {
    await b.page.evaluate(() => { const el = document.querySelector('.guesscard'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); });
    await shot(b.page, 'phone-why-this');
  }
  await b.ctx.close();
  // italian: mushrooms are the main ingredient of the risotto
  const it = await openMenu(browser, 'italian', { likes: 'pasta, tomato, basil', dislikes: 'mushrooms', rules: 'shellfish', spice: 2 });
  await it.page.locator('details.skipped summary').click();
  const skipped = await it.page.locator('.skiplist').innerText();
  check('why not: "Skipped: mushrooms are the main ingredient"', /Mushroom risotto\s+Skipped: mushrooms are the main ingredient\./.test(skipped), skipped.slice(0, 400));
  check('why not: allergies still rule dishes out, with the reason', /Linguine allo scoglio\s+Not for you: may contain shellfish/.test(skipped));
  check('no dish with the allergy is ever in its top 3', (await it.page.locator('.entry.ours').allInnerTexts()).every((t) => !/scoglio|calamari/i.test(t)));
  if (SHOTS) {
    await it.page.locator('.entry-tap[data-id="carbonara"]').click();
    await it.page.locator('.entry-tap[data-id="margherita"]').click();
    await it.page.evaluate(() => { const el = document.querySelector('.msec:nth-of-type(4)') || document.querySelector('.entry.ours'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); });
    await shot(it.page, 'phone-menu-with-picks');
    await it.page.evaluate(() => { const el = document.querySelector('details.skipped'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 330); });
    await shot(it.page, 'phone-why-not');
  }
  const ierr = it.errors.filter((e) => !/Failed to load resource|gstatic|firebase/i.test(e));
  check('no console errors (dislike pages)', ierr.length === 0, ierr.join(' | '));
  await it.ctx.close();
  // a different cuisine: a ramen bar, styled differently, same system
  const rb = await openMenu(browser, 'ramen-bar', { likes: 'noodles, pork, egg', dislikes: 'scallion', rules: '' });
  check('a ramen bar gets its own print style', await rb.page.locator('.sheet[data-style="izakaya"]').count() === 1 && /Ramen Yuzuki/.test(await rb.page.locator('.sheet-name').innerText()));
  check('no horizontal scroll on the menu at 390', await noSideScroll(rb.page));
  if (SHOTS) {
    await rb.page.locator('.entry-tap[data-id="shoyu-ramen"]').click();
    await rb.page.evaluate(() => { const el = document.querySelector('.entry.on'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150); });
    await shot(rb.page, 'phone-other-cuisine');
  }
  await rb.ctx.close();
}

async function signedOut(browser) {
  console.log('Signed out, phone 390x844');
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${BASE}?train=1`);
  await intake(page);
  check('share link ?train=1 opens the intake, then menu 1 of 10', await page.locator('text=Menu 1 of 10').count() === 1);
  await printedMenuChecks(page);
  await shot(page, 'phone-round');
  let text = '';
  for (let r = 1; r <= 4; r++) {
    const res = await playRound(page, r === 2 ? 2 : 3);
    text = res.text;
    check(`menu ${r}: its top 3 shown before picking`, res.guess === 3);
    check(`menu ${r}: score "it guessed n of your 3"`, /It guessed (none|\d|all \d) of your \d/.test(text) || /It guessed all/.test(text), text.slice(0, 120));
    check(`menu ${r}: running score shown`, new RegExp(`of your picks guessed over ${r} menus?`).test(text), text.slice(0, 400));
    if (r === 4) await shot(page, 'phone-reveal');
    await page.click('[data-action="next"]');
  }
  check('learned line in plain words', /You keep|Your picks|Noted/.test(text));
  check('no horizontal scroll at 390', await noSideScroll(page));
  // stop early
  await page.waitForSelector('.guesscard');
  await page.click('.roundhead [data-action="stop"]');
  await page.waitForSelector('h1');
  check('Finish: stops early and keeps the 4 menus', /palette is ready/i.test(await page.locator('main').innerText()) && /Over 4 menus/.test(await page.locator('main').innerText()));
  await page.reload();
  await page.goto(`${BASE}#/you`);
  await page.waitForSelector('.stat');
  const you = await page.locator('main').innerText();
  check('after reload the profile is kept (4 menus, typed foods, allergy)', /Sample menus\s+4/.test(you) && /broccoli/.test(you) && /peanuts/i.test(you), you.slice(0, 400));
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('browser storage keys start with mypalette.', keys.length > 0 && keys.every((k) => k.startsWith('mypalette.')), keys.join(','));
  check('stored state is version 3 under the same key', await page.evaluate(() => JSON.parse(localStorage.getItem('mypalette.state.v1')).v === 3));
  await page.goto(`${BASE}#/train`);
  await page.waitForSelector('[data-action="train-more"]');
  await page.click('[data-action="train-more"]');
  await page.waitForSelector('.guesscard');
  check('can come back for more menus', await page.locator('.guesscard').count() === 1);
  await page.goto(`${BASE}#/intake`);
  await page.waitForSelector('#in-likes');
  check('edit page shows the saved chips', /broccoli/.test(await page.locator('#box-likes').innerText()));
  await page.goto(`${BASE}#/menu`);
  await page.waitForSelector('h1');
  check('menu reading page loads', /Read a menu/.test(await page.locator('main').innerText()));
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('.hero');
  check('home shows the share of picks guessed', /Picks it guessed/.test(await page.locator('main').innerText()));
  await page.setViewportSize({ width: 360, height: 740 });
  for (const h of ['#/', '#/train', '#/you', '#/intake', '#/menu']) { await page.goto(BASE + h); await page.waitForTimeout(150); check(`no horizontal scroll at 360: ${h}`, await noSideScroll(page)); }
  const real = errors.filter((e) => !/Failed to load resource|gstatic|firebase/i.test(e));
  check('no console errors (phone)', real.length === 0, real.join(' | '));
  await page.goto(`${BASE}nope.html`);
  check('404 page', /not found/i.test(await page.locator('body').innerText()));
  await ctx.close();

  console.log('Older saved data (v1) still loads');
  const o = await newPage(browser, { width: 390, height: 844 });
  await o.page.goto(`${BASE}robots.txt`);
  await o.page.evaluate(() => localStorage.setItem('mypalette.state.v1', JSON.stringify({ v: 1, intake: { diet: ['vegetarian'], allergies: ['peanut'], never: ['olive'], spice: 1, adventure: 1, cuisines: [], at: 1 }, rounds: [{ id: 'r1', menu: 'thai', predicted: ['green-curry'], picked: ['panang-tofu'], never: [], at: 1, hit: false }], pending: null, feedback: [], meals: [], consent: false, sessionId: 'abcdefghijklmnopqrstuvwx', order: null, syncOffFor: null, updated: 1 })));
  await o.page.goto(`${BASE}#/train`);
  await o.page.waitForSelector('.guesscard');
  check('v1 tester: no crash, continues at menu 2 with their rules', /Menu 2 of 10/.test(await o.page.locator('main').innerText()) && await o.page.locator('.entry.blocked').count() > 0);
  const oerr = o.errors.filter((e) => !/Failed to load resource|gstatic|firebase/i.test(e));
  check('no console errors (v1 data)', oerr.length === 0, oerr.join(' | '));
  await o.ctx.close();

  console.log('Signed out, desktop 1280x800');
  const d = await newPage(browser, { width: 1280, height: 800 });
  await d.page.goto(`${BASE}?train=1`);
  await intake(d.page, { allergy: null, diet: 'vegetarian' });
  const t = await playRound(d.page, 1);
  check('desktop: a menu works', /Running score/i.test(t.text));
  await d.page.click('[data-action="next"]');
  await d.page.waitForSelector('.sheet .entry');
  const vmenu = await d.page.locator('.sheet-name').innerText();
  check('desktop: vegetarian rule greys out meat dishes', await d.page.locator('.entry.blocked').count() > 0, `on ${vmenu}`);
  await d.page.keyboard.press('Tab');
  check('desktop: keyboard focus is visible', await d.page.evaluate(() => { const el = document.activeElement; return !!el && getComputedStyle(el).outlineStyle !== 'none'; }));
  const derr = d.errors.filter((e) => !/Failed to load resource|gstatic|firebase/i.test(e));
  check('no console errors (desktop)', derr.length === 0, derr.join(' | '));
  for (const p of ['privacy.html', 'terms.html']) {
    await d.page.goto(BASE + p);
    const body = await d.page.locator('body').innerText();
    check(`${p} has the allergy disclaimer`, /confirm with (the )?staff/i.test(body) && /not medical advice/i.test(body));
  }
  await d.ctx.close();
}

async function firestoreDoc(pathName) {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/demo-apps/databases/(default)/documents/${pathName}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function firestoreList(pathName) {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/demo-apps/databases/(default)/documents/${pathName}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? ((await r.json()).documents ?? []) : [];
}

async function readText(page, text) {
  await page.goto(`${BASE}#/menu`);
  await page.waitForSelector('details[data-action="text-toggle"]');
  if (!(await page.locator('#menu-text-area').isVisible())) await page.locator('details[data-action="text-toggle"] summary').click();
  await page.fill('#menu-text-area', text);
  await page.click('#menu-text button[type="submit"]');
  await page.waitForFunction(() => location.hash.startsWith('#/meal/') || document.querySelector('[role="alert"]'), null, { timeout: 60000 });
}

async function signedIn(browser) {
  console.log('Emulator, signed in, phone 390x844');
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 }, { proxy: true });
  await page.goto(`${BASE}?emulator&train=1`);
  await intake(page);
  await playRound(page, 2);
  await page.click('[data-action="next"]');
  await page.waitForFunction(() => typeof window.__emuSignIn === 'function', null, { timeout: 60000 });
  const email = `e2e-${Date.now().toString(36)}@example.com`;
  const uid = await page.evaluate((e) => window.__emuSignIn(e), email);
  check('signed in through the test hook', !!uid);
  let prof = null;
  for (let i = 0; i < 40 && !prof; i++) { prof = await firestoreDoc(`palette_users/${uid}`); if (!prof) await page.waitForTimeout(250); }
  check('profile synced to palette_users', !!prof && /"rounds"/.test(prof.fields.history.stringValue) && !!prof.fields.weights);

  // consent: the anonymous session reaches palette_sessions (and carries no name or uid)
  await page.goto(`${BASE}#/you`);
  await page.locator('input[data-action="consent"]').check();
  const sid = await page.evaluate(() => JSON.parse(localStorage.getItem('mypalette.state.v1')).sessionId);
  let sess = null;
  for (let i = 0; i < 40 && !sess; i++) { sess = await firestoreDoc(`palette_sessions/${sid}`); if (!sess) await page.waitForTimeout(250); }
  check('consented session stored anonymously', !!sess && !JSON.stringify(sess).includes(uid) && !JSON.stringify(sess).includes(email));

  // a photo: render a small fake menu, screenshot it, and upload that
  const img = await (async () => {
    const p2 = await ctx.newPage();
    await p2.setContent('<body style="font:22px serif;padding:30px;background:#fff"><h2>Thai Kitchen</h2><p>Pad Thai ... 14</p><p>Green Curry ... 15</p><p>Tom Kha Gai ... 9</p></body>');
    const b = await p2.screenshot({ type: 'png' }); await p2.close(); return b;
  })();
  await page.goto(`${BASE}#/menu`);
  await page.waitForSelector('input[type="file"][data-action="photo"]');
  await page.locator('input[type="file"][data-action="photo"]').nth(1).setInputFiles({ name: 'menu.png', mimeType: 'image/png', buffer: img });
  check('progress shown while reading', await page.locator('text=Reading the menu').count() > 0 || /#\/meal\//.test(page.url()));
  await page.waitForFunction(() => location.hash.startsWith('#/meal/'), null, { timeout: 60000 });
  await page.waitForSelector('.pickcard');
  const meal = await page.locator('main').innerText();
  check('a top 3 is shown, each "Our pick #n" with "Why this"', await page.locator('.pickcard').count() === 3 && await page.locator('.pickcard .why').count() === 3 && /Our pick #1/i.test(meal));
  check('the photo menu is shown as a printed menu with sections', await page.locator('#dish-list .sheet .msec-h').count() >= 1 && await page.locator('#dish-list .sheet .entry').count() >= 5);
  const top = await page.locator('.pickcard .dname').allInnerTexts();
  check('top 3 leaves out dishes with the allergy (peanut)', top.every((n) => !/Pad Thai|Som Tam|Massaman/.test(n)), top.join(' / '));
  check('allergy note shown next to results', /Check with the staff/.test(meal) && /not medical advice/.test(meal));
  check('full menu decoded with allergy flags', /Not for you: may contain peanut/.test(meal) && /Mango Sticky Rice/.test(meal));
  await page.fill('#dish-search', 'cury');
  check('menu search forgives typos', /Green Curry/.test(await page.locator('#dish-list').innerText()));
  await page.fill('#dish-search', '');
  await page.click('[data-action="order-mode"]');
  await page.locator('[data-action="ordered"]').first().click();
  await page.locator('[data-action="rate"][data-v="1"]').first().click();
  check('ordered + rated feeds the learner', await page.evaluate(() => JSON.parse(localStorage.getItem('mypalette.state.v1')).feedback.length === 1));
  await shot(page, 'phone-top3');
  const meals = await firestoreList(`palette_users/${uid}/meals`);
  check('meal saved to the account', meals.length === 1);

  // daily limit: 10 per person; 1 used above
  for (let i = 0; i < 9; i++) await readText(page, `Pad thai, green curry ${i}`);
  await readText(page, 'Pad thai again');
  check('daily limit message past the limit', /Daily limit reached/.test(await page.locator('main').innerText()));

  // delete my data
  await page.goto(`${BASE}#/you`);
  await page.click('[data-action="delete-cloud"]');
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { gone = !(await firestoreDoc(`palette_users/${uid}`)) && (await firestoreList(`palette_users/${uid}/meals`)).length === 0; if (!gone) await page.waitForTimeout(250); }
  check('delete my data removes the profile and meals', gone);
  const unexpected = errors.filter((e) => !/resource-exhausted|429|Failed to load resource/.test(e));
  check('no unexpected console errors (emulator)', unexpected.length === 0, unexpected.join(' | '));
  await ctx.close();
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  try {
    await signedOut(browser);
    await dislikeChecks(browser);
    if (EMU) await signedIn(browser);
  } catch (e) { failed++; console.log('  FAIL crashed:', e); }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
