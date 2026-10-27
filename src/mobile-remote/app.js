import { Player } from "./player.js";
import { VideoPlayer } from "./video-player.js";
import { syllableFill } from "./lyrics.js";
import { createModeWatcher } from "./mode.js";
import { createSync } from "./sync.js";

const { searchSongs } = window.ZBSearch;
const $ = (id) => document.getElementById(id);

const state = {
  mode: null,
  pairing: null,
  songs: [],
  query: "",
  queue: [],
  nowPlaying: null,
  ws: null,
  bleResults: [],
};

const sync = createSync();
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
  banner.textContent = { remote: "Connected to desktop", bluetooth: "Connected via Bluetooth (search only, no offline songs)", standalone: "No desktop found - playing on this phone" }[state.mode] ?? "Checking for a desktop…";
  banner.className = `mode-banner ${state.mode ?? ""}`;
}

/** Bluetooth mode has no local catalog to filter - results only exist once the desktop answers a search. */
function renderSongs() {
  const list = state.mode === "bluetooth" ? state.bleResults : searchSongs(state.songs, state.query).songs;
  $("song-count").textContent = `${list.length} song${list.length === 1 ? "" : "s"}`;
  $("results").replaceChildren(
    ...list.slice(0, 200).map((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><div><div class="title"></div><div class="artist"></div></div><button data-act="go"></button>`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".title").textContent = s.title;
      li.querySelector(".artist").textContent = [s.artist, s.category].filter(Boolean).join(" · ");
      const button = li.querySelector("button");
      button.textContent = state.mode === "standalone" ? "Sing" : "Reserve";
      button.onclick = () => (state.mode === "standalone" ? reserveStandalone(s) : reserveRemote(s));
      return li;
    }),
  );
}

function renderQueue() {
  $("queue-count").textContent = state.queue.length ? `(${state.queue.length})` : "";
  $("queue").replaceChildren(
    ...state.queue.map((s, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><span class="t"></span>${state.mode === "standalone" ? '<button title="Remove">✕</button>' : ""}`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".t").textContent = s.title;
      if (state.mode === "standalone") {
        li.querySelector("button").onclick = () => {
          state.queue.splice(i, 1);
          renderQueue();
        };
      }
      return li;
    }),
  );
  $("now-playing").textContent = state.nowPlaying ? `Now playing: ${state.nowPlaying.number ? `${state.nowPlaying.number} · ` : ""}${state.nowPlaying.title}` : "Nothing playing";
}

let bleSearchTimer;
$("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  if (state.mode !== "bluetooth") return renderSongs();
  clearTimeout(bleSearchTimer);
  bleSearchTimer = setTimeout(() => modeWatcher.bleTransport.send({ type: "search", query: state.query }), 400);
});

// ---------- Remote mode (WiFi or Bluetooth): search/reserve only, playback happens on the desktop ----------

function reserveRemote(song) {
  if (state.mode === "bluetooth") modeWatcher.bleTransport.send({ type: "reserve", number: song.number });
  else state.ws?.send(JSON.stringify({ type: "reserve", number: song.number }));
  toast(`Reserved ${song.number} · ${song.title}`);
}

function connectWs() {
  state.ws?.close();
  const ws = new WebSocket(`${state.pairing.origin.replace(/^http/, "ws")}/ws?token=${state.pairing.token}`);
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "state") return;
    state.queue = message.queue;
    state.nowPlaying = message.nowPlaying;
    renderQueue();
  };
  ws.onclose = () => {
    if (state.mode === "remote" && state.ws === ws) setTimeout(connectWs, 2000);
  };
  state.ws = ws;
}

async function enterRemoteMode() {
  state.mode = "remote";
  renderStatus();
  const songs = await (await fetch(`${state.pairing.origin}/api/songs?token=${state.pairing.token}`)).json();
  state.songs = songs;
  renderSongs();
  connectWs();
  sync.startBackgroundSync(state.pairing, songs).catch(() => {});
}

// ---------- Bluetooth mode: same search/reserve idea as Remote, but desktop-driven search ----------

function enterBluetoothMode() {
  state.mode = "bluetooth";
  state.ws?.close();
  state.ws = null;
  state.bleResults = [];
  state.query = "";
  $("search").value = "";
  renderStatus();
  renderSongs();
  renderQueue();
}

function handleBleMessage(message) {
  if (message.type === "searchResults") {
    state.bleResults = message.songs;
    renderSongs();
  } else if (message.type === "state") {
    state.queue = message.queue;
    state.nowPlaying = message.nowPlaying;
    renderQueue();
  }
}

// ---------- Standalone mode: this phone plays songs itself ----------

function reserveStandalone(song) {
  state.queue.push(song);
  renderQueue();
  if (!player.song) playNextStandalone();
}

async function playNextStandalone() {
  const next = state.queue.shift();
  renderQueue();
  if (!next) return leaveStage();
  await singStandalone(next).catch((error) => {
    toast(error.message);
    playNextStandalone();
  });
}

function enterStage(song) {
  $("home").hidden = true;
  $("stage").hidden = false;
  $("stage-title").textContent = song.title;
  $("stage-artist").textContent = song.artist ?? "";
  slots.forEach((slot) => (slot.index = -2));
}

function leaveStage() {
  player.stop();
  state.nowPlaying = null;
  $("stage").hidden = true;
  $("home").hidden = false;
}

async function singStandalone(song) {
  const isVideo = song.mediaKind === "video";
  const bytes = await sync.getSongBytes(song.number, song.mediaKind);
  if (!bytes) throw new Error("This song hasn't been downloaded for offline play yet.");
  enterStage(song);
  state.nowPlaying = song;
  if (isVideo) {
    player = videoPlayer;
    await player.play(song, URL.createObjectURL(new Blob([bytes])));
  } else {
    const bank = await sync.getSoundBank();
    if (!bank) throw new Error("No sound bank has synced from a desktop yet.");
    midiReady ??= midiPlayer.init();
    await midiReady;
    await midiPlayer.loadSoundBank(bank.name, bank.data);
    player = midiPlayer;
    await player.play(song, bytes);
  }
}

async function enterStandaloneMode() {
  state.mode = "standalone";
  state.ws?.close();
  state.ws = null;
  state.queue = [];
  state.nowPlaying = null;
  renderStatus();
  state.songs = await sync.getCatalog();
  renderSongs();
  renderQueue();
}

midiPlayer.onEnded = () => playNextStandalone();
videoPlayer.onEnded = () => playNextStandalone();
videoPlayer.onError = (error) => {
  toast(error.message);
  playNextStandalone();
};

$("btn-stop").onclick = () => leaveStage();
$("btn-pause").onclick = () => {
  player.togglePause();
  $("btn-pause").textContent = player.paused ? "Resume" : "Pause";
};

// ---------- Lyrics (standalone playback only - remote mode never sings locally) ----------

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
  const dur = player.duration;
  $("progress-fill").style.width = dur ? `${Math.min((t / dur) * 100, 100)}%` : "0";
}, 33);

// ---------- Mode switching ----------

const modeWatcher = createModeWatcher({
  onChange: (mode, pairing) => {
    state.pairing = pairing;
    if (mode === "remote") enterRemoteMode().catch((error) => toast(error.message));
    else if (mode === "bluetooth") enterBluetoothMode();
    else enterStandaloneMode().catch((error) => toast(error.message));
  },
  onBleMessage: handleBleMessage,
});
