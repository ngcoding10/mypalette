// Renders the share image and app icons into assets/.  NODE_PATH=$(npm root -g) node tools/make-assets.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`file://${path.join(root, 'tools/make-assets.html')}`);
  await page.waitForFunction(() => window.ready);
  await page.locator('#card').screenshot({ path: path.join(root, 'assets/share.png') });
  for (const [name, size, pad, bg] of [['icon-512.png', 512, 0.12, '#c4472b'], ['icon-192.png', 192, 0.12, '#c4472b'], ['icon-maskable-512.png', 512, 0.24, '#c4472b'], ['apple-touch-icon.png', 180, 0.14, '#c4472b'], ['favicon-32.png', 32, 0.04, '#c4472b']]) {
    const url = await page.evaluate(([s, p, c]) => window.makeIcon(s, p, c), [size, pad, bg]);
    fs.writeFileSync(path.join(root, 'assets', name), Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
  console.log('assets written');
})();
