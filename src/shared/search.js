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

  // Normalizing tens of thousands of songs on every keystroke made typing lag, so each
  // song's normalized text is worked out once. Songs are replaced, not edited, when the library changes.
  const normalized = new WeakMap();
  function keys(song) {
    let k = normalized.get(song);
    if (!k) {
      k = {
        title: normalize(song.title),
        artist: normalize(song.artist),
        both: normalize(`${song.title} ${song.artist}`),
        hay: normalize(`${song.title} ${song.artist} ${song.category}`),
      };
      normalized.set(song, k);
    }
    return k;
  }

  function matchesNormalized(song, q, words) {
    if (/^\d+$/.test(q) && String(song.number).startsWith(q)) return true;
    const hay = keys(song).hay;
    return words.every((word) => hay.includes(word));
  }

  function matches(song, query) {
    const q = normalize(query);
    return !q || matchesNormalized(song, q, q.split(" "));
  }

  function searchSongs(songs, query) {
    const q = normalize(query);
    if (!q) return { songs, mode: "all", exactCount: 0, suggestedCount: 0 };
    const words = q.split(" ");
    const exact = [];
    const suggested = [];
    for (const song of songs) {
      const k = keys(song);
      if (k.title === q || String(song.number) === q || k.artist === q || k.both === q) exact.push(song);
      else if (matchesNormalized(song, q, words)) suggested.push(song);
    }
    const rank = new Map(suggested.map((song) => {
      const k = keys(song);
      return [song, k.title.startsWith(q) ? 0 : k.title.includes(q) ? 1 : k.artist.includes(q) ? 2 : 3];
    }));
    suggested.sort((a, b) => rank.get(a) - rank.get(b) || a.number - b.number);
    return { songs: [...exact, ...suggested], mode: exact.length ? "exact" : "suggested", exactCount: exact.length, suggestedCount: suggested.length };
  }
  /** Normalizes songs ahead of the first search, a slice at a time so the page stays responsive. */
  function warm(songs, start = 0) {
    const end = Math.min(start + 2000, songs.length);
    for (let i = start; i < end; i++) keys(songs[i]);
    if (end < songs.length) setTimeout(() => warm(songs, end), 0);
  }

  return { normalize, matches, searchSongs, warm };
});
