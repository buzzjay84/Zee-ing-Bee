import { Player } from "./player.js";
import { VideoPlayer } from "./video-player.js";
import { syllableFill } from "./lyrics.js";
import { createModeWatcher } from "./mode.js";
import { createSync } from "./sync.js";
import { createPackStore } from "./packs.js";
import { findUpdate } from "./update.js";

const { searchSongs } = window.ZBSearch;
const $ = (id) => document.getElementById(id);

const state = {
  mode: null,
  pairing: null,
  songs: [],
  query: "",
  category: "All",
  digits: "",
  byNumber: new Map(),
  queue: [],
  nowPlaying: null,
  paused: false,
  ws: null,
  bleResults: [],
};

const sync = createSync();
const packs = createPackStore();
// Only the installed app can download the song packs (see packs.js); a browser remote can't.
const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.());
const midiPlayer = new Player();
const videoPlayer = new VideoPlayer();
let player = midiPlayer;
let midiReady = null;

// ---------- Shared rendering ----------

function toast(text, ms = 2500) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function renderStatus() {
  const banner = $("mode-banner");
  banner.textContent = { remote: "Connected to desktop", bluetooth: "Connected to desktop via Bluetooth", standalone: "No desktop found - playing on this phone" }[state.mode] ?? "Checking for a desktop…";
  banner.className = `mode-banner ${state.mode ?? ""}`;
  $("btn-pair").hidden = isRemote() || !window.Capacitor?.Plugins?.QrScanner;
  $("btn-disconnect").hidden = !isRemote();
  $("btn-nickname").hidden = !isRemote();
  $("btn-nickname").textContent = nickname() ? `Name: ${nickname()}` : "Set your name";
}

const NICKNAME_KEY = "zb-nickname";
function nickname() {
  try { return localStorage.getItem(NICKNAME_KEY) ?? ""; } catch { return ""; }
}
/** Asks for the name the desktop shows beside this phone's reservations; false if cancelled. */
function askNickname() {
  const name = prompt("Your name, shown on the desktop next to the songs you reserve:", nickname())?.trim().slice(0, 24);
  if (!name) return false;
  try { localStorage.setItem(NICKNAME_KEY, name); } catch { /* name just won't be remembered */ }
  renderStatus();
  return true;
}

$("btn-nickname").onclick = askNickname;
$("btn-disconnect").onclick = () => {
  if (!confirm("Disconnect from the desktop and sing on this phone? Scan the desktop QR again to reconnect.")) return;
  modeWatcher.disconnect();
};

/** WiFi and Bluetooth both make this phone a remote: the desktop sings, the phone picks songs. */
function isRemote() {
  return state.mode === "remote" || state.mode === "bluetooth";
}

/** Bluetooth mode has no local catalog to filter - results only exist once the desktop answers a search. */
function catalog() {
  return state.mode === "bluetooth" ? state.bleResults : state.songs;
}

function renderChips() {
  const cats = state.mode === "bluetooth" ? [] : ["All", ...new Set(state.songs.map((s) => s.category).filter(Boolean))];
  if (!cats.includes(state.category)) state.category = "All";
  $("chips").replaceChildren(
    ...(cats.length > 2 ? cats : []).map((c) => {
      const b = document.createElement("button");
      b.textContent = c;
      b.className = c === state.category ? "on" : "";
      b.onclick = () => {
        state.category = c;
        renderChips();
        renderSongs();
      };
      return b;
    }),
  );
}

function renderSongs() {
  const all = catalog();
  const pool = state.category === "All" ? all : all.filter((s) => s.category === state.category);
  const result = state.mode === "bluetooth" ? { songs: all, mode: "all" } : searchSongs(pool, state.query);
  const list = result.songs;
  state.byNumber = new Map(state.songs.map((s) => [String(s.number), s]));
  $("search-note").hidden = result.mode === "all";
  $("search-note").textContent = result.mode === "exact" ? `${result.exactCount} exact match${result.exactCount === 1 ? "" : "es"}${result.suggestedCount ? ` · ${result.suggestedCount} suggested` : ""}` : list.length ? "No exact match. Showing suggested songs." : "No matches found.";
  $("song-count").textContent = `${list.length} song${list.length === 1 ? "" : "s"}`;
  $("empty").hidden = !(state.mode === "standalone" && !state.songs.length);
  $("results").replaceChildren(
    ...list.slice(0, 200).flatMap((s, index) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><div><div class="title"></div><div class="artist"></div></div>
        <div class="row-actions"><button data-act="reserve">Reserve</button><button data-act="sing" class="primary" aria-label="Sing now">▶</button></div>`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".title").textContent = s.title;
      li.querySelector(".artist").textContent = [s.artist, s.category].filter(Boolean).join(" · ");
      li.querySelector('[data-act="reserve"]').onclick = () => reserve(s);
      li.querySelector('[data-act="sing"]').onclick = () => singNow(s);
      if (result.mode !== "all" && (index === 0 || index === result.exactCount)) {
        const heading = document.createElement("li");
        heading.className = "search-section-heading";
        heading.setAttribute("role", "presentation");
        heading.textContent = index < result.exactCount ? "Exact matches" : "Suggested songs";
        return [heading, li];
      }
      return [li];
    }),
  );
  setDigits(state.digits);
}

function reserve(song) {
  return isRemote() ? sendRemote("reserve", song) : reserveLocal(song);
}

function singNow(song) {
  return isRemote() ? sendRemote("singNow", song) : singNowLocal(song);
}

function renderQueue() {
  $("queue-count").textContent = state.queue.length ? `(${state.queue.length})` : "";
  $("queue").replaceChildren(
    ...state.queue.map((s, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><span class="t"></span><span class="by"></span><button title="Remove">✕</button>`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".t").textContent = s.title || "";
      li.querySelector(".by").textContent = s.by ?? "";
      li.querySelector("button").onclick = () => {
        if (isRemote()) return sendRemote("remove", s);
        state.queue.splice(i, 1);
        renderQueue();
      };
      return li;
    }),
  );
  $("queue-empty").hidden = state.queue.length > 0;
  $("next-up").textContent = state.queue[0] ? `Next: ${state.queue[0].number} · ${state.queue[0].title}` : "";
  $("remote-controls").hidden = !isRemote() || !state.nowPlaying;
  $("remote-pause").textContent = state.paused ? "▶" : "❚❚";
  $("remote-pause").setAttribute("aria-label", state.paused ? "Play" : "Pause");
  $("now-playing").textContent = state.nowPlaying ? `Now playing: ${state.nowPlaying.number ? `${state.nowPlaying.number} · ` : ""}${state.nowPlaying.title}` : "Nothing playing";
}

// ---------- Number pad ----------

/** Bluetooth has no catalog on the phone, so a typed number is sent as-is and the desktop looks it up. */
function songFromDigits() {
  if (!state.digits) return null;
  const song = state.byNumber.get(state.digits) ?? (state.mode === "bluetooth" ? { number: Number(state.digits), title: "" } : null);
  if (!song) toast("No song with that number");
  else setDigits("");
  return song;
}

function setDigits(d) {
  state.digits = d.slice(0, 5);
  $("number-display").textContent = state.digits.padEnd(5, "-");
  const song = state.byNumber.get(state.digits);
  $("number-song").textContent = song
    ? `${song.title}${song.artist ? ` · ${song.artist}` : ""}`
    : state.digits.length === 5 && state.mode !== "bluetooth"
      ? "No song with that number"
      : "Type a song number";
}

$("btn-number-pad").onclick = () => {
  const pad = $("number-pad");
  pad.hidden = !pad.hidden;
  $("btn-number-pad").setAttribute("aria-expanded", String(!pad.hidden));
};
$("btn-number-pad-close").onclick = () => $("btn-number-pad").click();
$("btn-support").onclick = () => $("support").showModal();
$("keypad").addEventListener("click", (event) => {
  const key = event.target.closest("button")?.dataset.key;
  if (key === "clear") setDigits("");
  else if (key === "back") setDigits(state.digits.slice(0, -1));
  else if (key) setDigits(state.digits + key);
});
$("btn-reserve").onclick = () => {
  const song = songFromDigits();
  if (song) reserve(song);
};
$("btn-sing-now").onclick = () => {
  const song = songFromDigits();
  if (song) singNow(song);
};

let bleSearchTimer;
$("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  if (state.mode !== "bluetooth") return renderSongs();
  clearTimeout(bleSearchTimer);
  bleSearchTimer = setTimeout(() => modeWatcher.bleTransport.send({ type: "search", query: state.query }).catch(() => {}), 400);
});

// ---------- Remote modes (WiFi or Bluetooth): search, sing now, reserve - playback happens on the desktop ----------

const SENT = { reserve: "Reserved", singNow: "Singing on the desktop:", remove: "Removed" };

function sendRemote(type, song) {
  if (type !== "remove" && !nickname() && !askNickname()) return;
  const sent = () => toast(`${SENT[type]} ${song.number}${song.title ? ` · ${song.title}` : ""}`);
  const retry = () => toast("Reconnecting to the desktop… try again in a moment.");
  const message = { type, number: song.number, by: nickname() };
  if (state.mode === "bluetooth") return modeWatcher.bleTransport.send(message).then(sent, retry);
  if (state.ws?.readyState !== WebSocket.OPEN) return retry();
  state.ws.send(JSON.stringify(message));
  sent();
}

/** Play/pause, next, previous or stop on the desktop. */
function sendControl(action) {
  const message = { type: "control", action };
  const retry = () => toast("Reconnecting to the desktop… try again in a moment.");
  if (state.mode === "bluetooth") return modeWatcher.bleTransport.send(message).catch(retry);
  if (state.ws?.readyState !== WebSocket.OPEN) return retry();
  state.ws.send(JSON.stringify(message));
}

$("remote-controls").addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.control;
  if (action) sendControl(action);
});

/** Accepts the desktop's pairing URL, e.g. http://192.168.1.5:47800/?token=abc… */
function pairingFromText(text) {
  try {
    const url = new URL(text.trim());
    const token = url.searchParams.get("token");
    return /^https?:$/.test(url.protocol) && token ? { origin: url.origin, token } : null;
  } catch {
    return null;
  }
}

$("btn-pair").onclick = async () => {
  let text;
  try {
    text = (await window.Capacitor.Plugins.QrScanner.scan()).value;
  } catch (error) {
    if (error.message === "cancelled") return;
    // No Google Play services (or the scanner failed): typing the address under the QR still works.
    text = prompt("Couldn't open the scanner. Type the address shown under the QR code on the desktop:");
  }
  const pairing = text && pairingFromText(text);
  if (!pairing) return text && toast("That isn't a Zee-ing Bee pairing code.");
  toast("Connecting to the desktop…");
  await modeWatcher.repair(pairing);
  if (state.mode !== "remote") toast("Couldn't reach the desktop. Make sure the phone and laptop are on the same WiFi.", 4000);
};

function connectWs() {
  state.ws?.close();
  const ws = new WebSocket(`${state.pairing.origin.replace(/^http/, "ws")}/ws?token=${state.pairing.token}`);
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "state") return;
    state.queue = message.queue;
    state.nowPlaying = message.nowPlaying;
    state.paused = Boolean(message.paused);
    renderQueue();
  };
  ws.onclose = () => {
    if (state.mode === "remote" && state.ws === ws) setTimeout(connectWs, 2000);
  };
  state.ws = ws;
}

function renderSyncProgress({ done, total }) {
  const el = $("sync-banner");
  if (total === 0 || done >= total) {
    if (!el.hidden) {
      el.textContent = "Ready to play offline on this phone";
      setTimeout(() => (el.hidden = true), 3000);
    }
    return;
  }
  el.hidden = false;
  el.textContent = `Downloading songs for offline play… ${done}/${total}`;
}

async function enterRemoteMode() {
  state.mode = "remote";
  renderStatus();
  const songs = await (await fetch(`${state.pairing.origin}/api/songs?token=${state.pairing.token}`)).json();
  state.songs = songs;
  renderChips();
  renderSongs();
  connectWs();
  sync.startBackgroundSync(state.pairing, songs, renderSyncProgress, (song) => NATIVE && song.builtIn).catch(() => {});
}

// ---------- Bluetooth mode: same remote as WiFi, but search runs on the desktop (no catalog download) ----------

function enterBluetoothMode() {
  state.mode = "bluetooth";
  state.ws?.close();
  state.ws = null;
  state.bleResults = [];
  state.query = "";
  $("search").value = "";
  state.queue = [];
  state.nowPlaying = null;
  renderStatus();
  renderChips();
  renderSongs();
  renderQueue();
  modeWatcher.bleTransport.send({ type: "search", query: "" }).catch(() => {});
}

function handleBleMessage(message) {
  if (message.type === "searchResults") {
    state.bleResults = message.songs;
    renderSongs();
  } else if (message.type === "state") {
    state.queue = message.queue;
    state.nowPlaying = message.nowPlaying;
    state.paused = Boolean(message.paused);
    renderQueue();
  }
}

// ---------- Local playback: Standalone mode sings on this phone from songs synced earlier ----------

function reserveLocal(song) {
  state.queue.push(song);
  renderQueue();
  if (!player.song) playNextLocal();
  else toast(`Reserved ${song.number} · ${song.title}`);
}

function singNowLocal(song) {
  state.queue.unshift(song);
  player.stop();
  playNextLocal();
}

async function playNextLocal() {
  const next = state.queue.shift();
  renderQueue();
  if (!next) return leaveStage();
  await singLocal(next).catch((error) => {
    toast(error.message, 4000);
    playNextLocal();
  });
}

function enterStage(song) {
  $("home").hidden = true;
  $("stage").hidden = false;
  $("tc-number").textContent = song.number ?? "";
  $("tc-title").textContent = song.title;
  $("tc-artist").textContent = song.artist ?? "";
  $("now-title").textContent = `${song.number ? `${song.number} · ` : ""}${song.title}`;
  $("title-card").classList.remove("gone");
  $("mixer").hidden = true;
  slots.forEach((slot) => (slot.index = -2));
}

function leaveStage() {
  player.stop();
  state.nowPlaying = null;
  $("stage").hidden = true;
  $("home").hidden = false;
  renderQueue();
}

function updateStageControls() {
  const isVideo = player === videoPlayer;
  const hasGuide = !isVideo && player.melodyChannel !== -1;
  for (const id of ["key-down", "key-up", "btn-mixer"]) $(id).disabled = isVideo;
  $("btn-guide").disabled = !hasGuide;
  $("btn-guide").classList.toggle("on", hasGuide && player.guide);
  $("btn-guide").textContent = hasGuide ? `Guide: ${player.guide ? "On" : "Off"}` : "Guide: n/a";
  $("btn-guide").setAttribute("aria-pressed", String(hasGuide && player.guide));
  $("key-value").textContent = `Key ${player.key > 0 ? "+" : ""}${player.key}`;
  $("tempo-value").textContent = `${Math.round(player.tempo * 100)}%`;
  $("btn-pause").textContent = player.paused ? "▶" : "❚❚";
  $("btn-pause").setAttribute("aria-label", player.paused ? "Resume" : "Pause");
}

async function singLocal(song) {
  const isVideo = song.mediaKind === "video";
  const bytes = song.pack ? await packs.getSongBytes(song) : await sync.getSongBytes(song.number, song.mediaKind);
  if (!bytes) throw new Error(isVideo ? "This video hasn't been saved for offline play." : "This song hasn't been downloaded for offline play yet.");
  enterStage(song);
  state.nowPlaying = song;
  if (isVideo) {
    player = videoPlayer;
    await player.play(song, URL.createObjectURL(new Blob([bytes])));
  } else {
    const bank = (await sync.getSoundBank()) ?? (await packs.getSoundBank());
    if (!bank) throw new Error("No sound bank has synced from a desktop yet.");
    midiReady ??= midiPlayer.init();
    await midiReady;
    await midiPlayer.loadSoundBank(bank.name, bank.data);
    player = midiPlayer;
    await player.play(song, bytes);
  }
  updateStageControls();
}

/** The downloaded song packs, plus the desktop's own songs (not from the packs) synced from it. */
async function standaloneCatalog() {
  const [fromPacks, fromDesktop] = await Promise.all([packs.getCatalog(), sync.getCatalog()]);
  if (!fromPacks.length) return fromDesktop;
  const taken = new Set(fromPacks.map((song) => song.number));
  return [...fromPacks, ...fromDesktop.filter((song) => !song.builtIn && !taken.has(song.number))];
}

function renderPackProgress({ phase, percent }) {
  const el = $("packs-banner");
  el.hidden = phase === "done";
  el.textContent = phase === "soundbank" ? `Downloading sound bank… ${percent}%` : phase === "retrying" ? "Song download paused · Retrying…" : `Downloading songs… ${percent}%`;
}

if (NATIVE) {
  packs.syncForever(renderPackProgress, async () => {
    if (state.mode !== "standalone") return;
    state.songs = await standaloneCatalog();
    renderChips();
    renderSongs();
  });
}

async function enterStandaloneMode() {
  state.mode = "standalone";
  state.ws?.close();
  state.ws = null;
  state.queue = [];
  state.nowPlaying = null;
  renderStatus();
  state.songs = await standaloneCatalog();
  renderChips();
  renderSongs();
  renderQueue();
}

midiPlayer.onEnded = () => playNextLocal();
videoPlayer.onEnded = () => playNextLocal();
videoPlayer.onError = (error) => {
  toast(error.message);
  playNextLocal();
};

// Same as the desktop: reserved songs wait for the next Reserve or Sing now.
$("btn-stop").onclick = () => {
  if (state.queue.length && !confirm(`Stop singing? ${state.queue.length} reserved song(s) will wait.`)) return;
  leaveStage();
};
$("btn-pause").onclick = () => (player.togglePause(), updateStageControls());
$("btn-skip").onclick = () => (player.stop(), playNextLocal());
$("key-down").onclick = () => (player.setKey(player.key - 1), updateStageControls());
$("key-up").onclick = () => (player.setKey(player.key + 1), updateStageControls());
$("tempo-down").onclick = () => (player.setTempo(player.tempo - 0.05), updateStageControls());
$("tempo-up").onclick = () => (player.setTempo(player.tempo + 0.05), updateStageControls());
$("btn-guide").onclick = () => (midiPlayer.setGuide(!midiPlayer.guide), updateStageControls());
$("btn-mixer").onclick = () => ($("mixer").hidden = !$("mixer").hidden);
$("mixer").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  if (event.target.dataset.mix) player.setMix(event.target.dataset.mix, value);
  if (event.target.id === "mix-echo") player.setEcho(value);
  if (event.target.id === "mix-volume") player.setVolume(value);
});

// ---------- Lyrics (Standalone mode only - the remote modes never sing locally) ----------

const slots = [0, 1].map((n) => ({ el: $(`slot-${n}`), index: -2, spans: [] }));

function fillSlot(slot, index) {
  if (slot.index === index) return;
  slot.index = index;
  slot.spans = [];
  const line = player.lines?.[index];
  if (!line) {
    slot.el.replaceChildren();
    return;
  }
  slot.el.replaceChildren(
    ...line.syllables.map((syllable) => {
      const span = document.createElement("span");
      span.className = "syl";
      span.textContent = syllable.text;
      slot.spans.push(span);
      return span;
    }),
  );
}

function renderLyrics(t) {
  const lines = player.lines ?? [];
  if (!lines.length) {
    slots[0].el.textContent = player.song && t > 1 ? "♪ ♪ ♪" : "";
    slots[1].el.textContent = "";
    slots.forEach((s) => (s.index = -1));
    return;
  }
  let cur = 0;
  while (cur + 1 < lines.length && lines[cur + 1].start <= t) cur++;
  const mine = slots[cur % 2];
  const other = slots[(cur + 1) % 2];
  fillSlot(mine, cur);
  const curLine = lines[cur];
  const gapAhead = (lines[cur + 1]?.start ?? Infinity) - t;
  fillSlot(other, t > curLine.end + 0.5 && gapAhead > 6 ? -1 : cur + 1);
  for (const slot of slots) {
    const line = lines[slot.index];
    if (!line) continue;
    slot.spans.forEach((span, i) => span.style.setProperty("--fill", `${(syllableFill(line, i, t) * 100).toFixed(1)}%`));
  }
}

setInterval(() => {
  if (state.mode !== "standalone" || !player.song) return;
  const t = player.time;
  renderLyrics(t);
  const firstLine = player.lines?.[0]?.start ?? 4;
  if (t > Math.min(5, Math.max(2, firstLine - 1))) $("title-card").classList.add("gone");
  const dur = player.duration;
  $("progress-fill").style.width = dur ? `${Math.min((t / dur) * 100, 100)}%` : "0";
}, 33);

// ---------- Mode switching ----------

const modeWatcher = createModeWatcher({
  onChange: (mode, pairing) => {
    state.pairing = pairing;
    // A desktop just showed up mid-song: stop singing here, or the phone would go on to play the desktop's queue itself.
    if (mode !== "standalone" && player.song) leaveStage();
    if (mode === "remote") enterRemoteMode().catch((error) => toast(error.message));
    else if (mode === "bluetooth") enterBluetoothMode();
    else enterStandaloneMode().catch((error) => toast(error.message));
  },
  onBleMessage: handleBleMessage,
});

// ---------- Updates: the installed app checks GitHub on launch ----------

if (NATIVE && window.ZB_VERSION) {
  findUpdate(window.ZB_VERSION).then((update) => {
    if (!update) return;
    const el = $("update-banner");
    el.innerHTML = `Update v${update.version} is available. <a></a>`;
    el.querySelector("a").href = update.url;
    el.querySelector("a").textContent = "Download and install";
    el.hidden = false;
  }).catch(() => {}); // offline: try again next launch
}
