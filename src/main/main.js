const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const library = require("./library");
const { prepareBundledSongs } = require("./bundled-songs");
const { buildSongbookHtml } = require("./songbook");
const { indexVideos, matchVideo } = require("./videos");
const { createOnlineSearch } = require("./online-videos");
const { atTargetQuality, createVideoCache, cancelVideoDownloads } = require("./video-cache");
const { validateQuery, searchKaraoke } = require("./karaoke");
const { mediaResponse } = require("./media-response");
const { createAssetExporter } = require("./asset-exports");
const { createUpdater } = require("./updater");
const { createPackDownloader, UNLOCK_FRACTION } = require("./pack-downloader");
const { createRemoteServer } = require("./remote-server");
const { searchSongs } = require("../shared/search");
const qrcode = require("qrcode");

const APP_NAME = "Zee-ing Bee";
// Reuse existing libraries and downloaded videos after the display-name change.
const legacyUserData = path.join(app.getPath("appData"), "Zeenging Bee");
if (!app.commandLine.hasSwitch("user-data-dir") && fs.existsSync(legacyUserData)) app.setPath("userData", legacyUserData);
const appRoot = path.join(__dirname, "..", "..");
// Bundled songs and sound banks: next to the app when installed, in the project while developing.
const resourcesDir = app.isPackaged ? path.join(process.resourcesPath, "resources") : path.join(appRoot, "resources");
const appIcon = path.join(resourcesDir, "icons", "zee-ing-bee.png");
const libraryFile = () => path.join(app.getPath("userData"), "library.json");
const bundledPacksDir = () => app.isPackaged ? path.join(resourcesDir, "packs") : path.join(appRoot, "src", "assets", "packs");
const downloadedPacksDir = () => path.join(app.getPath("userData"), "song-packs");
const PACK_RETRY_MS = 60000;

let lib;
let win;
let displayWindow;
let musicVideos = [];
let searchOnlineVideos;
let savedVideos;
let karaokeVideos;
let assetExporter;
let updater;
let remoteServer;
let libraryReady;
let packStatus = { state: "idle", percent: 0 };
const karaokeSearches = new Map();
const karaokeImports = new Map();
const videoFiles = new Map();
const videoFileIds = new Map();
const videoSessions = new WeakSet();
function blockSmokeNetwork(session) {
  if (process.env.ZB_SMOKE_OFFLINE) session.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*"] }, (_details, callback) => callback({ cancel: true }));
}
if (process.env.ZB_SMOKE_OFFLINE) globalThis.fetch = async () => { throw new Error("Offline smoke test: network disabled"); };

function videoUrl(file) {
  if (videoFileIds.has(file)) return `app://video/${videoFileIds.get(file)}`;
  const id = String(videoFiles.size);
  videoFiles.set(id, file);
  videoFileIds.set(file, id);
  return `app://video/${id}`;
}

function serveAppRequest(request) {
  const url = new URL(request.url);
  if (url.hostname === "video") {
    const video = videoFiles.get(url.pathname.slice(1));
    return video ? mediaResponse(video, request) : new Response("Not found", { status: 404 });
  }
  const file = path.resolve(appRoot, `.${decodeURIComponent(url.pathname)}`);
  const relative = path.relative(appRoot, file);
  if (url.hostname !== "bundle" || relative.startsWith("..") || path.isAbsolute(relative)) return new Response("Not found", { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function openDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    if (!process.env.ZB_SMOKE) displayWindow.show();
    return;
  }
  const primary = screen.getDisplayMatching(win.getBounds());
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  displayWindow = new BrowserWindow({
    ...(fs.existsSync(appIcon) ? { icon: appIcon } : {}),
    show: !process.env.ZB_SMOKE,
    title: `${APP_NAME} — Karaoke Display`, width: 1100, height: 700,
    ...(external ? { x: external.bounds.x, y: external.bounds.y, fullscreen: true } : {}),
    backgroundColor: "#120d02", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: "persist:karaoke-display", autoplayPolicy: "no-user-gesture-required" },
  });
  // The display is visual only; even embedded videos must never add audio.
  displayWindow.webContents.setAudioMuted(true);
  blockSmokeNetwork(displayWindow.webContents.session);
  if (!videoSessions.has(displayWindow.webContents.session)) {
    displayWindow.webContents.session.protocol.handle("app", serveAppRequest);
    videoSessions.add(displayWindow.webContents.session);
  }
  if (process.env.ZB_SMOKE) displayWindow.webContents.on("console-message", (event) => console.log(`[display ${event.level}] ${event.message}`));
  displayWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: ["https://*.youtube.com/*", "https://*.youtube-nocookie.com/*"] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: "https://com.zeengingbee.app/" } });
  });
  displayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  displayWindow.loadURL("app://bundle/src/renderer/display.html");
  displayWindow.on("closed", () => { displayWindow = null; });
}

// The smoke test gets its own empty library so it never touches the singer's.
if (process.env.ZB_SMOKE) app.setPath("userData", app.commandLine.getSwitchValue("user-data-dir") || path.join(app.getPath("temp"), `zeenging-bee-smoke-${process.pid}`));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function bundledSoundBanks() {
  const dir = path.join(resourcesDir, "soundfonts");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(sf2|sf3|dls)$/i.test(f))
      .map((f) => ({ name: path.basename(f, path.extname(f)), path: path.join(dir, f), builtIn: true }));
  } catch {
    return [];
  }
}

function soundBanks() {
  return [...bundledSoundBanks(), ...(lib.settings.soundBanks ?? [])];
}

async function loadLibrary() {
  lib = library.load(libraryFile());
  searchOnlineVideos = createOnlineSearch(path.join(app.getPath("userData"), "music-video-cache.json"));
  const exportsRoot = app.isPackaged ? path.join(app.getPath("documents"), "Zee-ing Bee", "assets", "downloads") : path.join(appRoot, "src", "assets", "downloads");
  assetExporter = createAssetExporter(exportsRoot);
  savedVideos = createVideoCache(path.join(app.getPath("userData"), "music-videos"), { withAudio: true, onSaved: (entry, song) => assetExporter.exportFile(entry, song, "music-videos") });
  karaokeVideos = createVideoCache(path.join(app.getPath("userData"), "karaoke-videos"), { withAudio: true, policy: "karaoke-v1", onSaved: (entry, song) => assetExporter.exportFile(entry, song, "karaoke-videos") });
  // The bundled folder can move between installs, so match it by flag, not path.
  lib.folders = [...lib.folders.filter((f) => !f.builtIn), ...await songPackFolders()];
  library.rescan(lib);
  musicVideos = indexVideos([path.join(appRoot, "src", "assets", "music-videos"), ...lib.folders.filter((f) => !f.builtIn).map((f) => f.path)]);
  library.save(libraryFile(), lib);
}

/** Songs from bundled packs (a full install) and from packs downloaded in the background (app only). */
async function songPackFolders() {
  const extracted = path.join(app.getPath("userData"), "bundled-songs");
  return [...await prepareBundledSongs(bundledPacksDir(), extracted), ...await prepareBundledSongs(downloadedPacksDir(), extracted)];
}

/** Adds newly downloaded packs to the open library, keeping the person's own folders. */
async function addDownloadedSongs() {
  lib.folders = [...lib.folders.filter((f) => !f.builtIn), ...await songPackFolders()];
  library.rescan(lib);
  library.save(libraryFile(), lib);
  if (win && !win.isDestroyed()) win.webContents.send("library:changed", publicState());
}

/**
 * App-only installs fetch their song packs in the background. Resolves once enough has
 * arrived to start singing, or when the server can't be reached for now, and keeps
 * downloading (and retrying) after that.
 */
function downloadSongPacks(onProgress) {
  const downloader = createPackDownloader(downloadedPacksDir());
  if (process.env.ZB_SMOKE || !downloader.configured || !downloader.needed(bundledPacksDir())) return Promise.resolve();
  return new Promise((resolve) => {
    let lastDone;
    let adding = Promise.resolve();
    const addSongs = () => {
      adding = adding.then(() => libraryReady).then(addDownloadedSongs).catch((error) => console.warn("Adding downloaded songs failed:", error.message));
    };
    const setStatus = (status) => {
      packStatus = status;
      onProgress(status);
      if (win && !win.isDestroyed()) win.webContents.send("packs:status", status);
    };
    (async () => {
      for (;;) {
        try {
          await downloader.sync((p) => {
            setStatus({ state: "downloading", percent: p.total ? Math.floor((p.received / p.total) * 100) : 100 });
            if (p.unlocked) resolve();
            if (lastDone !== undefined && p.done !== lastDone) addSongs();
            lastDone = p.done;
          });
          setStatus({ state: "done", percent: 100 });
          addSongs();
          return;
        } catch (error) {
          console.warn("Song pack download failed:", error.message);
          setStatus({ state: "retrying", percent: packStatus.percent });
          resolve();
          await new Promise((r) => setTimeout(r, PACK_RETRY_MS));
        }
      }
    })();
  });
}

function publicState() {
  return {
    songs: lib.songs,
    folders: lib.folders,
    settings: lib.settings,
    assetExportDir: assetExporter.root,
    soundBanks: soundBanks().map(({ name, path: p, builtIn }) => ({ name, path: p, builtIn: Boolean(builtIn) })),
  };
}

function persist() {
  library.save(libraryFile(), lib);
  return publicState();
}

/** The window may only read songs in the library and known sound banks. */
function allowedToRead(file) {
  const resolved = path.resolve(file);
  return lib.songs.some((s) => s.path === resolved) || soundBanks().some((b) => b.path === resolved);
}

/** Saved so a phone paired once stays paired after the desktop restarts. */
function remoteToken() {
  const file = path.join(app.getPath("userData"), "remote-token.txt");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{32}$/.test(saved)) return saved;
  } catch {}
  const token = require("node:crypto").randomBytes(16).toString("hex");
  try { fs.writeFileSync(file, token); } catch {}
  return token;
}

/** What a phone is allowed to see of a song: enough to search/reserve/play, never local file paths. */
function remoteSongInfo(song) {
  return { number: song.number, title: song.title, artist: song.artist, category: song.category, mediaKind: song.mediaKind ?? "midi" };
}

async function remoteSongFile(number) {
  const song = lib.songs.find((s) => String(s.number) === String(number));
  if (!song || song.mediaKind === "video" || song.mediaKind === "music-video") return null;
  return fs.promises.readFile(song.path).catch(() => null);
}

async function remoteSoundbank() {
  const active = lib.settings.soundBank ?? soundBanks()[0]?.path;
  if (!active) return null;
  try {
    return { name: path.basename(active, path.extname(active)), data: await fs.promises.readFile(active) };
  } catch {
    return null;
  }
}

async function remoteSongVideo(number) {
  const song = lib.songs.find((s) => String(s.number) === String(number));
  if (!song) return null;
  if (song.mediaKind === "video") return fs.existsSync(song.path) ? song.path : null;
  const cached = savedVideos?.get(song);
  return cached && fs.existsSync(cached.path) ? cached.path : null;
}

function registerIpc() {
  const musicInfo = (entry) => ({ id: entry.id, title: entry.songTitle || entry.title, artist: entry.artist || "", hasAudio: entry.hasAudio });
  const musicSong = (entry) => ({ number: "MV", title: entry.songTitle || entry.title, artist: entry.artist || "", path: entry.path, mediaKind: "music-video", sourceVideoId: entry.id });
  // Music videos are saved automatically while their song plays in karaoke; listening never downloads.
  const prepareMusic = (entry) => ({ song: musicSong(entry), url: videoUrl(entry.path) });
  ipcMain.handle("music:list", (event) => event.sender === win.webContents ? savedVideos.list().filter((entry) => entry.hasAudio).map(musicInfo) : []);
  ipcMain.handle("music:play", async (event, id) => {
    if (event.sender !== win.webContents) throw new Error("Use the dashboard for music playback.");
    const entry = savedVideos.list().find((item) => item.id === id && item.hasAudio);
    if (!entry) throw new Error("This music video has not been saved yet.");
    return prepareMusic(entry);
  });
  ipcMain.handle("music:forSong", async (event, songPath) => {
    if (event.sender !== win.webContents) throw new Error("Use the dashboard for music playback.");
    const song = lib.songs.find((item) => item.path === songPath && item.mediaKind !== "video");
    if (!song) throw new Error("Select a MIDI song first.");
    let entry = savedVideos.get(song);
    if (!entry?.hasAudio) entry = await savedVideos.pendingFor(song)?.catch(() => null);
    if (!entry?.hasAudio) throw new Error("This song's music video has not been saved yet. It saves automatically while the song plays.");
    return prepareMusic(entry);
  });
  ipcMain.handle("assets:open", async (event) => {
    if (event.sender !== win.webContents) return;
    await fs.promises.mkdir(assetExporter.root, { recursive: true });
    const error = await shell.openPath(assetExporter.root);
    if (error) throw new Error(error);
  });
  ipcMain.handle("karaoke:search", async (event, title, artist) => {
    if (event.sender !== win.webContents) throw new Error("Use the dashboard to search.");
    const query = validateQuery(title, artist);
    const existing = library.findSong(lib, query.title, query.artist);
    if (existing) return { existing, items: [] };
    const items = await searchKaraoke(query);
    const token = require("node:crypto").randomUUID();
    karaokeSearches.set(token, { query, items, at: Date.now() });
    for (const [key, entry] of karaokeSearches) if (Date.now() - entry.at > 3600000) karaokeSearches.delete(key);
    return { token, items };
  });
  ipcMain.handle("karaoke:import", async (event, token, videoId) => {
    if (event.sender !== win.webContents) throw new Error("Use the dashboard to add songs.");
    const entry = karaokeSearches.get(token);
    const candidate = entry?.items.find((item) => item.id === videoId);
    if (!candidate || Date.now() - entry.at > 3600000) throw new Error("Search again before downloading this song.");
    const key = `${entry.query.title.toLowerCase()}|${entry.query.artist.toLowerCase()}`;
    if (karaokeImports.has(key)) return karaokeImports.get(key);
    const task = (async () => {
      const existing = library.findSong(lib, entry.query.title, entry.query.artist);
      if (existing) return { song: existing, library: publicState() };
      const saved = await karaokeVideos.save(entry.query, candidate, (state) => {
        if (process.env.ZB_SMOKE) console.log("KARAOKE", state, candidate.id);
        if (!win.isDestroyed()) win.webContents.send("karaoke:status", { token, videoId, state });
      });
      const song = library.importVideo(lib, { ...entry.query, path: saved.path, sourceId: candidate.id, sourceTitle: candidate.title });
      library.save(libraryFile(), lib);
      return { song, library: publicState() };
    })().finally(() => karaokeImports.delete(key));
    karaokeImports.set(key, task);
    return task;
  });
  ipcMain.handle("media:url", (_event, songPath) => {
    const song = lib.songs.find((s) => s.path === songPath && s.mediaKind === "video");
    const music = song ? null : savedVideos.list().find((entry) => entry.path === songPath);
    if (!song && !music) throw new Error("That video is not in the library.");
    return videoUrl(song?.path ?? music.path);
  });
  ipcMain.handle("video:save", async (event, songPath, videoId) => {
    if (event.sender !== displayWindow?.webContents) return null;
    const song = lib.songs.find((s) => s.path === songPath);
    if (!song) return null;
    const candidates = await searchOnlineVideos(song);
    const candidate = candidates.find((v) => v.id === videoId);
    if (!candidate) return null;
    const notify = (state) => {
      if (win && !win.isDestroyed()) win.webContents.send("video:status", { songPath, state });
    };
    try {
      const saved = await savedVideos.save(song, candidate, notify);
      return saved ? { matched: true, cached: true, url: videoUrl(saved.path) } : null;
    } catch (error) {
      console.warn("Unable to save music video:", error.message);
      notify("failed");
      return null;
    }
  });
  ipcMain.handle("video:searchOnline", async (_event, songPath) => {
    const song = lib.songs.find((s) => s.path === songPath);
    if (!song) return [];
    const saved = savedVideos.get(song);
    const cached = saved?.hasAudio && atTargetQuality(saved) ? saved : null;
    const notify = (state) => { if (!win.isDestroyed()) win.webContents.send("video:status", { songPath, state }); };
    notify(cached ? "saved-searching" : "searching");
    const items = await searchOnlineVideos(song, { refresh: true });
    notify(cached && (!items.length || items[0].id === cached.id) ? "saved" : items.length ? "loading" : "background");
    return items;
  });
  ipcMain.handle("video:resolve", (_event, songPath) => {
    const song = lib.songs.find((s) => s.path === songPath);
    if (!song) {
      const music = savedVideos.list().find((entry) => entry.path === songPath);
      return music ? { matched: true, karaoke: true, url: videoUrl(music.path) } : null;
    }
    if (song.mediaKind === "video") return { matched: true, karaoke: true, url: videoUrl(song.path) };
    const cached = savedVideos.get(song);
    const match = cached ?? matchVideo(musicVideos, song);
    const dir = path.join(appRoot, "src", "assets", "videos");
    const backgrounds = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp4|webm|m4v)$/i.test(f)) : [];
    const random = backgrounds.length ? path.join(dir, backgrounds[Math.floor(Math.random() * backgrounds.length)]) : null;
    // Low-resolution saves still play offline, but stream online so they get re-saved in HD
    // (unless the source itself is capped below the target — then this is as good as it gets).
    const complete = cached?.hasAudio && atTargetQuality(cached);
    if (complete && win && !win.isDestroyed()) win.webContents.send("video:status", { songPath, state: "saved" });
    return { matched: Boolean(match), cached: Boolean(complete), videoId: complete ? cached.id : undefined, url: match ? videoUrl(match.path) : random ? videoUrl(random) : null, fallback: random ? videoUrl(random) : null, backgrounds: backgrounds.map((file) => videoUrl(path.join(dir, file))) };
  });
  ipcMain.handle("display:open", (event) => {
    if (event.sender === win.webContents) openDisplay();
  });
  ipcMain.on("display:frame", (event, data) => {
    if (event.sender === win.webContents && displayWindow && !displayWindow.isDestroyed()) {
      displayWindow.webContents.send("display:frame", data);
    }
  });
  ipcMain.on("display:hide", (event) => {
    if (event.sender === win.webContents) displayWindow?.hide();
  });
  ipcMain.handle("update:install", (event) => event.sender === win?.webContents ? updater?.install() ?? false : false);
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:check", async () => {
    if (!updater) return { error: "Updates only run in an installed build, not when running from source." };
    try {
      return await updater.checkNow();
    } catch (error) {
      return { error: error.message };
    }
  });
  ipcMain.handle("library:get", () => publicState());
  ipcMain.handle("packs:status", () => packStatus);
  ipcMain.handle("remote:info", async () => {
    if (!remoteServer) return null;
    const { token, networks, clientCount } = remoteServer.info();
    const withQr = await Promise.all(networks.map(async (network) => ({ ...network, qrDataUrl: await qrcode.toDataURL(network.url) })));
    return { token, networks: withQr, clientCount };
  });
  ipcMain.handle("remote:state", (event, state) => {
    if (event.sender === win.webContents) remoteServer?.broadcastState(state);
  });

  ipcMain.handle("library:addFolder", async () => {
    const res = await dialog.showOpenDialog(win, { title: "Add a song folder", properties: ["openDirectory"] });
    if (res.canceled || !res.filePaths[0]) return publicState();
    library.addFolder(lib, res.filePaths[0]);
    return persist();
  });

  ipcMain.handle("library:removeFolder", (_e, folderPath) => {
    library.removeFolder(lib, folderPath);
    return persist();
  });

  ipcMain.handle("library:rescan", () => {
    library.rescan(lib);
    return persist();
  });

  ipcMain.handle("settings:set", (_e, patch) => {
    lib.settings = { ...lib.settings, ...patch };
    return persist();
  });

  ipcMain.handle("soundbank:add", async () => {
    const res = await dialog.showOpenDialog(win, {
      title: "Add a sound bank",
      properties: ["openFile"],
      filters: [{ name: "Sound banks", extensions: ["sf2", "sf3", "dls"] }],
    });
    if (res.canceled || !res.filePaths[0]) return publicState();
    const file = path.resolve(res.filePaths[0]);
    const list = lib.settings.soundBanks ?? [];
    if (!list.some((b) => b.path === file)) list.push({ name: path.basename(file, path.extname(file)), path: file });
    lib.settings = { ...lib.settings, soundBanks: list, soundBank: file };
    return persist();
  });

  ipcMain.handle("file:read", async (_e, file) => {
    if (!allowedToRead(file)) throw new Error("That file is not in the library.");
    const buf = await fs.promises.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle("songbook:pdf", async () => {
    const res = await dialog.showSaveDialog(win, {
      title: "Save the songbook",
      defaultPath: path.join(app.getPath("documents"), `${APP_NAME} Songbook.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (res.canceled || !res.filePath) return null;
    const page = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    try {
      const html = buildSongbookHtml(lib.songs, APP_NAME);
      await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await page.webContents.printToPDF({ pageSize: "A4", printBackground: true });
      await fs.promises.writeFile(res.filePath, pdf);
    } finally {
      page.destroy();
    }
    shell.openPath(res.filePath);
    return res.filePath;
  });
}

function createWindow() {
  win = new BrowserWindow({
    ...(fs.existsSync(appIcon) ? { icon: appIcon } : {}),
    show: !process.env.ZB_SMOKE,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#120d02",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The lyrics must keep moving when the window is behind another one or on a second screen.
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.loadURL(`app://bundle/src/renderer/index.html${process.env.ZB_SMOKE ? "?smoke" : ""}`);
  blockSmokeNetwork(win.webContents.session);
  // Electron intercepts Web Bluetooth's device picker itself; auto-pick the phone
  // (there's only ever one match, since requestDevice() already filters by service UUID
  // and the phone's advertisement carries no device name to tell matches apart by -
  // see BlePeripheralPlugin.java) instead of showing an OS-level chooser - this is what
  // makes reconnects silent.
  win.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    callback(deviceList[0]?.deviceId ?? "");
  });
  win.on("closed", () => { if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close(); });
  if (process.env.ZB_SMOKE) runSmokeTest();
}

/**
 * ZB_SMOKE=<file.png> npm start: sings the first song for a few seconds, prints what the
 * stage shows, saves a screenshot and quits. Used to check a build end to end.
 */
function runSmokeTest() {
  win.webContents.on("console-message", (e) => console.log(`[window ${e.level}] ${e.message}`));
  win.webContents.once("did-finish-load", async () => {
    let result;
    try {
      result = await win.webContents.executeJavaScript(`(async () => {
        const zb = await window.__zbReady;
        if (${Boolean(process.env.ZB_SMOKE_HOME)}) {
          zb.state.queue.push(zb.state.songs[0]);
          document.getElementById("keypad").querySelector('[data-key="1"]').click();
          await new Promise((r) => setTimeout(r, 800));
          return { songs: zb.state.songs.length };
        }
        let song = zb.state.songs.find((s) => s.title === ${JSON.stringify(process.env.ZB_SMOKE_SONG ?? "Twinkle Toes")}) ?? zb.state.songs[0];
        let importedChecks;
        if (${Boolean(process.env.ZB_SMOKE_KARAOKE)}) {
          const query = ${JSON.stringify(process.env.ZB_SMOKE_KARAOKE ?? "Ordinary|Alex Warren")}.split("|");
          const search = await window.zb.searchKaraoke(query[0], query[1]);
          if (search.existing) song = search.existing;
          else {
            if (!search.items.length) throw new Error("No online karaoke test results");
            const result = await window.zb.importKaraoke(search.token, search.items[0].id);
            song = result.song;
          }
          const rescanned = await window.zb.rescan();
          const duplicate = await window.zb.searchKaraoke(query[0], query[1]);
          importedChecks = { number: song.number, survivedRescan: rescanned.songs.some((s) => s.number === song.number && s.path === song.path), duplicatePrevented: duplicate.existing?.number === song.number };
        }
        await zb.singNow(song);
        await new Promise((r) => setTimeout(r, Number(${JSON.stringify(process.env.ZB_SMOKE_SECONDS ?? "9")}) * 1000));
        let pauseCheck;
        if (song.mediaKind === "video") {
          zb.player.togglePause();
          const pausedAt = zb.player.time;
          await new Promise((r) => setTimeout(r, 350));
          pauseCheck = zb.player.paused && Math.abs(zb.player.time - pausedAt) < 0.05;
          zb.player.togglePause();
        }
        const fills = [...document.querySelectorAll(".syl")].map((s) => s.style.getPropertyValue("--fill"));
        return {
          song: song.number + " " + song.title,
          dashboardVisible: !document.getElementById("home").hidden,
          time: zb.player.time,
          voices: zb.player.synth?.voiceCount,
          mediaKind: song.mediaKind ?? "midi",
          audioDecodedBytes: zb.player.media?.webkitAudioDecodedByteCount,
          importedChecks,
          pauseCheck,
          lines: zb.player.lines.length,
          melodyChannel: zb.player.melodyChannel,
          slot0: document.getElementById("slot-0").textContent,
          slot1: document.getElementById("slot-1").textContent,
          sungSyllables: fills.filter((f) => f === "100.0%").length,
          toast: document.getElementById("toast").hidden ? null : document.getElementById("toast").textContent,
        };
      })()`);
    } catch (err) {
      result = { error: String(err) };
    }
    if (displayWindow && !displayWindow.isDestroyed()) {
      result.display = await displayWindow.webContents.executeJavaScript(`({ title: document.getElementById("tc-title").textContent, lines: [document.getElementById("slot-0").textContent, document.getElementById("slot-1").textContent], videoReady: document.getElementById("background-video").readyState, videoTime: document.getElementById("background-video").currentTime, videoMuted: document.getElementById("background-video").muted, onlineStatus: document.getElementById("online-video").dataset.status, onlineVideoId: document.getElementById("online-video").dataset.videoId })`);
      result.display.audioMuted = displayWindow.webContents.isAudioMuted();
    }
    console.log("SMOKE", JSON.stringify(result, null, 2));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(process.env.ZB_SMOKE, image.toPNG());
    app.quit();
  });
}

app.whenReady().then(async () => {
  // app://bundle/<path> serves files from the app folder (inside app.asar once packaged).
  protocol.handle("app", serveAppRequest);
  const loading = new BrowserWindow({
    ...(fs.existsSync(appIcon) ? { icon: appIcon } : {}),
    show: !process.env.ZB_SMOKE,
    width: 540, height: 240, title: APP_NAME, autoHideMenuBar: true,
    backgroundColor: "#120d02",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await loading.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="background:#120d02;color:#ffe8a3;font:18px system-ui;padding:32px"><h2>Loading your songs...</h2><p>The first launch extracts all song packs and may take a few minutes. Later launches are faster.</p></body>')}`);
  const showPackProgress = ({ state, percent }) => {
    if (loading.isDestroyed()) return;
    const [title, detail] = state === "retrying"
      ? ["Can't reach the song server", "Opening the app now. Songs will keep trying to download in the background."]
      : [`Downloading songs... ${percent}%`, `You can start singing at ${Math.round(UNLOCK_FRACTION * 100)}%. The rest keeps downloading while you sing.`];
    loading.webContents.executeJavaScript(`document.querySelector("h2").textContent = ${JSON.stringify(title)}; document.querySelector("p").textContent = ${JSON.stringify(detail)};`).catch(() => {});
  };
  await downloadSongPacks(showPackProgress);
  libraryReady = loadLibrary();
  await libraryReady;
  registerIpc();
  createWindow();
  if (!process.env.ZB_SMOKE) {
    remoteServer = createRemoteServer({
      staticDir: path.join(appRoot, "src", "mobile-remote"),
      getSongs: () => lib.songs.map(remoteSongInfo),
      searchSongs,
      readSongFile: remoteSongFile,
      readSoundbank: remoteSoundbank,
      readSongVideo: remoteSongVideo,
      onAction: (action) => { if (win && !win.isDestroyed()) win.webContents.send("remote:action", action); },
      onClientsChanged: (count) => { if (win && !win.isDestroyed()) win.webContents.send("remote:clients", count); },
      token: remoteToken(),
      port: 47800,
    });
    remoteServer.start()
      .then(() => console.log("Remote control server listening:", remoteServer.info().networks.map((n) => n.url).join(" or ")))
      .catch((error) => console.warn("Remote control server failed to start:", error.message));
  }
  if (!process.env.ZB_SMOKE) {
    const { autoUpdater } = require("electron-updater");
    updater = createUpdater({
      app,
      autoUpdater,
      notify: (info) => { if (win && !win.isDestroyed()) win.webContents.send("update:ready", info); },
    });
    updater.start();
    (async () => {
      for (const [cache, kind] of [[savedVideos, "music-videos"], [karaokeVideos, "karaoke-videos"]]) {
        for (const entry of cache.list()) {
          await assetExporter.exportFile(entry, { title: entry.songTitle || entry.title, artist: entry.artist || "" }, kind)
            .catch((error) => console.warn("Asset export failed:", error.message));
        }
      }
    })();
  }
  if (!loading.isDestroyed()) loading.destroy();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox("Unable to load the song library", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => { cancelVideoDownloads(); updater?.stop(); remoteServer?.stop(); });
