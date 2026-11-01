// Where the desktop and mobile apps download the song packs from: the "songs" release on
// GitHub, holding manifest.json and the pack zips (refresh them with
// `node scripts/make-pack-manifest.cjs` then `gh release upload songs ... --clobber`).
// UMD-style so both the main process (require) and the mobile page (script tag) can use it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZBPacks = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return { PACKS_URL: "https://github.com/buzzjay84/Zee-ing-Bee/releases/download/songs" };
});
