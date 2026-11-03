// Small DOM helpers shared by the host and player screens.
import { cellLabel, rowCells, COLS, ROWS } from "./card.js";

// h("div.card#main", { onclick }, child, "text", [children])
export function h(tag, attrs, ...children) {
  const [, name = "div", rest = ""] = tag.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(name || "div");
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += " " + v;
    else if (k === "style") el.style.cssText = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

// Replaces root's content. Inputs marked with data-k keep their typed text and
// focus across re-renders, since live updates re-render whole screens.
export function mount(root, ...children) {
  const kept = {};
  let focused = null, selStart = 0, selEnd = 0;
  for (const el of root.querySelectorAll("[data-k]")) {
    kept[el.dataset.k] = el.value;
    if (el === document.activeElement) {
      focused = el.dataset.k;
      selStart = el.selectionStart;
      selEnd = el.selectionEnd;
    }
  }
  root.replaceChildren(...children.flat().filter(Boolean));
  for (const el of root.querySelectorAll("[data-k]")) {
    const k = el.dataset.k;
    if (k in kept && !el.value) el.value = kept[k];
    if (k === focused) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(selStart, selEnd); } catch {}
    }
  }
}

export function vibrate(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

export function toast(text, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div#toasts");
    document.body.append(box);
  }
  const t = h("div.toast", { class: kind }, text);
  box.append(t);
  setTimeout(() => t.classList.add("out"), 3600);
  setTimeout(() => t.remove(), 4000);
}

// Bottom sheet modal. Resolves with the value passed to close().
export function sheet(build) {
  return new Promise((resolve) => {
    const back = h("div.backdrop");
    // Keep the sheet inside the visible area when the on-screen keyboard is
    // open (iOS shrinks visualViewport instead of the layout viewport).
    const vv = window.visualViewport;
    const fit = () => {
      if (!vv) return;
      back.style.height = vv.height + "px";
      back.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    const close = (v) => {
      if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
      back.remove();
      resolve(v);
    };
    back.addEventListener("click", (e) => { if (e.target === back) close(null); });
    back.append(h("div.sheet", build(close)));
    document.body.append(back);
    if (vv) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit(); }
    const input = back.querySelector("input,textarea");
    if (input) setTimeout(() => input.focus(), 50);
  });
}

export function confirmSheet(title, text, okLabel = "Evet", danger = false) {
  return sheet((close) => [
    h("h3", title),
    text && h("p.muted", text),
    h("div.row-btns",
      h("button.btn.ghost", { onclick: () => close(false) }, "Vazgeç"),
      h("button.btn", { class: danger ? "danger" : "", onclick: () => close(true) }, okLabel)),
  ]);
}

export function promptSheet({ title, value = "", placeholder = "", maxLength = 200, validate = () => "", multiline = false, okLabel = "Kaydet" }) {
  return sheet((close) => {
    const input = multiline
      ? h("textarea", { rows: 6, placeholder, value })
      : h("input", { type: "text", placeholder, value, maxLength, enterKeyHint: "done" });
    const err = h("p.error");
    const submit = () => {
      const v = input.value.trim();
      const e = validate(v);
      if (e) { err.textContent = e; return; }
      close(v);
    };
    if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    return [
      h("h3", title),
      input,
      !multiline && h("p.hint.tight", "Klavyede ", h("b", "Bitti / Return"), " ile de kaydedebilirsin."),
      err,
      h("div.row-btns",
        h("button.btn.ghost", { onclick: () => close(null) }, "Vazgeç"),
        h("button.btn", { onclick: submit }, okLabel)),
    ];
  });
}

export function showInfo(title, text) {
  return sheet((close) => [h("h3", title), h("p.big-text", text), h("button.btn.wide", { onclick: () => close() }, "Tamam")]);
}

// Renders a 3x6 card. opts: { marks, onTap(i), onLong(i), mini, highlightRows:Set }
// Each row is a fixed grid: filled cells share the width equally, empty cells
// are thin slots, so widths never depend on the text inside.
export function renderCard(cells, opts = {}) {
  const marks = opts.marks || {};
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const idx = rowCells(r);
    const cols = idx.map((i) => (cells[i] && cells[i].t !== "e" ? "minmax(0, 1fr)" : "var(--empty-w)")).join(" ");
    const row = h("div.card-row", {
      class: opts.highlightRows && opts.highlightRows.has(r) ? "claimed" : "",
      style: `grid-template-columns: ${cols}`,
    });
    for (const i of idx) {
      const c = cells[i] || { t: "e" };
      if (c.t === "e") { row.append(h("div.cell.empty")); continue; }
      const label = cellLabel(c);
      const cls = [
        c.t === "c" ? "custom" : "item",
        marks[i] ? "on" : "",
        c.t === "c" && !label ? "blank" : "",
      ].join(" ");
      const cell = h("button.cell", { class: cls, type: "button" },
        opts.mini ? "" : h("span", label || "✏️ Yaz"));
      if (opts.mini) cell.title = label;
      if (opts.onTap) attachPress(cell, () => opts.onTap(i), opts.onLong && (() => opts.onLong(i)));
      else cell.disabled = true;
      row.append(cell);
    }
    rows.push(row);
  }
  return h("div.card", { class: opts.mini ? "mini" : "" }, rows);
}

// Tap vs long-press (long press shows the full text).
function attachPress(el, onTap, onLong) {
  let timer = null, long = false;
  const start = () => {
    long = false;
    if (onLong) timer = setTimeout(() => { long = true; vibrate(15); onLong(); }, 520);
  };
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.preventDefault();
    if (long) { long = false; return; }
    onTap();
  });
}

export const SLOT_LABEL = { cik1: "1. Cik'O", cik2: "2. Cik'O", birdo: "Bird'O" };
export const SLOT_ICON = { cik1: "🐣", cik2: "🐥", birdo: "🏆" };

// Fixed bottom bar listing the claims so far.
export function claimBar(claims = {}, onTapClaim) {
  const items = ["cik1", "cik2", "birdo"].map((s) => {
    const c = claims[s];
    return h("button.claim", { class: (c ? "won " : "") + s, type: "button", onclick: c && onTapClaim ? () => onTapClaim(s, c) : null },
      h("span.claim-label", SLOT_ICON[s], " ", SLOT_LABEL[s]),
      h("span.claim-name", c ? c.name : "—"));
  });
  return h("div.claim-bar", items);
}

export function showClaim(slot, c) {
  return sheet((close) => [
    h("h3", SLOT_ICON[slot], " ", SLOT_LABEL[slot], " — ", c.name),
    h("p.muted", slot === "birdo" ? "Tüm kartı doldurdu:" : `${c.row + 1}. satırı doldurdu:`),
    h("ul.claim-items", (c.items || []).map((t) => h("li", t))),
    c.at && h("p.muted", "Saat " + fmtTime(c.at)),
    h("button.btn.wide", { onclick: () => close() }, "Tamam"),
  ]);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

// Simple confetti burst on a full-screen canvas.
export function confetti(ms = 4000) {
  const cv = h("canvas.confetti");
  document.body.append(cv);
  const ctx = cv.getContext("2d");
  const W = (cv.width = innerWidth), H = (cv.height = innerHeight);
  const colors = ["#22c55e", "#facc15", "#38bdf8", "#f472b6", "#fb923c", "#a78bfa"];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const end = performance.now() + ms;
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    if (t < end) requestAnimationFrame(frame); else cv.remove();
  })(performance.now());
}

// Keeps the screen awake while the game is on (where supported).
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}

export function connectionBadge(online) {
  return online ? null : h("div.offline", "⚠️ Bağlantı yok — tıklamaların kaydediliyor, bağlanınca gönderilecek");
}

export { COLS };
