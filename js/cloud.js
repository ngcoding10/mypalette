// Optional sign-in and sync through the shared core (js/core.js, copied unchanged from the backend).
// Signed out, nothing here loads and everything stays in this browser.
// Signed in: the taste profile syncs to palette_users/{uid}, meals to palette_users/{uid}/meals,
// and menus are read by the paletteReadMenu Cloud Function.
// Backend: github.com/ngcoding10/backend-combination (rules, functions, tests).
import { firebaseConfig, appCheckSiteKey } from './config.js';
import { createCore, loadSdkFromCdn, wantsEmulator } from './core.js';

const APP = 'palette';
/** Local testing only: localhost + ?emulator in the address talks to the Firebase emulators. */
export const emulator = wantsEmulator('mypalette'); // remembers ?emulator for the tab under "mypalette.emulator"

export const cloud = new EventTarget();
cloud.enabled = !!firebaseConfig || emulator; // false until the owner pastes the web config
cloud.ready = false;  // the core has loaded: the sign-in button can work
cloud.failed = false; // the Firebase SDK could not be loaded (offline, blocked)
cloud.user = null;

let core = null, loading = null;
const fire = (name, detail) => cloud.dispatchEvent(new CustomEvent(name, { detail }));

export const getCore = () => core;

/** Load Firebase once, at startup, so that sign-in can open straight from a click. */
export function initCloud() {
  if (!cloud.enabled) return Promise.resolve(null);
  if (loading) return loading;
  cloud.failed = false;
  loading = (async () => {
    try {
      core = createCore({ appName: APP, sdk: await loadSdkFromCdn(), config: firebaseConfig, appCheckSiteKey, emulator });
      if (emulator) window.__emuSignIn = (email, name) => core.emulatorSignIn(email, name).then((u) => u.uid);
      cloud.ready = true;
      fire('ready');
      core.onUser((u) => { cloud.user = u ? { uid: u.uid, name: u.name, email: u.email } : null; fire('user', cloud.user); });
    } catch (e) {
      console.warn('Firebase failed to load', e);
      loading = null; cloud.failed = true;
      fire('ready');
    }
    return core;
  })();
  return loading;
}

/** Google sign-in. Called straight from the click handler: nothing is awaited before the window opens. */
export function signInGoogle() {
  if (!core) return Promise.reject(Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { code: 'not-ready' }));
  return core.signInWithGoogle();
}
export const signInEmail = (email, password) => core.signInWithEmail(email, password);
export const signUpEmail = (email, password) => core.signUpWithEmail(email, password);
export const resetPassword = (email) => core.resetPassword(email);
export const signOut = () => core?.signOut();

const profileRef = (uid) => core.F.doc(core.db, 'palette_users', uid);

/** The saved profile document, or null. */
export async function loadProfile(uid) {
  const snap = await core.F.getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}

/** Save the profile (intake, weights, stats, history JSON). Shape checked by the backend rules. */
export function saveProfile(uid, { intake, weights, stats, history }) {
  return core.F.setDoc(profileRef(uid), { intake, weights, stats, history, updatedAt: core.F.serverTimestamp() });
}

export async function saveMeal(uid, id, meal) {
  await core.F.setDoc(core.F.doc(core.db, 'palette_users', uid, 'meals', id), { ...meal, createdAt: core.F.serverTimestamp() });
}
export async function updateMeal(uid, id, fields) {
  await core.F.updateDoc(core.F.doc(core.db, 'palette_users', uid, 'meals', id), fields);
}

/** Read a menu photo (base64 JPEG) or typed text. Can take 10-30 seconds or more. */
export function readMenu(payload) {
  return core.call('paletteReadMenu', payload, { timeout: 300_000 });
}

/** Store or withdraw this browser's anonymous training session (only with consent). */
export async function shareSession(id, session) {
  if (!core) await initCloud();
  if (!core) throw new Error('Sharing is not available right now.');
  return core.call('paletteShareSession', session ? { id, session } : { id, remove: true }, { timeout: 30_000 });
}

/** Delete this person's MyPalette data in the cloud. Signs out if no other app has data for them. */
export const deleteCloudData = () => core.deleteMyData('palette');
