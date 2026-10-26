const fs = require("node:fs");
const path = require("node:path");
const { parseFileName } = require("./library");

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".m4v"]);
const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function indexVideos(folders) {
  const videos = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        const meta = parseFileName(file);
        videos.push({ path: file, title: normalize(meta.title), artist: normalize(meta.artist) });
      }
    }
  }
  for (const folder of new Set(folders)) walk(folder);
  return videos;
}

function matchVideo(videos, song) {
  const title = normalize(song.title);
  const artist = normalize(song.artist);
  if (!title) return null;
  return videos.find((v) => v.title === title && v.artist === artist)
    ?? videos.find((v) => v.title === title && !v.artist)
    ?? null;
}

module.exports = { indexVideos, matchVideo };
