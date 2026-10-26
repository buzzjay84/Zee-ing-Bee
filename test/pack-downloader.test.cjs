const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createPackDownloader, UNLOCK_FRACTION } = require("../src/main/pack-downloader");

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "zb-packs-"));

function fakeFetchManifest(manifest) {
  return async (url) => (url.endsWith("manifest.json")
    ? { ok: true, json: async () => manifest }
    : { ok: false });
}

test("sync downloads every pack in order, verifies checksums and reports progress to unlock", async () => {
  const root = tmpRoot();
  const contents = { "a.zip": "a".repeat(100), "b.zip": "b".repeat(900) };
  const manifest = Object.entries(contents).map(([name, text]) => ({ name, size: text.length, sha256: sha256(text) }));
  const progress = [];
  const downloader = createPackDownloader(root, {
    fetch: fakeFetchManifest(manifest),
    downloadFile: async (url, dest) => fs.writeFileSync(dest, contents[path.basename(url)]),
  });
  await downloader.sync((info) => progress.push(info));
  assert.equal(fs.readFileSync(path.join(root, "a.zip"), "utf8"), contents["a.zip"]);
  assert.equal(fs.readFileSync(path.join(root, "b.zip"), "utf8"), contents["b.zip"]);
  assert.equal(progress.at(-1).done, 1000);
  assert.equal(progress.at(-1).total, 1000);
  // Nothing is downloaded at the first report, so it is locked; once everything is in, it is unlocked.
  assert.equal(progress[0].unlocked, false);
  assert.equal(progress.at(-1).unlocked, true);
  assert.ok(UNLOCK_FRACTION < 1);
});

test("an already-complete pack is not re-downloaded", async () => {
  const root = tmpRoot();
  const text = "x".repeat(50);
  fs.writeFileSync(path.join(root, "a.zip"), text);
  let downloads = 0;
  const downloader = createPackDownloader(root, {
    fetch: fakeFetchManifest([{ name: "a.zip", size: text.length, sha256: sha256(text) }]),
    downloadFile: async () => { downloads++; },
  });
  const progress = [];
  await downloader.sync((info) => progress.push(info));
  assert.equal(downloads, 0);
  assert.equal(progress[0].unlocked, true, "already satisfied before any download starts");
});

test("a pack that fails checksum verification is rejected and leaves no partial file", async () => {
  const root = tmpRoot();
  const downloader = createPackDownloader(root, {
    fetch: fakeFetchManifest([{ name: "a.zip", size: 5, sha256: sha256("right") }]),
    downloadFile: async (_url, dest) => fs.writeFileSync(dest, "wrong"),
  });
  await assert.rejects(downloader.sync(), /verification/);
  assert.equal(fs.existsSync(path.join(root, "a.zip")), false);
  assert.equal(fs.existsSync(path.join(root, "a.zip.part")), false);
});

test("the built-in download streams to disk and reports bytes while the pack is still arriving", async () => {
  const root = tmpRoot();
  const text = "z".repeat(4096);
  const manifest = [{ name: "a.zip", size: text.length, sha256: sha256(text) }];
  const progress = [];
  const downloader = createPackDownloader(root, {
    baseUrl: "https://packs.test",
    fetch: async (url) => (url.endsWith("manifest.json")
      ? { ok: true, json: async () => manifest }
      : new Response(text)),
  });
  await downloader.sync((info) => progress.push(info));
  assert.equal(fs.readFileSync(path.join(root, "a.zip"), "utf8"), text);
  assert.ok(progress.some((p) => p.done === 0 && p.received === text.length), "bytes are reported before the pack completes");
  assert.equal(progress.at(-1).done, text.length);
});

test("an invalid manifest is rejected before any download is attempted", async () => {
  const root = tmpRoot();
  let downloads = 0;
  const downloader = createPackDownloader(root, {
    fetch: fakeFetchManifest([{ name: "../escape.zip", size: 5, sha256: sha256("x") }]),
    downloadFile: async () => { downloads++; },
  });
  await assert.rejects(downloader.sync(), /invalid/i);
  assert.equal(downloads, 0);
});

test("needed() detects an app-only build from an empty or missing packs folder", () => {
  const root = tmpRoot();
  const downloader = createPackDownloader(root);
  assert.equal(downloader.needed(path.join(root, "does-not-exist")), true);
  const emptyPacks = path.join(root, "empty-packs");
  fs.mkdirSync(emptyPacks);
  assert.equal(downloader.needed(emptyPacks), true);
  fs.writeFileSync(path.join(emptyPacks, "01-opm-1.zip"), "data");
  assert.equal(downloader.needed(emptyPacks), false);
});
