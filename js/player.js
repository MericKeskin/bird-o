// Player screen: pick your name, fill row 3, get ready, then tap what the Bird does.
import {
  auth, db, ref, set, update, remove, onValue, onDisconnect, serverTimestamp,
} from "./firebase.js";
import {
  generateCard, validateCustom, customsFilled, nextClaim, lockedRows, filledInRow,
  cellLabel, COLS, MAX_CUSTOM_LEN, SLOTS,
} from "./card.js";
import {
  h, mount, toast, vibrate, confirmSheet, promptSheet, showInfo, renderCard, claimBar,
  showClaim, confetti, keepAwake, connectionBadge, SLOT_LABEL, SLOT_ICON,
} from "./ui.js";

export function mountPlayer(root, gid, { embedded = false } = {}) {
  const uid = auth.currentUser.uid;
  const gpath = `games/${gid}`;
  let game;              // undefined = loading, null = not found
  let online = true;
  let claimInFlight = false;
  let failedKey = "";
  let presenceFor = "";
  let dead = false;

  const myFid = () => {
    const seats = (game && game.seats) || {};
    return Object.keys(seats).find((f) => seats[f] === uid) || null;
  };

  const unsubs = [
    onValue(ref(db, gpath), (snap) => {
      const next = snap.val();
      const before = game;
      game = next;
      announce(before, next);
      render();
      autoClaim();
      presence();
    }, (err) => {
      console.error(err);
      game = null;
      render();
    }),
    onValue(ref(db, ".info/connected"), (snap) => {
      online = !!snap.val();
      if (online) presenceFor = "";
      render();
      presence();
    }),
  ];
  const onVisible = () => keepAwake(game && game.meta && game.meta.status === "playing");
  document.addEventListener("visibilitychange", onVisible);

  function presence() {
    const fid = myFid();
    if (!online || !fid || presenceFor === fid) return;
    presenceFor = fid;
    const r = ref(db, `${gpath}/online/${fid}`);
    onDisconnect(r).remove().then(() => set(r, true)).catch(() => {});
  }

  function announce(before, after) {
    if (!before || !after) return;
    const fid = myFid();
    const was = before.meta.status, now = after.meta.status;
    if (was === "lobby" && now === "playing") {
      vibrate([80, 60, 80]);
      toast("🎬 Oyun başladı! Bird'ü izle, gördüğünde dokun.", "big");
    }
    for (const s of SLOTS) {
      const c = after.claims && after.claims[s];
      const old = before.claims && before.claims[s];
      if (c && (!old || old.fid !== c.fid || old.row !== c.row)) {
        const me = c.fid === fid;
        vibrate(s === "birdo" ? [200, 80, 200, 80, 400] : [120, 60, 120]);
        toast(`${SLOT_ICON[s]} ${SLOT_LABEL[s]}: ${me ? "Sen! 🎉" : c.name}`, s === "birdo" ? "big gold" : "big");
        if (s === "birdo" || me) confetti(s === "birdo" ? 6000 : 2500);
      }
      if (old && !c) toast(`↩️ ${SLOT_LABEL[s]} (${old.name}) host tarafından geri alındı`);
    }
    if (was !== "stopped" && now === "stopped") toast("⏹️ Host oyunu bitirdi");
    if (was !== now) keepAwake(now === "playing");
  }

  function autoClaim() {
    if (!game || game.meta.status !== "playing" || claimInFlight) return;
    const fid = myFid();
    const p = fid && game.players && game.players[fid];
    if (!p) return;
    const claims = game.claims || {};
    const nc = nextClaim(fid, p.card, p.marks || {}, claims, game.revoked || {});
    if (!nc) return;
    const key = `${nc.slot}:${nc.row}:${Object.keys(claims).sort().join(",")}`;
    if (key === failedKey) return;
    claimInFlight = true;
    const idx = nc.row < 0 ? p.card.map((c, i) => (c.t === "e" ? -1 : i)).filter((i) => i >= 0) : filledInRow(p.card, nc.row);
    const up = {
      [`claims/${nc.slot}`]: { fid, name: p.name, row: nc.row, items: idx.map((i) => cellLabel(p.card[i])), at: serverTimestamp() },
    };
    if (nc.slot === "birdo") {
      up["meta/status"] = "finished";
      up["meta/endedAt"] = serverTimestamp();
    }
    update(ref(db, gpath), up)
      .catch(() => { failedKey = key; })
      .finally(() => { claimInFlight = false; if (!dead) autoClaim(); });
  }

  async function pickName(fid) {
    const name = game.roster[fid];
    const hasCard = game.players && game.players[fid];
    const ok = await confirmSheet(`${name} sen misin?`, hasCard ? "Kartın bu telefona geri yüklenecek." : "Kartın bu isimle oluşturulacak.", "Evet, benim");
    if (!ok) return;
    try {
      await set(ref(db, `${gpath}/seats/${fid}`), uid);
    } catch {
      toast("Bu isim az önce alındı 🤔");
      return;
    }
    if (!hasCard) await createCard(fid);
  }

  let creating = false;
  async function createCard(fid) {
    if (creating || (game.players && game.players[fid])) return;
    creating = true;
    try {
      const items = Object.entries(game.items || {}).map(([id, it]) => ({ id, ...it }));
      await set(ref(db, `${gpath}/players/${fid}`), {
        name: game.roster[fid], joinedAt: serverTimestamp(), ready: false, card: generateCard(items),
      });
    } finally {
      creating = false;
    }
  }

  async function editCustom(fid, i) {
    const cells = game.players[fid].card;
    const v = await promptSheet({
      title: "Tahminin",
      value: cells[i].text || "",
      placeholder: "Bird bu gece ne yapacak / diyecek?",
      maxLength: MAX_CUSTOM_LEN,
      validate: (t) => validateCustom(cells, i, t),
    });
    if (v == null) return;
    set(ref(db, `${gpath}/players/${fid}/card/${i}/text`), v).catch(() => toast("Kaydedilemedi"));
  }

  async function toggleMark(fid, i) {
    const p = game.players[fid];
    const c = p.card[i];
    if (!c || c.t === "e") return;
    const marks = p.marks || {};
    const path = `${gpath}/players/${fid}/marks/${i}`;
    if (marks[i]) {
      if (lockedRows(fid, game.claims).has(Math.floor(i / COLS))) {
        toast("Bu satır ilan edildi, geri alınamaz 🔒");
        return;
      }
      if (!(await confirmSheet("İşareti kaldır?", cellLabel(c), "Kaldır"))) return;
      remove(ref(db, path)).catch(() => toast("Kaldırılamadı"));
    } else {
      vibrate(12);
      set(ref(db, path), serverTimestamp()).catch(() => toast("İşaretlenemedi"));
    }
  }

  function header(extra) {
    if (embedded) return extra ? h("div.sub-header", extra) : null;
    return h("header.top",
      h("div.logo", "🐦 Bird'O"),
      game && game.meta && h("div.bird-name", "Bu gecenin Bird'ü: ", h("b", game.meta.birdName)),
      extra && h("div.me", extra));
  }

  function renderNamePicker() {
    const st = game.meta.status;
    const roster = game.roster || {};
    const seats = game.seats || {};
    const players = game.players || {};
    if (st === "finished" || st === "stopped") {
      return [header(), h("main.center", h("p", "Bu oyun bitti."))];
    }
    const fids = Object.keys(roster)
      .filter((f) => st === "lobby" || players[f])
      .sort((a, b) => roster[a].localeCompare(roster[b], "tr"));
    return [
      header(),
      h("main",
        h("h2", "Sen kimsin?"),
        h("p.muted", st === "lobby" ? "İsmine dokun, kartın hemen gelsin." : "Oyun başladı. Kartına geri dönmek için ismine dokun."),
        h("div.name-grid", fids.map((f) => {
          const taken = !!seats[f];
          return h("button.name-btn", { class: taken ? "taken" : "", disabled: taken, onclick: () => pickName(f) },
            taken ? "🔒 " : "", roster[f]);
        })),
        Object.values(seats).length > 0 && h("p.hint",
          "İsmin kilitli 🔒 ama kartın sende değil mi? (Örn. linki başka tarayıcıda açtın.) Host'tan ",
          h("b", "“Linki sıfırla”"), " demesini iste, sonra ismine tekrar dokun."))
    ];
  }

  function render() {
    if (dead) return;
    if (game === undefined) return mount(root, header(), h("main.center", h("div.spinner"), h("p.muted", "Yükleniyor…")));
    if (game === null || !game.meta) return mount(root, header(), h("main.center", h("p", "Oyun bulunamadı 🤷"), h("p.muted", "Host'tan yeni linki iste.")));
    const fid = myFid();
    if (!fid) return mount(root, connectionBadge(online), renderNamePicker());

    const p = game.players && game.players[fid];
    if (!p) {
      if (game.meta.status === "lobby") createCard(fid).catch(() => {});
      return mount(root, header(), h("main.center", h("div.spinner"), h("p.muted", "Kartın hazırlanıyor…")));
    }

    const st = game.meta.status;
    const cells = p.card;
    const marks = p.marks || {};
    const claims = game.claims || {};
    const filled = cells.filter((c) => c.t !== "e").length;
    const marked = cells.filter((c, i) => c.t !== "e" && marks[i]).length;
    const players = game.players || {};
    const parts = [connectionBadge(online), header(h("span", "👤 ", p.name))];

    if (st === "lobby") {
      const done = customsFilled(cells);
      parts.push(h("main",
        p.ready
          ? h("div.banner.ok", "✅ Hazırsın! Host oyunu başlatınca kartın açılacak.")
          : h("div.banner", "3. satıra Bird'ün bu gece yapacağını/diyeceğini düşündüğün ", h("b", "3 şey"), " yaz, sonra ", h("b", "Hazırım"), "'a bas."),
        renderCard(cells, {
          onTap: (i) => {
            if (cells[i].t === "c" && !p.ready) editCustom(fid, i);
            else showInfo(cells[i].t === "c" ? "Tahminin" : "Bird'ün özelliği", cells[i].text || "—");
          },
        }),
        p.ready
          ? h("button.btn.ghost.wide", { onclick: () => set(ref(db, `${gpath}/players/${fid}/ready`), false) }, "✏️ Düzenle")
          : h("button.btn.wide.go", {
              disabled: !done,
              onclick: () => set(ref(db, `${gpath}/players/${fid}/ready`), true).then(() => vibrate(30)),
            }, done ? "Hazırım 👍" : "Önce 3 tahminini yaz"),
        h("h4", "Oyuncular"),
        h("div.chips", Object.values(players).map((q) => h("span.chip", { class: q.ready ? "ok" : "" }, q.ready ? "✅ " : "✏️ ", q.name)))));
    } else {
      const locked = lockedRows(fid, claims);
      const playing = st === "playing";
      const w = claims.birdo;
      parts.push(h("main.play",
        st === "finished" && w && h("div.banner.gold", `🏆 Bird'O! ${w.fid === fid ? "Kazandın! 🎉" : w.name + " kazandı!"}`),
        st === "stopped" && h("div.banner", "⏹️ Oyun host tarafından bitirildi."),
        playing && h("div.status-line", h("span", "Bird'ü izle 👀 gördüğünde dokun"), h("span.count", `${marked}/${filled}`)),
        renderCard(cells, {
          marks,
          highlightRows: locked,
          onTap: playing ? (i) => toggleMark(fid, i) : (i) => showInfo("Kart", cells[i].text || ""),
          onLong: (i) => showInfo(cells[i].t === "c" ? "Tahminin" : "Bird'ün özelliği", cells[i].text || ""),
        }),
        playing && h("p.hint", "Uzun bas: tam metni gör. Yanlış dokunduysan yeşile tekrar dokun.")));
      parts.push(claimBar(claims, showClaim));
    }
    mount(root, parts);
  }

  render();
  return () => {
    dead = true;
    unsubs.forEach((u) => u());
    document.removeEventListener("visibilitychange", onVisible);
    keepAwake(false);
  };
}
