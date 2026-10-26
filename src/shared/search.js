// Search that ignores accents, apostrophes and case: "nino" finds "Niño", "dont" finds "Don't".
// UMD-style so both the main process (require) and the window (script tag) can use it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZBSearch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function normalize(s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’`]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function matches(song, query) {
    const q = normalize(query);
    if (!q) return true;
    if (/^\d+$/.test(q) && String(song.number).startsWith(q)) return true;
    const hay = normalize(`${song.title} ${song.artist} ${song.category}`);
    return q.split(" ").every((word) => hay.includes(word));
  }

  function searchSongs(songs, query) {
    const q = normalize(query);
    if (!q) return { songs, mode: "all", exactCount: 0, suggestedCount: 0 };
    const exact = songs.filter((song) => normalize(song.title) === q || String(song.number) === q || normalize(song.artist) === q || normalize(`${song.title} ${song.artist}`) === q);
    const exactSet = new Set(exact);
    const suggested = songs.filter((song) => !exactSet.has(song) && matches(song, query));
    const rank = (song) => normalize(song.title).startsWith(q) ? 0 : normalize(song.title).includes(q) ? 1 : normalize(song.artist).includes(q) ? 2 : 3;
    suggested.sort((a, b) => rank(a) - rank(b) || a.number - b.number);
    return { songs: [...exact, ...suggested], mode: exact.length ? "exact" : "suggested", exactCount: exact.length, suggestedCount: suggested.length };
  }
  return { normalize, matches, searchSongs };
});
