// Downloads GeneralUser GS by S. Christian Collins (GeneralUser GS License v2.0, which allows
// bundling it in software) into resources/soundfonts, plus its license text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "resources", "soundfonts");
const base = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main";
const files = [
  { url: `${base}/GeneralUser-GS.sf2`, name: "GeneralUser GS.sf2", minBytes: 20_000_000 },
  { url: `${base}/documentation/LICENSE.txt`, name: "GeneralUser GS LICENSE.txt", minBytes: 500 },
];

fs.mkdirSync(dir, { recursive: true });
for (const f of files) {
  const out = path.join(dir, f.name);
  if (fs.existsSync(out) && fs.statSync(out).size >= f.minBytes) {
    console.log("already here:", f.name);
    continue;
  }
  console.log("downloading", f.name, "…");
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < f.minBytes) throw new Error(`${f.name} looks too small (${buf.length} bytes)`);
  fs.writeFileSync(out, buf);
  console.log("saved", f.name, `${(buf.length / 1e6).toFixed(1)} MB`);
}
