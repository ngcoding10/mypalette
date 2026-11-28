// MyPalette page logic: intake, training rounds, reading a menu, profile and account.
// Plain ES modules, no build step. Views are small HTML strings; clicks are handled by delegation.
import { menuById } from './menus.js';
import { LABELS } from './schema.js';
import { conflicts, cautions } from './rules.js';
import { chipLabel, entryOf, parseList, suggest } from './foods.js';
import { dislikeNotes, learnedLine, profileForServer, rank, skippedWithReasons, summary, whyThis } from './learner.js';
import { entryHtml, kickerOf, priceText, sectionsOf, sectionsOfReading, sheetHtml, styleForCuisine } from './menu-view.js';
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
  fix: null,             // { field, i }: the chip whose "did you mean" panel is open
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
  if (name !== 'intake' && name !== 'train' && S.get().intake && S.get().draft) S.update((st) => { st.draft = null; }, { retrain: false, sync: false });
  const view = { home: viewHome, train: viewTrain, intake: viewIntake, menu: viewMenu, meal: () => viewMeal(arg), you: viewYou }[name] ?? viewHome;
  app.innerHTML = view();
  document.body.classList.toggle('has-bar', !!document.getElementById('bar'));
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
    ? `<div class="card"><h2>Start in a minute</h2><p class="muted">Tell it the foods you like and don’t, any allergies, and how much heat you like. Then on 10 sample menus it shows its top 3 for you, you pick yours, and it learns from the difference.</p><a class="btn primary block" href="#/train">Teach it what you like</a></div>`
    : `<div class="card"><div class="row"><div class="grow"><div class="muted small">Your palette</div><div class="stat">${st.rounds} ${st.rounds === 1 ? 'menu' : 'menus'}</div></div>${st.rounds ? `<div><div class="muted small">Picks it guessed</div><div class="stat">${pct(st.share)}</div></div>` : ''}</div>
       ${likes.length ? `<p class="muted small" style="margin-top:10px">Leaning towards</p><div class="chips">${likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('')}</div>` : '<p class="muted">Do a few rounds so it can learn what you like.</p>'}
       <div class="row" style="margin-top:14px"><a class="btn" href="#/train">${S.phase() === 'round' ? 'Continue the menus' : 'See your training'}</a><a class="btn quiet" href="#/you">Your profile</a></div></div>`;
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
      <li>Type the foods you like and don’t, your allergies and diet, and how much heat you like. Typos are fine.</li>
      <li>On 10 sample menus it shows its top 3 for you, then you pick yours. It learns from the difference, and you see its score climb.</li>
      <li>At a restaurant, take a photo of the menu. You get your top 3, why, and what every dish actually is.</li>
    </ol>
  </section>`;
}

// ───────── chip inputs: likes, dislikes, allergies and diets, cuisines ─────────
const FIELDS = {
  likes: { kind: 'food', label: 'Foods you like', hint: 'Type as many as you like, separated by commas, then press Enter. Spelling does not have to be right.', placeholder: 'e.g. broccoli, tomato, pad thai, salmon' },
  dislikes: { kind: 'food', label: 'Foods you don’t like', hint: 'Same idea. These count against a dish, but never rule it out: a dish where it is only a garnish or a side can still be a top pick, with a note that you could ask to leave it out. Allergies go in the next box.', placeholder: 'e.g. mushrooms, olives, cilantro' },
  restrictions: { kind: 'restriction', label: 'Allergies and dietary restrictions', hint: 'Strict: a dish that likely contains an allergy is never suggested, and unclear dishes get a warning. Diets work the same way.', placeholder: 'e.g. peanut allergy, celiac, vegetarian, halal' },
  cuisineChips: { kind: 'cuisine', label: 'Cuisines you love', hint: 'Optional.', placeholder: 'e.g. thai, mexican, italian' },
};
const SPICE = ['None', 'Mild', 'Medium', 'Hot'];
const ADVENTURE = ['Familiar food', 'A bit of both', 'Surprise me'];
const STEPS = [['likes'], ['dislikes'], ['restrictions'], ['heat'], ['cuisineChips']];

/** The answers being edited: the saved draft, or a copy of the saved intake. */
function draft() {
  const s = S.get();
  if (s.draft) return s.draft;
  const i = s.intake;
  return i ? { step: 0, likes: i.likes, dislikes: i.dislikes, restrictions: i.restrictions, cuisineChips: i.cuisineChips, spice: i.spice, adventure: i.adventure, name: i.name ?? '' } : S.blankDraft();
}
function setDraft(fn) { S.update((s) => { const d = structuredClone(draft()); fn(d); s.draft = d; }, { retrain: false, sync: false }); }

function chipHtml(c, field, i) {
  const kind = FIELDS[field].kind;
  const label = chipLabel(c, kind);
  const allergy = kind === 'restriction' && entryOf(c.k, 'restriction')?.spec.A;
  const cls = c.s === 'unknown' ? 'unknown' : c.s === 'fixed' ? 'fixed' : '';
  const note = c.s === 'unknown' ? '<span class="ce-note">not recognised</span>' : c.s === 'fixed' ? `<span class="ce-note">from “${esc(c.t)}”</span>` : '';
  const open = ui.fix?.field === field && ui.fix.i === i;
  return `<li class="ce ${cls} ${allergy ? 'allergy' : ''} ${open ? 'open' : ''}"><button type="button" class="ce-main" data-action="chip-tap" data-field="${field}" data-i="${i}" aria-expanded="${open}" aria-label="${esc(label)}${c.s === 'fixed' ? `, corrected from ${esc(c.t)}` : c.s === 'unknown' ? ', not recognised' : ''}. Tap to change"><span class="ce-label">${esc(label)}</span>${note}</button><button type="button" class="ce-x" data-action="chip-remove" data-field="${field}" data-i="${i}" aria-label="Remove ${esc(label)}">×</button></li>`;
}

function fixPanel(field) {
  const f = ui.fix;
  if (!f || f.field !== field) return '';
  const c = draft()[field][f.i];
  if (!c) return '';
  const kind = FIELDS[field].kind;
  const options = suggest(c.t, kind, 5).filter((o) => o.k !== c.k);
  return `<div class="fix" role="group" aria-label="Change ${esc(chipLabel(c, kind))}">
    <p class="small">You typed <b>“${esc(c.t)}”</b>${c.k ? `. It reads that as <b>${esc(chipLabel(c, kind))}</b>.` : '. It does not know that one, so it is kept as you typed it and matched word for word.'}</p>
    ${options.length ? `<p class="small muted" style="margin:6px 0">Did you mean</p><div class="chips">${options.map((o) => `<button type="button" class="chip pickable" data-action="chip-choose" data-field="${field}" data-k="${esc(o.k)}">${esc(kind === 'restriction' && o.k.startsWith('food:') ? `No ${o.label}` : o.label)}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:10px">${c.k ? `<button type="button" class="btn small-btn" data-action="chip-keep" data-field="${field}">Keep “${esc(c.t)}” as typed</button>` : ''}<button type="button" class="btn small-btn" data-action="chip-remove" data-field="${field}" data-i="${f.i}">Remove</button><button type="button" class="btn quiet small-btn" data-action="chip-close">Done</button></div>
  </div>`;
}

function chipBox(field) {
  const F = FIELDS[field];
  const list = draft()[field] ?? [];
  return `<div class="chipbox" id="box-${field}" data-field="${field}">
    <div class="entry"><label class="sr" for="in-${field}">${esc(F.label)}</label>
      <input id="in-${field}" type="text" data-chip-input="${field}" placeholder="${esc(F.placeholder)}" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" maxlength="400">
      <button type="button" class="btn" data-action="chip-add" data-field="${field}">Add</button></div>
    <ul class="ce-list" aria-live="polite">${list.map((c, i) => chipHtml(c, field, i)).join('')}</ul>
    ${list.some((c) => c.s !== 'ok') ? '<p class="hint" style="margin:6px 0 0">Tap a chip to fix a wrong guess.</p>' : ''}
    ${fixPanel(field)}
  </div>`;
}
function rerenderBox(field, focus = false) {
  const el = document.getElementById(`box-${field}`);
  if (!el) return;
  const input = el.querySelector('input');
  const typed = input?.value ?? '';
  el.outerHTML = chipBox(field);
  const again = document.getElementById(`in-${field}`);
  if (again) { again.value = typed; if (focus) again.focus(); }
}

/** Turn what is in the box into chips (comma separated, spelling corrected), and empty the box. */
function addChips(field) {
  const input = document.getElementById(`in-${field}`);
  const text = input?.value ?? '';
  if (!text.trim()) return 0;
  const found = parseList(text, FIELDS[field].kind);
  setDraft((d) => {
    const list = d[field] ?? [];
    for (const c of found) if (!list.some((x) => (x.k && x.k === c.k) || (!x.k && !c.k && x.t.toLowerCase() === c.t.toLowerCase()))) list.push(c);
    d[field] = list.slice(0, 40);
  });
  input.value = '';
  ui.fix = null;
  rerenderBox(field, true);
  const fixed = found.filter((c) => c.s === 'fixed').length, unknown = found.filter((c) => c.s === 'unknown').length;
  if (fixed || unknown) announce(`${found.length} added. ${fixed ? `${fixed} spelling corrected. ` : ''}${unknown ? `${unknown} not recognised, kept as typed.` : ''}`);
  return found.length;
}
const announce = (t) => { const el = document.getElementById('sr-live'); if (el) el.textContent = t; };
const addPending = () => { for (const f of Object.keys(FIELDS)) addChips(f); };

function heatBlock(d) {
  const seg = (name, labels, value) => `<div class="seg" style="--n:${labels.length}">${labels.map((l, k) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''} data-action="seg"><span>${esc(l)}</span></label>`).join('')}</div>`;
  return `<fieldset><legend>How much heat do you like?</legend>${seg('spice', SPICE, d.spice ?? 1)}</fieldset>
    <fieldset><legend>How adventurous are you?</legend>${seg('adventure', ADVENTURE, d.adventure ?? 1)}</fieldset>`;
}
const fieldBlock = (field, h = 'legend') => `<fieldset><${h === 'h1' ? 'h1' : 'legend'} class="${h === 'h1' ? 'qtitle' : ''}">${esc(FIELDS[field].label)}</${h === 'h1' ? 'h1' : 'legend'}><p class="hint">${esc(FIELDS[field].hint)}</p>${chipBox(field)}</fieldset>`;
const consentBox = () => `<label class="check"><input type="checkbox" name="consent" data-action="consent" ${S.get().consent ? 'checked' : ''} ${cloud.enabled ? '' : 'disabled'}><span><b>Help improve MyPalette by sharing my anonymous choices.</b><br><span class="small muted">Your rule and heat answers (not the foods you typed) and your picks on the sample menus, under a random id. Never your photos. Untick any time to remove them.${cloud.enabled ? '' : ' Sharing starts once sign-in is set up on this site.'}</span></span></label>`;

/** First time: one question per screen. */
function viewWizard() {
  const d = draft();
  const step = Math.min(d.step ?? 0, STEPS.length - 1);
  const [what] = STEPS[step];
  const body = what === 'heat' ? `<h1 class="qtitle">Heat and adventure</h1><p class="hint">Two quick taps.</p>${heatBlock(d)}`
    : what === 'cuisineChips' ? `${fieldBlock('cuisineChips', 'h1')}${consentBox()}`
    : fieldBlock(what, 'h1');
  return `
  <div class="stepper" aria-label="Step ${step + 1} of ${STEPS.length}"><span class="muted small">Step ${step + 1} of ${STEPS.length}</span><span class="dots">${STEPS.map((_, k) => `<i class="${k < step ? 'done' : k === step ? 'now' : ''}"></i>`).join('')}</span></div>
  <form id="wizard" class="card q" novalidate>${body}
    <div class="row navrow">${step ? '<button class="btn" type="button" data-action="wiz-back">Back</button>' : ''}<span class="grow"></span>
      <button class="btn primary" type="submit">${step === STEPS.length - 1 ? 'Start the menus' : 'Next'}</button></div>
  </form>
  ${step === 0 ? '<p class="small muted center">About a minute. Next, it shows you sample menus, guesses your top 3 and learns from your picks.</p>' : ''}`;
}

/** Later: every answer on one page. */
function viewEditIntake() {
  const d = draft();
  return `
  <h1>Your answers</h1>
  <p class="muted">Change anything. Your picks on the sample menus are kept.</p>
  <form id="intake" class="card" novalidate>
    <fieldset><legend><label for="nick">Name or nickname</label></legend><p class="hint">Optional. Only shown to you.</p>
      <input id="nick" type="text" name="name" maxlength="40" autocomplete="nickname" value="${esc(d.name ?? S.get().intake?.name ?? '')}"></fieldset>
    ${fieldBlock('likes')}${fieldBlock('dislikes')}${fieldBlock('restrictions')}${heatBlock(d)}${fieldBlock('cuisineChips')}
    ${consentBox()}
    <div class="actions" style="margin-top:18px"><button class="btn primary big" type="submit">Save</button><a class="btn block" href="#/you" data-action="discard">Cancel</a></div>
  </form>`;
}
const viewIntake = () => (S.get().intake ? viewEditIntake() : viewWizard());

function readSegs(form) {
  const fd = new FormData(form);
  return { spice: fd.has('spice') ? Number(fd.get('spice')) : undefined, adventure: fd.has('adventure') ? Number(fd.get('adventure')) : undefined };
}
function wizardNext(form, back = false) {
  addPending();
  const seg = readSegs(form);
  setDraft((d) => {
    if (seg.spice !== undefined) d.spice = seg.spice;
    if (seg.adventure !== undefined) d.adventure = seg.adventure;
    d.step = Math.max(0, Math.min(STEPS.length - 1, (d.step ?? 0) + (back ? -1 : 1)));
  });
  ui.fix = null;
  render(); window.scrollTo(0, 0);
}
function finishIntake(extra = {}) {
  addPending();
  const d = draft();
  const first = !S.get().intake;
  S.saveIntake({ ...d, ...extra, name: extra.name ?? d.name ?? S.get().intake?.name ?? '' });
  ui.fix = null;
  if (S.get().consent) shareNow();
  if (first) { location.hash = '#/train'; render(); } else { toast('Saved'); location.hash = '#/you'; }
}

// ───────── training: its guess, your top 3, what it learned ─────────
function viewTrain() {
  const s = S.get();
  if (!s.intake) return viewWizard();
  if (ui.reveal) return viewReveal(ui.reveal);
  const ph = S.phase();
  if (ph === 'offer') return viewOffer();
  if (ph === 'done') return viewTrainDone();
  const pending = S.startRound();
  if (!pending) return viewTrainDone();
  const menu = menuById(pending.menu);
  const n = s.rounds.length + 1, of = s.target;
  const byId = (id) => menu.dishes.find((d) => d.id === id);
  const st = S.stats();
  const model = S.getModel(), intake = s.intake;
  afterRender = () => { renderBar(); document.body.classList.add('has-bar'); };
  const head = { name: menu.name, tagline: menu.tagline, kicker: kickerOf(menu), style: menu.style };
  return `
  <div class="roundhead"><span class="muted small">Menu ${n} of ${of}</span><button class="btn quiet small-btn" type="button" data-action="stop">Finish</button></div>
  <div class="progressbar" aria-hidden="true"><i style="width:${Math.round(((n - 1) / of) * 100)}%"></i></div>
  ${st.rounds ? `<p class="scoreline small">So far it has guessed <b>${st.got} of your ${st.of}</b> picks.${scoreDots(st)}</p>` : ''}
  <section class="guesscard" aria-labelledby="g-h">
    <h2 id="g-h" class="small-h">Our top 3 for you</h2>
    <ol class="guess">${pending.predicted.map((id, k) => guessItem(byId(id), k, model, intake)).join('') || '<li class="muted">Nothing here fits your rules.</li>'}</ol>
  </section>
  <h2 class="pickhead" id="pick-h">Now pick your own top 3</h2>
  <p class="muted small" style="margin-top:-6px">Tap the dishes you would order here. It learns from where you and it differ.</p>
  ${sheetHtml(head, sectionsOf(menu), (d) => trainEntry(d, pending, model, intake), { id: 'm' })}
  ${skippedBlock(model, menu.dishes, intake, pending.predicted)}
  <p class="muted small center" style="margin-top:18px">Nothing here for you? <button class="btn quiet small-btn" type="button" data-action="skip-menu">Skip this menu</button></p>
  <div class="bar" id="bar"></div>`;
}

const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** "Why this" in one line, from the learner's strongest reasons (or the menu reader's, for a photo). */
function whyLine(model, d, intake, fallback = '') {
  const why = whyThis(model, d, intake, 3);
  const text = why.length ? `${capFirst(why.join('; '))}.` : fallback || 'A good all-round match for your answers.';
  return `<p class="why"><b>Why this:</b> ${esc(text)}</p>`;
}
const noteLines = (notes) => notes.map((x) => `<p class="enote ${x.removable ? 'n-leave' : 'n-firm'}">${esc(x.text)}</p>`).join('');

function guessItem(d, k, model, intake) {
  if (!d) return '';
  return `<li><span class="n" aria-hidden="true">${k + 1}</span><div class="grow"><div class="gline"><span class="sr">Our pick ${k + 1}: </span><b class="gname">${esc(d.name)}</b>${d.price ? `<span class="price small">${esc(priceText(d.price))}</span>` : ''}</div>
    ${whyLine(model, d, intake)}${noteLines(dislikeNotes(model, d))}</div></li>`;
}

function trainEntry(d, pending, model, intake) {
  const blocked = conflicts(d, intake);
  const warn = blocked.length ? [] : cautions(d, intake);
  const notes = blocked.length ? [] : dislikeNotes(model, d).map((x) => ({ cls: x.removable ? 'n-leave' : 'n-firm', text: x.text }));
  return entryHtml(d, {
    mode: 'pick', picked: pending.picked.indexOf(d.id), ours: pending.predicted.indexOf(d.id), blocked,
    notes: [...notes, ...warn.slice(0, 1).map((w) => ({ cls: 'n-warn', text: w.text }))],
  });
}

/** "Show dishes we skipped and why": a toggle under the menu. */
function skippedBlock(model, dishes, intake, topIds) {
  const list = skippedWithReasons(model, dishes, intake, topIds);
  if (!list.length) return '';
  return `<details class="skipped" ${ui.showSkipped ? 'open' : ''} data-action="skipped-toggle"><summary>Show dishes we skipped and why <span class="muted">(${list.length})</span></summary>
    <ul class="skiplist">${list.map((x) => `<li class="${x.kind}"><b>${esc(x.dish.name)}</b><span>${esc(x.text)}</span></li>`).join('')}</ul></details>`;
}

function scoreDots(st) {
  const last = st.series.slice(-12);
  return ` <span class="dotsrow" aria-label="Per menu: ${last.map((x) => `${x.got} of ${x.of}`).join(', ')}">${last.map((x) => `<i class="d${Math.min(3, x.got)}" title="${x.got} of ${x.of}"></i>`).join('')}</span>`;
}

function renderBar() {
  const bar = document.getElementById('bar');
  const p = S.get().pending;
  if (!bar || !p) return;
  const k = p.picked.length;
  bar.innerHTML = `<div class="wrap"><span class="count">${k ? `${k} of 3 picked` : 'Pick your top 3'}</span><button class="btn primary" type="button" data-action="lock" ${k ? '' : 'disabled'}>${k === 3 ? 'Lock in my 3' : k ? `Lock in ${k}` : 'Lock in'}</button></div>`;
}

function onPick(id) {
  if (!S.togglePick(id)) { toast('That is 3. Tap one of your picks to swap it out.'); return; }
  const q = S.get().pending;
  for (const row of app.querySelectorAll('.entry[data-dish]')) {
    const did = row.dataset.dish, k = q.picked.indexOf(did), on = k >= 0;
    row.classList.toggle('on', on);
    row.querySelector('.entry-tap')?.setAttribute('aria-pressed', String(on));
    const c = row.querySelector('.check'); if (c) c.textContent = on ? k + 1 : '';
    const y = row.querySelector('.yours'); if (y) y.textContent = on ? `Your pick #${k + 1}` : '';
  }
  renderBar();
}

function lockIn() {
  const round = S.finishRound();
  if (!round) return;
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
  const { got, of } = S.roundScore(r);
  const st = S.stats();
  const allPicks = s.rounds.flatMap((x) => x.picked.map((id) => menuById(x.menu)?.dishes.find((d) => d.id === id)).filter(Boolean));
  const line = learnedLine(S.getModel(), allPicks);
  const missed = r.predicted.filter((id) => !r.picked.includes(id));
  const ph = S.phase();
  const head = got === of ? `It guessed all ${of} of your picks.` : got ? `It guessed ${got} of your ${of}.` : `It guessed none of your ${of}.`;
  const trend = st.rounds >= 6 ? `<p class="small muted" style="margin:6px 0 0">First 3 menus: ${pct(st.first)} of picks guessed. Last 3: ${pct(st.last)}.</p>` : '';
  return `
  <div class="verdict ${got ? 'hit' : 'miss'}" role="status">
    <div class="score-big" aria-hidden="true">${got}<span>/${of}</span></div>
    <div><h2>${head}</h2><p class="muted" style="margin:0">${got ? 'It learns from the ones it missed too.' : 'A miss teaches it the most.'}</p></div>
  </div>
  <h3>Your picks</h3>
  <ol class="guess">${r.picked.map((id) => `<li class="${r.predicted.includes(id) ? 'match' : ''}"><span class="n">${r.predicted.includes(id) ? '✓' : '·'}</span><span class="grow">${esc(byId(id)?.name)}</span>${r.predicted.includes(id) ? '<span class="chip good">it guessed this</span>' : ''}</li>`).join('')}</ol>
  ${missed.length ? `<p class="small muted" style="margin-top:8px">It also guessed: ${missed.map((id) => esc(byId(id)?.name)).join(', ')}.</p>` : ''}
  <div class="card section">
    <div class="muted small">What it learned</div>
    <p class="learned">${esc(line)}</p>
    <div class="muted small" style="margin-top:12px">Running score</div>
    <div class="bars" aria-hidden="true">${st.series.map((x) => `<i style="height:${Math.round(10 + 90 * (x.of ? x.got / x.of : 0))}%"></i>`).join('')}</div>
    <div><b>${st.got} of ${st.of}</b> of your picks guessed over ${st.rounds} ${st.rounds === 1 ? 'menu' : 'menus'} (${pct(st.share)}).</div>
    ${trend}
  </div>
  <div class="actions section">
    ${ph === 'round' ? '<button class="btn primary big" type="button" data-action="next">Next menu</button><button class="btn block" type="button" data-action="stop">Finish here</button>'
      : ph === 'offer' ? offerButtons() : '<button class="btn primary big" type="button" data-action="next">See what it learned</button>'}
  </div>`;
}

const offerButtons = () => `<div class="offer card"><h2 style="margin:0 0 4px">That is ${S.get().rounds.length}. Nice.</h2><p class="muted" style="margin:0 0 12px">It already works for real menus. Keep going for better accuracy, up to ${S.MAX_ROUNDS} menus. You can stop at any time.</p>
  <div class="actions"><button class="btn primary big" type="button" data-action="keep-going">Keep going</button><button class="btn block" type="button" data-action="stop">I'm done for now</button></div></div>`;

function viewOffer() {
  const st = S.stats();
  return `<h1>${st.rounds} menus done</h1><p class="muted">It guessed ${st.got} of your ${st.of} picks (${pct(st.share)}).</p>${offerButtons()}`;
}

function viewTrainDone() {
  const st = S.stats(), sm = summary(S.getModel());
  const left = S.MAX_ROUNDS - st.rounds;
  return `
  <h1>${st.rounds ? 'Your palette is ready' : 'Ready when you are'}</h1>
  <p class="muted">${st.rounds ? `Over ${st.rounds} ${st.rounds === 1 ? 'menu' : 'menus'} it guessed <b>${st.got} of your ${st.of}</b> picks (${pct(st.share)}).${st.rounds >= 6 ? ` First 3 menus ${pct(st.first)}, last 3 ${pct(st.last)}.` : ''}` : 'Your answers are saved. It will lean on them until you do a few menus.'} It keeps learning from the real meals you rate.</p>
  <div class="card"><h3>What it thinks you like</h3><div class="chips">${sm.likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('') || '<span class="muted small">Nothing clear yet</span>'}</div>
  ${sm.dislikes.length ? `<h3 style="margin-top:14px">And less so</h3><div class="chips">${sm.dislikes.map((l) => `<span class="chip bad">${esc(l)}</span>`).join('')}</div>` : ''}</div>
  <div class="actions section"><a class="btn primary big" href="#/menu">${ICON.camera} Read a real menu</a>
  ${left > 0 && S.menusLeft() > 0 ? `<button class="btn block" type="button" data-action="train-more">Do more sample menus (${Math.min(left, S.menusLeft())} left)</button>` : ''}
  <a class="btn block quiet" href="#/you">See your profile</a></div>`;
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
    ${!s.rounds.length ? '<p class="notice info small" style="margin-top:12px">It has not seen your picks yet, so it leans on your answers and general appeal. <a href="#/train">Do a few sample menus</a> for better picks.</p>' : ''}`;
  }
  return `<h1>Read a menu</h1><p class="muted">Get your top 3 and every dish explained in plain words.</p>${body}${recentHtml}`;
}

const READ_STEPS = ['Sending the photo', 'Reading every dish', 'Explaining what each one is', 'Matching to your taste'];
function viewReading() {
  const r = ui.reading;
  const t = Math.floor((Date.now() - r.started) / 1000);
  const step = t < 2 ? 0 : t < 9 ? 1 : t < 22 ? 2 : 3;
  return `<div class="card reading" aria-busy="true">
    ${r.preview ? `<img class="preview" src="${r.preview}" alt="The menu photo being read">` : ''}
    <div class="spinner" aria-hidden="true"></div>
    <h2>Reading the menu…</h2>
    <p class="muted" id="elapsed">${t} seconds. Usually 10 to 30, longer for big menus.</p>
    <ol class="progress">${READ_STEPS.map((x, k) => `<li class="${k < step ? 'done' : k === step ? 'now' : ''}">${k < step ? '✓ ' : ''}${x}</li>`).join('')}</ol>
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
  const intake = s.intake ?? {};
  const ranked = rank(model, meal.dishes, intake).filter((r) => !r.blocked.length && r.dish.course !== 'drink');
  if (!ranked.length) return [];
  const mean = ranked.reduce((a, r) => a + r.score, 0) / ranked.length;
  const sd = Math.sqrt(ranked.reduce((a, r) => a + (r.score - mean) ** 2, 0) / ranked.length) || 1;
  // With little training, lean on the model's picks; with more, lean on what this person has shown.
  const trust = 1.2 - 0.7 * Math.min(1, model.n / 10);
  const bonus = [1, 0.75, 0.5];
  const scored = ranked.map((r) => {
    const k = meal.claude.findIndex((c) => c.id === r.dish.id);
    // unclear for an allergy: still possible, but a clear dish of similar appeal comes first
    const warn = cautions(r.dish, intake);
    const unsure = warn.some((w) => w.kind === 'allergy') ? 0.6 : warn.length ? 0.2 : 0;
    return { ...r, warn, final: (r.score - mean) / sd + (k >= 0 ? trust * bonus[k] : 0) - unsure, reason: k >= 0 ? meal.claude[k].reason : '' };
  }).sort((a, b) => b.final - a.final);
  return scored.slice(0, 3);
}

function viewMeal(id) {
  const s = S.get();
  const meal = s.meals.find((m) => m.id === id);
  if (!meal) return `<h1>Menu not found</h1><p class="muted">It may have been on another device.</p><a class="btn" href="#/menu">Read a menu</a>`;
  const intake = s.intake ?? {};
  const top = topThree(meal);
  const hasAllergies = (intake.allergies ?? []).length > 0 || (intake.restrictions ?? []).length > 0;
  const model = S.getModel();
  const topHtml = top.length ? `<ol class="top3" aria-label="Our top 3">${top.map((t, k) => `<li class="pickcard">
      <span class="ours-tag">Our pick #${k + 1}</span>
      <div class="line"><span class="dname">${esc(t.dish.name)}</span><span class="leader" aria-hidden="true"></span>${t.dish.price ? `<span class="dprice">${esc(priceText(t.dish.price))}</span>` : ''}</div>
      ${t.dish.englishName && t.dish.englishName.toLowerCase() !== t.dish.name.toLowerCase() ? `<p class="dsub">${esc(t.dish.englishName)}</p>` : ''}
      <p class="ddesc">${esc(t.dish.whatItIs)}</p>
      ${whyLine(model, t.dish, intake, t.reason)}
      ${noteLines(dislikeNotes(model, t.dish))}
      ${t.dish.heatNote ? `<p class="small muted">${heatBadge(t.dish.heat, t.dish.heatNote)}</p>` : ''}
      ${t.warn.length ? `<p class="enote n-warn">${esc(t.warn.map((w) => w.text).join(' '))}</p>` : ''}
    </li>`).join('')}</ol>` : '<div class="notice info">Nothing on this menu fits your rules. Ask the staff what they can adapt.</div>';
  return `
  <div class="row"><h1 class="grow" style="font-size:30px;margin:0">Your top 3</h1><a class="btn" href="#/menu">${ICON.camera} New menu</a></div>
  <p class="muted">${esc(meal.title)} · ${meal.dishes.length} dishes read${meal.usage ? ` · ${meal.usage.used} of ${meal.usage.limit} readings used today` : ''}</p>
  ${meal.readable !== 'clear' && meal.problem ? `<div class="notice info" style="margin-bottom:12px"><strong>Partly read.</strong> ${esc(meal.problem)}</div>` : ''}
  ${hasAllergies ? `<div style="margin-bottom:12px">${safetyNote()}</div>` : ''}
  ${topHtml}
  ${skippedBlock(model, meal.dishes, intake, top.map((t) => t.dish.id))}
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
  const model = S.getModel();
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
  const top = topThree(meal).map((t) => t.dish.id);
  const head = { name: meal.title || 'Your menu', tagline: `Read from your ${meal.problem || meal.readable !== 'clear' ? 'photo (partly)' : 'photo'} · ${meal.dishes.length} dishes`, kicker: 'As read by MyPalette', style: styleForCuisine(meal.cuisine || meal.title) };
  return sheetHtml(head, sectionsOfReading(dishes), (d) => {
    const blocked = conflicts(d, intake);
    const warn = blocked.length ? [] : cautions(d, intake);
    const ordered = meal.ordered.includes(d.id);
    const rating = meal.ratings[d.id];
    const notes = [
      ...(blocked.some((b) => b.kind === 'allergy') && d.allergenNote ? [{ cls: 'n-muted', text: d.allergenNote }] : !blocked.length && d.allergenNote && (intake.allergies ?? []).length ? [{ cls: 'n-muted', text: d.allergenNote }] : []),
      ...(blocked.length ? [] : dislikeNotes(model, d).map((x) => ({ cls: x.removable ? 'n-leave' : 'n-firm', text: x.text }))),
      ...warn.map((w) => ({ cls: 'n-warn', text: w.text })),
    ];
    const rate = ui.orderMode ? `<div class="rate"><button class="btn" type="button" data-action="ordered" data-id="${d.id}" aria-pressed="${ordered}">${ordered ? 'Had this' : 'I had this'}</button>${ordered ? `<button class="btn" type="button" data-action="rate" data-id="${d.id}" data-v="1" aria-pressed="${rating === true}">Loved it</button><button class="btn" type="button" data-action="rate" data-id="${d.id}" data-v="0" aria-pressed="${rating === false}">Not for me</button>` : ''}</div>` : '';
    return entryHtml(d, {
      mode: 'view', ours: top.indexOf(d.id), picked: ordered ? 0 : -1, blocked,
      sub: d.englishName && d.englishName.toLowerCase() !== d.name.toLowerCase() ? d.englishName : '', notes, after: rate,
    });
  }, { id: 'meal' });
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
function answersSummary(i) {
  const row = (title, list, kind, cls = '') => (list?.length ? `<h3 style="margin-top:12px">${title}</h3><div class="chips">${list.map((c) => `<span class="chip ${cls} ${c.s === 'unknown' ? 'unknown' : ''}">${esc(chipLabel(c, kind))}</span>`).join('')}</div>` : '');
  return `${row('Foods you like', i.likes, 'food', 'good')}${row('Foods you don’t like', i.dislikes, 'food', 'bad')}${row('Allergies and diet', i.restrictions, 'restriction', 'rule')}
    <p class="small muted" style="margin-top:10px">Heat: ${esc(SPICE[i.spice ?? 1].toLowerCase())} · ${esc(ADVENTURE[i.adventure ?? 1].toLowerCase())}${i.cuisineChips?.length ? ` · loves ${esc(i.cuisineChips.map((c) => chipLabel(c, 'cuisine')).join(', '))}` : ''}</p>`;
}
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
    <div class="row"><div class="grow"><div class="muted small">Sample menus</div><div class="stat">${st.rounds}</div></div><div class="grow"><div class="muted small">Picks guessed</div><div class="stat">${st.rounds ? pct(st.share) : '–'}</div></div><div class="grow"><div class="muted small">Meals rated</div><div class="stat">${st.feedback}</div></div></div>
    <h3 style="margin-top:12px">Leaning towards</h3><div class="chips">${sm.likes.map((l) => `<span class="chip good">${esc(l)}</span>`).join('') || '<span class="muted small">Nothing clear yet. Do a few rounds.</span>'}</div>
    ${sm.dislikes.length ? `<h3 style="margin-top:12px">Less keen on</h3><div class="chips">${sm.dislikes.map((l) => `<span class="chip bad">${esc(l)}</span>`).join('')}</div>` : ''}
    ${i ? answersSummary(i) : ''}
    <div class="row" style="margin-top:12px"><a class="btn" href="#/intake">${i ? 'Edit my answers' : 'Answer the questions'}</a><a class="btn quiet" href="#/train">Sample menus</a></div>
  </div>
  <section class="section card"><h2>Account</h2>${account}</section>
  <section class="section card"><h2>Your data</h2>
    <label class="check"><input type="checkbox" data-action="consent" ${s.consent ? 'checked' : ''} ${cloud.enabled ? '' : 'disabled'}><span><b>Help improve MyPalette by sharing my anonymous choices.</b><br><span class="small muted">Your rule and heat answers (no name or typed foods) and your picks on the sample menus, under a random id. Unticking removes what was shared.${cloud.enabled ? '' : ' Available once sign-in is set up on this site.'}</span></span></label>
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
  // signed out (also the first answer at start-up): only pages that show the account need redrawing, and
  // redrawing the questions would drop what someone is typing
  if (!user) { setSync(''); if (['menu', 'you', 'meal'].includes(route)) render(); return; }
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
  const field = el.dataset.field;
  if (a === 'pick') onPick(el.dataset.id);
  else if (a === 'lock') lockIn();
  else if (a === 'next') { ui.reveal = null; render(); window.scrollTo(0, 0); }
  else if (a === 'stop') { S.stopTraining(); ui.reveal = null; location.hash = '#/train'; render(); window.scrollTo(0, 0); }
  else if (a === 'keep-going') { S.keepGoing(); ui.reveal = null; render(); window.scrollTo(0, 0); }
  else if (a === 'train-more') { S.trainMore(); ui.reveal = null; render(); window.scrollTo(0, 0); }
  else if (a === 'skip-menu') { S.skipMenu(); render(); window.scrollTo(0, 0); }
  else if (a === 'chip-add') addChips(field);
  else if (a === 'chip-remove') { const i = Number(el.dataset.i); setDraft((d) => { d[field].splice(i, 1); }); ui.fix = null; rerenderBox(field); }
  else if (a === 'chip-tap') { const i = Number(el.dataset.i); ui.fix = ui.fix?.field === field && ui.fix.i === i ? null : { field, i }; rerenderBox(field); document.querySelector(`#box-${field} .fix button`)?.focus(); }
  else if (a === 'chip-choose' && ui.fix) { const { i } = ui.fix; setDraft((d) => { d[field][i] = { t: d[field][i].t, k: el.dataset.k, s: 'ok' }; }); ui.fix = null; rerenderBox(field); }
  else if (a === 'chip-keep' && ui.fix) { const { i } = ui.fix; setDraft((d) => { d[field][i] = { t: d[field][i].t, k: null, s: 'unknown' }; }); ui.fix = null; rerenderBox(field); }
  else if (a === 'chip-close') { ui.fix = null; rerenderBox(field ?? el.closest('.chipbox')?.dataset.field); }
  else if (a === 'wiz-back') wizardNext(el.closest('form'), true);
  else if (a === 'discard') { S.update((s) => { s.draft = null; }, { retrain: false, sync: false }); ui.fix = null; }
  else if (a === 'google') {
    // straight from the click, nothing awaited first: browsers block the window otherwise
    signInGoogle().then((u) => { if (u) toast('Signed in'); }).catch((err) => toast(err.message));
  } else if (a === 'email-mode') { ui.authMode = 'email'; render(); document.getElementById('em')?.focus(); }
  else if (a === 'signout') signOut().then(() => { setSync(''); toast('Signed out'); });
  else if (a === 'retry-cloud') { initCloud().then(render); }
  else if (a === 'sync-on') { S.update((s) => { s.syncOffFor = null; }, { retrain: false, sync: false }); onSignedIn(cloud.user); }
  else if (a === 'cancel-read') { ui.readToken++; ui.reading = null; render(); }
  else if (a === 'order-mode') { ui.orderMode = !ui.orderMode; render(); }
  else if (a === 'skipped-toggle') return;
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

app.addEventListener('keydown', (e) => {
  const field = e.target.dataset?.chipInput;
  if (!field) return;
  if (e.key === 'Enter') { e.preventDefault(); addChips(field); }
  else if (e.key === 'Backspace' && !e.target.value) {
    // an empty box and backspace: take the last chip off, as most tag inputs do
    const list = draft()[field] ?? [];
    if (list.length) { setDraft((d) => { d[field].pop(); }); ui.fix = null; rerenderBox(field, true); }
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'photo' && el.files?.[0]) { const f = el.files[0]; el.value = ''; startReading({ file: f }); }
  else if (el.dataset.action === 'consent') { S.update((s) => { s.consent = el.checked; }, { retrain: false, sync: false }); consentChanged(el.checked); }
  else if (el.dataset.action === 'seg') setDraft((d) => { d[el.name] = Number(el.value); });
});
app.addEventListener('toggle', (e) => { if (e.target.dataset?.action === 'text-toggle') ui.textOpen = e.target.open; if (e.target.dataset?.action === 'skipped-toggle') ui.showSkipped = e.target.open; }, true);
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
  if (f.id === 'wizard') {
    if ((draft().step ?? 0) >= STEPS.length - 1) finishIntake(readSegs(f).spice === undefined ? {} : readSegs(f));
    else wizardNext(f);
  } else if (f.id === 'intake') {
    const fd = new FormData(f);
    finishIntake({ name: String(fd.get('name') ?? '').trim().slice(0, 40), ...readSegs(f) });
  } else if (f.id === 'menu-text') {
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
