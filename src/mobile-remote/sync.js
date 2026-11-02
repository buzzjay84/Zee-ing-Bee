// Caches catalog/song content locally for Standalone mode. Uses IndexedDB rather than
// the Cache Storage API, because Cache Storage/Service Workers require a secure context
// and this app is typically reached over plain http:// on a home LAN - IndexedDB has no
// such restriction.
const DB_NAME = "zb-remote";
const DB_VERSION = 1;
const MAX_BANK_BYTES = 150 * 1024 * 1024;

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
   * `skip(song)` leaves out songs the phone gets elsewhere (the song packs).
   */
  async function startBackgroundSync(pairing, songs, onProgress = () => {}, skip = () => false) {
    const db = await dbPromise;
    await idbSet(db, "meta", "catalog", songs);
    if (syncing) return;
    syncing = true;
    try {
      const listResponse = await fetch(`${pairing.origin}/api/soundbanks?token=${pairing.token}`);
      const banks = listResponse.ok ? await listResponse.json() : null;
      // Every desktop bank the phone can hold; older desktops only offer the one in use (below).
      for (const bank of Array.isArray(banks) ? banks : []) {
        const list = (await idbGet(db, "meta", "soundbank-list")) ?? [];
        // shortcut: banks over MAX_BANK_BYTES are skipped, since the phone loads a whole bank into memory; raise it if phones cope.
        if (list.some((saved) => saved.name === bank.name) || bank.size > MAX_BANK_BYTES) continue;
        const response = await fetch(`${pairing.origin}/api/soundbank?name=${encodeURIComponent(bank.name)}&token=${pairing.token}`);
        if (!response.ok) continue;
        const data = await response.arrayBuffer();
        await idbSet(db, "meta", `soundbank:${bank.name}`, data);
        await idbSet(db, "meta", "soundbank-list", [...list, { name: bank.name, size: data.byteLength }]);
      }
      const bankResponse = banks ? null : await fetch(`${pairing.origin}/api/soundbank?token=${pairing.token}`);
      if (bankResponse?.ok) {
        const name = bankResponse.headers.get("X-Sound-Bank-Name") ?? "default";
        if ((await idbGet(db, "meta", "soundbank-name")) !== name) {
          await idbSet(db, "meta", "soundbank-data", await bankResponse.arrayBuffer());
          await idbSet(db, "meta", "soundbank-name", name);
        }
      }
      // MIDI songs are tiny, so the whole catalog is prefetched; videos are opt-in (see
      // downloadVideoForOffline) since they can be large.
      const eligible = songs.filter((song) => (!song.mediaKind || song.mediaKind === "midi") && !skip(song));
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

  /**
   * The banks copied from desktops, plus the single one older desktops sent, as
   * {name, size, load()}: a bank is tens of MB, so only the one being played is read.
   */
  async function getSoundBanks() {
    const db = await dbPromise;
    const banks = ((await idbGet(db, "meta", "soundbank-list")) ?? []).map(({ name, size }) => ({ name, size, load: () => idbGet(db, "meta", `soundbank:${name}`) }));
    const legacyName = await idbGet(db, "meta", "soundbank-name");
    if (legacyName && !banks.some((bank) => bank.name === legacyName)) {
      const data = await idbGet(db, "meta", "soundbank-data");
      if (data) banks.push({ name: legacyName, size: data.byteLength, load: async () => data });
    }
    return banks;
  }

  return { startBackgroundSync, downloadVideoForOffline, getCatalog, getSongBytes, getSoundBanks };
}
