const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { SELECTION_POLICY } = require("./online-videos");

const TOOL_RELEASE = "2026.10.21";
const activeDownloads = new Set();
function cancelVideoDownloads() {
  for (const child of activeDownloads) child.kill();
}
const songKey = (song) => /^[a-f0-9]{64}$/.test(song.cacheKey ?? "") ? song.cacheKey : crypto.createHash("sha256").update(`${song.title.trim().toLowerCase()}|${song.artist.trim().toLowerCase()}`).digest("hex");

async function ensureDownloader(toolsDir) {
  const name = process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
  const target = path.join(toolsDir, `${TOOL_RELEASE}-${name}`);
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${TOOL_RELEASE}`;
  fs.mkdirSync(toolsDir, { recursive: true });
  const sumsResponse = await fetch(`${base}/SHA2-256SUMS`, { signal: AbortSignal.timeout(30000) });
  if (!sumsResponse.ok) throw new Error("Unable to verify the video downloader");
  const line = (await sumsResponse.text()).split(/\r?\n/).find((entry) => entry.trim().endsWith(` ${name}`));
  const expected = line?.split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error("Missing downloader checksum");
  if (fs.existsSync(target) && crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") === expected) return target;
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("Unable to install the video downloader");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Video downloader verification failed");
  fs.writeFileSync(`${target}.tmp`, bytes, { mode: 0o755 });
  fs.renameSync(`${target}.tmp`, target);
  return target;
}

function downloadVideo(tool, id, output, { nodePath = process.execPath, withAudio = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [
      "--ignore-config", "--no-playlist", "--no-progress", "--no-warnings",
      "--js-runtimes", `node:${nodePath}`, "--retries", "2", "--socket-timeout", "20",
      "--max-filesize", "250M", "--no-mtime",
      "-f", withAudio ? "best[ext=mp4][height<=720][acodec!=none][vcodec!=none]" : "bestvideo[ext=mp4][vcodec^=avc1][height<=720]/best[ext=mp4][height<=720]",
      "-o", output, `https://www.youtube.com/watch?v=${id}`,
    ], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "pipe"] });
    activeDownloads.add(child);
    child.once("close", () => activeDownloads.delete(child));
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText = (errorText + chunk.toString()).slice(-3000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Video download timed out")); }, 300000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(errorText.trim() || `Video download failed (${code})`)); });
  });
}

function validVideo(file) {
  try {
    if (fs.statSync(file).size < 1024) return false;
    const fd = fs.openSync(file, "r");
    try {
      const total = fs.fstatSync(fd).size;
      const header = Buffer.alloc(16);
      const types = new Set();
      let offset = 0;
      let count = 0;
      while (offset < total && count++ < 10000) {
        if (total - offset < 8) return false;
        fs.readSync(fd, header, 0, Math.min(16, total - offset), offset);
        const type = header.toString("ascii", 4, 8);
        let size = header.readUInt32BE(0);
        let headerSize = 8;
        if (size === 1) {
          if (total - offset < 16) return false;
          const large = header.readBigUInt64BE(8);
          if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false;
          size = Number(large);
          headerSize = 16;
        } else if (size === 0) size = total - offset;
        if (size < headerSize || offset + size > total) return false;
        types.add(type);
        offset += size;
      }
      return offset === total && types.has("ftyp") && types.has("moov") && types.has("mdat");
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

function hasAudioTrack(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const total = fs.fstatSync(fd).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= total) {
      fs.readSync(fd, header, 0, Math.min(16, total - offset), offset);
      const type = header.toString("ascii", 4, 8);
      let size = header.readUInt32BE(0);
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      else if (size === 0) size = total - offset;
      if (!Number.isSafeInteger(size) || size < 8 || offset + size > total) return false;
      if (type === "moov" && size <= 16 * 1024 * 1024) {
        const data = Buffer.alloc(size);
        fs.readSync(fd, data, 0, size, offset);
        let index = -1;
        while ((index = data.indexOf("hdlr", index + 1, "ascii")) !== -1) {
          if (data.toString("ascii", index + 12, index + 16) === "soun") return true;
        }
      }
      offset += size;
    }
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  return false;
}

function createVideoCache(root, options = {}) {
  const policy = options.policy ?? SELECTION_POLICY;
  const manifestFile = path.join(root, "index.json");
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch {}
  let downloader;
  let tail = Promise.resolve();
  const pending = new Map();
  async function mirror(saved, song) {
    if (saved && options.onSaved) {
      try { await options.onSaved(saved, song); } catch (error) { console.warn("Could not export downloaded asset:", error.message); }
    }
    return saved;
  }
  const get = (song) => {
    const entry = manifest[songKey(song)];
    if (!entry || !/^[\w-]{11}$/.test(entry.id)) return null;
    const file = path.join(root, `${entry.id}.mp4`);
    return validVideo(file) ? { ...entry, path: file, hasAudio: hasAudioTrack(file) } : null;
  };
  function save(song, candidate, onStatus = () => {}) {
    const existing = get(song);
    if (existing?.id === candidate.id && (!options.withAudio || existing.hasAudio)) return mirror(existing, song);
    if (!/^[\w-]{11}$/.test(candidate.id)) return Promise.reject(new Error("Invalid video ID"));
    const key = songKey(song);
    const requestKey = `${key}|${candidate.id}`;
    if (pending.has(requestKey)) return pending.get(requestKey);
    onStatus("queued");
    const task = tail.catch(() => {}).then(async () => {
      fs.mkdirSync(root, { recursive: true });
      const finalFile = path.join(root, `${candidate.id}.mp4`);
      if (!validVideo(finalFile) || options.withAudio && !hasAudioTrack(finalFile)) {
        onStatus("downloading");
        downloader ??= (options.ensureDownloader ?? ensureDownloader)(path.join(root, "tools")).catch((error) => { downloader = null; throw error; });
        const tool = await downloader;
        const tempFile = path.join(root, `${candidate.id}.${options.withAudio ? "audio." : ""}download.mp4`);
        if (fs.existsSync(tempFile) && !validVideo(tempFile)) fs.unlinkSync(tempFile);
        await (options.downloadVideo ?? downloadVideo)(tool, candidate.id, tempFile, { withAudio: Boolean(options.withAudio) });
        if (!validVideo(tempFile)) throw new Error("The downloaded video is incomplete");
        if (options.withAudio && !hasAudioTrack(tempFile)) throw new Error("The video has no audio track. Try another version.");
        fs.renameSync(tempFile, finalFile);
      }
      manifest[key] = { id: candidate.id, title: candidate.title, songTitle: song.title, artist: song.artist, policy, savedAt: new Date().toISOString() };
      fs.writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2));
      fs.renameSync(`${manifestFile}.tmp`, manifestFile);
      onStatus("saved");
      return mirror(get(song), song);
    }).finally(() => pending.delete(requestKey));
    pending.set(requestKey, task);
    tail = task.catch(() => {});
    return task;
  }
  // Resolves with the download already running for this song, if any.
  const pendingFor = (song) => {
    const prefix = `${songKey(song)}|`;
    for (const [requestKey, task] of pending) if (requestKey.startsWith(prefix)) return task;
    return null;
  };
  const list = () => Object.entries(manifest).flatMap(([key, entry]) => {
    if (!/^[\w-]{11}$/.test(entry.id)) return [];
    const file = path.join(root, `${entry.id}.mp4`);
    return validVideo(file) ? [{ ...entry, key, path: file, hasAudio: hasAudioTrack(file) }] : [];
  });
  return { get, save, list, pendingFor, root };
}

module.exports = { createVideoCache, ensureDownloader, validVideo, hasAudioTrack, cancelVideoDownloads };
