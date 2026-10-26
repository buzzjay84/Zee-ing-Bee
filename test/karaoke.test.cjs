const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const library = require("../src/main/library");
const { validateQuery, filterKaraoke } = require("../src/main/karaoke");

test("karaoke imports keep song numbers through save, restart and rescan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-karaoke-"));
  const video = path.join(root, "song.mp4");
  fs.writeFileSync(video, "fixture");
  const lib = library.emptyLibrary();
  const song = library.importVideo(lib, { title: "New Song", artist: "Artist", path: video });
  const duplicate = library.importVideo(lib, { title: "NEW SONG", artist: "Artist", path: video });
  assert.equal(duplicate.number, song.number);
  assert.equal(lib.songs.length, 1);
  const file = path.join(root, "library.json");
  library.save(file, lib);
  const restored = library.rescan(library.load(file));
  assert.equal(restored.songs[0].number, song.number);
  assert.equal(restored.songs[0].mediaKind, "video");
  fs.unlinkSync(video);
  assert.equal(library.rescan(restored).songs.length, 0);
});

test("overlapping song folders do not duplicate songs or numbers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-overlap-"));
  const child = path.join(root, "sub");
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, "Song - Artist.mid"), "fixture");
  const lib = library.addFolder(library.emptyLibrary(), root);
  library.addFolder(lib, child);
  assert.equal(lib.songs.length, 1);
  assert.equal(lib.nextNumber, 10002);
});

test("karaoke search requires a title and artist and filters unrelated or vocal videos", () => {
  assert.throws(() => validateQuery("", "Artist"), /Enter/);
  assert.throws(() => validateQuery("Song", {}), /Enter/);
  const song = validateQuery(" Ordinary ", " Alex Warren ");
  assert.deepEqual(song, { title: "Ordinary", artist: "Alex Warren" });
  const results = filterKaraoke([
    { id: "bFvZbgCghj8", title: "Alex Warren - Ordinary (Karaoke Version)", duration: 191 },
    { id: "abcdefghijk", title: "Alex Warren - Ordinary (Official Music Video)", duration: 191 },
    { id: "bcdefghijkl", title: "Someone Else - Ordinary (Karaoke)", duration: 191 },
    { id: "cdefghijklm", title: "Alex Warren - Ordinary (Karaoke with vocals)", duration: 191 },
  ], song);
  assert.deepEqual(results.map((r) => r.id), ["bFvZbgCghj8"]);
});
