const { test } = require("node:test");
const assert = require("node:assert/strict");
const { searchSongs } = require("../src/shared/search");
const songs = [
  { number: 10001, title: "Bakit Ba Ikaw", artist: "Artist A", category: "OPM" },
  { number: 10002, title: "Ikaw", artist: "Yeng Constantino", category: "OPM" },
  { number: 10003, title: "Ikaw", artist: "Artist B", category: "OPM" },
  { number: 10004, title: "Ikaw Lang", artist: "Artist C", category: "OPM" },
];
test("exact titles stay above suggestions, without duplicate songs", () => {
  const result = searchSongs(songs, "IKAW");
  assert.equal(result.mode, "exact");
  assert.equal(result.exactCount, 2);
  assert.equal(result.suggestedCount, 2);
  assert.deepEqual(result.songs.map((s) => s.number), [10002, 10003, 10004, 10001]);
});
test("suggestions also work without exact matches and exact numbers stay first", () => {
  assert.deepEqual(searchSongs(songs, "10001").songs.map((s) => s.number), [10001]);
  const result = searchSongs(songs, "ikaw la");
  assert.equal(result.mode, "suggested");
  assert.equal(result.songs[0].title, "Ikaw Lang");
  assert.equal(searchSongs(songs, "missing song").songs.length, 0);
  assert.equal(searchSongs(songs, "").mode, "all");
  assert.equal(searchSongs(songs, "Yeng Constantino").mode, "exact");
});
