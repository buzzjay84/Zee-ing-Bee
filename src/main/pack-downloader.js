const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Lets an "app only" install (no song packs bundled) fetch them from a GitHub Release in
// the background on first launch, and unlock the library once a meaningful share has
// arrived, rather than making people stare at an empty app for however long the full
// download takes. A "full" install already has its packs locally and never needs this.
const DEFAULT_RELEASE = "https://github.com/buzzjay84/Zee-ing-Bee/releases/download/packs";
const UNLOCK_FRACTION = 0.1;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

function createPackDownloader(cacheDir, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_RELEASE;
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

  async function defaultDownloadFile(url, dest) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`Could not download ${path.basename(dest)}`);
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  }

  async function downloadOne(entry) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = targetFile(entry);
    const tempFile = `${target}.part`;
    await (options.downloadFile ?? defaultDownloadFile)(`${baseUrl}/${entry.name}`, tempFile);
    const stat = fs.statSync(tempFile);
    if (stat.size !== entry.size || (await sha256File(tempFile)) !== entry.sha256) {
      fs.unlinkSync(tempFile);
      throw new Error(`${entry.name} failed verification`);
    }
    fs.renameSync(tempFile, target);
  }

  /** Downloads whatever isn't already complete, in manifest order, reporting progress as it goes. */
  async function sync(onProgress = () => {}) {
    const manifest = await fetchManifest();
    const total = manifest.reduce((sum, e) => sum + e.size, 0);
    const doneBefore = manifest.filter(isComplete).reduce((sum, e) => sum + e.size, 0);
    const report = (done) => onProgress({ done, total, unlocked: total === 0 || done / total >= UNLOCK_FRACTION });
    report(doneBefore);
    let done = doneBefore;
    for (const entry of manifest) {
      if (isComplete(entry)) continue;
      await downloadOne(entry);
      done += entry.size;
      report(done);
    }
  }

  /** True once nothing has been bundled locally — the signal that this is an "app only" build. */
  const needed = (packsDir) => {
    try { return fs.readdirSync(packsDir).filter((f) => f.endsWith(".zip")).length === 0; } catch { return true; }
  };

  return { sync, needed, cacheDir };
}

module.exports = { createPackDownloader, UNLOCK_FRACTION };
