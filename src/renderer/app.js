import { Player } from "./player.js";
import { VideoPlayer } from "./video-player.js";
import { wireKaraokeSearch } from "./karaoke-search.js";
import { syllableFill } from "./lyrics.js";
import { createBluetoothRemote } from "./bluetooth-remote.js";

const { searchSongs } = window.ZBSearch;
const $ = (id) => document.getElementById(id);
const LIST_LIMIT = 400;

const state = {
  songs: [],
  byNumber: new Map(),
  folders: [],
  settings: {},
  soundBanks: [],
  category: "All",
  query: "",
  digits: "",
  queue: [],
};

const midiPlayer = new Player();
const videoPlayer = new VideoPlayer();
let player = midiPlayer;
let playRequest = 0;
let playerReady = null;
let playbackId = 0;
let musicVideoSaved = false;
const isRecordedVideo = (song) => song?.mediaKind === "video" || song?.mediaKind === "music-video";

// ---------- Library ----------

function applyLibrary(data) {
  state.songs = data.songs;
  state.byNumber = new Map(data.songs.map((s) => [String(s.number), s]));
  state.folders = data.folders;
  state.settings = data.settings ?? {};
  $("asset-export-path").textContent = data.assetExportDir ?? "";
  midiPlayer.setGuide(state.settings.guideEnabled ?? true);
  midiPlayer.setMix("melody", state.settings.guideVolume ?? 1.35);
  $("guide-level").value = midiPlayer.mix.melody;
  const mixerGuide = document.querySelector('[data-mix="melody"]');
  if (mixerGuide) mixerGuide.value = midiPlayer.mix.melody;
  state.soundBanks = data.soundBanks;
  state.queue = state.queue.filter((s) => state.byNumber.has(String(s.number)));
  applyLyricStyle();
  renderChips();
  renderSongs();
  renderQueue();
  renderSettings();
}

function renderChips() {
  const cats = ["All", ...new Set(state.songs.map((s) => s.category))];
  if (!cats.includes(state.category)) state.category = "All";
  $("chips").replaceChildren(
    ...cats.map((c) => {
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
  const result = searchSongs(state.category === "All" ? state.songs : state.songs.filter((s) => s.category === state.category), state.query);
  const list = result.songs;
  $("search-note").hidden = result.mode === "all";
  $("search-note").textContent = result.mode === "exact" ? `${result.exactCount} exact match${result.exactCount === 1 ? "" : "es"}${result.suggestedCount ? ` · ${result.suggestedCount} suggested` : ""}` : list.length ? "No exact match. Showing suggested songs." : "No matches found. Try another title, artist, or Find online karaoke.";
  $("song-count").textContent = `${list.length} song${list.length === 1 ? "" : "s"}`;
  $("empty").hidden = state.songs.length > 0;
  $("song-list").replaceChildren(
    ...list.slice(0, LIST_LIMIT).flatMap((s, index) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><div><div class="title"></div><div class="artist"></div></div>
        <div class="row-actions"><button data-act="reserve">Reserve</button><button data-act="sing" class="primary">▶</button></div>`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".title").textContent = s.title;
      li.querySelector(".artist").textContent = [s.artist, s.category].filter(Boolean).join(" · ");
      li.querySelector('[data-act="reserve"]').onclick = () => reserve(s);
      li.querySelector('[data-act="sing"]').onclick = () => singNow(s);
      li.ondblclick = () => singNow(s);
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
}

// ---------- Number pad ----------

function setDigits(d) {
  state.digits = d.slice(0, 5);
  const shown = state.digits.padEnd(5, "-");
  $("number-display").textContent = shown;
  const song = state.byNumber.get(state.digits);
  $("number-song").textContent = song
    ? `${song.title}${song.artist ? ` · ${song.artist}` : ""}`
    : state.digits.length === 5
      ? "No song with that number"
      : "Type a song number";
  const stageNum = $("stage-number");
  stageNum.hidden = !state.digits;
  stageNum.textContent = song ? `${shown}  ${song.title}` : shown;
}

function pressKey(key) {
  if (key === "clear") setDigits("");
  else if (key === "back") setDigits(state.digits.slice(0, -1));
  else if (/^\d$/.test(key)) setDigits(state.digits + key);
}

function songFromDigits() {
  const song = state.byNumber.get(state.digits);
  if (!song) {
    if (state.digits) toast("No song with that number");
    return null;
  }
  setDigits("");
  return song;
}

// ---------- Queue ----------

function reserve(song) {
  state.queue.push(song);
  renderQueue();
  toast(`Reserved ${song.number} · ${song.title}`);
  if (!player.song) playNext();
}

function removeFromQueueByNumber(number) {
  const index = state.queue.findIndex((s) => String(s.number) === String(number));
  if (index === -1) return;
  state.queue.splice(index, 1);
  renderQueue();
}

/** Shared by the WiFi (IPC) and Bluetooth transports - both just hand it a {type, number}. */
function applyRemoteAction(action) {
  const song = state.byNumber.get(String(action.number));
  if (!song) return;
  if (action.type === "reserve") reserve(song);
  else if (action.type === "remove") removeFromQueueByNumber(action.number);
  else if (action.type === "singNow") { removeFromQueueByNumber(action.number); singNow(song); }
}

const bluetoothRemote = createBluetoothRemote({ getSongs: () => state.songs, onCommand: applyRemoteAction, onConnected: () => pushRemoteState() });

/** Keeps a paired phone's reserve list and now-playing banner in sync with the desktop. */
function pushRemoteState() {
  const minimal = (s) => ({ number: s.number, title: s.title, artist: s.artist });
  const payload = { queue: state.queue.map(minimal), nowPlaying: player.song ? minimal(player.song) : null };
  window.zb.pushRemoteState?.(payload).catch(() => {});
  if (bluetoothRemote.isConnected()) bluetoothRemote.sendState({ type: "state", ...payload }).catch(() => {});
}

function renderQueue() {
  $("queue-count").textContent = state.queue.length ? `(${state.queue.length})` : "";
  $("queue-empty").hidden = state.queue.length > 0;
  $("queue").replaceChildren(
    ...state.queue.map((s, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="num"></span><span class="t"></span><button title="Sing now">▶</button><button title="Remove">✕</button>`;
      li.querySelector(".num").textContent = s.number;
      li.querySelector(".t").textContent = s.title;
      const [now, remove] = li.querySelectorAll("button");
      now.onclick = () => {
        state.queue.splice(i, 1);
        singNow(s);
      };
      remove.onclick = () => {
        state.queue.splice(i, 1);
        renderQueue();
      };
      return li;
    }),
  );
  const next = state.queue[0];
  $("next-up").textContent = player.song?.mediaKind === "music-video" ? `Listening mode · ${state.queue.length} reserved song(s) waiting` : next ? `Next: ${next.number} · ${next.title}` : "Nothing reserved";
  pushRemoteState();
}

function playNext() {
  const next = state.queue.shift();
  renderQueue();
  if (next) singNow(next);
  else leaveStage();
}

// ---------- Playing ----------

async function showMusicLibrary() {
  $("music-library").showModal();
  $("music-results").replaceChildren();
  $("music-status").textContent = "Loading saved music videos…";
  try {
    const items = await window.zb.listMusicVideos();
    $("music-status").textContent = items.length ? "Choose a video to listen to. The next saved video will play automatically." : "No saved music videos yet. Music videos save automatically while their songs play in karaoke.";
    for (const item of items) {
      const row = document.createElement("li");
      const title = document.createElement("div");
      title.textContent = `${item.title}${item.artist ? ` · ${item.artist}` : ""}`;
      const button = document.createElement("button");
      button.textContent = "Play";
      button.onclick = () => prepareMusicPlayback(item.id);
      row.append(title, button);
      $("music-results").append(row);
    }
  } catch (error) { $("music-status").textContent = error.message; }
}

async function prepareMusicPlayback(id, songPath) {
  const request = ++playRequest;
  player.stop();
  window.zb.hideDisplay();
  document.body.classList.remove("playing");
  const buttons = [...$("music-results").querySelectorAll("button")];
  buttons.forEach((button) => button.disabled = true);
  try {
    const result = id ? await window.zb.playMusicVideo(id) : await window.zb.musicForSong(songPath);
    if (request !== playRequest) return;
    if ($("music-library").open) $("music-library").close();
    await singNow(result.song);
  } catch (error) {
    if (request === playRequest) {
      $("music-status").textContent = error.message;
      toast(error.message, 5000);
      if (!$("stage").hidden) leaveStage();
    }
  } finally { buttons.forEach((button) => button.disabled = false); }
}

async function playNextMusic() {
  const current = player.song?.sourceVideoId;
  try {
    const items = await window.zb.listMusicVideos();
    if (!items.length) { leaveStage(); return; }
    const index = items.findIndex((item) => item.id === current);
    await prepareMusicPlayback(items[(index + 1) % items.length].id);
  } catch (error) { leaveStage(); toast(error.message, 5000); }
}

async function ensurePlayer() {
  if (!playerReady) {
    playerReady = (async () => {
      await midiPlayer.init();
      midiPlayer.onEnded = () => { if (player === midiPlayer && player.song) playNext(); };
    })();
    playerReady.catch(() => { playerReady = null; });
  }
  await playerReady;
  const bank = currentSoundBank();
  if (!bank) throw new Error("No sound bank yet. Add an .sf2 file in Settings.");
  if (midiPlayer.soundBankPath !== bank.path) {
    toast("Loading the band…");
    await midiPlayer.loadSoundBank(bank.path, await window.zb.readFile(bank.path));
  }
}

function currentSoundBank() {
  return state.soundBanks.find((b) => b.path === state.settings.soundBank) ?? state.soundBanks[0];
}

async function singNow(song) {
  const request = ++playRequest;
  try {
    await window.zb.openDisplay();
    const isVideo = isRecordedVideo(song);
    if (!isVideo) await ensurePlayer();
    const source = isVideo ? await window.zb.mediaUrl(song.path) : await window.zb.readFile(song.path);
    if (request !== playRequest) return;
    player.stop();
    player = isVideo ? videoPlayer : midiPlayer;
    enterStage(song);
    await player.play(song, source);
    player.setVolume(Number($("master-volume").value));
    if (request !== playRequest) return;
    updateStageControls();
    renderQueue();
    const t = player.headers;
    $("tc-title").textContent = song.title || t.title || "";
    $("tc-artist").textContent = song.artist || t.artist || "";
  } catch (err) {
    if (request !== playRequest) return;
    leaveStage();
    console.error(err);
    toast(`Can't play ${song.title}: ${err.message}`, 5000);
  }
}

function enterStage(song) {
  playbackId++;
  $("video-save-status").textContent = "";
  musicVideoSaved = false;
  $("home").hidden = false;
  $("stage").hidden = true;
  document.body.classList.add("playing");
  $("mixer").hidden = true;
  $("tc-number").textContent = song.number;
  $("tc-title").textContent = song.title;
  $("tc-artist").textContent = song.artist;
  $("title-card").classList.remove("gone");
  $("now-title").textContent = `${song.mediaKind === "music-video" ? "Listening" : song.number} · ${song.title}${song.artist ? ` — ${song.artist}` : ""}`;
  slots.forEach((s) => (s.index = -2));
  updateStageControls();
  wakeStage();
}

function leaveStage() {
  playRequest++;
  player.stop();
  window.zb.hideDisplay();
  document.body.classList.remove("playing");
  $("stage").hidden = true;
  $("home").hidden = false;
  $("search").focus();
  pushRemoteState();
}

function stopSong() {
  if (state.queue.length && !confirm(`Stop singing? ${state.queue.length} reserved song(s) will wait.`)) return;
  leaveStage();
}

function updateStageControls() {
  const isVideo = isRecordedVideo(player.song);
  $("btn-listen-instead").disabled = isVideo || !player.song || !musicVideoSaved;
  const hasGuide = !isVideo && player.melodyChannel !== -1;
  for (const id of ["key-down", "key-up", "btn-guide", "btn-mixer"]) $(id).disabled = isVideo;
  $("btn-guide").disabled = !hasGuide;
  $("guide-level").disabled = !hasGuide;
  $("key-value").textContent = `Key ${player.key > 0 ? "+" : ""}${player.key}`;
  $("tempo-value").textContent = `${Math.round(player.tempo * 100)}%`;
  $("btn-guide").classList.toggle("on", hasGuide && player.guide);
  $("btn-guide").textContent = hasGuide ? `Guide: ${player.guide ? "On" : "Off"}` : "Guide: unavailable";
  $("btn-guide").setAttribute("aria-pressed", String(hasGuide && player.guide));
  $("btn-guide").title = hasGuide ? "Play the vocal melody to help you follow the tune" : "This song has no separate MIDI melody guide";
  $("btn-pause").textContent = player.paused ? "▶" : "❚❚";
}

// ---------- Lyrics on stage ----------

const slots = [0, 1].map((n) => ({ el: $(`slot-${n}`), index: -2, spans: [] }));

function fillSlot(slot, index) {
  if (slot.index === index) return;
  slot.index = index;
  slot.spans = [];
  const line = player.lines[index];
  if (!line) {
    slot.el.replaceChildren();
    return;
  }
  slot.el.replaceChildren(
    ...line.syllables.map((s) => {
      const span = document.createElement("span");
      span.className = "syl";
      span.textContent = s.text;
      slot.spans.push(span);
      return span;
    }),
  );
}

function renderLyrics(t) {
  if (isRecordedVideo(player.song)) {
    slots.forEach((slot) => { slot.el.replaceChildren(); slot.spans = []; slot.index = -2; });
    return;
  }
  const lines = player.lines;
  if (!lines.length) {
    slots[0].el.textContent = t > 1 ? "♪ ♪ ♪" : "";
    slots[1].el.textContent = "";
    slots.forEach((s) => (s.index = -1));
    return;
  }
  let cur = 0;
  while (cur + 1 < lines.length && lines[cur + 1].start <= t) cur++;

  // The line being sung sits in its own slot; the other slot shows the next line.
  const mine = slots[cur % 2];
  const other = slots[(cur + 1) % 2];
  fillSlot(mine, cur);
  const curLine = lines[cur];
  const gapAhead = (lines[cur + 1]?.start ?? Infinity) - t;
  if (t > curLine.end + 0.5 && gapAhead > 6) fillSlot(other, -1);
  else fillSlot(other, cur + 1);

  for (const slot of slots) {
    const line = lines[slot.index];
    if (!line) continue;
    slot.spans.forEach((span, i) => span.style.setProperty("--fill", `${(syllableFill(line, i, t) * 100).toFixed(1)}%`));
  }
}

function countIn(t) {
  const lines = player.lines;
  const el = $("stage-countin");
  if (!lines.length || t >= lines[0].start || lines[0].start - t > 3) {
    if (el) el.remove();
    return;
  }
  const dots = Math.ceil(lines[0].start - t);
  let node = el;
  if (!node) {
    node = document.createElement("div");
    node.id = "stage-countin";
    node.className = "line countin";
    $("slot-0").before(node);
  }
  node.textContent = "● ".repeat(dots).trim();
}

function frame() {
  if (player.song) {
    const t = player.time;
    renderLyrics(t);
    countIn(t);
    const firstLine = player.lines[0]?.start ?? 4;
    if (t > Math.min(5, Math.max(2, firstLine - 1))) $("title-card").classList.add("gone");
    const dur = player.duration;
    $("progress-fill").style.width = dur ? `${Math.min((t / dur) * 100, 100)}%` : "0";
    publishDisplay();
  }
}

let lastDisplayFrame = 0;
function publishDisplay() {
  const now = performance.now();
  if (now - lastDisplayFrame < 33) return;
  lastDisplayFrame = now;
  window.zb.sendDisplayFrame({
    text: Object.fromEntries(["tc-number", "tc-title", "tc-artist", "stage-number"].map((id) => [id, id === "stage-number" && $(id).hidden ? "" : $(id).textContent])),
    titleGone: $("title-card").classList.contains("gone"),
    countIn: $("stage-countin")?.textContent ?? "",
    introUntil: player.lines[0]?.start ?? null,
    size: `${state.settings.lyricSize ?? 5}vw`,
    color: state.settings.lyricColor ?? "#ffd34d",
    songPath: player.song.path,
    mediaKind: player.song.mediaKind ?? "midi",
    playbackId,
    time: player.time,
    paused: player.paused,
    tempo: player.tempo,
    lines: slots.map((slot) => slot.spans.length ? slot.spans.map((span) => ({ text: span.textContent, fill: span.style.getPropertyValue("--fill") || "0%" })) : [{ text: slot.el.textContent, fill: "0%" }]),
  });
}

// ---------- Stage chrome ----------

let idleTimer;
function wakeStage() {
  $("stage").classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($("mixer").hidden) $("stage").classList.add("idle");
  }, 3500);
}

let toastTimer;
function toast(text, ms = 2200) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
  // Off stage, show it in the number panel instead.
  if ($("stage").hidden) {
    $("number-song").textContent = text;
    setTimeout(() => setDigits(state.digits), ms);
  }
}

// ---------- Settings ----------

function applyLyricStyle() {
  const s = state.settings;
  document.documentElement.style.setProperty("--lyric-size", `${s.lyricSize ?? 5}vw`);
  document.documentElement.style.setProperty("--sung", s.lyricColor ?? "#ffd34d");
}

function renderSettings() {
  const sel = $("soundbank-select");
  const current = currentSoundBank();
  sel.replaceChildren(
    ...state.soundBanks.map((b) => {
      const o = document.createElement("option");
      o.value = b.path;
      o.textContent = b.builtIn ? `${b.name} (built in)` : b.name;
      o.selected = current?.path === b.path;
      return o;
    }),
  );
  $("soundbank-note").textContent = state.soundBanks.length
    ? "The sound you pick stays, song after song."
    : "No sound bank found. Add any General MIDI .sf2 file.";
  $("folder-list").replaceChildren(
    ...state.folders.map((f) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = f.builtIn ? `${f.name} (built in)` : f.path;
      name.title = f.path;
      li.append(name);
      if (!f.builtIn) {
        const b = document.createElement("button");
        b.textContent = "Remove";
        b.onclick = async () => applyLibrary(await window.zb.removeFolder(f.path));
        li.append(b);
      }
      return li;
    }),
  );
  $("lyric-size").value = state.settings.lyricSize ?? 5;
  $("lyric-color").value = state.settings.lyricColor ?? "#ffd34d";
}

// ---------- Wiring ----------

async function addFolder() {
  applyLibrary(await window.zb.addFolder());
}

function wire() {
  $("master-volume").oninput = (event) => {
    $("mix-volume").value = event.target.value;
    if (player.song) player.setVolume(Number(event.target.value));
  };
  $("btn-music-videos").onclick = showMusicLibrary;
  $("music-close").onclick = () => $("music-library").close();
  $("btn-listen-instead").onclick = () => prepareMusicPlayback(null, player.song?.path);
  $("btn-open-assets").onclick = () => window.zb.openDownloadedAssets().catch((error) => toast(error.message, 5000));
  wireKaraokeSearch({ applyLibrary, singNow, reserve });
  window.zb.onVideoStatus(({ songPath, state: status }) => {
    if (player.song?.path !== songPath) return;
    if (status === "saved" || status === "saved-searching") musicVideoSaved = true;
    updateStageControls();
    $("video-save-status").textContent = ({ searching: "Finding a music video or live performance…", "saved-searching": "Playing saved video · Checking for a newer match…", loading: "Loading music video or live performance…", background: "No matching video · Using background", queued: "Video queued for offline saving", downloading: "Saving music video for offline playback…", saved: "Video saved · Available offline", failed: "Video could not be saved · Streaming only" })[status] ?? "";
  });
  window.zb.onUpdateReady?.(({ version }) => {
    $("update-banner-text").textContent = `Update ${version} is ready.`;
    $("update-banner").hidden = false;
  });
  $("btn-update-later").onclick = () => { $("update-banner").hidden = true; };
  window.zb.getVersion?.().then((v) => { $("app-version").textContent = `Version ${v}`; }).catch(() => {});
  $("btn-check-updates").onclick = async () => {
    $("update-check-status").textContent = "Checking…";
    const result = await window.zb.checkForUpdates();
    if (result.error) $("update-check-status").textContent = result.error;
    else if (result.upToDate) $("update-check-status").textContent = `You're up to date (v${result.currentVersion}).`;
    else $("update-check-status").textContent = `Update ${result.latestVersion} found — downloading in the background…`;
  };
  // App-only installs keep downloading song packs after opening; new songs appear as each pack lands.
  const showPackStatus = ({ state: status, percent }) => {
    $("packs-banner").hidden = status !== "downloading" && status !== "retrying";
    $("packs-banner").textContent = status === "retrying" ? "Song download paused · Retrying…" : `Downloading songs… ${percent}%`;
  };
  window.zb.onSongPackStatus?.(showPackStatus);
  window.zb.getSongPackStatus?.().then(showPackStatus).catch(() => {});
  window.zb.onLibraryChanged?.(applyLibrary);
  window.zb.onRemoteAction?.(applyRemoteAction);
  function renderRemoteStatus(clientCount) {
    $("remote-status").textContent = clientCount > 0 ? `✓ ${clientCount} phone${clientCount === 1 ? "" : "s"} connected` : "Waiting for a phone to connect…";
    $("remote-status").className = `remote-status ${clientCount > 0 ? "on" : ""}`;
  }
  function showNetwork(network) {
    $("remote-qr").src = network.qrDataUrl;
    $("remote-url").textContent = network.url;
  }
  window.zb.onRemoteClients?.(renderRemoteStatus);
  $("btn-remote").onclick = async () => {
    $("remote").showModal();
    $("remote-qr").removeAttribute("src");
    $("remote-url").textContent = "Starting…";
    $("remote-empty").hidden = true;
    $("remote-networks").hidden = true;
    try {
      const info = await window.zb.getRemoteInfo();
      const remoteNetworks = info?.networks ?? [];
      renderRemoteStatus(info?.clientCount ?? 0);
      if (!remoteNetworks.length) { $("remote-url").textContent = ""; $("remote-empty").hidden = false; return; }
      showNetwork(remoteNetworks[0]);
      if (remoteNetworks.length > 1) {
        $("remote-networks").hidden = false;
        $("remote-networks").replaceChildren(
          ...remoteNetworks.map((network, i) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = i === 0 ? "ghost on" : "ghost";
            button.textContent = `${network.name} (${network.address})`;
            button.onclick = () => {
              showNetwork(network);
              $("remote-networks").querySelectorAll("button").forEach((b) => b.classList.remove("on"));
              button.classList.add("on");
            };
            return button;
          }),
        );
      }
    } catch (error) {
      $("remote-url").textContent = error.message;
    }
  };
  $("btn-remote-bluetooth").onclick = async () => {
    if (!navigator.bluetooth) return toast("Bluetooth isn't available in this app build.", 5000);
    try {
      $("btn-remote-bluetooth").disabled = true;
      await bluetoothRemote.connect();
      toast("Bluetooth connected · the phone is now a remote, no WiFi needed.");
      $("remote").close();
    } catch (error) {
      toast(error.message, 5000);
    } finally {
      $("btn-remote-bluetooth").disabled = false;
    }
  };
  $("btn-update-now").onclick = () => window.zb.installUpdate().catch((error) => toast(error.message, 5000));
  // Keep playback controls on the dashboard; only the lyrics go to the display.
  document.body.append(document.querySelector(".stage-bar"), $("mixer"));
  $("btn-display").onclick = () => window.zb.openDisplay();
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderSongs();
  });
  $("keypad").addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (key) pressKey(key);
  });
  $("btn-reserve").onclick = () => {
    const s = songFromDigits();
    if (s) reserve(s);
  };
  $("btn-sing-now").onclick = () => {
    const s = songFromDigits();
    if (s) singNow(s);
  };
  for (const id of ["btn-add-folder", "btn-add-folder-2", "btn-add-folder-3"]) $(id).onclick = addFolder;
  $("btn-rescan").onclick = async () => applyLibrary(await window.zb.rescan());
  $("btn-songbook").onclick = async () => {
    const file = await window.zb.makeSongbook();
    if (file) toast("Songbook saved");
  };
  $("btn-settings").onclick = () => $("settings").showModal();
  $("btn-add-soundbank").onclick = async () => applyLibrary(await window.zb.addSoundBank());
  $("soundbank-select").onchange = async (e) => applyLibrary(await window.zb.setSettings({ soundBank: e.target.value }));
  $("lyric-size").oninput = (e) => {
    state.settings.lyricSize = Number(e.target.value);
    applyLyricStyle();
  };
  $("lyric-size").onchange = (e) => window.zb.setSettings({ lyricSize: Number(e.target.value) });
  $("lyric-color").oninput = (e) => {
    state.settings.lyricColor = e.target.value;
    applyLyricStyle();
  };
  $("lyric-color").onchange = (e) => window.zb.setSettings({ lyricColor: e.target.value });

  // Stage controls
  $("key-down").onclick = () => (player.setKey(player.key - 1), updateStageControls());
  $("key-up").onclick = () => (player.setKey(player.key + 1), updateStageControls());
  $("tempo-down").onclick = () => (player.setTempo(player.tempo - 0.05), updateStageControls());
  $("tempo-up").onclick = () => (player.setTempo(player.tempo + 0.05), updateStageControls());
  $("btn-guide").onclick = () => {
    midiPlayer.setGuide(!midiPlayer.guide);
    state.settings.guideEnabled = midiPlayer.guide;
    window.zb.setSettings({ guideEnabled: midiPlayer.guide });
    updateStageControls();
  };
  $("guide-level").oninput = (event) => {
    const volume = Number(event.target.value);
    midiPlayer.setMix("melody", volume);
    state.settings.guideVolume = volume;
    const mixerGuide = document.querySelector('[data-mix="melody"]');
    if (mixerGuide) mixerGuide.value = volume;
  };
  $("guide-level").onchange = () => window.zb.setSettings({ guideVolume: midiPlayer.mix.melody });
  $("btn-pause").onclick = () => (player.togglePause(), updateStageControls());
  $("btn-skip").onclick = () => player.song?.mediaKind === "music-video" ? playNextMusic() : playNext();
  $("btn-stop").onclick = () => stopSong();
  $("btn-mixer").onclick = () => ($("mixer").hidden = !$("mixer").hidden);
  $("mixer").addEventListener("input", (e) => {
    const part = e.target.dataset.mix;
    if (part) player.setMix(part, Number(e.target.value));
    if (part === "melody") {
      state.settings.guideVolume = Number(e.target.value);
      $("guide-level").value = state.settings.guideVolume;
    }
    if (e.target.id === "mix-echo") player.setEcho(Number(e.target.value));
    if (e.target.id === "mix-volume") {
      $("master-volume").value = e.target.value;
      player.setVolume(Number(e.target.value));
    }
  });
  $("mixer").addEventListener("change", (event) => {
    if (event.target.dataset.mix === "melody") window.zb.setSettings({ guideVolume: midiPlayer.mix.melody });
  });
  $("stage").addEventListener("mousemove", wakeStage);

  // Keyboard: digits go to the number pad unless typing in a field.
  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input[type=search], input[type=text]") || $("settings").open || $("online-karaoke").open || $("music-library").open;
    if (typing) return;
    const onStage = Boolean(player.song);
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
    else if (e.key === "Escape") state.digits ? pressKey("clear") : onStage && ($("mixer").hidden = true);
    else if (e.key === "Enter" && state.digits) {
      const s = songFromDigits();
      if (s) onStage || player.song ? reserve(s) : singNow(s);
    } else if (onStage && e.key === " ") {
      e.preventDefault();
      player.togglePause();
      updateStageControls();
    } else if (onStage && e.key === "ArrowUp") $("key-up").click();
    else if (onStage && e.key === "ArrowDown") $("key-down").click();
    else return;
    if (onStage) wakeStage();
  });
}

wire();
videoPlayer.onEnded = () => player.song?.mediaKind === "music-video" ? playNextMusic() : playNext();
videoPlayer.onError = (error) => { leaveStage(); toast(error.message, 5000); };
setDigits("");
applyLibrary(await window.zb.getLibrary());
// Keep the display synchronized even when the dashboard is minimized.
setInterval(frame, 33);

// Handle for the smoke test (see runSmokeTest in main.js).
if (location.search.includes("smoke")) window.__zbReady = Promise.resolve({ get player() { return player; }, state, singNow });
