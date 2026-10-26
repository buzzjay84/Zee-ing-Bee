const fs = require("node:fs");
const path = require("node:path");

// The "full" build is built locally with your own song packs, soundfonts and branding
// already in place (see package.json's own "build" config), so unlike prepare-ci-build.cjs
// this only needs to put it on its own update channel, separate from the lean CI build
// that's published under the default "latest" channel.
const root = path.resolve(__dirname, "..");
const config = structuredClone(require(path.join(root, "package.json")).build);
config.publish = { ...config.publish, channel: "full" };
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const file = path.join(root, "dist", "electron-builder-full.json");
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log("Prepared full-package installer configuration:", file);
