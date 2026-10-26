const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVideoCache, validVideo, hasAudioTrack } = require("../src/main/video-cache");

const song = { title: "Test Song", artist: "Test Artist" };
const candidate = { id: "abcdefghijk", title: "Official Music Video" };
function sampleMp4(file, audio = true) {
  const bytes = Buffer.alloc(2048);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.writeUInt32BE(56, 24);
  bytes.write("moov", 28, "ascii");
  bytes.writeUInt32BE(48, 32);
  bytes.write("trak", 36, "ascii");
  bytes.writeUInt32BE(40, 40);
  bytes.write("mdia", 44, "ascii");
  bytes.writeUInt32BE(32, 48);
  bytes.write("hdlr", 52, "ascii");
  bytes.write(audio ? "soun" : "vide", 64, "ascii");
  bytes.writeUInt32BE(1968, 80);
  bytes.write("mdat", 84, "ascii");
  fs.writeFileSync(file, bytes);
}

test("completed videos survive restart and play from cache without network", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-cache-"));
  let downloads = 0;
  const cache = createVideoCache(root, {
    ensureDownloader: async () => "test-tool",
    downloadVideo: async (_tool, _id, file) => { downloads++; sampleMp4(file); },
  });
  const [first, duplicate] = await Promise.all([cache.save(song, candidate), cache.save(song, candidate)]);
  assert.equal(downloads, 1);
  assert.equal(first.path, duplicate.path);
  const offline = createVideoCache(root, { ensureDownloader: async () => { throw new Error("Offline"); } });
  assert.equal(offline.get(song).id, candidate.id);
  assert.equal((await offline.save(song, candidate)).path, first.path);
  assert.equal(downloads, 1);
});

test("different videos for the same song get distinct queued downloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-queue-"));
  const downloads = [];
  const cache = createVideoCache(root, { ensureDownloader: async () => "test", downloadVideo: async (_tool, id, file) => { downloads.push(id); sampleMp4(file); } });
  const alternate = { id: "bcdefghijkl", title: "Live performance" };
  const [first, second] = await Promise.all([cache.save(song, candidate), cache.save(song, alternate)]);
  assert.equal(first.id, candidate.id);
  assert.equal(second.id, alternate.id);
  assert.deepEqual(downloads, [candidate.id, alternate.id]);
});

test("cached MP4 validation rejects truncated media boxes and missing metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-truncated-"));
  const file = path.join(root, "video.mp4");
  sampleMp4(file);
  assert.equal(validVideo(file), true);
  fs.truncateSync(file, 1500);
  assert.equal(validVideo(file), false);
  const headerOnly = Buffer.alloc(2048);
  headerOnly.write("ftyp", 4, "ascii");
  fs.writeFileSync(file, headerOnly);
  assert.equal(validVideo(file), false);
});

test("partial or invalid downloads never become offline videos", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-cache-"));
  const cache = createVideoCache(root, {
    ensureDownloader: async () => "test-tool",
    downloadVideo: async (_tool, _id, file) => fs.writeFileSync(file, "incomplete"),
  });
  await assert.rejects(cache.save(song, candidate), /incomplete/);
  assert.equal(cache.get(song), null);
  assert.equal(createVideoCache(root).get(song), null);
  await assert.rejects(cache.save(song, { id: "../outside" }), /Invalid video ID/);
});

test("saved backgrounds remain available after search policy changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-policy-"));
  const oldCache = createVideoCache(root, { policy: "old", ensureDownloader: async () => "test", downloadVideo: async (_tool, _id, file) => sampleMp4(file) });
  await oldCache.save(song, candidate);
  assert.equal(createVideoCache(root, { policy: "new" }).get(song).id, candidate.id);
});

test("karaoke downloads request audio while background downloads do not", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-video-audio-"));
  let requestedAudio;
  const cache = createVideoCache(root, { withAudio: true, policy: "karaoke", ensureDownloader: async () => "test", downloadVideo: async (_tool, _id, file, options) => { requestedAudio = options.withAudio; sampleMp4(file); } });
  await cache.save(song, candidate);
  assert.equal(requestedAudio, true);
});

test("silent saved music videos are upgraded once to include original audio", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zb-music-audio-"));
  const silent = createVideoCache(root, { ensureDownloader: async () => "test", downloadVideo: async (_tool, _id, file) => sampleMp4(file, false) });
  const first = await silent.save(song, candidate);
  assert.equal(hasAudioTrack(first.path), false);
  let downloads = 0;
  const music = createVideoCache(root, { withAudio: true, ensureDownloader: async () => "test", downloadVideo: async (_tool, _id, file) => { downloads++; sampleMp4(file, true); } });
  const upgraded = await music.save(song, candidate);
  assert.equal(upgraded.hasAudio, true);
  await music.save(song, candidate);
  assert.equal(downloads, 1);
  assert.equal(music.list()[0].id, candidate.id);
});
