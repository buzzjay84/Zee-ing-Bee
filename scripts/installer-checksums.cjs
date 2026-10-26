const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..", "dist");
const [platform, arch] = process.argv.slice(2);
if (!["win", "mac"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error("Specify win/mac and x64/arm64.");
const suffix = platform === "win" ? ".exe" : ".dmg";
const files = fs.readdirSync(root).filter((file) => file.endsWith(`-${platform}-${arch}${suffix}`)).sort();
if (!files.length) throw new Error(`No ${platform} ${arch} installer was produced.`);
async function main() {
  const lines = [];
  for (const file of files) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(path.join(root, file))) hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${file}`);
  }
  fs.writeFileSync(path.join(root, `SHA256SUMS-${platform}-${arch}.txt`), lines.join("\n") + "\n");
  console.log(`Checksummed ${files.length} installer(s).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
