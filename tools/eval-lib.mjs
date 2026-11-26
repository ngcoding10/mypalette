// Replays training sessions the way the app sees them: before each round, predict from the
// rounds before it only, then compare with what the person really picked.
// Used by tools/evaluate.mjs (real, exported sessions) and test/learner.test.mjs (synthetic people).
import { train, topK } from '../js/learner.js';
import { allowed } from '../js/schema.js';
import { menuById } from '../js/menus.js';

/** Turn stored rounds ({ menu, picked, never }) into learner input ({ options, picked, never }). */
export const expand = (rounds) => rounds.map((r) => ({ options: menuById(r.menu)?.dishes ?? [], picked: r.picked, never: r.never ?? [] })).filter((r) => r.options.length);

const choose = (n, k) => { if (k < 0 || k > n) return 0; let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; };
/** Chance that k random dishes out of n include at least one of the `hits` picked. */
export const randomHitRate = (n, hits, k) => (n <= 0 ? 0 : 1 - choose(n - hits, Math.min(k, n)) / choose(n, Math.min(k, n)));

/** Pick counts per menu and dish, so "most popular" can leave the person themselves out. */
export function popularity(sessions) {
  const counts = new Map(); // menu -> Map(dish -> count)
  for (const s of sessions) for (const r of s.rounds) {
    const m = counts.get(r.menu) ?? new Map();
    for (const id of r.picked) m.set(id, (m.get(id) ?? 0) + 1);
    counts.set(r.menu, m);
  }
  return counts;
}

/** Most popular `k` allowed dishes on a menu, not counting this person's own round. */
export function popularTop(counts, menu, intake, own, k = 3) {
  const m = counts.get(menu.id) ?? new Map();
  return menu.dishes
    .map((d, i) => ({ id: d.id, i, c: (m.get(d.id) ?? 0) - (own.includes(d.id) ? 1 : 0), ok: allowed(d, intake) }))
    .filter((x) => x.ok)
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .slice(0, k).map((x) => x.id);
}

/**
 * @param sessions [{ id, intake, rounds: [{ menu, picked, never }] }]
 * @returns {{ byRound: object[], overall: object, rounds: number, people: number }}
 */
export function replay(sessions) {
  const counts = popularity(sessions);
  const rows = []; // one per (person, round)
  for (const s of sessions) {
    const rounds = s.rounds.filter((r) => menuById(r.menu) && r.picked?.length);
    for (let i = 0; i < rounds.length; i++) {
      const menu = menuById(rounds[i].menu);
      const model = train(s.intake, expand(rounds.slice(0, i)));
      const guess = topK(model, menu.dishes, s.intake, 3);
      const pop = popularTop(counts, menu, s.intake, rounds[i].picked, 3);
      const picked = new Set(rounds[i].picked);
      const eligible = menu.dishes.filter((d) => allowed(d, s.intake)).length;
      const hitsAvailable = rounds[i].picked.filter((id) => menu.dishes.some((d) => d.id === id && allowed(d, s.intake))).length;
      rows.push({
        round: i + 1,
        top1: picked.has(guess[0]) ? 1 : 0,
        top3: guess.some((id) => picked.has(id)) ? 1 : 0,
        pop1: picked.has(pop[0]) ? 1 : 0,
        pop3: pop.some((id) => picked.has(id)) ? 1 : 0,
        rand1: randomHitRate(eligible, hitsAvailable, 1),
        rand3: randomHitRate(eligible, hitsAvailable, 3),
      });
    }
  }
  const avg = (list) => {
    const n = list.length || 1;
    const sum = (k) => list.reduce((a, r) => a + r[k], 0) / n;
    return { n: list.length, top1: sum('top1'), top3: sum('top3'), pop1: sum('pop1'), pop3: sum('pop3'), rand1: sum('rand1'), rand3: sum('rand3') };
  };
  const maxRound = Math.max(0, ...rows.map((r) => r.round));
  const byRound = Array.from({ length: maxRound }, (_, i) => ({ round: i + 1, ...avg(rows.filter((r) => r.round === i + 1)) }));
  return { byRound, overall: avg(rows), rounds: rows.length, people: sessions.length };
}

const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(5);
/** The replay as a plain-text table. */
export function formatReport(rep) {
  const lines = [];
  lines.push(`${rep.people} people, ${rep.rounds} rounds. Hit = the guess contains a dish they picked.`);
  lines.push('');
  lines.push('round  people   top-1  top-3 | popular top-1  top-3 | random top-1  top-3');
  for (const r of rep.byRound) lines.push(`${String(r.round).padStart(5)}  ${String(r.n).padStart(6)}  ${pct(r.top1)}  ${pct(r.top3)} |        ${pct(r.pop1)}  ${pct(r.pop3)} |       ${pct(r.rand1)}  ${pct(r.rand3)}`);
  const o = rep.overall;
  lines.push(`  all  ${String(o.n).padStart(6)}  ${pct(o.top1)}  ${pct(o.top3)} |        ${pct(o.pop1)}  ${pct(o.pop3)} |       ${pct(o.rand1)}  ${pct(o.rand3)}`);
  return lines.join('\n');
}
