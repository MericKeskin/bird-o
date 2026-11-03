// Firebase setup. The web config is public by design: access is controlled
// by database.rules.json, not by keeping these values secret.
import {
  initializeApp, getAuth, getDatabase, connectAuthEmulator, connectDatabaseEmulator,
} from "../vendor/firebase.js";

const firebaseConfig = {
  apiKey: "AIzaSyAduYXyJEa7FCbSJTj8R79XDaVRR7Vyt0o",
  authDomain: "bird-o-1.firebaseapp.com",
  databaseURL: "https://bird-o-1-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bird-o-1",
  storageBucket: "bird-o-1.firebasestorage.app",
  messagingSenderId: "764741341242",
  appId: "1:764741341242:web:570a2088238b1742fd2503",
};

// Local testing against the Firebase emulators: open the app with ?emu=1
export const useEmulator = new URLSearchParams(location.search).has("emu");

const app = initializeApp(
  useEmulator ? { ...firebaseConfig, databaseURL: `http://${location.hostname}:9000?ns=bird-o-1` } : firebaseConfig
);
export const auth = getAuth(app);
export const db = getDatabase(app);

if (useEmulator) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, location.hostname, 9000);
}

export * from "../vendor/firebase.js";
