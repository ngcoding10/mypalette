// Writes tools/sample-sessions.json: 60 synthetic people (10 personas x 6), in the same shape as a
// real export, so tools/evaluate.mjs runs before anyone has shared real data.
//   node tools/make-sample-sessions.mjs
import { writeFileSync } from 'node:fs';
import { PERSONAS, makePerson, playSession, rng } from '../test/personas.mjs';
import { train, topK } from '../js/learner.js';
import { expand } from './eval-lib.mjs';
import { menuById } from '../js/menus.js';

const sessions = [];
let seed = 5000;
for (const name of Object.keys(PERSONAS)) for (let i = 0; i < 6; i++, seed++) {
  const person = makePerson(name, seed);
  const r = rng(seed);
  // people stop at different points, like real volunteers
  const stopAfter = 3 + Math.floor(r() * 23);
  const rounds = playSession(person, seed, (done, menu) => topK(train(person.intake, expand(done)), menuById(menu.id).dishes, person.intake, 3), { max: stopAfter })
    .map((x, j) => ({ ...x, at: Date.UTC(2026, 10, 20) + seed * 1000 + j }));
  sessions.push({ id: `sample-${seed}`, persona: name, intake: person.intake, rounds });
}
const out = { note: 'Synthetic sample made by tools/make-sample-sessions.mjs, not real people.', exportedAt: '2026-11-25T00:00:00Z', sessions };
writeFileSync(new URL('./sample-sessions.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`wrote ${sessions.length} sessions, ${sessions.reduce((a, s) => a + s.rounds.length, 0)} rounds`);
