// MyPalette page logic: intake, training rounds, reading a menu, profile and account.
// Plain ES modules, no build step. Views are small HTML strings; clicks are handled by delegation.
import { MENUS, COURSE_TITLES, menuById } from './menus.js';
import { ALLERGENS, CUISINES, DIET_RULES, LABELS, NEVER_OPTIONS, conflicts } from './schema.js';
import { explain, learnedLine, profileForServer, rank, summary, topK } from './learner.js';
import { createFuzzyIndex, foldText } from './fuzzy.js';
import * as S from './store.js';
import { cloud, emulator, initCloud, signInGoogle, signInEmail, signUpEmail, resetPassword, signOut, loadProfile, saveProfile, saveMeal, updateMeal, readMenu, shareSession, deleteCloudData } from './cloud.js';
import { photoToJpeg } from './photo.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const syncEl = document.getElementById('sync');

// ───────── small helpers ─────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const ICON = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 5-5 4 4 2-2 3 3"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 10h14M5 14h9M5 18h6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a4 4 0 0 1-1.7 2.6v2.1h2.8c1.6-1.5 2.4-3.7 2.4-6.3z"/><path d="M12 20.5c2.3 0 4.2-.8 5.6-2l-2.8-2.1c-.8.5-1.7.8-2.8.8-2.2 0-4-1.5-4.7-3.4H4.4v2.2A8.5 8.5 0 0 0 12 20.5z"/><path d="M7.3 13.8a5 5 0 0 1 0-3.4V8.2H4.4a8.5 8.5 0 0 0 0 7.8z"/><path d="M12 6.8c1.3 0 2.4.4 3.3 1.3l2.5-2.5A8.5 8.5 0 0 0 4.4 8.2l2.9 2.2C8 8.3 9.8 6.8 12 6.8z"/></svg>',
};
const tickSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>';
const flame = (on) => `<svg class="${on ? '' : 'off'}" viewBox="0 0 12 12"><path d="M6 1c.5 2 2.6 3 2.6 5.6A2.6 2.6 0 0 1 6 9.2a2.6 2.6 0 0 1-2.6-2.6C3.4 5 4.6 4.4 5 3c.6.8.9 1.5.9 2.2C6.7 4.4 6.4 2.6 6 1z"/></svg>`;
const heatBadge = (h, note = '') => `${h ? `<span class="heat" aria-hidden="true">${[1, 2, 3].map((i) => flame(i <= h)).join('')}</span>` : ''}<span>${esc(note || LABELS.heat[h])}</span>`;

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

const SAFETY = 'Allergy and diet flags are a best guess from the menu and general food knowledge. Kitchens and recipes vary, so always confirm with the staff before you order. This is not medical advice.';
const safetyNote = () => `<div class="notice" role="note"><strong>Check with the staff.</strong> ${SAFETY}</div>`;

// ───────── routing ─────────
const params = new URLSearchParams(location.search);
if (params.has('train') && !location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/train`);
let route = '';
function currentRoute() { return (location.hash.replace(/^#\/?/, '') || 'home').split('/'); }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); document.getElementById('main').focus({ preventScroll: true }); });

const ui = {
  editIntake: false,
  reveal: null,          // id of the round whose result is showing
  reading: null,         // { status: 'working'|'error', started, preview, error, code }
  readToken: 0,
  authMode: 'none',      // none | email
  orderMode: false,
  search: '',
  syncNote: '',
};

function render() {
  const [name, arg] = currentRoute();
  route = name;
  for (const a of document.querySelectorAll('.tabs a')) {
    const on = a.dataset.tab === (name === 'meal' ? 'menu' : name === 'intake' ? 'train' : name);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.body.classList.toggle('has-bar', false);
  const view = { home: viewHome, train: viewTrain, intake: viewIntake, menu: viewMenu, meal: () => viewMeal(arg), you: viewYou }[name] ?? viewHome;
  app.innerHTML = view();
  afterRender?.(); afterRender = null;
  document.title = { home: 'MyPalette · know what to order', train: 'Train · MyPalette', intake: 'About you · MyPalette', menu: 'Read a menu · MyPalette', meal: 'Your top 3 · MyPalette', you: 'You · MyPalette' }[name] ?? 'MyPalette';
}
let afterRender = null;

// ───────── home ─────────
function viewHome() {
  const s = S.get(), st = S.stats();
  const model = S.getModel();
  const likes = summary(model).likes.slice(0, 6);
  const status = !s.intake
    ? `<div class="card"><h2>Start in a minute</h2><p class="muted">A few questions, then quick rounds where you pick from sample menus. It guesses your picks before you make them, and gets better each round.</p><a class="btn primary block" href="#/train">Teach it what you like</a></div>`
    : `<div class="card"><div class="row"><div class="grow"><div class="muted small">Your palette</div><div class="stat">${st.rounds} ${st.rounds === 1 ? 'round' : 'rounds'}</div></div>${st.rounds ? `<div><div class="muted small">Top-3 hit rate</div><div class="stat">${pct(st.rate)}</div></div>` : ''}</div>
       ${likes.length ? `<p class="muted small" style="margin-top:10px">Leaning towards</p><div class="chips">${likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('')}</div>` : '<p class="muted">Do a few rounds so it can learn what you like.</p>'}
       <div class="row" style="margin-top:14px"><a class="btn" href="#/train">${S.nextMenuId() ? 'Train some more' : 'See your training'}</a><a class="btn quiet" href="#/you">Your profile</a></div></div>`;
  return `
  <section class="hero">
    <h1>Know what to order.</h1>
    <p>Snap a menu and get the 3 dishes you will most likely enjoy, with everything else explained in plain words.</p>
  </section>
  <div class="actions">
    <a class="btn primary big" href="#/menu">${ICON.camera} Read a menu</a>
    <a class="btn big" href="#/train">${ICON.spark} ${s.intake ? 'Train my palette' : 'Teach it what I like'}</a>
  </div>
  <div class="section">${status}</div>
  <section class="section">
    <h2>How it works</h2>
    <ol class="steps">
      <li>Tell it the basics: diet, allergies, what you never eat, how much heat you like.</li>
      <li>Play a few rounds: from each sample menu, pick what you would order. It guesses first, then learns from you.</li>
      <li>At a restaurant, take a photo of the menu. You get your top 3, why, and what every dish actually is.</li>
    </ol>
  </section>`;
}

// ───────── intake ─────────
const SPICE = ['None', 'Mild', 'Medium', 'Hot'];
const ADVENTURE = ['Familiar food', 'A bit of both', 'Surprise me'];
function viewIntake() {
  const i = S.get().intake ?? { diet: [], allergies: [], never: [], spice: 1, adventure: 1, cuisines: [] };
  const custom = (i.never ?? []).filter((n) => !NEVER_OPTIONS.some((o) => o.key === n));
  const chips = (name, list, chosen, label = (x) => x) => `<div class="pick-chips">${list.map((x) => `<label><input type="checkbox" name="${name}" value="${esc(x)}" ${chosen.includes(x) ? 'checked' : ''}><span>${esc(label(x))}</span></label>`).join('')}</div>`;
  const seg = (name, labels, value) => `<div class="seg" style="--n:${labels.length}">${labels.map((l, k) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
  return `
  <h1>About you</h1>
  <p class="muted">This takes about a minute. You can change it any time.</p>
  <form id="intake" class="card" novalidate>
    <fieldset><legend><label for="nick">Name or nickname</label></legend><p class="hint">Optional. Only shown to you.</p>
      <input id="nick" type="text" name="name" maxlength="40" autocomplete="nickname" value="${esc(i.name ?? '')}"></fieldset>
    <fieldset><legend>Diet rules</legend><p class="hint">Dishes that break these are never suggested.</p>${chips('diet', DIET_RULES, i.diet ?? [], (x) => LABELS.diet[x])}</fieldset>
    <fieldset><legend>Allergies</legend><p class="hint">Flagged on every menu and left out of your top 3.</p>${chips('allergies', ALLERGENS, i.allergies ?? [], (x) => LABELS.allergen[x][0].toUpperCase() + LABELS.allergen[x].slice(1))}</fieldset>
    <fieldset><legend>Things you never eat</legend>${chips('never', NEVER_OPTIONS.map((o) => o.key), i.never ?? [], (k) => NEVER_OPTIONS.find((o) => o.key === k).label)}
      <label class="hint" for="never-more" style="display:block;margin-top:12px">Anything else? Separate with commas.</label>
      <input id="never-more" type="text" name="neverMore" maxlength="200" placeholder="e.g. tripe, capers" value="${esc(custom.join(', '))}"></fieldset>
    <fieldset><legend>How much heat do you like?</legend>${seg('spice', SPICE, i.spice ?? 1)}</fieldset>
    <fieldset><legend>Familiar or adventurous?</legend>${seg('adventure', ADVENTURE, i.adventure ?? 1)}</fieldset>
    <fieldset><legend>Cuisines you already love</legend><p class="hint">Optional.</p>${chips('cuisines', CUISINES.filter((c) => c !== 'other'), i.cuisines ?? [], (c) => LABELS.cuisine[c])}</fieldset>
    <label class="check"><input type="checkbox" name="consent" ${S.get().consent ? 'checked' : ''}><span><b>Help improve MyPalette by sharing my anonymous choices.</b><br><span class="small muted">Your answers above (without your name or anything you typed) and your picks in the training rounds, under a random id. Never your photos. Untick any time to remove them.${cloud.enabled ? '' : ' Sharing starts once sign-in is set up on this site.'}</span></span></label>
    <div class="actions" style="margin-top:18px"><button class="btn primary big" type="submit">${S.get().intake ? 'Save' : 'Start round 1'}</button></div>
  </form>`;
}

function saveIntake(form) {
  const fd = new FormData(form);
  const more = String(fd.get('neverMore') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 30));
  const first = !S.get().intake;
  const intake = {
    name: String(fd.get('name') ?? '').trim().slice(0, 40),
    diet: fd.getAll('diet').filter((x) => DIET_RULES.includes(x)),
    allergies: fd.getAll('allergies').filter((x) => ALLERGENS.includes(x)),
    never: [...new Set([...fd.getAll('never'), ...more])],
    spice: Number(fd.get('spice') ?? 1), adventure: Number(fd.get('adventure') ?? 1),
    cuisines: fd.getAll('cuisines').filter((x) => CUISINES.includes(x)),
    at: Date.now(),
  };
  const consent = fd.get('consent') === 'on';
  const wasConsent = S.get().consent;
  S.update((s) => { s.intake = intake; s.consent = consent; if (s.pending) s.pending = null; });
  if (consent !== wasConsent) consentChanged(consent);
  else if (consent) shareNow();
  if (location.hash === '#/train') { render(); window.scrollTo(0, 0); } else location.hash = '#/train';
  if (!first) toast('Saved');
}

// ───────── training rounds ─────────
function startRound() {
  const id = S.nextMenuId();
  if (!id) return null;
  const s = S.get();
  if (s.pending?.menu === id) return s.pending;
  const menu = menuById(id);
  // The guess is made now, before the person sees the menu, and stored so a reload cannot change it.
  const predicted = topK(S.getModel(), menu.dishes, s.intake, 3);
  const pending = { id: S.newId(12), menu: id, predicted, picked: [], never: [], at: Date.now() };
  S.update((st) => { st.pending = pending; }, { retrain: false, sync: false });
  return pending;
}

function viewTrain() {
  const s = S.get();
  if (!s.intake) return viewIntake();
  if (ui.reveal) return viewReveal(ui.reveal);
  const pending = startRound();
  if (!pending) return viewTrainDone();
  const menu = menuById(pending.menu);
  const n = s.rounds.length + 1;
  const groups = {};
  for (const d of menu.dishes) (groups[d.course] ??= []).push(d);
  document.body.classList.add('has-bar');
  afterRender = () => { renderBar(); document.body.classList.add('has-bar'); };
  return `
  <div class="roundhead"><h1 style="font-size:28px;margin:0">${esc(menu.title)}</h1><span class="muted">Round ${n} of ${MENUS.length}</span></div>
  <p class="muted">${esc(menu.place)}. Tap up to 3 dishes you would order. It has already made its guess.</p>
  ${Object.keys(COURSE_TITLES).filter((c) => groups[c]).map((c) => `<h2 class="course">${COURSE_TITLES[c]}</h2><div class="dishes">${groups[c].map((d) => dishRow(d, pending)).join('')}</div>`).join('')}
  <p class="muted small center" style="margin-top:18px">Had enough? <a href="#/">Stop here</a>. Your answers so far are kept.</p>
  <div class="bar" id="bar"></div>`;
}

function dishRow(d, pending) {
  const blocked = conflicts(d, S.get().intake ?? {});
  const on = pending.picked.includes(d.id), no = pending.never.includes(d.id);
  const meta = `<div class="meta">${heatBadge(d.heat)}${blocked.length ? `<span class="flag">Not for you: ${esc(blocked.map((b) => b.text).join(', '))}</span>` : ''}</div>`;
  if (blocked.length) return `<div class="dish blocked" data-dish="${d.id}"><div><div class="name">${esc(d.name)}</div><div class="desc">${esc(d.desc)}</div>${meta}</div></div>`;
  return `<div class="dish ${on ? 'on' : ''} ${no ? 'no' : ''}" data-dish="${d.id}">
    <button class="tap" type="button" data-action="pick" data-id="${d.id}" aria-pressed="${on}"><div class="name">${esc(d.name)}</div><div class="desc">${esc(d.desc)}</div>${meta}</button>
    <div class="side"><span class="tick" aria-hidden="true">${tickSvg}</span><button class="never" type="button" data-action="never" data-id="${d.id}" aria-pressed="${no}" aria-label="Would never order ${esc(d.name)}">${no ? 'Never' : 'Never?'}</button></div>
  </div>`;
}

function renderBar() {
  const bar = document.getElementById('bar');
  const p = S.get().pending;
  if (!bar || !p) return;
  const k = p.picked.length;
  bar.innerHTML = `<div class="wrap"><span class="count">${k ? `${k} of 3 picked` : 'Pick 1 to 3 dishes'}</span><button class="btn primary" type="button" data-action="reveal" ${k ? '' : 'disabled'}>See its guess</button></div>`;
}

function togglePick(id, kind) {
  const p = S.get().pending;
  if (!p) return;
  S.update((s) => {
    const q = s.pending;
    if (kind === 'pick') {
      if (q.picked.includes(id)) q.picked = q.picked.filter((x) => x !== id);
      else if (q.picked.length >= 3) { toast('Pick up to 3. Tap one again to swap it out.'); return; }
      else { q.picked.push(id); q.never = q.never.filter((x) => x !== id); }
    } else {
      if (q.never.includes(id)) q.never = q.never.filter((x) => x !== id);
      else { q.never.push(id); q.picked = q.picked.filter((x) => x !== id); }
    }
  }, { retrain: false, sync: false });
  const q = S.get().pending;
  for (const row of app.querySelectorAll('.dish[data-dish]')) {
    const did = row.dataset.dish;
    const on = q.picked.includes(did), no = q.never.includes(did);
    row.classList.toggle('on', on); row.classList.toggle('no', no);
    row.querySelector('.tap')?.setAttribute('aria-pressed', String(on));
    const nv = row.querySelector('.never');
    if (nv) { nv.setAttribute('aria-pressed', String(no)); nv.textContent = no ? 'Never' : 'Never?'; }
  }
  renderBar();
}

function finishRound() {
  const p = S.get().pending;
  if (!p || !p.picked.length) return;
  const round = { ...p, hit: p.predicted.some((id) => p.picked.includes(id)) };
  S.update((s) => { s.rounds.push(round); s.pending = null; });
  ui.reveal = round.id;
  if (S.get().consent) shareNow();
  render(); window.scrollTo(0, 0);
}

function viewReveal(roundId) {
  const s = S.get();
  const r = s.rounds.find((x) => x.id === roundId);
  if (!r) { ui.reveal = null; return viewTrain(); }
  const menu = menuById(r.menu);
  const byId = (id) => menu.dishes.find((d) => d.id === id);
  const st = S.stats();
  const allPicks = s.rounds.flatMap((x) => x.picked.map((id) => menuById(x.menu)?.dishes.find((d) => d.id === id)).filter(Boolean));
  const line = learnedLine(S.getModel(), allPicks);
  const matched = r.predicted.filter((id) => r.picked.includes(id));
  const next = S.nextMenuId();
  return `
  <div class="verdict ${r.hit ? 'hit' : 'miss'}" role="status">
    <h2>${r.hit ? `Got it. ${esc(byId(matched[0])?.name)} was in its top 3.` : 'Missed this one.'}</h2>
    <p class="muted" style="margin:0">${r.hit ? (matched.length > 1 ? `${matched.length} of your picks were in its guess.` : 'It guessed before you picked.') : 'It learns more from a miss than a hit.'}</p>
  </div>
  <h3>Its guess, made before you picked</h3>
  <ol class="guess">${r.predicted.map((id, k) => `<li class="${r.picked.includes(id) ? 'match' : ''}"><span class="n">${r.picked.includes(id) ? '✓' : k + 1}</span><span class="grow">${esc(byId(id)?.name)}</span>${r.picked.includes(id) ? '<span class="chip good">you picked it</span>' : ''}</li>`).join('')}</ol>
  <p class="small muted" style="margin-top:8px">You picked: ${r.picked.map((id) => esc(byId(id)?.name)).join(', ')}.</p>
  <div class="card section">
    <div class="muted small">What it just learned</div>
    <p class="learned">${esc(line)}</p>
    <div class="muted small" style="margin-top:12px">Top-3 hit rate so far</div>
    <div class="meter" aria-hidden="true"><i style="width:${Math.round(st.rate * 100)}%"></i></div>
    <div><b>${st.hits} of ${st.rounds}</b> rounds (${pct(st.rate)}). More rounds, better guesses.</div>
  </div>
  <div class="actions section">
    ${next ? '<button class="btn primary big" type="button" data-action="next">Next menu</button>' : '<button class="btn primary big" type="button" data-action="next">See your results</button>'}
    <a class="btn block" href="#/" data-action="stop">Stop here</a>
  </div>`;
}

function viewTrainDone() {
  const st = S.stats(), s = summary(S.getModel());
  return `
  <h1>All ${MENUS.length} menus done</h1>
  <p class="muted">That is every sample menu. Your top-3 hit rate was <b>${pct(st.rate)}</b> over ${st.rounds} rounds. From here it keeps learning from the real meals you rate.</p>
  <div class="card"><h3>What it thinks you like</h3><div class="chips">${s.likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('') || '<span class="muted">Nothing clear yet</span>'}</div>
  ${s.dislikes.length ? `<h3 style="margin-top:14px">And less so</h3><div class="chips">${s.dislikes.map((l) => `<span class="chip bad">${esc(l)}</span>`).join('')}</div>` : ''}</div>
  <div class="actions section"><a class="btn primary big" href="#/menu">${ICON.camera} Read a real menu</a><a class="btn block" href="#/you">See your profile</a></div>`;
}

// ───────── reading a menu ─────────
function viewMenu() {
  const s = S.get();
  const recent = [...s.meals].reverse().slice(0, 5);
  const recentHtml = recent.length ? `<section class="section"><h2>Recent menus</h2><ul class="list-plain card">${recent.map((m) => `<li><a href="#/meal/${m.id}"><span>${esc(m.title || 'Menu')}</span><span class="muted small">${new Date(m.at).toLocaleDateString()}</span></a></li>`).join('')}</ul></section>` : '';
  if (ui.reading?.status === 'working') return viewReading();
  let body;
  if (!cloud.enabled) {
    body = `<div class="notice info"><strong>Not switched on yet.</strong> Reading a menu needs sign-in, and sign-in is not set up on this site yet. Everything else works: <a href="#/train">train your palette</a> now and it will be ready.</div>`;
  } else if (cloud.failed) {
    body = `<div class="notice info"><strong>Could not reach sign-in.</strong> You may be offline. <button class="btn quiet" type="button" data-action="retry-cloud">Try again</button></div>`;
  } else if (!cloud.user) {
    body = `<div class="card"><h2>Sign in to read menus</h2><p class="muted">Reading a menu uses an AI model, so it needs a free account (and has a daily limit). Your taste profile comes with you.</p>${signInBlock()}</div>`;
  } else {
    const err = ui.reading?.status === 'error' ? `<div class="notice" role="alert" style="margin-bottom:12px"><strong>${esc(ui.reading.title)}</strong> ${esc(ui.reading.error)}</div>` : '';
    body = `${err}
    <div class="capture">
      <label class="btn primary big">${ICON.camera} Take a photo of the menu<input type="file" accept="image/*" capture="environment" data-action="photo"></label>
      <label class="btn big">${ICON.image} Choose a photo<input type="file" accept="image/*" data-action="photo"></label>
      <details ${ui.textOpen ? 'open' : ''} data-action="text-toggle"><summary class="btn block">${ICON.text} Type or paste a menu</summary>
        <form id="menu-text" class="stack" style="margin-top:10px"><label class="sr" for="menu-text-area">Menu text</label>
          <textarea id="menu-text-area" name="text" maxlength="8000" placeholder="Paste the dish names (and descriptions if there are any)"></textarea>
          <button class="btn primary block" type="submit">Read this menu</button></form></details>
    </div>
    <p class="small muted" style="margin-top:12px">Tips: get the whole menu in the frame, hold steady, and use the flash if it is dim. One page at a time. The photo is used to read the menu and is not stored.</p>
    ${s.intake?.allergies?.length ? safetyNote() : ''}
    ${!s.rounds.length ? '<p class="notice info small" style="margin-top:12px">It does not know your taste yet, so picks will lean on your answers and general appeal. <a href="#/train">Do a few training rounds</a> for better picks.</p>' : ''}`;
  }
  return `<h1>Read a menu</h1><p class="muted">Get your top 3 and every dish explained in plain words.</p>${body}${recentHtml}`;
}

const STEPS = ['Sending the photo', 'Reading every dish', 'Explaining what each one is', 'Matching to your taste'];
function viewReading() {
  const r = ui.reading;
  const t = Math.floor((Date.now() - r.started) / 1000);
  const step = t < 2 ? 0 : t < 9 ? 1 : t < 22 ? 2 : 3;
  return `<div class="card reading" aria-busy="true">
    ${r.preview ? `<img class="preview" src="${r.preview}" alt="The menu photo being read">` : ''}
    <div class="spinner" aria-hidden="true"></div>
    <h2>Reading the menu…</h2>
    <p class="muted" id="elapsed">${t} seconds. Usually 10 to 30, longer for big menus.</p>
    <ol class="progress">${STEPS.map((x, k) => `<li class="${k < step ? 'done' : k === step ? 'now' : ''}">${k < step ? '✓ ' : ''}${x}</li>`).join('')}</ol>
    <button class="btn quiet" type="button" data-action="cancel-read" style="margin-top:12px">Cancel</button>
  </div>`;
}
let readingTimer = null;
function tickReading() {
  clearInterval(readingTimer);
  readingTimer = setInterval(() => { if (ui.reading?.status === 'working' && route === 'menu') render(); else clearInterval(readingTimer); }, 1000);
}

async function startReading({ file = null, text = '' }) {
  if (!navigator.onLine) { ui.reading = { status: 'error', title: 'You are offline.', error: 'Reading a menu needs a connection. Your profile still works offline.' }; render(); return; }
  const token = ++ui.readToken;
  ui.reading = { status: 'working', started: Date.now(), preview: null };
  render(); tickReading();
  try {
    let image = null;
    if (file) { const p = await photoToJpeg(file); image = p.base64; ui.reading.preview = p.preview; }
    const s = S.get();
    const res = await readMenu({ image, text: image ? '' : text, profile: profileForServer(S.getModel(), s.intake ?? {}), context: {} });
    if (token !== ui.readToken) return;
    const menu = res.menu;
    if (!menu.isMenu || !menu.dishes.length) {
      ui.reading = { status: 'error', title: menu.isMenu ? 'No dishes found.' : 'That does not look like a menu.', error: menu.problem || 'Try again with the menu filling the frame, in good light.' };
      render(); return;
    }
    const meal = buildMeal(menu, res.usage);
    S.update((st) => { st.meals.push(meal); st.meals = st.meals.slice(-S.MAX_MEALS); }, { retrain: false });
    ui.reading = null; ui.search = ''; ui.orderMode = false;
    if (cloud.user) saveMeal(cloud.user.uid, meal.id, cloudMeal(meal)).catch((e) => console.warn('meal not saved', e));
    location.hash = `#/meal/${meal.id}`;
  } catch (e) {
    if (token !== ui.readToken) return;
    const code = e?.code ?? '';
    const title = code === 'resource-exhausted' ? 'Daily limit reached.' : code === 'unauthenticated' ? 'Please sign in again.' : !navigator.onLine ? 'You are offline.' : 'That did not work.';
    ui.reading = { status: 'error', title, error: e?.message || 'Try again in a moment.' };
    render();
  }
}

function buildMeal(menu, usage) {
  const dishes = S.dishesFromReading(menu);
  return {
    id: S.newId(16), at: Date.now(), title: menu.cuisineGuess ? `${menu.cuisineGuess} menu` : 'Menu', cuisine: menu.cuisineGuess ?? '',
    readable: menu.readable, problem: menu.problem ?? '', dishes,
    claude: menu.picks.map((p) => ({ id: dishes[p.index]?.id, reason: p.reason })).filter((p) => p.id),
    ordered: [], ratings: {}, usage: usage ?? null,
  };
}
const cloudMeal = (m) => ({
  title: m.title.slice(0, 80), cuisine: m.cuisine.slice(0, 60),
  dishes: m.dishes.slice(0, 80).map((d) => ({ ...S.compactDish(d), englishName: d.englishName, section: d.section, price: d.price, whatItIs: d.whatItIs })),
  picks: topThree(m).map((t) => t.dish.id), ordered: m.ordered, ratings: m.ratings,
});

/** The learner's ranking blended with the model's own picks; rule-breaking dishes never make it. */
function topThree(meal) {
  const s = S.get(), model = S.getModel();
  const ranked = rank(model, meal.dishes, s.intake ?? {}).filter((r) => !r.blocked.length && r.dish.course !== 'drink');
  if (!ranked.length) return [];
  const mean = ranked.reduce((a, r) => a + r.score, 0) / ranked.length;
  const sd = Math.sqrt(ranked.reduce((a, r) => a + (r.score - mean) ** 2, 0) / ranked.length) || 1;
  // With little training, lean on the model's picks; with more, lean on what this person has shown.
  const trust = 1.2 - 0.7 * Math.min(1, model.n / 10);
  const bonus = [1, 0.75, 0.5];
  const scored = ranked.map((r) => {
    const k = meal.claude.findIndex((c) => c.id === r.dish.id);
    return { ...r, final: (r.score - mean) / sd + (k >= 0 ? trust * bonus[k] : 0), reason: k >= 0 ? meal.claude[k].reason : '' };
  }).sort((a, b) => b.final - a.final);
  return scored.slice(0, 3).map((r) => ({ ...r, why: explain(model, r.dish, 3) }));
}

function viewMeal(id) {
  const s = S.get();
  const meal = s.meals.find((m) => m.id === id);
  if (!meal) return `<h1>Menu not found</h1><p class="muted">It may have been on another device.</p><a class="btn" href="#/menu">Read a menu</a>`;
  const intake = s.intake ?? {};
  const top = topThree(meal);
  const hasAllergies = (intake.allergies ?? []).length > 0;
  const name = (d) => `${esc(d.name)}${d.englishName && d.englishName.toLowerCase() !== d.name.toLowerCase() ? ` <span class="alt">· ${esc(d.englishName)}</span>` : ''}`;
  const topHtml = top.length ? `<div class="top3">${top.map((t) => `<article class="card pick">
      <div class="row"><div class="name grow">${name(t.dish)}</div>${t.dish.price ? `<span class="price">${esc(t.dish.price)}</span>` : ''}</div>
      <p class="muted" style="margin:4px 0 0">${esc(t.dish.whatItIs)}</p>
      <p class="why"><b>Why you:</b> ${esc(t.reason || '')}${t.why.length ? `${t.reason ? ' ' : ''}Fits what you pick: ${esc(t.why.join(', '))}.` : ''}${!t.reason && !t.why.length ? 'A good all-round match for your answers.' : ''}</p>
      <div class="meta row small muted">${heatBadge(t.dish.heat, t.dish.heatNote)}</div>
    </article>`).join('')}</div>` : '<div class="notice info">Nothing on this menu fits your rules. Ask the staff what they can adapt.</div>';
  return `
  <div class="row"><h1 class="grow" style="font-size:30px;margin:0">Your top 3</h1><a class="btn" href="#/menu">${ICON.camera} New menu</a></div>
  <p class="muted">${esc(meal.title)} · ${meal.dishes.length} dishes read${meal.usage ? ` · ${meal.usage.used} of ${meal.usage.limit} readings used today` : ''}</p>
  ${meal.readable !== 'clear' && meal.problem ? `<div class="notice info" style="margin-bottom:12px"><strong>Partly read.</strong> ${esc(meal.problem)}</div>` : ''}
  ${hasAllergies ? `<div style="margin-bottom:12px">${safetyNote()}</div>` : ''}
  ${topHtml}
  <section class="section" aria-labelledby="full">
    <div class="row"><h2 id="full" class="grow" style="margin:0">The whole menu</h2><button class="btn" type="button" data-action="order-mode" aria-pressed="${ui.orderMode}">${ui.orderMode ? 'Done' : 'What did you order?'}</button></div>
    ${ui.orderMode ? '<p class="muted small">Tap what you had, then say how it was. It learns from real meals too.</p>' : ''}
    <label class="sr" for="dish-search">Search this menu</label>
    <input id="dish-search" type="search" placeholder="Search this menu" value="${esc(ui.search)}" data-action="search" style="margin:10px 0" autocomplete="off">
    <div id="dish-list">${mealList(meal)}</div>
  </section>`;
}

function mealList(meal) {
  const intake = S.get().intake ?? {};
  let dishes = meal.dishes;
  const q = ui.search.trim();
  if (q) {
    const fq = foldText(q);
    const hay = (d) => foldText([d.name, d.englishName, d.whatItIs, d.section, ...(d.mainIngredients ?? []), ...d.ingredients].join(' '));
    let hits = dishes.filter((d) => fq.split(' ').every((w) => hay(d).includes(w)));
    if (hits.length < 3) {
      const index = createFuzzyIndex(dishes, (d) => [d.name, d.englishName, ...(d.mainIngredients ?? []), ...d.ingredients]);
      const extra = index.search(q, { limit: 10 }).map((r) => r.item).filter((d) => !hits.includes(d));
      hits = [...hits, ...extra];
    }
    dishes = hits;
  }
  if (!dishes.length) return '<p class="muted">Nothing matches that.</p>';
  const sections = [];
  for (const d of dishes) { const k = d.section || COURSE_TITLES[d.course] || 'Dishes'; let g = sections.find((x) => x.k === k); if (!g) sections.push(g = { k, list: [] }); g.list.push(d); }
  return sections.map((g) => `<h3 class="course">${esc(g.k)}</h3><div class="dishes">${g.list.map((d) => {
    const blocked = conflicts(d, intake);
    const allergy = blocked.filter((b) => b.kind === 'allergy');
    const other = blocked.filter((b) => b.kind !== 'allergy');
    const ordered = meal.ordered.includes(d.id);
    const rating = meal.ratings[d.id];
    return `<div class="dish ${ordered ? 'on' : ''}" data-dish="${d.id}" style="grid-template-columns:1fr">
      <div class="row"><div class="name grow">${esc(d.name)}${d.englishName && d.englishName.toLowerCase() !== d.name.toLowerCase() ? ` <span class="muted small">· ${esc(d.englishName)}</span>` : ''}</div>${d.price ? `<span class="price">${esc(d.price)}</span>` : ''}</div>
      <div class="desc">${esc(d.whatItIs)}</div>
      <div class="meta">${heatBadge(d.heat, d.heatNote)}${d.mainIngredients?.length ? `<span>${esc(d.mainIngredients.slice(0, 5).join(', '))}</span>` : ''}</div>
      ${allergy.length ? `<div class="flag small" style="margin-top:6px">Allergy: ${esc(allergy.map((b) => b.text).join(', '))}. ${esc(d.allergenNote)}</div>` : d.allergenNote && (intake.allergies ?? []).length ? `<div class="small muted" style="margin-top:6px">${esc(d.allergenNote)}</div>` : ''}
      ${other.length ? `<div class="small flag" style="margin-top:4px">Not for you: ${esc(other.map((b) => b.text).join(', '))}</div>` : ''}
      ${ui.orderMode ? `<div class="rate"><button class="btn" type="button" data-action="ordered" data-id="${d.id}" aria-pressed="${ordered}">${ordered ? 'Had this' : 'I had this'}</button>${ordered ? `<button class="btn" type="button" data-action="rate" data-id="${d.id}" data-v="1" aria-pressed="${rating === true}">Loved it</button><button class="btn" type="button" data-action="rate" data-id="${d.id}" data-v="0" aria-pressed="${rating === false}">Not for me</button>` : ''}</div>` : ''}
    </div>`;
  }).join('')}</div>`).join('');
}

function mealFeedback(meal) {
  const liked = meal.ordered.filter((id) => meal.ratings[id] !== false);
  const disliked = meal.ordered.filter((id) => meal.ratings[id] === false);
  return { id: meal.id, at: meal.at, options: meal.dishes.slice(0, 60).map(S.compactDish), liked, disliked };
}

function changeOrder(mealId, id, what, value) {
  S.update((s) => {
    const m = s.meals.find((x) => x.id === mealId);
    if (!m) return;
    if (what === 'ordered') {
      if (m.ordered.includes(id)) { m.ordered = m.ordered.filter((x) => x !== id); delete m.ratings[id]; }
      else if (m.ordered.length < 12) m.ordered.push(id);
    } else m.ratings[id] = m.ratings[id] === value ? undefined : value;
    for (const k of Object.keys(m.ratings)) if (m.ratings[k] === undefined) delete m.ratings[k];
    s.feedback = s.feedback.filter((f) => f.id !== m.id);
    if (m.ordered.length) s.feedback.push(mealFeedback(m));
  });
  const m = S.get().meals.find((x) => x.id === mealId);
  if (cloud.user && m) updateMeal(cloud.user.uid, m.id, { ordered: m.ordered, ratings: m.ratings }).catch(() => saveMeal(cloud.user.uid, m.id, cloudMeal(m)).catch(() => {}));
  document.getElementById('dish-list').innerHTML = mealList(m);
  if (what === 'rate') toast('Thanks. Noted for next time.');
}

// ───────── you: profile, account, data ─────────
function signInBlock() {
  const ready = cloud.ready;
  return `<div class="stack">
    <button class="btn primary block" type="button" data-action="google" ${ready ? '' : 'disabled aria-disabled="true"'}>${ICON.google} ${ready ? 'Continue with Google' : 'Loading sign-in…'}</button>
    ${ui.authMode === 'email' ? `<form id="email-auth" class="stack" novalidate>
      <label class="sr" for="em">Email</label><input id="em" type="email" name="email" autocomplete="email" placeholder="Email" required>
      <label class="sr" for="pw">Password</label><input id="pw" type="password" name="password" autocomplete="current-password" placeholder="Password (6 or more characters)" required minlength="6">
      <div class="row"><button class="btn primary" type="submit" name="mode" value="in" ${ready ? '' : 'disabled'}>Sign in</button><button class="btn" type="submit" name="mode" value="up" ${ready ? '' : 'disabled'}>Create account</button><button class="btn quiet" type="submit" name="mode" value="reset" ${ready ? '' : 'disabled'}>Forgot password</button></div>
    </form>` : '<button class="btn quiet" type="button" data-action="email-mode">Use email instead</button>'}
  </div>`;
}

function viewYou() {
  const s = S.get(), st = S.stats();
  const sm = summary(S.getModel());
  const i = s.intake;
  const account = !cloud.enabled
    ? '<p class="muted">Sign-in is not set up on this site yet. Everything is saved in this browser only.</p>'
    : cloud.failed ? '<p class="muted">Could not reach sign-in. You may be offline. <button class="btn quiet" type="button" data-action="retry-cloud">Try again</button></p>'
    : cloud.user ? `<p>Signed in as <b>${esc(cloud.user.email || cloud.user.name)}</b>. Your profile syncs to your account.${s.syncOffFor === cloud.user.uid ? ' <b>Sync is off</b> because you deleted your cloud data.' : ''}</p>
        <div class="row">${s.syncOffFor === cloud.user.uid ? '<button class="btn" type="button" data-action="sync-on">Turn sync back on</button>' : ''}<button class="btn" type="button" data-action="signout">Sign out</button></div>`
    : `<p class="muted">Optional. Signing in lets you read menu photos and keeps your profile across devices.</p>${signInBlock()}`;
  return `
  <h1>${i?.name ? esc(i.name) : 'You'}</h1>
  <div class="card">
    <div class="row"><div class="grow"><div class="muted small">Training rounds</div><div class="stat">${st.rounds}</div></div><div class="grow"><div class="muted small">Top-3 hit rate</div><div class="stat">${st.rounds ? pct(st.rate) : '–'}</div></div><div class="grow"><div class="muted small">Meals rated</div><div class="stat">${st.feedback}</div></div></div>
    <h3 style="margin-top:12px">Leaning towards</h3><div class="chips">${sm.likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('') || '<span class="muted small">Nothing clear yet. Do a few rounds.</span>'}</div>
    ${sm.dislikes.length ? `<h3 style="margin-top:12px">Less keen on</h3><div class="chips">${sm.dislikes.map((l) => `<span class="chip bad">${esc(l)}</span>`).join('')}</div>` : ''}
    ${i ? `<h3 style="margin-top:12px">Your rules</h3><p class="small muted">${esc([...(i.diet ?? []).map((d) => LABELS.diet[d]), ...(i.allergies ?? []).map((a) => `allergic to ${LABELS.allergen[a]}`), ...(i.never ?? []).map((n) => `no ${NEVER_OPTIONS.find((o) => o.key === n)?.label.toLowerCase() ?? n}`), `heat: ${SPICE[i.spice ?? 1].toLowerCase()}`].join(' · '))}</p>` : ''}
    <div class="row" style="margin-top:12px"><a class="btn" href="#/intake">${i ? 'Edit my answers' : 'Answer the questions'}</a><a class="btn quiet" href="#/train">Train</a></div>
  </div>
  <section class="section card"><h2>Account</h2>${account}</section>
  <section class="section card"><h2>Your data</h2>
    <label class="check"><input type="checkbox" data-action="consent" ${s.consent ? 'checked' : ''} ${cloud.enabled ? '' : 'disabled'}><span><b>Help improve MyPalette by sharing my anonymous choices.</b><br><span class="small muted">Your intake choices (no name or typed text) and your training picks, under a random id. Unticking removes what was shared.${cloud.enabled ? '' : ' Available once sign-in is set up on this site.'}</span></span></label>
    <div class="actions" style="margin-top:12px">
      <button class="btn block" type="button" data-action="export">Download my profile (JSON)</button>
      ${cloud.user ? '<button class="btn block" type="button" data-action="delete-cloud">Delete my MyPalette data from my account</button>' : ''}
      <button class="btn block" type="button" data-action="reset">Clear everything on this device</button>
    </div>
    <p class="small muted" style="margin-top:10px">See the <a href="privacy.html">privacy policy</a> and <a href="terms.html">terms</a>.</p>
  </section>`;
}

// ───────── sync and sharing ─────────
let syncTimer = null, syncing = null;
const setSync = (t) => { syncEl.textContent = t; };
function syncAllowed() { const u = cloud.user; return !!u && S.get().syncOffFor !== u.uid; }
function scheduleSync() {
  if (!syncAllowed()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushProfile, 1200);
}
async function pushProfile() {
  if (!syncAllowed()) return;
  const uid = cloud.user.uid;
  setSync('Saving…');
  try { syncing = saveProfile(uid, S.cloudProfile()); await syncing; if (cloud.user?.uid === uid) setSync('Synced'); }
  catch (e) { console.warn('sync failed', e); setSync(navigator.onLine ? 'Not synced' : 'Offline'); }
  finally { syncing = null; }
}
async function onSignedIn(user) {
  if (!user) { setSync(cloud.enabled ? '' : ''); render(); return; }
  if (!syncAllowed()) { setSync('Sync off'); render(); return; }
  setSync('Syncing…');
  try {
    const doc = await loadProfile(user.uid);
    if (cloud.user?.uid !== user.uid) return;
    S.mergeCloud(doc);
    await pushProfile();
  } catch (e) { console.warn(e); setSync('Not synced'); }
  if (!ui.reading) render();
}

let shareTimer = null;
function shareNow() {
  if (!cloud.enabled || !S.get().consent || !S.get().rounds.length) return;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(async () => {
    try { await shareSession(S.get().sessionId, S.sharedSession()); }
    catch (e) { console.warn('share failed', e?.message); }
  }, 800);
}
async function consentChanged(on) {
  if (on) { shareNow(); toast('Thank you. Your anonymous picks will be shared.'); return; }
  const old = S.get().sessionId;
  S.update((s) => { s.sessionId = S.newId(24); }, { retrain: false, sync: false });
  if (!cloud.enabled) return;
  try { await shareSession(old, null); toast('Removed what you shared.'); }
  catch (e) { toast('Could not remove it right now. Try again later.'); S.update((s) => { s.consent = false; s.sessionId = old; }, { retrain: false, sync: false }); }
}

// ───────── events ─────────
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'pick' || a === 'never') togglePick(el.dataset.id, a);
  else if (a === 'reveal') finishRound();
  else if (a === 'next') { ui.reveal = null; render(); window.scrollTo(0, 0); }
  else if (a === 'stop') { ui.reveal = null; }
  else if (a === 'google') {
    // straight from the click, nothing awaited first: browsers block the window otherwise
    signInGoogle().then((u) => { if (u) toast('Signed in'); }).catch((err) => toast(err.message));
  } else if (a === 'email-mode') { ui.authMode = 'email'; render(); document.getElementById('em')?.focus(); }
  else if (a === 'signout') signOut().then(() => { setSync(''); toast('Signed out'); });
  else if (a === 'retry-cloud') { initCloud().then(render); }
  else if (a === 'sync-on') { S.update((s) => { s.syncOffFor = null; }, { retrain: false, sync: false }); onSignedIn(cloud.user); }
  else if (a === 'cancel-read') { ui.readToken++; ui.reading = null; render(); }
  else if (a === 'order-mode') { ui.orderMode = !ui.orderMode; render(); }
  else if (a === 'ordered') changeOrder(currentRoute()[1], el.dataset.id, 'ordered');
  else if (a === 'rate') changeOrder(currentRoute()[1], el.dataset.id, 'rate', el.dataset.v === '1');
  else if (a === 'export') exportProfile();
  else if (a === 'delete-cloud') deleteCloud();
  else if (a === 'reset') {
    if (!confirm('Clear your answers, training and menus from this device? This cannot be undone.')) return;
    const old = S.get();
    if (old.consent && cloud.enabled) shareSession(old.sessionId, null).catch(() => {});
    S.replaceAll({ syncOffFor: cloud.user?.uid ?? null });
    toast('Cleared on this device'); location.hash = '#/';
    render();
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'photo' && el.files?.[0]) { const f = el.files[0]; el.value = ''; startReading({ file: f }); }
  else if (el.dataset.action === 'consent') { S.update((s) => { s.consent = el.checked; }, { retrain: false, sync: false }); consentChanged(el.checked); }
});
app.addEventListener('toggle', (e) => { if (e.target.dataset?.action === 'text-toggle') ui.textOpen = e.target.open; }, true);
app.addEventListener('input', (e) => {
  if (e.target.dataset.action === 'search') {
    ui.search = e.target.value;
    const meal = S.get().meals.find((m) => m.id === currentRoute()[1]);
    if (meal) document.getElementById('dish-list').innerHTML = mealList(meal);
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'intake') saveIntake(f);
  else if (f.id === 'menu-text') {
    const text = String(new FormData(f).get('text') ?? '').trim();
    if (text.length < 3) { toast('Type or paste a few dishes first.'); return; }
    startReading({ text });
  } else if (f.id === 'email-auth') {
    const fd = new FormData(f), mode = e.submitter?.value ?? 'in';
    const email = String(fd.get('email') ?? '').trim(), password = String(fd.get('password') ?? '');
    try {
      if (mode === 'reset') { if (!email) return toast('Type your email first.'); await resetPassword(email); toast('If that email has an account, a reset link is on its way.'); return; }
      if (!email || password.length < 6) { toast('Enter your email and a password of at least 6 characters.'); return; }
      if (mode === 'up') await signUpEmail(email, password); else await signInEmail(email, password);
      toast('Signed in'); ui.authMode = 'none';
    } catch (err) { toast(err.message); }
  }
});

function exportProfile() {
  const s = S.get();
  const data = { app: 'MyPalette', exportedAt: new Date().toISOString(), intake: s.intake, rounds: s.rounds, meals: s.meals, feedback: s.feedback, weights: S.getModel().w };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = 'mypalette-profile.json';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function deleteCloud() {
  if (!confirm('Delete your MyPalette profile and saved menus from your account? The copy in this browser stays. This cannot be undone.')) return;
  const uid = cloud.user?.uid;
  clearTimeout(syncTimer);
  try {
    await syncing?.catch(() => {});
    S.update((s) => { s.syncOffFor = uid; }, { retrain: false, sync: false });
    const res = await deleteCloudData();
    toast(res.accountDeleted ? 'Deleted, and signed out.' : 'Deleted from your account. Sync is off.');
    setSync(res.accountDeleted ? '' : 'Sync off');
  } catch (e) {
    S.update((s) => { s.syncOffFor = null; }, { retrain: false, sync: false });
    toast(e.message || 'Could not delete right now.');
  }
  render();
}

// ───────── start ─────────
S.store.addEventListener('change', (e) => { if (e.detail?.sync) scheduleSync(); });
cloud.addEventListener('ready', () => { if (['menu', 'you'].includes(route)) render(); });
cloud.addEventListener('user', (e) => onSignedIn(e.detail));
window.addEventListener('online', () => { if (route === 'menu') render(); });
window.addEventListener('offline', () => { if (route === 'menu') render(); });
if (emulator) setSync('Emulator');
render();
initCloud();
