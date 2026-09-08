// Firebase web app config. Filled in from `firebase apps:sdkconfig web` for the
// "Nudes PAR System" project. These values are public identifiers, not secrets;
// access is enforced by Firestore security rules (see /firestore.rules).
export const firebaseConfig = {
  apiKey: 'AIzaSyDB9rogSxG7fdlGUkfhef_5PEajn14gnAQ',
  authDomain: 'nudes-par.firebaseapp.com',
  projectId: 'nudes-par',
  storageBucket: 'nudes-par.firebasestorage.app',
  messagingSenderId: '499154769540',
  appId: '1:499154769540:web:1166e30f3a3229cc7794d1',
};

// The owner account. Always treated as admin (also hardcoded in firestore.rules)
// so the very first sign-in works before anyone is on the team list.
export const OWNER_EMAIL = 'admin@nudesyogurt.com';

// Counts roll over at midnight in this timezone.
export const TIMEZONE = 'America/Los_Angeles';
