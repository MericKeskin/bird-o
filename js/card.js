// Pure game logic: card generation, validation and win checks.
// No DOM or Firebase imports, so it runs in Node tests too.

export const ROWS = 3;
export const COLS = 6;
export const LIST_ITEMS = 7;   // items from the Bird's features (rows 1-2)
export const CUSTOM_ITEMS = 3; // player-written predictions (row 3)
export const MIN_FEATURES = LIST_ITEMS;
export const MAX_CUSTOM_LEN = 40;
export const SLOTS = ["cik1", "cik2", "birdo"];

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickColumns(n, rand) {
  return shuffle([...Array(COLS).keys()], rand).slice(0, n).sort((a, b) => a - b);
}

// items: [{ id, text, short? }]. Returns 18 cells, row-major:
//   { t: "i", id, text, short } list item
//   { t: "c", text: "" }        custom cell the player fills
//   { t: "e" }                  empty, not tappable
export function generateCard(items, rand = Math.random) {
  if (items.length < LIST_ITEMS) throw new Error(`En az ${LIST_ITEMS} özellik gerekli`);
  const picked = shuffle(items, rand).slice(0, LIST_ITEMS);
  const firstRow = rand() < 0.5 ? 3 : 4;
  const perRow = [firstRow, LIST_ITEMS - firstRow, CUSTOM_ITEMS];
  const cells = Array.from({ length: ROWS * COLS }, () => ({ t: "e" }));
  let next = 0;
  perRow.forEach((count, r) => {
    for (const c of pickColumns(count, rand)) {
      if (r < 2) {
        const it = picked[next++];
        cells[r * COLS + c] = { t: "i", id: it.id, text: it.text, short: it.short || "" };
      } else {
        cells[r * COLS + c] = { t: "c", text: "" };
      }
    }
  });
  return cells;
}

export function normalize(s) {
  return String(s || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Returns an error message for the custom cell at `index`, or "" if it is fine.
export function validateCustom(cells, index, text) {
  const t = String(text || "").trim();
  if (!t) return "Boş bırakılamaz";
  if (t.length > MAX_CUSTOM_LEN) return `En fazla ${MAX_CUSTOM_LEN} karakter`;
  const n = normalize(t);
  for (let i = 0; i < cells.length; i++) {
    if (i === index) continue;
    const c = cells[i];
    if (c.t === "i" && (normalize(c.text) === n || (c.short && normalize(c.short) === n))) {
      return "Bu zaten kartında var";
    }
    if (c.t === "c" && c.text && normalize(c.text) === n) return "Aynısını iki kez yazamazsın";
  }
  return "";
}

export function customsFilled(cells) {
  return cells.filter((c) => c.t === "c").every((c) => String(c.text || "").trim());
}

export function rowCells(r) {
  return [...Array(COLS).keys()].map((c) => r * COLS + c);
}

export function filledInRow(cells, r) {
  return rowCells(r).filter((i) => cells[i] && cells[i].t !== "e");
}

export function rowComplete(cells, marks, r) {
  return filledInRow(cells, r).every((i) => marks && marks[i]);
}

export function cardComplete(cells, marks) {
  return [...Array(ROWS).keys()].every((r) => rowComplete(cells, marks, r));
}

export function cellLabel(cell) {
  if (!cell) return "";
  return cell.t === "i" ? (cell.short || cell.text) : cell.text || "";
}

// Decides which claim (if any) a player should make right now.
// claims: { cik1?: {fid,row}, cik2?: ..., birdo?: ... }
// revoked: { "<fid>_<row>": true } rows the host rejected
// Returns { slot, row } or null.
export function nextClaim(fid, cells, marks, claims = {}, revoked = {}) {
  if (claims.birdo) return null;
  if (cardComplete(cells, marks) && !revoked[`${fid}_card`]) return { slot: "birdo", row: -1 };
  const mine = new Set(
    ["cik1", "cik2"].filter((s) => claims[s] && claims[s].fid === fid).map((s) => claims[s].row)
  );
  const free = ["cik1", "cik2"].find((s) => !claims[s]);
  if (!free) return null;
  for (let r = 0; r < ROWS; r++) {
    if (mine.has(r) || revoked[`${fid}_${r}`]) continue;
    if (rowComplete(cells, marks, r)) return { slot: free, row: r };
  }
  return null;
}

// Rows the player can no longer unmark (already claimed by them).
export function lockedRows(fid, claims = {}) {
  const rows = new Set();
  for (const s of ["cik1", "cik2"]) if (claims[s] && claims[s].fid === fid) rows.add(claims[s].row);
  if (claims.birdo && claims.birdo.fid === fid) [0, 1, 2].forEach((r) => rows.add(r));
  return rows;
}

export function randomId(len = 8) {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((x) => abc[x % abc.length]).join("");
}

// Inserts soft hyphens at Turkish syllable boundaries so long words in narrow
// cells break as "Ke-sin-lik-le" instead of at a random letter. Turkish
// syllables are regular: one vowel each; with consonants between two vowels
// the last consonant starts the next syllable, with none the split is
// between the vowels.
const TR_VOWELS = "aeıioöuüâîûAEIİOÖUÜÂÎÛ";
export function hyphenateTr(text, minWord = 6) {
  return String(text || "").replace(/\p{L}+/gu, (w) => {
    if (w.length < minWord) return w;
    const v = [...w].map((ch, i) => (TR_VOWELS.includes(ch) ? i : -1)).filter((i) => i >= 0);
    const cuts = [];
    for (let k = 1; k < v.length; k++) {
      const cut = v[k] - v[k - 1] > 1 ? v[k] - 1 : v[k];
      if (cut >= 2 && w.length - cut >= 2) cuts.push(cut);
    }
    let out = "", prev = 0;
    for (const c of cuts) { out += w.slice(prev, c) + "­"; prev = c; }
    return out + w.slice(prev);
  });
}
