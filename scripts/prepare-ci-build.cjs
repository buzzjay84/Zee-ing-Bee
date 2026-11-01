const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = structuredClone(require(path.join(root, "package.json")).build);
// A clean checkout has no private media, but the logo is tracked and CI turns it into
// resources/icons with `npm run make-icons`, so the icon settings stay as they are.
config.extends = null;
config.files = ["src/**/*", "!src/assets/**/*", "package.json"];
config.extraResources = [{
  from: "resources/soundfonts/",
  to: "resources/soundfonts/",
  filter: ["GeneralUser GS.sf2", "GeneralUser GS LICENSE.txt"],
}, {
  // The window and taskbar icon (main.js appIcon); without it Windows shows Electron's.
  from: "resources/icons/",
  to: "resources/icons/",
  filter: ["zee-ing-bee.png"],
}];
config.artifactName = "Zee-ing-Bee-${version}-${os}-${arch}.${ext}";
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const file = path.join(root, "dist", "electron-builder-ci.json");
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log("Prepared source-only installer configuration:", file);
