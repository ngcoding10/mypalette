// Works out the order sample menus are offered in, so the first rounds teach the learner the most:
// greedily pick the menu whose dishes add the most not-yet-seen features (cuisine, protein, starch,
// cooking method, heat, texture, and to a lesser degree ingredients), with diminishing returns for
// features already seen. Prints the order to paste into MENU_ORDER in js/menus.js.
//   node tools/menu-order.mjs
import { MENUS } from '../js/menus.js';
import { features } from '../js/learner.js';

const weight = (k) => (k.startsWith('ing:') ? 0.15 : k.startsWith('course:') ? 0.2 : ['rich', 'sweet', 'sour', 'umami'].includes(k) ? 0 : 1);
const seen = new Map();
const left = [...MENUS];
const order = [];
while (left.length) {
  let best = null;
  for (const m of left) {
    const fs = new Set(m.dishes.flatMap((d) => [...features(d).keys()]));
    let gain = 0;
    for (const k of fs) gain += weight(k) / (1 + (seen.get(k) ?? 0));
    if (!best || gain > best.gain) best = { m, gain, fs };
  }
  order.push(best.m.id);
  for (const k of best.fs) seen.set(k, (seen.get(k) ?? 0) + 1);
  left.splice(left.indexOf(best.m), 1);
}
console.log(JSON.stringify(order).replace(/","/g, "', '").replace('["', "['").replace('"]', "']"));
