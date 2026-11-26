// Turns collected training sessions into a scorecard: replays each person's rounds in order,
// predicts before each round from the earlier rounds only, and prints top-1 / top-3 hit rates
// by round number and overall, next to two baselines (random, and each menu's most popular dishes).
//
//   node tools/evaluate.mjs [sessions.json]          (default: tools/sample-sessions.json)
//
// sessions.json is what scripts/export-palette-sessions.mjs in the backend repo writes:
//   { "sessions": [ { "id", "intake": {...}, "rounds": [ { "menu", "picked": [...], "never": [...] } ] } ] }
// A plain array of sessions also works.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatReport, replay } from './eval-lib.mjs';

const file = process.argv[2] ?? fileURLToPath(new URL('./sample-sessions.json', import.meta.url));
const raw = JSON.parse(readFileSync(file, 'utf8'));
const sessions = (Array.isArray(raw) ? raw : raw.sessions ?? [])
  .filter((s) => s && Array.isArray(s.rounds) && s.rounds.length)
  .map((s) => ({ id: s.id, intake: s.intake ?? {}, rounds: s.rounds }));
if (!sessions.length) { console.error(`No sessions with rounds in ${file}`); process.exit(1); }

console.log(`MyPalette evaluation: ${file}`);
console.log(formatReport(replay(sessions)));
console.log('\nRead it like this: top-3 should climb with the round number and sit above "popular".');
console.log('Rounds with few people are noisy; trust the "all" row and the early rounds first.');
