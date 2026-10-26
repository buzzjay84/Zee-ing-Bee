const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = structuredClone(require(path.join(root, "package.json")).build);
// A clean checkout has no private media or branding. Build without those files.
for (const section of ["win", "mac", "nsis"]) {
  for (const key of ["icon", "installerIcon", "uninstallerIcon"]) {
    if (config[section]) delete config[section][key];
  }
}
config.extends = null;
config.files = ["src/**/*", "!src/assets/**/*", "package.json"];
config.extraResources = [{
  from: "resources/soundfonts/",
  to: "resources/soundfonts/",
  filter: ["GeneralUser GS.sf2", "GeneralUser GS LICENSE.txt"],
}];
config.artifactName = "Zee-ing-Bee-${version}-${os}-${arch}.${ext}";
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const file = path.join(root, "dist", "electron-builder-ci.json");
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log("Prepared source-only installer configuration:", file);
