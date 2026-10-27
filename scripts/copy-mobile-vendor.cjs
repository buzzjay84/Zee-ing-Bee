const fs = require("node:fs");
const path = require("node:path");

// The mobile remote app plays MIDI songs itself in Standalone mode, using the same
// spessasynth_lib/spessasynth_core synth as the desktop renderer. There's no bundler for
// that static page, so their dist files are copied in here (instead of an import map
// pointing at node_modules, which a phone obviously can't reach).
const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "src", "mobile-remote", "vendor");

function copyDist(pkg) {
  const from = path.join(root, "node_modules", pkg, "dist");
  const to = path.join(vendorDir, pkg);
  fs.mkdirSync(to, { recursive: true });
  for (const file of fs.readdirSync(from)) {
    if (file.endsWith(".d.ts")) continue;
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}

for (const pkg of ["spessasynth_lib", "spessasynth_core"]) copyDist(pkg);

// The mobile app is served live by the desktop and bundled standalone into the Capacitor
// APK, so its search logic is vendored in here rather than referenced across directories
// (the APK build has no access to anything outside src/mobile-remote/).
fs.mkdirSync(path.join(vendorDir, "..", "shared"), { recursive: true });
for (const file of ["search.js", "bluetooth.js"]) {
  fs.copyFileSync(path.join(root, "src", "shared", file), path.join(vendorDir, "..", "shared", file));
}

// Same app icon the desktop installer uses, for the mobile app's home-screen icon.
try {
  fs.copyFileSync(path.join(root, "resources", "icons", "zee-ing-bee.png"), path.join(root, "src", "mobile-remote", "icon.png"));
} catch {
  console.warn("No resources/icons/zee-ing-bee.png yet (run `npm run make-icons` first) - mobile remote app will use a blank icon for now.");
}

console.log("Copied spessasynth_lib/spessasynth_core and the app icon into src/mobile-remote/");
