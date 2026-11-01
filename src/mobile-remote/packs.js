// Downloads the song packs from the same place as the desktop's src/main/pack-downloader.js,
// so the phone can sing without ever meeting a desktop.
// Each pack zip is kept whole in IndexedDB and songs are inflated out of it on demand,
// so the phone stores ~the download size instead of every extracted file.
const DB_NAME = "zb-packs";
const RETRY_MS = 30000;
const STALL_MS = 60000;
const SOUND_BANK = { name: "GeneralUser GS.sf2", url: "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2" };
const SONG_FILE = /\.(mid|midi|kar)$/i;
const FIRST_NUMBER = 10001;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const store of ["packs", "meta"]) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idb(db, store, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
const idbGet = (db, store, key) => idb(db, store, "readonly", (s) => s.get(key));
const idbSet = (db, store, key, value) => idb(db, store, "readwrite", (s) => s.put(value, key));

/** Lists a zip's files from its central directory: name, compression method and where the data sits. */
export function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Damaged zip directory");
    const nameLength = view.getUint16(at + 28, true);
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/** Inflates one entry found by readZipEntries. */
export async function readZipEntry(blob, entry) {
  const header = new DataView(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return data.arrayBuffer();
  if (entry.method !== 8) throw new Error("Unsupported zip compression");
  return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
}

/** Same as the desktop's library.parseFileName: "Title - Artist.kar" → { title, artist }. */
function parseFileName(file) {
  const base = file.split("/").pop().replace(/\.[^.]+$/, "").replace(/_/g, " ").trim().replace(/^\d{5}\s+-\s+/, "");
  const dash = base.indexOf(" - ");
  if (dash === -1) return { title: base, artist: "" };
  return { title: base.slice(0, dash).trim(), artist: base.slice(dash + 3).trim() };
}

/**
 * Numbers songs the way a fresh desktop install does (bundled-songs.js + library.rescan),
 * so a phone that never met a desktop still matches the printed songbook: packs in name
 * order, each top-level folder of a pack is a category, files sorted by path, counting up
 * from 10001.
 * shortcut: assumes the desktop library holds only the packs; a desktop where folders
 * were added before the packs arrived numbers differently - pair once to use its numbers.
 */
export function numberSongs(packs) {
  let number = FIRST_NUMBER;
  const songs = [];
  for (const pack of [...packs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const folders = new Map();
    for (const entry of pack.entries) {
      const parts = entry.name.split("/");
      if (parts.length < 2 || parts.some((p) => p.startsWith(".")) || !SONG_FILE.test(entry.name)) continue;
      if (!folders.has(parts[0])) folders.set(parts[0], []);
      folders.get(parts[0]).push(entry);
    }
    for (const folder of [...folders.keys()].sort()) {
      // The desktop sorts full Windows paths, where the separator is a backslash.
      const files = folders.get(folder).map((entry) => ({ entry, key: entry.name.replace(/\//g, "\\") }));
      files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const { entry } of files) {
        songs.push({ number: number++, ...parseFileName(entry.name), category: folder.replace(/^\d+\s+/, ""), pack: pack.name, entry });
      }
    }
  }
  return songs;
}

/**
 * GitHub release downloads send no CORS headers, so inside the app they go through Android's
 * own HTTP stack instead of the page's fetch. No byte-level progress that way, so progress
 * moves once per pack (each is ~10 MB).
 */
async function downloadPack(url, onBytes) {
  const http = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins.CapacitorHttp;
  if (!http) return download(url, onBytes);
  const response = await http.request({ url, method: "GET", responseType: "arraybuffer", connectTimeout: 20000, readTimeout: STALL_MS });
  if (response.status !== 200) throw new Error(`Download failed (${response.status})`);
  const blob = await (await fetch(`data:application/octet-stream;base64,${response.data}`)).blob();
  onBytes(blob.size, blob.size);
  return blob;
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetches into a Blob, calling onBytes(received) as data arrives. Gives up only when it stalls, like the desktop. */
async function download(url, onBytes) {
  const controller = new AbortController();
  let timer;
  const resetStall = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_MS);
  };
  resetStall();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStall();
      chunks.push(value);
      received += value.length;
      onBytes(received, Number(response.headers.get("Content-Length")) || 0);
    }
    return new Blob(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export function createPackStore(baseUrl = window.ZBPacks.PACKS_URL) {
  const dbPromise = openDb();
  let catalog = null;

  async function getCatalog() {
    catalog ??= (await idbGet(await dbPromise, "meta", "catalog")) ?? [];
    return catalog;
  }

  async function getSongBytes(song) {
    const blob = await idbGet(await dbPromise, "packs", song.pack);
    return blob ? readZipEntry(blob, song.entry) : null;
  }

  async function getSoundBank() {
    const db = await dbPromise;
    const data = await idbGet(db, "meta", "soundbank");
    return data ? { name: SOUND_BANK.name, data } : null;
  }

  async function fetchManifest() {
    const manifest = JSON.parse(await (await downloadPack(`${baseUrl}/manifest.json`, () => {})).text());
    if (!Array.isArray(manifest) || manifest.some((e) => !/^[\w.-]+\.zip$/.test(e.name ?? "") || !Number.isInteger(e.size) || !/^[a-f0-9]{64}$/.test(e.sha256 ?? ""))) {
      throw new Error("The song pack list is invalid");
    }
    return manifest;
  }

  /**
   * One pass: sound bank first (nothing plays without it), then every pack not stored yet.
   * onProgress({phase: "soundbank"|"songs", percent}); onSongs(catalog) after each pack.
   */
  async function syncOnce(onProgress, onSongs) {
    const db = await dbPromise;
    if (!(await idbGet(db, "meta", "soundbank"))) {
      onProgress({ phase: "soundbank", percent: 0 });
      const bank = await download(SOUND_BANK.url, (got, size) => onProgress({ phase: "soundbank", percent: size ? Math.floor((got / size) * 100) : 0 }));
      await idbSet(db, "meta", "soundbank", await bank.arrayBuffer());
    }
    const manifest = await fetchManifest();
    const stored = (await idbGet(db, "meta", "stored")) ?? {};
    const total = manifest.reduce((sum, e) => sum + e.size, 0);
    let done = manifest.filter((e) => stored[e.name]?.sha256 === e.sha256).reduce((sum, e) => sum + e.size, 0);
    const report = (received = done) => onProgress({ phase: "songs", percent: total ? Math.floor((received / total) * 100) : 100 });
    report();
    for (const entry of manifest) {
      if (stored[entry.name]?.sha256 === entry.sha256) continue;
      const blob = await downloadPack(`${baseUrl}/${entry.name}`, (got) => report(done + Math.min(got, entry.size)));
      if (blob.size !== entry.size || (await sha256(blob)) !== entry.sha256) throw new Error(`${entry.name} failed verification`);
      await idbSet(db, "packs", entry.name, blob);
      stored[entry.name] = { sha256: entry.sha256, entries: readZipEntries(new Uint8Array(await blob.arrayBuffer())) };
      await idbSet(db, "meta", "stored", stored);
      catalog = numberSongs(Object.entries(stored).map(([name, pack]) => ({ name, entries: pack.entries })));
      await idbSet(db, "meta", "catalog", catalog);
      done += entry.size;
      report();
      onSongs(catalog);
    }
  }

  /** Keeps trying until everything is here; onProgress gets {phase: "retrying"} between attempts. */
  async function syncForever(onProgress, onSongs) {
    navigator.storage?.persist?.().catch(() => {});
    for (;;) {
      try {
        await syncOnce(onProgress, onSongs);
        return onProgress({ phase: "done", percent: 100 });
      } catch (error) {
        console.warn("Song pack download failed:", error.message);
        onProgress({ phase: "retrying" });
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  return { getCatalog, getSongBytes, getSoundBank, syncForever };
}
