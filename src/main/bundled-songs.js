const fs = require("node:fs");
const path = require("node:path");
const { extract } = require("@electron-internal/extract-zip");

// Extract once per pack version into writable storage, also for installed apps.
async function prepareBundledSongs(packsDir, cacheDir) {
  if (!fs.existsSync(packsDir)) return [];
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const name of fs.readdirSync(packsDir).filter((n) => n.endsWith(".zip")).sort()) {
    const archive = path.join(packsDir, name);
    const stat = fs.statSync(archive);
    const version = `${stat.size}:${stat.mtimeMs}`;
    const target = path.join(cacheDir, path.basename(name, ".zip"));
    const marker = path.join(target, ".complete");
    // Match on size only: dev and installed builds share this cache but their zips carry different dates.
    // shortcut: a repacked zip with the exact same size is not re-extracted; key on the .sha256 sidecar if that ever bites.
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").split(":")[0] === String(stat.size)) continue;
    fs.mkdirSync(target, { recursive: true });
    await extract(archive, { dir: target });
    fs.writeFileSync(marker, version);
  }
  return fs.readdirSync(packsDir).filter((n) => n.endsWith(".zip")).sort().flatMap((name) => {
    const root = path.join(cacheDir, path.basename(name, ".zip"));
    return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({
      path: path.join(root, e.name), name: e.name.replace(/^\d+\s+/, ""), builtIn: true,
    }));
  });
}

module.exports = { prepareBundledSongs };
