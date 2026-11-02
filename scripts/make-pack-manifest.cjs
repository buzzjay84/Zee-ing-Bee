const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Writes manifest.json for the song packs the app downloads in the background.
// Packs are listed in file-name order, which is the order the app downloads them,
// so name the most popular packs to sort first.
// Usage: node scripts/make-pack-manifest.cjs [packs folder]
// With --backgrounds it lists the .mp4/.webm stage videos in the folder as backgrounds.json
// instead (the phone downloads those after the songs; keep them few and small).
const root = path.resolve(__dirname, "..");
const backgrounds = process.argv.includes("--backgrounds");
const dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(root, "src", "assets", "packs"));
const ext = backgrounds ? /\.(mp4|webm)$/ : /\.zip$/;

const names = fs.readdirSync(dir).filter((f) => ext.test(f)).sort();
if (names.length === 0) throw new Error(`No ${backgrounds ? "videos" : ".zip packs"} found in ${dir}`);
const invalid = names.filter((name) => !/^[\w.-]+$/.test(name));
if (invalid.length) throw new Error(`Rename these packs to use only letters, numbers, ".", "_" and "-": ${invalid.join(", ")}`);

const manifest = names.map((name) => {
  const file = path.join(dir, name);
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(1 << 20);
  for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read));
  fs.closeSync(fd);
  return { name, size: fs.statSync(file).size, sha256: hash.digest("hex") };
});
fs.writeFileSync(path.join(dir, backgrounds ? "backgrounds.json" : "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const total = manifest.reduce((sum, e) => sum + e.size, 0);
console.log(`Wrote ${backgrounds ? "backgrounds.json" : "manifest.json"}: ${manifest.length} files, ${(total / 1024 / 1024).toFixed(1)} MB in total.`);
