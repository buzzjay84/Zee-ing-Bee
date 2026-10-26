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
  const songs = [];
  const seen = new Set();
  for (const folder of library.folders) {
    for (const file of walk(folder.path).sort()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const old = known.get(file);
      const meta = parseFileName(file);
      songs.push({
        number: old ? old.number : library.nextNumber++,
        path: file,
        title: meta.title,
        artist: meta.artist,
        category: folder.builtIn ? folder.name : categoryOf(folder.path, file),
        builtIn: Boolean(folder.builtIn),
      });
      known.delete(file);
    }
  }
  for (const song of library.imports ?? []) {
    if (fs.existsSync(song.path) && !seen.has(song.path)) { songs.push(song); seen.add(song.path); }
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
