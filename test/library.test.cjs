const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const library = require("../src/main/library");
const { normalize, matches } = require("../src/shared/search");
const { buildSongbookHtml } = require("../src/main/songbook");

function tempSongs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zb-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "");
  }
  return dir;
}

test("songs get numbers that survive a rescan", () => {
  const dir = tempSongs(["OPM/Anak - Freddie Aguilar.kar", "Christmas/Silent Night.mid", "notes.txt"]);
  const lib = library.addFolder(library.emptyLibrary(), dir);
  assert.equal(lib.songs.length, 2, "only song files count");
  const before = new Map(lib.songs.map((s) => [s.path, s.number]));

  fs.writeFileSync(path.join(dir, "OPM", "Bayan Ko - Traditional.kar"), "");
  library.rescan(lib);
  assert.equal(lib.songs.length, 3);
  for (const [p, n] of before) assert.equal(lib.songs.find((s) => s.path === p).number, n);
  assert.equal(new Set(lib.songs.map((s) => s.number)).size, 3, "numbers are unique");
  assert.ok(lib.songs.every((s) => s.number >= 10001 && s.number <= 99999));
});

test("file names give title, artist and category", () => {
  const dir = tempSongs(["OPM/Anak - Freddie Aguilar.kar"]);
  const [song] = library.addFolder(library.emptyLibrary(), dir).songs;
  assert.equal(song.title, "Anak");
  assert.equal(song.artist, "Freddie Aguilar");
  assert.equal(song.category, "OPM");
  assert.deepEqual(library.parseFileName("Just_A_Title.mid"), { title: "Just A Title", artist: "" });
  assert.deepEqual(library.parseFileName("10001 - 1-2-8 - April Boy Regino.mid"), { title: "1-2-8", artist: "April Boy Regino" });
});

test("the library saves and loads", () => {
  const dir = tempSongs(["A - B.kar"]);
  const file = path.join(dir, "data", "library.json");
  const lib = library.addFolder(library.emptyLibrary(), dir);
  library.save(file, lib);
  assert.deepEqual(library.load(file).songs, lib.songs);
  assert.deepEqual(library.load(path.join(dir, "missing.json")).songs, []);
});

test("search ignores accents, apostrophes and case", () => {
  assert.equal(normalize("Niño Don't"), "nino dont");
  const song = { number: 10042, title: "Don't Stop Believin'", artist: "Journey", category: "International" };
  assert.ok(matches(song, "dont stop"));
  assert.ok(matches(song, "JOURNEY"));
  assert.ok(matches(song, "1004"));
  assert.ok(!matches(song, "anak"));
});

test("the songbook lists every song and escapes names", () => {
  const html = buildSongbookHtml(
    [
      { number: 10001, title: "Tom & Jerry <3", artist: "X", category: "Kids" },
      { number: 10002, title: "Anak", artist: "Freddie Aguilar", category: "OPM" },
    ],
    "Zee-ing Bee",
  );
  assert.ok(html.includes("10001") && html.includes("10002"));
  assert.ok(html.includes("Tom &amp; Jerry &lt;3"));
  assert.ok(!html.includes("<3"));
});
