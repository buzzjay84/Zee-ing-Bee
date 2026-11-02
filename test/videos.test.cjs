const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankVideos, preferHD, parseSearch, createOnlineSearch } = require("../src/main/online-videos");

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

test("official music videos take priority over newer live performances", () => {
  const song = { title: "Song", artist: "Artist" };
  const items = [
    { id: "abcdefghijk", title: "Artist Song Live Concert", channel: "Artist", published: "1d ago", duration: 200 },
    { id: "bcdefghijkl", title: "Artist Song Official Music Video", channel: "Artist", published: "3y ago", duration: 200 },
    { id: "cdefghijklm", title: "Artist Song Official Music Video", channel: "Artist", published: "1y ago", duration: 200 },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["cdefghijklm", "bcdefghijkl", "abcdefghijk"]);
});

test("live candidates remain available after all music video candidates fail", () => {
  const song = { title: "Song", artist: "Artist" };
  const musicVideos = Array.from({ length: 6 }, (_, index) => ({ id: `abcdefghij${index}`, title: "Artist Song Official Music Video", channel: "Artist", published: `${index + 1}y ago`, duration: 200 }));
  const live = { id: "artistlive1", title: "Artist Song Live Concert", channel: "Artist", published: "1d ago", duration: 200 };
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

test("TV and radio uploads are left out, since they carry the station's logo", () => {
  const song = { title: "Chinito", artist: "Yeng Constantino" };
  const items = [
    { id: "abcdefghijk", title: "Yeng Constantino performs Chinito LIVE on Wish 107.5 Bus", channel: "Wish 107.5", duration: 240 },
    { id: "bcdefghijkl", title: "Yeng Constantino - Chinito | ASAP Natin 'To", channel: "ABS-CBN Entertainment", duration: 240 },
    { id: "cdefghijklm", title: "Yeng Constantino - Chinito (Live on Wish 107.5)", channel: "Yeng Constantino", duration: 240 },
    { id: "defghijklmn", title: "Chinito - Yeng Constantino (Official Music Video)", channel: "ABS-CBN Star Music", duration: 240 },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["defghijklmn"]);
});

test("the song title must stand alone, not start another song's title", () => {
  const song = { title: "Ikaw", artist: "Yeng Constantino" };
  const items = [
    { id: "abcdefghijk", title: "Ogie Alcasid, Yeng Constantino - 'Ikaw ang Aking Pahinga' Official Performance Video", channel: "ABS-CBN Star Music", duration: 240 },
    { id: "bcdefghijkl", title: "IKAW (LIVE PERFORMANCE) - YENG CONSTANTINO | 10th Anniversary Version", channel: "Yeng Constantino", published: "1y ago", duration: 240 },
    { id: "cdefghijklm", title: "Ikaw - Yeng Constantino (Music Video)", channel: "ABS-CBN Star Music", duration: 240 },
  ];
  assert.deepEqual(rankVideos(items, song).map((v) => v.id), ["cdefghijklm", "bcdefghijkl"]);
});

test("1080p wins, and an old music video gives way to a 1080p live one", () => {
  const oldMv = { id: "oldmv", kind: "music-video", published: "11 years ago", height: 1080 };
  const sdMv = { id: "sdmv", kind: "music-video", published: "1 year ago", height: 480 };
  const newMv = { id: "newmv", kind: "music-video", published: "2 years ago", height: 1080 };
  const live = { id: "live", kind: "live", published: "1 year ago", height: 1080 };
  const sdLive = { id: "sdlive", kind: "live", published: "1 month ago", height: 720 };
  const ids = (items) => items.map((item) => item.id);
  assert.deepEqual(ids(preferHD([oldMv, sdMv, live, sdLive])), ["live", "oldmv", "sdmv", "sdlive"]);
  assert.deepEqual(ids(preferHD([newMv, oldMv, live])), ["newmv", "live", "oldmv"]);
  assert.deepEqual(ids(preferHD([newMv, live], { liveFirst: true })), ["live", "newmv"]);
  assert.deepEqual(ids(preferHD([sdMv, sdLive])), ["sdmv", "sdlive"], "no 1080p: the usual order");
});
