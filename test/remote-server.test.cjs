const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { createRemoteServer } = require("../src/main/remote-server");
const { searchSongs } = require("../src/shared/search");

const SONGS = [
  { number: 10001, title: "Twinkle Toes", artist: "Someone", category: "Kids" },
  { number: 10002, title: "Big Ballad", artist: "Someone Else", category: "Pop" },
];

function tmpStaticDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zb-remote-static-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Remote</title>");
  return dir;
}

async function startServer(overrides = {}) {
  const server = createRemoteServer({
    staticDir: tmpStaticDir(),
    getSongs: () => SONGS,
    searchSongs,
    readSongFile: async () => null,
    readSoundbank: async () => null,
    readSongVideo: async () => null,
    onAction: () => {},
    ...overrides,
  });
  await server.start();
  const { port, token } = server.info();
  return { server, port, token };
}

test("ping rejects a missing or wrong token and accepts the right one", async () => {
  const { server, port, token } = await startServer();
  try {
    const wrong = await fetch(`http://127.0.0.1:${port}/api/ping?token=nope`);
    assert.equal(wrong.status, 401);
    const right = await fetch(`http://127.0.0.1:${port}/api/ping?token=${token}`);
    assert.equal(right.status, 200);
    assert.deepEqual(await right.json(), { ok: true });
  } finally {
    server.stop();
  }
});

test("serves the catalog and search results", async () => {
  const { server, port, token } = await startServer();
  try {
    const songs = await (await fetch(`http://127.0.0.1:${port}/api/songs?token=${token}`)).json();
    assert.equal(songs.length, 2);
    const results = await (await fetch(`http://127.0.0.1:${port}/api/search?token=${token}&q=ballad`)).json();
    assert.equal(results.songs[0].title, "Big Ballad");
  } finally {
    server.stop();
  }
});

test("serves a song's MIDI bytes through readSongFile", async () => {
  const { server, port, token } = await startServer({ readSongFile: async (number) => (number === "10001" ? Buffer.from("midi-bytes") : null) });
  try {
    const found = await fetch(`http://127.0.0.1:${port}/api/song/10001/midi?token=${token}`);
    assert.equal(found.status, 200);
    assert.equal(await found.text(), "midi-bytes");
    const missing = await fetch(`http://127.0.0.1:${port}/api/song/99999/midi?token=${token}`);
    assert.equal(missing.status, 404);
  } finally {
    server.stop();
  }
});

test("proxies a cached video with range-request support", async () => {
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "zb-remote-video-"));
  const videoFile = path.join(videoDir, "song.mp4");
  fs.writeFileSync(videoFile, "0123456789");
  const { server, port, token } = await startServer({ readSongVideo: async (number) => (number === "10001" ? videoFile : null) });
  try {
    const full = await fetch(`http://127.0.0.1:${port}/api/song/10001/video?token=${token}`);
    assert.equal(full.status, 200);
    assert.equal(await full.text(), "0123456789");
    const ranged = await fetch(`http://127.0.0.1:${port}/api/song/10001/video?token=${token}`, { headers: { Range: "bytes=2-4" } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "234");
    const missing = await fetch(`http://127.0.0.1:${port}/api/song/99999/video?token=${token}`);
    assert.equal(missing.status, 404);
  } finally {
    server.stop();
  }
});

test("serves the static mobile app at /", async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Remote/);
  } finally {
    server.stop();
  }
});

test("a WebSocket reserve action is forwarded, and broadcastState reaches the phone", async () => {
  const actions = [];
  const { server, port, token } = await startServer({ onAction: (action) => actions.push(action) });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const received = new Promise((resolve) => ws.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
    ws.send(JSON.stringify({ type: "reserve", number: 10001 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(actions, [{ type: "reserve", number: 10001 }]);
    server.broadcastState({ queue: [SONGS[0]], nowPlaying: null });
    assert.deepEqual(await received, { type: "state", queue: [SONGS[0]], nowPlaying: null });
    ws.close();
  } finally {
    server.stop();
  }
});

test("a WebSocket connection with the wrong token is refused", async () => {
  const { server, port } = await startServer();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
    await new Promise((resolve) => { ws.once("error", resolve); ws.once("close", resolve); });
  } finally {
    server.stop();
  }
});
