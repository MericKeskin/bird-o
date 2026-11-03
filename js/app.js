// Router: #/g/{gameId} = player, #/host = host, anything else = landing.
import {
  auth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signOut, signInWithCredential, useEmulator,
} from "./firebase.js";
import { mountPlayer } from "./player.js";
import { mountHost, ensureHost } from "./host.js";
import { h, mount, toast } from "./ui.js";

const root = document.getElementById("app");
let unmount = null;

const authReady = new Promise((resolve) => {
  const stop = onAuthStateChanged(auth, (u) => { stop(); resolve(u); });
});
getRedirectResult(auth).catch((e) => toast("Giriş başarısız: " + e.code));

function loading(text = "Yükleniyor…") {
  mount(root, h("main.center", h("div.spinner"), h("p.muted", text)));
}

async function hostLogin() {
  const provider = new GoogleAuthProvider();
  if (useEmulator) {
    // Local tests only: the auth emulator accepts an unsigned fake Google token.
    const sub = new URLSearchParams(location.search).get("as") || "host";
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true })));
    return route();
  }
  try {
    await signInWithPopup(auth, provider);
    route();
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      toast("Giriş başarısız: " + e.code);
    }
  }
}

async function route() {
  if (unmount) { unmount(); unmount = null; }
  const hash = location.hash.replace(/^#/, "");
  const m = hash.match(/^\/g\/([a-z0-9]+)/i);
  loading();
  await authReady;

  if (m) {
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
    } catch (e) {
      return mount(root, h("main.center", h("p", "Bağlanılamadı 😕"), h("p.muted", e.code || String(e)),
        h("button.btn", { onclick: route }, "Tekrar dene")));
    }
    unmount = mountPlayer(root, m[1]);
    return;
  }

  if (hash.startsWith("/host")) {
    const u = auth.currentUser;
    if (!u || u.isAnonymous) {
      return mount(root,
        h("header.top", h("div.logo", "🐦 Bird'O ", h("small", "host"))),
        h("main.center",
          h("p", "Host olarak devam etmek için Google hesabınla giriş yap."),
          h("button.btn.go", { onclick: hostLogin }, "Google ile giriş")));
    }
    let ok = false;
    try { ok = await ensureHost(u.uid); } catch (e) { console.error(e); }
    if (!ok) {
      return mount(root, h("main.center",
        h("p", "Bu hesap (", u.email || u.uid, ") host değil."),
        h("button.btn.ghost", { onclick: async () => { await signOut(auth); route(); } }, "Başka hesapla gir")));
    }
    unmount = mountHost(root);
    return;
  }

  mount(root,
    h("main.center.landing",
      h("div.logo.huge", "🐦 Bird'O"),
      h("p", "Oyuna katılmak için host'un gönderdiği linki aç."),
      h("a.btn.ghost", { href: "#/host" }, "Host girişi")));
}

// New release check: the running version is in <meta name="app-version">;
// version.json on the server says what is live. Offer a reload, never force
// one (it could wipe a prediction being typed; game state is safe in Firebase).
const runningVersion = document.querySelector('meta[name="app-version"]')?.content;
let updateShown = false;
async function checkVersion() {
  if (!runningVersion || updateShown) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { v } = await res.json();
    if (v && v !== runningVersion) {
      updateShown = true;
      document.body.prepend(h("div.update-bar",
        h("span", "🆕 Yeni sürüm var"),
        h("button.btn", { onclick: () => location.reload() }, "Yenile")));
    }
  } catch {}
}
setInterval(checkVersion, 3 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
checkVersion();

addEventListener("hashchange", route);
route();
