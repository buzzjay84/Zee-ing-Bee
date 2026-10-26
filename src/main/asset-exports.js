const fs = require("node:fs");
const path = require("node:path");

function safeName(value) {
  const clean = String(value ?? "").normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 130);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `_${clean}` : clean || "Music video";
}

function createAssetExporter(root) {
  const pending = new Map();
  async function exportFile(entry, song, kind) {
    if (!["music-videos", "karaoke-videos"].includes(kind) || !/^[\w-]{11}$/.test(entry.id)) throw new Error("Invalid exported asset.");
    const dir = path.join(root, kind);
    const title = song.title || entry.songTitle || entry.title;
    const artist = song.artist || entry.artist || "";
    const file = path.join(dir, `${safeName(`${title}${artist ? ` - ${artist}` : ""}`)} [${entry.id}].mp4`);
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      const source = await fs.promises.stat(entry.path);
      let target;
      try { target = await fs.promises.stat(file); } catch {}
      let previous = {};
      try { previous = JSON.parse(await fs.promises.readFile(`${file}.json`, "utf8")); } catch {}
      const sourceFingerprint = `${source.size}:${source.mtimeMs}`;
      if (target?.size !== source.size || previous.sourceFingerprint !== sourceFingerprint) {
        await fs.promises.copyFile(entry.path, `${file}.part`);
        await fs.promises.rename(`${file}.part`, file);
      }
      const metadata = { title, artist, videoId: entry.id, sourceTitle: entry.title, kind, bytes: source.size, hasAudio: Boolean(entry.hasAudio), savedAt: entry.savedAt, sourceFingerprint };
      await fs.promises.writeFile(`${file}.json`, JSON.stringify(metadata, null, 2));
      return file;
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  }
  return { root, exportFile };
}
module.exports = { createAssetExporter, safeName };
