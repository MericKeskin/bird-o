import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateCard, validateCustom, customsFilled, rowComplete, cardComplete, nextClaim, lockedRows,
  ROWS, COLS,
} from "../js/card.js";

const items = Array.from({ length: 20 }, (_, i) => ({ id: "f" + i, text: "Özellik " + i }));

test("card layout: 7 list items split 3+4 over rows 1-2, 3 custom cells in row 3", () => {
  for (let n = 0; n < 500; n++) {
    const cells = generateCard(items);
    assert.equal(cells.length, ROWS * COLS);
    const row = (r) => cells.slice(r * COLS, r * COLS + COLS);
    const r1 = row(0).filter((c) => c.t === "i").length;
    const r2 = row(1).filter((c) => c.t === "i").length;
    assert.ok((r1 === 3 && r2 === 4) || (r1 === 4 && r2 === 3), `${r1}+${r2}`);
    assert.equal(row(2).filter((c) => c.t === "c").length, 3);
    assert.equal(row(2).filter((c) => c.t === "i").length, 0);
    const ids = cells.filter((c) => c.t === "i").map((c) => c.id);
    assert.equal(new Set(ids).size, 7, "no duplicate items on a card");
  }
});

test("rejects lists shorter than 7", () => {
  assert.throws(() => generateCard(items.slice(0, 6)));
  assert.doesNotThrow(() => generateCard(items.slice(0, 7)));
});

test("custom validation", () => {
  const cells = generateCard(items);
  const ci = cells.findIndex((c) => c.t === "c");
  const anItem = cells.find((c) => c.t === "i");
  assert.ok(validateCustom(cells, ci, ""));
  assert.ok(validateCustom(cells, ci, "x".repeat(41)));
  assert.ok(validateCustom(cells, ci, anItem.text.toUpperCase()), "duplicate of a card item");
  assert.equal(validateCustom(cells, ci, "Kahve ister"), "");
  cells[ci].text = "Kahve ister";
  const other = cells.findIndex((c, i) => c.t === "c" && i !== ci);
  assert.ok(validateCustom(cells, other, "kahve İSTER!"), "duplicate custom, case/punct-insensitive");
  assert.equal(customsFilled(cells), false);
  cells.forEach((c, i) => { if (c.t === "c") c.text = "t" + i; });
  assert.equal(customsFilled(cells), true);
});

function markRow(cells, marks, r) {
  for (let c = 0; c < COLS; c++) if (cells[r * COLS + c].t !== "e") marks[r * COLS + c] = 1;
}

test("claims: cik1, cik2 (same player allowed, different rows), then birdo", () => {
  const cells = generateCard(items);
  const marks = {};
  assert.equal(nextClaim("a", cells, marks), null);
  markRow(cells, marks, 1);
  assert.ok(rowComplete(cells, marks, 1));
  assert.deepEqual(nextClaim("a", cells, marks, {}), { slot: "cik1", row: 1 });
  const claims = { cik1: { fid: "a", row: 1 } };
  assert.equal(nextClaim("a", cells, marks, claims), null, "same row cannot claim twice");
  markRow(cells, marks, 0);
  assert.deepEqual(nextClaim("a", cells, marks, claims), { slot: "cik2", row: 0 });
  claims.cik2 = { fid: "a", row: 0 };
  assert.deepEqual([...lockedRows("a", claims)].sort(), [0, 1]);
  markRow(cells, marks, 2);
  assert.ok(cardComplete(cells, marks));
  assert.deepEqual(nextClaim("a", cells, marks, claims), { slot: "birdo", row: -1 });
  claims.birdo = { fid: "a", row: -1 };
  assert.equal(nextClaim("b", cells, marks, claims), null, "nothing after birdo");
});

test("claims: other player's row takes cik2 when cik1 is gone; revoked rows are skipped", () => {
  const cells = generateCard(items);
  const marks = {};
  markRow(cells, marks, 0);
  assert.deepEqual(nextClaim("b", cells, marks, { cik1: { fid: "a", row: 2 } }), { slot: "cik2", row: 0 });
  assert.equal(nextClaim("b", cells, marks, {}, { b_0: true }), null);
  assert.equal(nextClaim("b", cells, marks, { cik1: { fid: "a", row: 0 }, cik2: { fid: "c", row: 1 } }), null);
});

test("Turkish syllable hyphenation", async () => {
  const { hyphenateTr } = await import("../js/card.js");
  const show = (s) => hyphenateTr(s).replace(/­/g, "-");
  assert.equal(show("Kesinlikle"), "Ke-sin-lik-le");
  assert.equal(show("değiştirir"), "de-ğiş-ti-rir");
  assert.equal(show("ovuşturur"), "ovuş-tu-rur");
  assert.equal(show("Türkçe konuşmuyor"), "Türk-çe ko-nuş-mu-yor");
  assert.equal(show("fotoğrafını çeker"), "fo-toğ-ra-fı-nı çeker");
  assert.equal(show("Abi şimdi şöyle bi' durum var"), "Abi şimdi şöyle bi' durum var");
});
