// The public Firebase web config for this site. Both values are public (not secrets) and are
// pasted from the Firebase console of the shared project (backend: github.com/ngcoding10/backend-combination):
//   firebaseConfig   Project settings → General → Your apps → Web app → "Config"
//   appCheckSiteKey  App Check → Apps → this web app → reCAPTCHA Enterprise site key
// While firebaseConfig is null the app works signed-out: intake, training rounds and the learner all
// run in this browser. Reading a menu photo needs sign-in, so it explains that it is not set up yet.
export const firebaseConfig = {
  apiKey: 'AIzaSyBS9L5-lAQXibNvtXDXDeBDRXVIWRIg7v0',
  authDomain: 'combination-23e84.firebaseapp.com',
  projectId: 'combination-23e84',
  storageBucket: 'combination-23e84.firebasestorage.app',
  messagingSenderId: '102320113071',
  appId: '1:102320113071:web:a5bcb17141bd1652181b5a',
};
export const appCheckSiteKey = '6LeG7S4uAAAAABOlsa7JG8j-B_Cy7d9EWDMP8iJH';
