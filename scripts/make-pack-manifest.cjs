const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Writes manifest.json for the song packs the app downloads in the background.
// Packs are listed in file-name order, which is the order the app downloads them,
// so name the most popular packs to sort first.
// Usage: node scripts/make-pack-manifest.cjs [packs folder]
const root = path.resolve(__dirname, "..");
const dir = path.resolve(process.argv[2] ?? path.join(root, "src", "assets", "packs"));

const names = fs.readdirSync(dir).filter((f) => f.endsWith(".zip")).sort();
if (names.length === 0) throw new Error(`No .zip packs found in ${dir}`);
const invalid = names.filter((name) => !/^[\w.-]+\.zip$/.test(name));
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
fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const total = manifest.reduce((sum, e) => sum + e.size, 0);
console.log(`Wrote manifest.json: ${manifest.length} packs, ${(total / 1024 / 1024).toFixed(1)} MB in total.`);
