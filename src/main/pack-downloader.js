const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// Lets an "app only" install (no song packs bundled) fetch them in the background on first
// launch, and unlock the library once a meaningful share has arrived, rather than making
// people stare at an empty app for however long the full download takes. A "full" install
// already has its packs locally and never needs this.
// The packs live in a private GitHub release. PACKS_URL is a Cloudflare Worker (see
// worker/) that answers each request with a short-lived download link, so the songs are
// never publicly listed and no GitHub token ships inside the app.
const PACKS_URL = process.env.ZB_PACKS_URL || "";
const UNLOCK_FRACTION = 0.07;
// A download only fails when it stalls, so large packs still finish on slow connections.
const STALL_MS = 60000;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

function createPackDownloader(cacheDir, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? PACKS_URL;
  const manifestUrl = options.manifestUrl ?? `${baseUrl}/manifest.json`;

  function targetFile(entry) {
    return path.join(cacheDir, entry.name);
  }
  function isComplete(entry) {
    try { return fs.statSync(targetFile(entry)).size === entry.size; } catch { return false; }
  }

  async function fetchManifest() {
    const response = await fetchImpl(manifestUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Unable to fetch the song pack list");
    const manifest = await response.json();
    if (!Array.isArray(manifest) || manifest.some((e) => !/^[\w.-]+\.zip$/.test(e.name ?? "") || !Number.isInteger(e.size) || !/^[a-f0-9]{64}$/.test(e.sha256 ?? ""))) {
      throw new Error("The song pack list is invalid");
    }
    return manifest;
  }

  async function defaultDownloadFile(url, dest, onBytes) {
    const controller = new AbortController();
    let timer;
    const resetStall = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), STALL_MS); };
    resetStall();
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Could not download ${path.basename(dest)}`);
      let received = 0;
      const progress = new Transform({
        transform(chunk, _encoding, callback) {
          resetStall();
          received += chunk.length;
          onBytes(received);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(dest));
    } finally {
      clearTimeout(timer);
    }
  }

  async function downloadOne(entry, onBytes) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = targetFile(entry);
    const tempFile = `${target}.part`;
    await (options.downloadFile ?? defaultDownloadFile)(`${baseUrl}/${entry.name}`, tempFile, onBytes);
    const stat = fs.statSync(tempFile);
    if (stat.size !== entry.size || (await sha256File(tempFile)) !== entry.sha256) {
      fs.unlinkSync(tempFile);
      throw new Error(`${entry.name} failed verification`);
    }
    fs.renameSync(tempFile, target);
  }

  /**
   * Downloads whatever isn't already complete, in manifest order, reporting progress as it goes.
   * `done` counts finished packs only (they are what unlock the library); `received` also
   * includes the pack still arriving, for showing a smooth percentage.
   */
  async function sync(onProgress = () => {}) {
    const manifest = await fetchManifest();
    const total = manifest.reduce((sum, e) => sum + e.size, 0);
    const doneBefore = manifest.filter(isComplete).reduce((sum, e) => sum + e.size, 0);
    const report = (done, received = done) => onProgress({ done, received, total, unlocked: total === 0 || done / total >= UNLOCK_FRACTION });
    report(doneBefore);
    let done = doneBefore;
    for (const entry of manifest) {
      if (isComplete(entry)) continue;
      await downloadOne(entry, (bytes) => report(done, done + Math.min(bytes, entry.size)));
      done += entry.size;
      report(done);
    }
  }

  /** True once nothing has been bundled locally — the signal that this is an "app only" build. */
  const needed = (packsDir) => {
    try { return fs.readdirSync(packsDir).filter((f) => f.endsWith(".zip")).length === 0; } catch { return true; }
  };

  return { sync, needed, cacheDir, configured: Boolean(baseUrl) };
}

module.exports = { createPackDownloader, UNLOCK_FRACTION };
