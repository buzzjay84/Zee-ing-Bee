// Caches catalog/song content locally for Standalone mode. Uses IndexedDB rather than
// the Cache Storage API, because Cache Storage/Service Workers require a secure context
// and this app is typically reached over plain http:// on a home LAN - IndexedDB has no
// such restriction.
const DB_NAME = "zb-remote";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ["catalog", "songs", "meta"]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbSet(db, store, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function createSync() {
  const dbPromise = openDb();
  let syncing = false;

  /**
   * Opportunistic background caching while a desktop is reachable (Remote mode). Runs
   * silently unless `onProgress({done, total})` is given - without it, there's no way
   * for the person to tell this is happening at all, or when it's safe to walk away.
   */
  async function startBackgroundSync(pairing, songs, onProgress = () => {}) {
    const db = await dbPromise;
    await idbSet(db, "meta", "catalog", songs);
    if (syncing) return;
    syncing = true;
    try {
      const bankResponse = await fetch(`${pairing.origin}/api/soundbank?token=${pairing.token}`);
      if (bankResponse.ok) {
        const name = bankResponse.headers.get("X-Sound-Bank-Name") ?? "default";
        if ((await idbGet(db, "meta", "soundbank-name")) !== name) {
          await idbSet(db, "meta", "soundbank-data", await bankResponse.arrayBuffer());
          await idbSet(db, "meta", "soundbank-name", name);
        }
      }
      // MIDI songs are tiny, so the whole catalog is prefetched; videos are opt-in (see
      // downloadVideoForOffline) since they can be large.
      const eligible = songs.filter((song) => !song.mediaKind || song.mediaKind === "midi");
      let done = 0;
      onProgress({ done, total: eligible.length });
      for (const song of eligible) {
        if (await idbGet(db, "songs", song.number)) {
          done++;
          continue;
        }
        const response = await fetch(`${pairing.origin}/api/song/${song.number}/midi?token=${pairing.token}`);
        if (response.ok) await idbSet(db, "songs", song.number, await response.arrayBuffer());
        done++;
        onProgress({ done, total: eligible.length });
      }
    } catch {
      // Best-effort: Standalone mode just has less cached if this fails partway through.
    } finally {
      syncing = false;
    }
  }

  async function downloadVideoForOffline(pairing, song) {
    const db = await dbPromise;
    const response = await fetch(`${pairing.origin}/api/song/${song.number}/video?token=${pairing.token}`);
    if (!response.ok) throw new Error("This song has no saved video on the desktop yet.");
    await idbSet(db, "songs", `${song.number}-video`, await response.arrayBuffer());
  }

  async function getCatalog() {
    return (await idbGet(await dbPromise, "meta", "catalog")) ?? [];
  }

  async function getSongBytes(number, mediaKind) {
    const key = mediaKind === "video" ? `${number}-video` : Number(number);
    return (await idbGet(await dbPromise, "songs", key)) ?? null;
  }

  async function getSoundBank() {
    const db = await dbPromise;
    const name = await idbGet(db, "meta", "soundbank-name");
    const data = await idbGet(db, "meta", "soundbank-data");
    return name && data ? { name, data } : null;
  }

  // Written by the Bluetooth path (bluetooth.js's on-demand fetch), not just WiFi sync -
  // once a song arrives over Bluetooth it's cached exactly like a WiFi-synced one, so
  // replaying it later needs no desktop at all, over any transport.
  async function cacheSongBytes(number, bytes) {
    await idbSet(await dbPromise, "songs", Number(number), bytes);
  }

  async function cacheSoundBank(name, data) {
    const db = await dbPromise;
    await idbSet(db, "meta", "soundbank-name", name);
    await idbSet(db, "meta", "soundbank-data", data);
  }

  return { startBackgroundSync, downloadVideoForOffline, getCatalog, getSongBytes, getSoundBank, cacheSongBytes, cacheSoundBank };
}
