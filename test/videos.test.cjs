const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankVideos, parseSearch, createOnlineSearch } = require("../src/main/online-videos");

test("music video selection excludes other artists and karaoke covers", () => {
  const song = { title: "Hawak Kamay", artist: "Yeng Constantino" };
  const items = [
    { id: "abcdefghijk", title: "Hawak Kamay (Karaoke)", channel: "Yeng Constantino" },
    { id: "bcdefghijkl", title: "Hawak Kamay Official Music Video", channel: "Other Artist" },
    { id: "cdefghijklm", title: "Yeng Constantino - Hawak Kamay (Official Lyric Video)", channel: "Sony Music" },
    { id: "defghijklmn", title: "Yeng Constantino - Hawak Kamay (Official Music Video)", channel: "Sony Music" },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["defghijklmn"]);
  assert.deepEqual(rankVideos([{ id: "MXlZ49vQQII", title: "MUSIC VIDEO - Yeng Constantino - Hawak Kamay", channel: "JosephineConstantino" }], song), []);
});

test("official music videos take priority over newer Wish or live performances", () => {
  const song = { title: "Song", artist: "Artist" };
  const items = [
    { id: "abcdefghijk", title: "Artist Song live on Wish 107.5", channel: "Wish 107.5", published: "1d ago", duration: 200 },
    { id: "bcdefghijkl", title: "Artist Song Official Music Video", channel: "Artist", published: "3y ago", duration: 200 },
    { id: "cdefghijklm", title: "Artist Song Official Music Video", channel: "Artist", published: "1y ago", duration: 200 },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["cdefghijklm", "bcdefghijkl", "abcdefghijk"]);
});

test("live candidates remain available after all music video candidates fail", () => {
  const song = { title: "Song", artist: "Artist" };
  const musicVideos = Array.from({ length: 6 }, (_, index) => ({ id: `abcdefghij${index}`, title: "Artist Song Official Music Video", channel: "Artist", published: `${index + 1}y ago`, duration: 200 }));
  const live = { id: "wishlive123", title: "Artist Song live on Wish 107.5", channel: "Wish 107.5", published: "1d ago", duration: 200 };
  const result = rankVideos([...musicVideos, live], song);
  assert.deepEqual(result.map((item) => item.kind), ["music-video", "music-video", "music-video", "live"]);
  assert.equal(result.at(-1).id, live.id);
});

test("search parsing accepts video results and ignores channel results", () => {
  const data = { contents: [{ videoRenderer: { videoId: "abcdefghijk", title: { runs: [{ text: "Song" }] }, ownerText: { runs: [{ text: "Artist" }] } } }, { channelRenderer: { channelId: "other" } }] };
  assert.deepEqual(parseSearch(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`), [{ id: "abcdefghijk", title: "Song", channel: "Artist", verified: false, published: "", duration: null }]);
  assert.deepEqual(parseSearch("Consent required"), []);
});

test("recent official live performances outrank older ones and exclude reposts", () => {
  const song = { title: "Chinito", artist: "Yeng Constantino" };
  const items = [
    { id: "abcdefghijk", title: "Yeng Constantino Chinito Live", channel: "Yeng Constantino", published: "3 years ago", duration: 240 },
    { id: "lgmRUQm-Guw", title: "Yeng Live: NEW GEN | Chinito | Yeng Constantino and KAIA", channel: "Yeng Constantino", published: "2mo ago", duration: 240 },
    { id: "bcdefghijkl", title: "Yeng Constantino Chinito Live", channel: "Random Reuploads", verified: true, published: "1 day ago", duration: 240 },
    { id: "cdefghijklm", title: "Yeng Constantino Chinito Live Shorts", channel: "Yeng Constantino", published: "1 day ago", duration: 30 },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["lgmRUQm-Guw", "abcdefghijk"]);
});
