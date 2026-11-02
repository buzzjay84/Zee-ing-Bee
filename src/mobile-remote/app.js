import { Player } from "./player.js";
import { VideoPlayer } from "./video-player.js";
import { syllableFill } from "./lyrics.js";
import { createModeWatcher } from "./mode.js";
import { createSync } from "./sync.js";
import { createPackStore } from "./packs.js";
import { findUpdate } from "./update.js";

const { searchSongs, warm: warmSearch } = window.ZBSearch;
const { withDefaults, summary, mountRows, wireSettingsDialog } = window.ZBSound;
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
// The karaoke video is the picture on the phone's own stage (the desktop shows it on its display instead).
videoPlayer.media.className = "background-video";
$("stage").querySelector(".backdrop").after(videoPlayer.media);

// ---------- Settings (kept on this phone) ----------

const SETTINGS_KEY = "zb-settings";
const settings = (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
})();
let mix = withDefaults(settings.mix);
const mixViews = [];
let backgroundUrls = null;

function saveSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* just won't be remembered */ }
  renderSettingsSummary();
}

function applyMix() {
  for (const part of ["melody", "bass", "drums", "band"]) midiPlayer.setMix(part, mix[part]);
  midiPlayer.setSound(mix);
  videoPlayer.setVolume(mix.volume);
  mixViews.forEach((refresh) => refresh());
}

/** Connected to a desktop, Settings shows and changes the desktop's sound; otherwise this phone's own. */
const shownMix = () => (isRemote() && state.remoteSound?.mix) || mix;
const shownGuide = () => (isRemote() ? state.remoteSound?.guide ?? midiPlayer.guide : midiPlayer.guide);

function sendSound(change) {
  const retry = () => toast("Reconnecting to the desktop… try again in a moment.");
  const message = { type: "sound", ...change };
  if (state.mode === "bluetooth") return modeWatcher.bleTransport.send(message).catch(retry);
  if (state.ws?.readyState !== WebSocket.OPEN) return retry();
  state.ws.send(JSON.stringify(message));
}

/** The desktop's mixer and guide, from its state messages. */
function applyRemoteSound(message) {
  if (!message.mix) return;
  state.remoteSound = { mix: withDefaults(message.mix), guide: message.guide !== false };
  mixViews.forEach((refresh) => refresh());
  renderSettingsSummary();
}

function changeMix(key, value) {
  if (isRemote()) {
    state.remoteSound = { ...state.remoteSound, mix: { ...shownMix(), [key]: value } };
    mixViews.forEach((refresh) => refresh());
    renderSettingsSummary();
    return sendSound({ mix: state.remoteSound.mix });
  }
  mix = { ...mix, [key]: value };
  applyMix();
  saveSettings({ mix });
}

function applyLyricStyle() {
  document.documentElement.style.setProperty("--lyric-scale", settings.lyricScale ?? 1);
  document.documentElement.style.setProperty("--sung", settings.lyricColor ?? "#ffd34d");
}

/** The desktop's sound banks (synced while paired) and the one downloaded with the song packs. */
async function soundBanks() {
  const fromPacks = await packs.getSoundBank();
  const banks = [...await sync.getSoundBanks(), fromPacks && { name: fromPacks.name, size: fromPacks.data.byteLength, load: async () => fromPacks.data }].filter(Boolean);
  // The desktop and the song packs can both carry GeneralUser GS; list it once.
  return [...new Map(banks.reverse().map((bank) => [bank.name, bank])).values()].reverse();
}

async function currentSoundBank() {
  const banks = await soundBanks();
  return banks.find((bank) => bank.name === settings.soundBank) ?? banks[0];
}

const bankName = (bank) => bank.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function pickSoundBank(bank) {
  saveSettings({ soundBank: bank.name });
  renderInstruments();
  if (player.song) return toast("The new sound plays from the next song.");
  try {
    midiReady ??= midiPlayer.init();
    await midiReady;
    if (midiPlayer.soundBankPath !== bank.name) await midiPlayer.loadSoundBank(bank.name, await bank.load());
    await midiPlayer.playSample();
  } catch (error) {
    toast(error.message, 4000);
  }
}

async function renderInstruments() {
  const list = $("instrument-list");
  if (isRemote()) return (list.textContent = "Connected to a desktop: pick its instrument in the desktop's Settings.");
  const [banks, current] = await Promise.all([soundBanks(), currentSoundBank()]);
  list.replaceChildren(
    ...banks.map((bank) => {
      const on = bank.name === current?.name;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `instrument${on ? " on" : ""}`;
      card.setAttribute("aria-pressed", String(on));
      const name = document.createElement("b");
      name.textContent = bankName(bank);
      const info = document.createElement("small");
      info.textContent = `${Math.round(bank.size / 1048576)} MB`;
      card.append(name, info);
      if (on) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "In use";
        card.append(badge);
      }
      card.onclick = () => pickSoundBank(bank);
      return card;
    }),
  );
  if (!banks.length) list.textContent = "No sound bank yet. It downloads with the songs, or comes from a desktop.";
}

function renderSettingsSummary() {
  const sound = shownMix();
  if (isRemote()) $("sum-sound").textContent = `The desktop's sound · ${summary(sound)}`;
  else currentSoundBank().then((bank) => { $("sum-sound").textContent = `${bank ? bankName(bank) : "No sound bank"} · ${summary(sound)}`; });
  $("sum-singing").textContent = `Melody ${shownGuide() ? "on" : "off"} · ${Math.round(sound.melody * 100)}%`;
  $("sum-lyrics").textContent = `Size ${Math.round((settings.lyricScale ?? 1) * 100)}%`;
  $("sum-screen").textContent = `Background: ${settings.backgrounds === false ? "Off" : "Videos"}`;
  $("set-guide").checked = shownGuide();
  $("set-backgrounds").checked = settings.backgrounds !== false;
  $("lyric-size").value = settings.lyricScale ?? 1;
  $("lyric-color").value = settings.lyricColor ?? "#ffd34d";
}

/** A looping video behind the lyrics of MIDI songs, from the backgrounds downloaded with the packs. */
async function startBackground() {
  const bg = $("background-video");
  bg.hidden = true;
  if (settings.backgrounds === false || player !== midiPlayer) return;
  backgroundUrls ??= (await packs.getBackgrounds()).map((blob) => URL.createObjectURL(blob));
  $("backgrounds-note").textContent = backgroundUrls.length ? "" : "No background videos on this phone yet. They download after the songs, on WiFi.";
  if (!backgroundUrls.length || player !== midiPlayer || !player.song) return;
  bg.src = backgroundUrls[Math.floor(Math.random() * backgroundUrls.length)];
  bg.hidden = false;
  bg.play().catch(() => {});
}

function stopBackground() {
  const bg = $("background-video");
  bg.hidden = true;
  bg.pause();
  bg.removeAttribute("src");
}

midiPlayer.setGuide(settings.guide ?? true);
applyMix();
applyLyricStyle();
mixViews.push(
  mountRows($("stage-mix"), ["melody", "bass", "drums", "band", "low", "high", "echo", "volume"], shownMix, changeMix),
  mountRows($("settings-mix"), ["bass", "drums", "band", "low", "high", "echo", "volume"], shownMix, changeMix),
  mountRows($("singing-mix"), ["melody"], shownMix, changeMix),
);
const openSettings = wireSettingsDialog($("settings"));
$("btn-settings").onclick = () => {
  renderSettingsSummary();
  renderInstruments();
  openSettings();
};
$("btn-mix-reset").onclick = () => {
  const melody = shownMix().melody;
  if (isRemote()) {
    state.remoteSound = { ...state.remoteSound, mix: withDefaults({ melody }) };
    return changeMix("melody", melody);
  }
  mix = withDefaults({ melody });
  changeMix("melody", melody);
};
$("set-guide").onchange = (e) => {
  if (isRemote()) {
    state.remoteSound = { ...state.remoteSound, guide: e.target.checked };
    renderSettingsSummary();
    return sendSound({ guide: e.target.checked });
  }
  midiPlayer.setGuide(e.target.checked);
  saveSettings({ guide: e.target.checked });
  updateStageControls();
};
$("lyric-size").oninput = (e) => ((settings.lyricScale = Number(e.target.value)), applyLyricStyle());
$("lyric-size").onchange = (e) => saveSettings({ lyricScale: Number(e.target.value) });
$("lyric-color").oninput = (e) => ((settings.lyricColor = e.target.value), applyLyricStyle());
$("lyric-color").onchange = (e) => saveSettings({ lyricColor: e.target.value });
$("set-backgrounds").onchange = (e) => {
  saveSettings({ backgrounds: e.target.checked });
  if (!player.song) return;
  if (e.target.checked) startBackground();
  else stopBackground();
};
$("app-version").textContent = window.ZB_VERSION ? `Version ${window.ZB_VERSION}` : "";
$("brand-version").textContent = window.ZB_VERSION ? `v${window.ZB_VERSION}` : "";
if (window.ZB_VERSION) document.title = `Zee-ing Bee Mobile v${window.ZB_VERSION}`;
$("set-support").onclick = () => ($("settings").close(), $("support").showModal());

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
  // Connecting or disconnecting switches the mixer between the desktop's sound and this phone's.
  mixViews.forEach((refresh) => refresh());
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
  if (state.byNumberFor !== state.songs) {
    state.byNumberFor = state.songs;
    state.byNumber = new Map(state.songs.map((s) => [String(s.number), s]));
    warmSearch(state.songs);
  }
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

const QUEUE_KEY = "zb-queue";
function renderQueue() {
  // In Standalone mode the reserved songs are this phone's own: they wait through Stop and restarts.
  if (state.mode === "standalone") {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue)); } catch { /* just won't be remembered */ }
  }
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
  clearTimeout(bleSearchTimer);
  // Wait for a pause in typing, so each key press doesn't redraw the list.
  if (state.mode !== "bluetooth") return (bleSearchTimer = setTimeout(renderSongs, 120));
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
    applyRemoteSound(message);
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
  // Songs first (tiny), then the desktop's stage videos for singing on the phone later.
  const pairing = state.pairing;
  packs.useDesktop(pairing);
  sync.startBackgroundSync(pairing, songs, renderSyncProgress, (song) => NATIVE && song.builtIn).catch(() => {})
    .then(() => packs.syncBackgroundsFrom(pairing))
    .then((added) => { if (added) backgroundUrls = null; })
    .catch((error) => console.warn("Copying background videos from the desktop failed:", error.message));
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
    applyRemoteSound(message);
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
  $("now-label").textContent = `${song.title}${song.artist ? ` — ${song.artist}` : ""}`;
  $("now-title").textContent = `${song.number ? `${song.number} · ` : ""}${song.title}`;
  $("title-card").classList.remove("gone");
  $("mixer").hidden = true;
  slots.forEach((slot) => (slot.index = -2));
}

function leaveStage() {
  player.stop();
  stopBackground();
  videoPlayer.media.hidden = true;
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
  // A karaoke video has its lyrics in the picture.
  $("stage").querySelector(".lyrics").hidden = isVideo;
  state.nowPlaying = song;
  if (isVideo) {
    stopBackground();
    player = videoPlayer;
    videoPlayer.media.hidden = false;
    await player.play(song, URL.createObjectURL(new Blob([bytes])));
  } else {
    videoPlayer.media.hidden = true;
    const bank = await currentSoundBank();
    if (!bank) throw new Error("No sound bank has synced from a desktop yet.");
    midiReady ??= midiPlayer.init();
    await midiReady;
    if (midiPlayer.soundBankPath !== bank.name) await midiPlayer.loadSoundBank(bank.name, await bank.load());
    player = midiPlayer;
    await player.play(song, bytes);
    startBackground();
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
  if (phase === "done") backgroundUrls = null; // pick up backgrounds that just finished downloading
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
  packs.useDesktop(null);
  state.ws?.close();
  state.ws = null;
  // Restored before the catalog loads, so nothing in between can save an empty list over it.
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? []; } catch { /* nothing saved */ }
  state.queue = saved;
  state.nowPlaying = null;
  renderStatus();
  state.songs = await standaloneCatalog();
  const byNumber = new Map(state.songs.map((song) => [String(song.number), song]));
  state.queue = state.queue.map((song) => byNumber.get(String(song.number))).filter(Boolean);
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
$("btn-guide").onclick = () => {
  midiPlayer.setGuide(!midiPlayer.guide);
  saveSettings({ guide: midiPlayer.guide });
  updateStageControls();
};
$("btn-mixer").onclick = () => ($("mixer").hidden = !$("mixer").hidden);

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

/** Same as the desktop: an INTRO countdown until the vocals, then count-in dots for the last 3 seconds. */
function renderIntro(t) {
  const first = player.lines?.[0]?.start;
  const inIntro = Number.isFinite(first) && t < first;
  $("intro-indicator").hidden = !inIntro || first - t <= 3;
  $("countin").hidden = !inIntro || first - t > 3;
  if (!inIntro) return;
  $("countin").textContent = "● ".repeat(Math.ceil(first - t)).trim();
  const remaining = Math.ceil((first - t) / Math.max(player.tempo || 1, 0.5));
  $("intro-countdown").textContent = `Vocals in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}${player.paused ? " · Paused" : ""}`;
  $("intro-progress-fill").style.width = `${Math.max(0, Math.min(100, (t / first) * 100))}%`;
}

setInterval(() => {
  if (state.mode !== "standalone" || !player.song) return;
  const t = player.time;
  renderLyrics(t);
  renderIntro(t);
  const firstLine = player.lines?.[0]?.start ?? 4;
  // The title card stays up through the intro and fades 2 seconds before the singing starts.
  if (t > Math.max(2, firstLine - 2)) $("title-card").classList.add("gone");
  const bg = $("background-video");
  if (!bg.hidden) player.paused ? bg.pause() : bg.paused && bg.play().catch(() => {});
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

/** Downloads the APK in the app and opens Android's installer (it asks once to confirm). */
async function installUpdate(update) {
  const updater = window.Capacitor?.Plugins?.AppUpdater;
  if (!updater) return window.open(update.url, "_blank"); // an older APK without the plugin
  toast("Downloading the update…", 60000);
  try {
    await updater.install({ url: update.url });
    toast("Tap Install to finish updating.");
  } catch (error) {
    toast(`Update failed: ${error.message}`, 5000);
  }
}

function showUpdate(update) {
  const el = $("update-banner");
  el.textContent = `Update v${update.version} is available. `;
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "Update now";
  button.onclick = () => installUpdate(update);
  el.append(button);
  el.hidden = false;
}

if (NATIVE && window.ZB_VERSION) {
  findUpdate(window.ZB_VERSION).then((update) => update && showUpdate(update)).catch(() => {}); // offline: try again next launch
}
$("btn-check-updates").hidden = !NATIVE;
$("btn-check-updates").onclick = async () => {
  $("update-check-status").textContent = "Checking…";
  try {
    const update = await findUpdate(window.ZB_VERSION);
    $("update-check-status").textContent = update ? `Version ${update.version} is out.` : "You're up to date.";
    if (update) {
      showUpdate(update);
      installUpdate(update);
    }
  } catch {
    $("update-check-status").textContent = "Couldn't check. Are you online?";
  }
};
