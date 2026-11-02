// The song library: folders the singer added, each song with a five-digit number
// that stays the same between runs.
const fs = require("node:fs");
const path = require("node:path");

const SONG_EXTENSIONS = new Set([".mid", ".midi", ".kar"]);
const FIRST_NUMBER = 10001;

function emptyLibrary() {
  return { nextNumber: FIRST_NUMBER, folders: [], songs: [], imports: [], settings: {} };
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...emptyLibrary(), ...data };
  } catch {
    return emptyLibrary();
  }
}

function save(file, library) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(library, null, 2));
  fs.renameSync(tmp, file);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (SONG_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/** The five-digit number a pack song carries in its file name ("10888 - Title - Artist.mid"), or null. */
function packNumber(file) {
  return Number(path.basename(file).match(/^(\d{5})\s+-\s+/)?.[1]) || null;
}

/** "Title - Artist.kar" → { title, artist }. Underscores count as spaces. */
function parseFileName(file) {
  const base = path.basename(file, path.extname(file)).replace(/_/g, " ").trim().replace(/^\d{5}\s+-\s+/, "");
  const dash = base.indexOf(" - ");
  if (dash === -1) return { title: base, artist: "" };
  return { title: base.slice(0, dash).trim(), artist: base.slice(dash + 3).trim() };
}

/** The first subfolder under the added folder becomes the song's category chip. */
function categoryOf(folder, file) {
  const rel = path.relative(folder, path.dirname(file));
  if (!rel || rel.startsWith("..")) return path.basename(folder);
  return rel.split(path.sep)[0];
}

/**
 * Re-reads every folder. Known songs keep their number; new files get the next
 * free number; files that are gone drop out.
 */
function rescan(library) {
  const known = new Map(library.songs.map((s) => [s.path, s]));
  const seen = new Set();
  const found = [];
  for (const folder of library.folders) {
    for (const file of walk(folder.path).sort()) {
      if (seen.has(file)) continue;
      seen.add(file);
      found.push({ folder, file });
    }
  }
  const imports = (library.imports ?? []).filter((song) => fs.existsSync(song.path) && !seen.has(song.path));
  // Pack songs keep the number in their file name, so it never changes when the packs are
  // unpacked somewhere new, and matches the phone (numberSongs in mobile-remote/packs.js).
  const fixed = new Map(found.filter(({ folder }) => folder.builtIn).map(({ file }) => [file, packNumber(file)]).filter(([, n]) => n));
  const taken = new Set(fixed.values());
  // Everything else keeps its number unless a pack song now owns it or it outgrew five digits.
  const kept = new Map();
  for (const { file } of found.filter(({ file }) => !fixed.has(file))) {
    const number = known.get(file)?.number;
    if (number >= FIRST_NUMBER && number <= 99999 && !taken.has(number)) { kept.set(file, number); taken.add(number); }
  }
  for (const song of imports) {
    if (song.number >= FIRST_NUMBER && song.number <= 99999 && !taken.has(song.number)) taken.add(song.number);
    else song.number = null;
  }
  let highest = FIRST_NUMBER - 1;
  for (const number of taken) if (number > highest) highest = number;
  library.nextNumber = highest + 1;
  const songs = found.map(({ folder, file }) => {
    const meta = parseFileName(file);
    return {
      number: fixed.get(file) ?? kept.get(file) ?? library.nextNumber++,
      path: file,
      title: meta.title,
      artist: meta.artist,
      category: folder.builtIn ? folder.name : categoryOf(folder.path, file),
      builtIn: Boolean(folder.builtIn),
    };
  });
  for (const song of imports) {
    song.number ??= library.nextNumber++;
    songs.push(song);
  }
  songs.sort((a, b) => a.number - b.number);
  library.songs = songs;
  return library;
}

const normalizeSong = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function findSong(library, title, artist) {
  return library.songs.find((song) => normalizeSong(song.title) === normalizeSong(title) && normalizeSong(song.artist) === normalizeSong(artist));
}
function importVideo(library, meta) {
  const existing = findSong(library, meta.title, meta.artist);
  if (existing) return existing;
  if (library.nextNumber > 99999) throw new Error("The five-digit song library is full.");
  const song = { ...meta, number: library.nextNumber++, mediaKind: "video", category: "Online Karaoke", builtIn: false };
  library.imports ??= [];
  library.imports.push(song);
  library.songs.push(song);
  return song;
}

function addFolder(library, folderPath, extra = {}) {
  const resolved = path.resolve(folderPath);
  if (!library.folders.some((f) => f.path === resolved)) {
    library.folders.push({ path: resolved, name: path.basename(resolved), ...extra });
  }
  return rescan(library);
}

function removeFolder(library, folderPath) {
  library.folders = library.folders.filter((f) => f.path !== folderPath || f.builtIn);
  return rescan(library);
}

module.exports = {
  SONG_EXTENSIONS,
  FIRST_NUMBER,
  emptyLibrary,
  load,
  save,
  rescan,
  addFolder,
  removeFolder,
  parseFileName,
  categoryOf,
  findSong,
  importVideo,
};
