// Host screens: friends & features, new game, lobby, live dashboard, results.
import {
  auth, db, ref, get, set, update, remove, push, onValue, serverTimestamp, signOut,
} from "./firebase.js";
import { MIN_FEATURES, SLOTS, cellLabel, lockedRows, randomId } from "./card.js";
import {
  h, mount, toast, confirmSheet, promptSheet, renderCard, claimBar, showClaim, fmtTime,
  SLOT_LABEL, SLOT_ICON,
} from "./ui.js";
import { mountPlayer } from "./player.js";
import qrcode from "../vendor/qrcode.js";

export function joinLink(gid) {
  return `${location.origin}${location.pathname}${location.search}#/g/${gid}`;
}

function parseFeatureLine(line) {
  const [text, short = ""] = line.split("|").map((s) => s.trim());
  return { text, short: short.slice(0, 24) };
}

export function mountHost(root) {
  const user = auth.currentUser;
  let tab = sessionStorage.getItem("birdo:tab") || "game";
  let friends = {};
  let currentId = undefined;
  let game = undefined;
  let gameUnsub = null;
  let friendSel = null;
  let showNewForm = false;
  let birdChoice = null;
  let showQr = false;
  let cardRoot = null, cardGid = null, cardUnmount = null;

  const unsubs = [
    onValue(ref(db, "friends"), (s) => { friends = s.val() || {}; render(); }),
    onValue(ref(db, "current"), (s) => {
      const id = s.val();
      if (id === currentId) return;
      currentId = id;
      if (gameUnsub) gameUnsub();
      game = id ? undefined : null;
      gameUnsub = id ? onValue(ref(db, `games/${id}`), (g) => { game = g.val(); render(); }) : null;
      render();
    }),
  ];

  const gref = (p = "") => ref(db, `games/${currentId}${p ? "/" + p : ""}`);
  const setTab = (t) => { tab = t; sessionStorage.setItem("birdo:tab", t); render(); scrollTo(0, 0); };

  // ---------- Friends ----------
  async function addFriend(input) {
    const name = input.value.trim();
    if (!name) return;
    if (Object.values(friends).some((f) => f.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
      toast("Bu isim zaten var");
      return;
    }
    input.value = "";
    await push(ref(db, "friends"), { name, createdAt: serverTimestamp() });
    toast(`${name} eklendi`);
  }

  async function addFeatures(fid, textarea) {
    const lines = textarea.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const existing = new Set(Object.values(friends[fid].features || {}).map((f) => f.text.toLocaleLowerCase("tr")));
    const up = {};
    let n = 0;
    for (const line of lines) {
      const f = parseFeatureLine(line);
      if (!f.text || existing.has(f.text.toLocaleLowerCase("tr"))) continue;
      existing.add(f.text.toLocaleLowerCase("tr"));
      up[push(ref(db, `friends/${fid}/features`)).key] = { ...f, createdAt: serverTimestamp() };
      n++;
    }
    if (!n) { toast("Yeni özellik yok (hepsi zaten listede)"); return; }
    textarea.value = "";
    await update(ref(db, `friends/${fid}/features`), up);
    toast(`${n} özellik eklendi`);
  }

  async function editFeature(fid, featId) {
    const f = friends[fid].features[featId];
    const v = await promptSheet({
      title: "Özelliği düzenle",
      value: f.short ? `${f.text} | ${f.short}` : f.text,
      placeholder: "Uzun metin | kısa etiket",
      maxLength: 160,
      validate: (t) => (parseFeatureLine(t).text ? "" : "Boş olamaz"),
    });
    if (v == null) return;
    await update(ref(db, `friends/${fid}/features/${featId}`), parseFeatureLine(v));
  }

  function friendsList() {
    const input = h("input", { "data-k": "new-friend", type: "text", placeholder: "Arkadaşın adı", maxLength: 24, enterKeyHint: "done" });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(input); });
    const list = Object.entries(friends).sort((a, b) => a[1].name.localeCompare(b[1].name, "tr"));
    return h("main",
      h("h2", "Arkadaşlar"),
      h("p.muted", "Arkadaşlarını ekle, sonra her birinin sık söylediği sözleri, hareketlerini ve alışkanlıklarını gir."),
      h("div.add-row", input, h("button.btn", { onclick: () => addFriend(input) }, "Ekle")),
      h("div.list", list.map(([fid, f]) => {
        const n = Object.keys(f.features || {}).length;
        return h("button.list-item", { onclick: () => { friendSel = fid; render(); } },
          h("span.li-title", f.name),
          h("span.li-sub", { class: n < MIN_FEATURES ? "warn" : "" }, `${n} özellik`), h("span.chev", "›"));
      })),
      !list.length && h("p.muted.center", "Henüz arkadaş yok."));
  }

  function friendDetail(fid) {
    const f = friends[fid];
    if (!f) { friendSel = null; return friendsList(); }
    const feats = Object.entries(f.features || {}).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const ta = h("textarea", { "data-k": "features-" + fid, rows: 5, placeholder: "Her satıra bir özellik.\nÖrn: Abi şimdi şöyle bi' durum var | Abi şimdi…\n(| sonrası kartta görünen kısa hali, isteğe bağlı)" });
    return h("main",
      h("button.link", { onclick: () => { friendSel = null; render(); } }, "‹ Arkadaşlar"),
      h("div.title-row",
        h("h2", f.name),
        h("button.btn.small.ghost", {
          onclick: async () => {
            const v = await promptSheet({ title: "İsmi değiştir", value: f.name, maxLength: 24, validate: (t) => (t ? "" : "Boş olamaz") });
            if (v) update(ref(db, `friends/${fid}`), { name: v });
          },
        }, "✏️")),
      h("p.muted", `${feats.length} özellik`, feats.length < MIN_FEATURES ? ` — Bird olabilmesi için en az ${MIN_FEATURES} gerekli` : " — Bird olmaya hazır 🐦"),
      h("h4", "Özellik ekle"),
      ta,
      h("button.btn.wide", { onclick: () => addFeatures(fid, ta) }, "Ekle"),
      h("h4", "Özellikler"),
      h("div.list", feats.map(([id, it]) => h("div.list-item.static",
        h("span.li-title", it.text, it.short && h("span.tag", it.short)),
        h("button.icon", { onclick: () => editFeature(fid, id), "aria-label": "Düzenle" }, "✏️"),
        h("button.icon", {
          "aria-label": "Sil",
          onclick: async () => {
            if (await confirmSheet("Silinsin mi?", it.text, "Sil", true)) remove(ref(db, `friends/${fid}/features/${id}`));
          },
        }, "🗑️")))),
      !feats.length && h("p.muted.center", "Henüz özellik yok."),
      h("button.btn.danger.ghost.wide", {
        style: "margin-top:32px",
        onclick: async () => {
          if (await confirmSheet(`${f.name} silinsin mi?`, "Tüm özellikleriyle birlikte silinir. Devam eden oyunlar etkilenmez.", "Sil", true)) {
            await remove(ref(db, `friends/${fid}`));
            friendSel = null;
            render();
          }
        },
      }, "Arkadaşı sil"));
  }

  // ---------- New game ----------
  async function createGame(birdId) {
    const bird = friends[birdId];
    const roster = {};
    for (const [fid, f] of Object.entries(friends)) if (fid !== birdId) roster[fid] = f.name;
    const items = {};
    for (const [id, it] of Object.entries(bird.features || {})) items[id] = { text: it.text, short: it.short || "" };
    const gid = randomId(8);
    await update(ref(db), {
      [`games/${gid}`]: {
        meta: { status: "lobby", birdId, birdName: bird.name, hostUid: user.uid, createdAt: serverTimestamp() },
        roster, items,
      },
      current: gid,
    });
    showNewForm = false;
    showQr = true;
    scrollTo(0, 0);
    toast("Oyun oluşturuldu 🎉 Linki paylaş!");
  }

  function newGameForm() {
    const list = Object.entries(friends).sort((a, b) => a[1].name.localeCompare(b[1].name, "tr"));
    const btn = h("button.btn.wide.go", { disabled: !friends[birdChoice], onclick: () => friends[birdChoice] && createGame(birdChoice) },
      friends[birdChoice] ? `🐦 ${friends[birdChoice].name} Bird olsun — oluştur` : "Oyunu oluştur");
    const choices = list.map(([fid, f]) => {
      const n = Object.keys(f.features || {}).length;
      const ok = n >= MIN_FEATURES && list.length > 1;
      return h("label.choice", { class: ok ? "" : "disabled" },
        h("input", {
          type: "radio", name: "bird", disabled: !ok, checked: ok && birdChoice === fid,
          onchange: () => { birdChoice = fid; btn.disabled = false; btn.textContent = `🐦 ${f.name} Bird olsun — oluştur`; },
        }),
        h("span.li-title", f.name),
        h("span.li-sub", { class: n < MIN_FEATURES ? "warn" : "" }, `${n} özellik`));
    });
    return h("main",
      game && (game.meta.status === "finished" || game.meta.status === "stopped") &&
        h("button.link", { onclick: () => { showNewForm = false; render(); } }, "‹ Son oyunun sonuçları"),
      h("h2", "Yeni oyun"),
      h("p.muted", "Bu gece kim Bird? Diğer herkes oyuncu listesinde olacak."),
      list.length < 2
        ? h("div.banner", "Önce en az 2 arkadaş ekle (Bird + en az 1 oyuncu). ", h("button.link", { onclick: () => setTab("friends") }, "Arkadaşlar →"))
        : h("div.list", choices),
      list.length >= 2 && btn,
      h("p.hint", `Bird olabilmek için en az ${MIN_FEATURES} özellik gerekli. Kartlar daha çeşitli olsun diye 20+ önerilir.`));
  }

  // ---------- Game dashboard ----------
  async function share(gid) {
    const url = joinLink(gid);
    if (navigator.share) {
      try { await navigator.share({ title: "Bird'O", text: `🐦 Bird'O başlıyor! Bu gecenin Bird'ü: ${game.meta.birdName}. Kartını al:`, url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copy(url);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Link kopyalandı 📋"); }
    catch { await promptSheet({ title: "Linki kopyala", value: text, okLabel: "Tamam" }); }
  }

  function qrBox(url) {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const box = h("div.qr");
    box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    return box;
  }

  async function startGame() {
    if (!(await confirmSheet("Oyun başlasın mı?", "Kartlar kilitlenir ve işaretlemeye açılır.", "Başlat 🎬"))) return;
    await update(gref("meta"), { status: "playing", startedAt: serverTimestamp() });
  }

  async function stopGame() {
    if (!(await confirmSheet("Oyunu bitir?", "Herkesin kartı donar. Bu geri alınamaz.", "Bitir", true))) return;
    await update(gref("meta"), { status: "stopped", endedAt: serverTimestamp() });
  }

  async function resetSeat(fid, name) {
    const ok = await confirmSheet(`${name}: bağlantıyı sıfırla`,
      "Kartı silinmez. Oyuncu linki açıp ismine tekrar dokununca kartı yeni telefona/tarayıcıya gelir.", "Sıfırla");
    if (ok) { await update(gref(), { [`seats/${fid}`]: null, [`online/${fid}`]: null }); toast(`${name} artık yeniden bağlanabilir`); }
  }

  async function kick(fid, name) {
    if (await confirmSheet(`${name} çıkarılsın mı?`, "Kartı silinir. İsterse tekrar girip yeni kart alabilir.", "Çıkar", true)) {
      await update(gref(), { [`seats/${fid}`]: null, [`players/${fid}`]: null, [`online/${fid}`]: null });
    }
  }

  async function revoke(slot) {
    const c = game.claims[slot];
    if (!(await confirmSheet(`${SLOT_LABEL[slot]} geri alınsın mı?`, `${c.name} bu ${slot === "birdo" ? "kart" : "satır"} için bir daha ilan edemez. Sıradaki hak eden alır.`, "Geri al", true))) return;
    const up = { [`claims/${slot}`]: null, [`revoked/${c.fid}_${slot === "birdo" ? "card" : c.row}`]: true };
    if (slot === "birdo") { up["meta/status"] = "playing"; up["meta/endedAt"] = null; }
    await update(gref(), up);
  }

  function playerRows(withCards) {
    const roster = game.roster || {};
    const players = game.players || {};
    const seats = game.seats || {};
    const onl = game.online || {};
    const st = game.meta.status;
    return Object.keys(roster).sort((a, b) => roster[a].localeCompare(roster[b], "tr")).map((fid) => {
      const p = players[fid];
      const seated = !!seats[fid];
      if (!p && st !== "lobby") return null;
      const cells = p && p.card;
      const marks = (p && p.marks) || {};
      const filled = cells ? cells.filter((c) => c.t !== "e").length : 0;
      const marked = cells ? cells.filter((c, i) => c.t !== "e" && marks[i]).length : 0;
      const status = !p ? (seated ? "Kart hazırlanıyor…" : "Henüz girmedi")
        : st === "lobby" ? (p.ready ? "✅ Hazır" : "✏️ Dolduruyor") : `${marked}/${filled} işaretli`;
      return h("div.player-row", { class: p && p.ready ? "ready" : "" },
        h("div.pr-head",
          h("span.dot", { class: onl[fid] ? "on" : seated ? "away" : "" , title: onl[fid] ? "Bağlı" : "Bağlı değil" }),
          h("span.li-title", roster[fid]),
          h("span.li-sub", status),
          seated && h("button.btn.small.ghost", { onclick: () => resetSeat(fid, roster[fid]) }, "Bağlantıyı sıfırla"),
          st === "lobby" && p && h("button.icon", { onclick: () => kick(fid, roster[fid]), "aria-label": "Çıkar" }, "✖")),
        withCards && cells && renderCard(cells, { marks, mini: true, highlightRows: lockedRows(fid, game.claims) }));
    });
  }

  function claimsList(canRevoke) {
    const claims = game.claims || {};
    return h("div.list", SLOTS.map((s) => {
      const c = claims[s];
      return h("div.list-item.static", { class: c ? "won" : "" },
        h("span.li-title", SLOT_ICON[s], " ", SLOT_LABEL[s]),
        h("span.li-sub", c ? `${c.name} · ${fmtTime(c.at)}` : "—"),
        c && h("button.btn.small.ghost", { onclick: () => showClaim(s, c) }, "Gör"),
        c && canRevoke && h("button.btn.small.ghost.danger", { onclick: () => revoke(s) }, "Geri al"));
    }));
  }

  function timeline() {
    const rows = [];
    for (const p of Object.values(game.players || {})) {
      for (const [i, ts] of Object.entries(p.marks || {})) {
        if (ts && p.card[i]) rows.push({ ts, name: p.name, label: cellLabel(p.card[i]) });
      }
    }
    rows.sort((a, b) => a.ts - b.ts);
    return h("div.timeline", rows.map((r) => h("div.tl-row", h("span.tl-time", fmtTime(r.ts)), h("span.tl-name", r.name), h("span", r.label))));
  }

  function gameDashboard() {
    const st = game.meta.status;
    const url = joinLink(currentId);
    const players = game.players || {};
    const joined = Object.keys(players);
    const allReady = joined.length > 0 && joined.every((f) => players[f].ready);
    const readyCount = joined.filter((f) => players[f].ready).length;
    const top = h("div.game-head",
      h("div", h("span.muted", "Bird: "), h("b", game.meta.birdName)),
      h("span.pill", { class: st }, { lobby: "Lobi", playing: "Oyunda", finished: "Bitti", stopped: "Bitirildi" }[st]));

    if (st === "lobby") {
      return h("main",
        top,
        h("div.share-box",
          h("p", "Bu linki gruba gönder. Herkes açınca ismini seçip kartını alır."),
          h("div.link-box", url),
          h("div.row-btns",
            h("button.btn", { onclick: () => share(currentId) }, "📤 Paylaş"),
            h("button.btn.ghost", { onclick: () => copy(url) }, "📋 Kopyala"),
            h("button.btn.ghost", { onclick: () => { showQr = !showQr; render(); } }, showQr ? "QR gizle" : "QR")),
          showQr && qrBox(url)),
        h("h4", joined.length ? `Oyuncular — ${readyCount}/${joined.length} hazır` : "Oyuncular — henüz kimse katılmadı"),
        h("div.list", playerRows(false)),
        h("p.hint", "Sen de oynuyorsan “Kartım” sekmesinden ismini seç ve kartını doldur."),
        h("button.btn.wide.go", { disabled: !allReady, onclick: startGame },
          allReady ? `🎬 Oyunu başlat (${joined.length} oyuncu)` : joined.length ? "Herkesin hazır olması bekleniyor…" : "Oyuncu bekleniyor…"),
        h("button.btn.ghost.danger.wide", { onclick: stopGame }, "Oyunu iptal et"));
    }

    if (st === "playing") {
      return h("main",
        top,
        h("h4", "İlanlar"),
        claimsList(true),
        h("h4", "Kartlar (canlı)"),
        h("div.list", playerRows(true)),
        h("button.btn.ghost.wide", { onclick: () => copy(url) }, "📋 Oyun linkini kopyala"),
        h("button.btn.danger.wide", { onclick: stopGame }, "⏹️ Oyunu bitir"));
    }

    const w = game.claims && game.claims.birdo;
    return h("main",
      top,
      w ? h("div.banner.gold", `🏆 Bird'O: ${w.name}!`) : h("div.banner", "Oyun bitirildi."),
      h("h4", "İlanlar"),
      claimsList(st === "finished"),
      h("h4", "Kartlar"),
      h("div.list", playerRows(true)),
      h("h4", "Gecenin özeti"),
      timeline(),
      h("button.btn.wide.go", { onclick: () => { showNewForm = true; render(); } }, "🐦 Yeni oyun"));
  }

  // ---------- My card (host also plays) ----------
  function myCard() {
    if (!currentId || !game) return h("main.center", h("p.muted", "Önce bir oyun oluştur."));
    if (!cardRoot || cardGid !== currentId) {
      if (cardUnmount) cardUnmount();
      cardRoot = h("div.embedded-player");
      cardGid = currentId;
      cardUnmount = mountPlayer(cardRoot, currentId, { embedded: true });
    }
    return cardRoot;
  }

  function render() {
    if (currentId && game) myCard(); // keep the host's own card live for announcements
    let body;
    if (tab === "friends") body = friendSel ? friendDetail(friendSel) : friendsList();
    else if (tab === "card") body = myCard();
    else if (currentId === undefined || game === undefined) body = h("main.center", h("div.spinner"));
    else if (!game || showNewForm) body = newGameForm();
    else body = gameDashboard();

    const tabs = h("nav.tabs",
      [["game", "🎲 Oyun"], ["card", "🃏 Kartım"], ["friends", "👥 Arkadaşlar"]].map(([k, label]) =>
        h("button.tab", { class: tab === k ? "active" : "", onclick: () => setTab(k) }, label)));
    const showBar = tab === "game" && game && !showNewForm && game.meta.status !== "lobby";
    mount(root,
      h("div.sticky-top", h("header.top",
        h("div.logo", "🐦 Bird'O ", h("small", "host")),
        h("button.link.small", {
          onclick: async () => { if (await confirmSheet("Çıkış yap?", null, "Çıkış")) { await signOut(auth); location.hash = "#/"; } },
        }, "Çıkış")),
      tabs), body, showBar && claimBar(game.claims || {}, showClaim));
  }

  render();
  return () => {
    unsubs.forEach((u) => u());
    if (gameUnsub) gameUnsub();
    if (cardUnmount) cardUnmount();
  };
}

// Makes the signed-in Google account the host on first use.
export async function ensureHost(uid) {
  const snap = await get(ref(db, "config/hostUid"));
  if (snap.exists()) return snap.val() === uid;
  await set(ref(db, "config/hostUid"), uid);
  return true;
}
