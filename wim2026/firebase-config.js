// ---------------------------------------------------------------------------
// FIREBASE SETUP  --  fill this in once (see README.md, step by step).
//
// 1. Go to https://console.firebase.google.com  and create a free project.
// 2. In the project, click the </> (Web) icon to register a web app.
// 3. Firebase shows you a "firebaseConfig" object -- copy its values below,
//    replacing every PASTE_... placeholder.
// 4. In the left menu open "Build > Firestore Database" and create a database.
// 5. Paste the security rules from README.md into the Firestore "Rules" tab.
//
// Until this file is filled in, the app shows a setup screen instead of the
// brackets.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'AIzaSyAFtvhL5lvs3NfGQ1s6qYv4Uh5Ue1yllwA',
  authDomain: 'tennis-bracket-2026-rg.firebaseapp.com',
  projectId: 'tennis-bracket-2026-rg',
  storageBucket: 'tennis-bracket-2026-rg.firebasestorage.app',
  messagingSenderId: '546112197853',
  appId: '1:546112197853:web:1c96990e5c37a6d7a7f734',
  measurementId: 'G-MVT3PQSY1F',
};

// The commissioner password gates results entry and locking the brackets.
// Change this to something only you (the family commissioner) know.
// Note: this is a light gate to prevent accidental edits, not real security.
export const COMMISSIONER_PASSWORD = 'Serve1221!';
