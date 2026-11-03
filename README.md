# 🐦 Bird'O

A private bingo (tombala) game for our friend group. One friend is the **Bird**. Players' cards are filled with the Bird's usual phrases, habits and gestures, and you tap a cell green when the Bird actually does it that night.

- **Card:** 3×5. Rows 1–2 hold 7 of the Bird's features (split 3+4 at random). Row 3 holds 3 predictions the player writes.
- **1. Cik'O / 2. Cik'O:** the first two completed rows, announced to everyone. One player can win both.
- **Bird'O:** all 10 filled cells green. That player wins and the game ends.

Live site: https://merickeskin.github.io/bird-o/

## Game night

1. Open `…/bird-o/#/host` and sign in with Google.
2. **Arkadaşlar** tab: add friends and their features (one per line; `long text | short label` is optional).
3. **Oyun** tab: choose the Bird → **Oluştur** → **Paylaş** to send the link to the group (or show the QR).
4. Each friend opens the link, taps their name, writes 3 predictions, presses **Hazırım**.
5. You play too: **Kartım** tab, pick your name and fill your card.
6. When everyone is ✅, press **Oyunu başlat**.
7. Someone lost their card (opened the link in another browser)? On the host screen, tap **Linki sıfırla** next to their name. They open the link, tap their name, and their card comes back.
8. Tap **Geri al** on an announcement to reject a Cik'O or Bird'O. **Oyunu bitir** ends the game early.

Game state lives in Firebase until the host ends the game. Reloading, locking the phone or losing connection doesn't lose anything.

## Setup (one time)

1. **Firebase:** project `bird-o-1`, with a Realtime Database (europe-west1) and Anonymous + Google sign-in enabled. Add `merickeskin.github.io` under Authentication → Settings → Authorized domains.
2. **Rules:** copy [`database.rules.json`](database.rules.json) into Realtime Database → Rules → **Publish**. Re-publish whenever this file changes.
3. **Host:** the **first** Google account to sign in on `#/host` becomes the host (saved at `config/hostUid`). To change the host, delete `config/hostUid` in the Firebase console and sign in with the new account.
4. **GitHub Pages:** Settings → Pages → Deploy from a branch → choose the branch, folder `/ (root)`.

## Code

Plain HTML/CSS/JS with no build step.

| File | Purpose |
|---|---|
| `js/card.js` | Card generation, validation, Cik'O/Bird'O rules (pure, unit tested) |
| `js/player.js` | Player screen |
| `js/host.js` | Host screens (friends, new game, lobby, live, results) |
| `js/ui.js` | DOM helpers, card rendering, toasts, confetti |
| `js/firebase.js` | Firebase config |
| `vendor/` | Firebase SDK v13 + qrcode-generator, bundled with esbuild |
| `database.rules.json` | Security rules |

### Releasing

Before merging a change to `main`, run `node scripts/bump-version.mjs`. It stamps a new version into `index.html` (all script and stylesheet URLs) and `version.json`, so phones never mix cached old files with new ones. Phones with the page already open show a **"Yeni sürüm var — Yenile"** banner. The version test fails if you forget.

### Tests

```sh
node --test tests/*.test.mjs        # card logic
```

To run locally against the Firebase emulators (Auth on 9099, Database on 9000):

```sh
firebase emulators:start --only auth,database
python3 -m http.server 8080
# open http://127.0.0.1:8080/?emu=1#/host  (Google login is faked in emulator mode)
```
