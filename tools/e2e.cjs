// End-to-end check in a real browser (Chromium via a global Playwright install; nothing to npm install).
//
//   NODE_PATH=$(npm root -g) node tools/e2e.cjs              signed-out app with the null config
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
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };
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
    viewport, deviceScaleFactor: 2, isMobile: viewport.width < 500, hasTouch: viewport.width < 500,
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
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); } };

async function intake(page, { allergy = 'peanut', diet = null } = {}) {
  await page.waitForSelector('form#intake');
  if (diet) await page.locator(`input[name="diet"][value="${diet}"]`).check();
  if (allergy) await page.locator(`input[name="allergies"][value="${allergy}"]`).check();
  await page.locator('input[name="never"][value="olive"]').check();
  await page.locator('input[name="spice"][value="2"]').check();
  await page.click('form#intake button[type="submit"]');
}

async function playRound(page, k = 2) {
  await page.waitForSelector('.dish .tap');
  const taps = page.locator('.dish .tap');
  for (let i = 0; i < k; i++) await taps.nth(i * 3).click();
  await page.locator('.dish .never').last().click();
  await page.click('[data-action="reveal"]');
  await page.waitForSelector('.verdict');
  return page.locator('main').innerText();
}

async function signedOut(browser) {
  console.log('Signed out, null config, phone 390x844');
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${BASE}?train=1`);
  await intake(page);
  check('share link ?train=1 opens the intake, then round 1', await page.locator('text=Round 1 of 12').count() === 1);
  await shot(page, 'phone-round');
  let text = '';
  for (let r = 1; r <= 4; r++) {
    text = await playRound(page, r % 3 + 1);
    check(`round ${r}: guess revealed with a hit or miss`, /Got it|Missed this one/.test(text));
    check(`round ${r}: running hit rate shown`, new RegExp(`of ${r}\\s+rounds`).test(text), text.slice(0, 200));
    if (r === 4) await shot(page, 'phone-reveal');
    await page.click('[data-action="next"]');
  }
  check('learned line in plain words', /You keep|Your picks|Noted/.test(text));
  check('no horizontal scroll at 390', await noSideScroll(page));
  await page.reload();
  await page.goto(`${BASE}#/you`);
  await page.waitForSelector('.stat');
  const you = await page.locator('main').innerText();
  check('after reload the profile is kept (4 rounds, rules)', /Training rounds\s+4/.test(you) && /allergic to peanut/.test(you), you.slice(0, 300));
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('browser storage keys start with mypalette.', keys.length > 0 && keys.every((k) => k.startsWith('mypalette.')), keys.join(','));
  await page.goto(`${BASE}#/menu`);
  await page.waitForSelector('h1');
  check('menu reading explains sign-in is not set up yet', await page.locator('text=Not switched on yet').count() === 1);
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('.hero');
  check('home shows the hit rate', /Top-3 hit rate/.test(await page.locator('main').innerText()));
  await page.setViewportSize({ width: 360, height: 740 });
  for (const h of ['#/', '#/train', '#/you', '#/intake', '#/menu']) { await page.goto(BASE + h); await page.waitForTimeout(150); check(`no horizontal scroll at 360: ${h}`, await noSideScroll(page)); }
  check('no console errors (phone)', errors.length === 0, errors.join(' | '));
  await page.goto(`${BASE}nope.html`);
  check('404 page', /not found/i.test(await page.locator('body').innerText()));
  await ctx.close();

  console.log('Signed out, desktop 1280x800');
  const d = await newPage(browser, { width: 1280, height: 800 });
  await d.page.goto(`${BASE}?train=1`);
  await intake(d.page, { allergy: null, diet: 'vegetarian' });
  const t = await playRound(d.page, 1);
  check('desktop: a round works', /hit rate so far/i.test(t));
  await d.page.click('[data-action="next"]');
  await d.page.waitForSelector('.dish');
  check('desktop: vegetarian rule greys out meat dishes', await d.page.locator('.dish.blocked').count() > 0);
  await d.page.keyboard.press('Tab');
  check('desktop: keyboard focus is visible', await d.page.evaluate(() => { const el = document.activeElement; return !!el && getComputedStyle(el).outlineStyle !== 'none'; }));
  check('no console errors (desktop)', d.errors.length === 0, d.errors.join(' | '));
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
  await page.waitForSelector('.pick');
  const meal = await page.locator('main').innerText();
  check('a top 3 is shown', await page.locator('.pick').count() === 3);
  const top = await page.locator('.pick .name').allInnerTexts();
  check('top 3 leaves out dishes with the allergy (peanut)', top.every((n) => !/Pad Thai|Som Tam|Massaman/.test(n)), top.join(' / '));
  check('allergy note shown next to results', /Check with the staff/.test(meal) && /not medical advice/.test(meal));
  check('full menu decoded with allergy flags', /Allergy: may contain peanut/.test(meal) && /Mango Sticky Rice/.test(meal));
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
    if (EMU) await signedIn(browser);
  } catch (e) { failed++; console.log('  FAIL crashed:', e); }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
