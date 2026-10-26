const { parseSearch } = require("./online-videos");

function validateQuery(title, artist) {
  if (typeof title !== "string" || typeof artist !== "string" || !title.trim() || !artist.trim() || title.length > 160 || artist.length > 160) throw new Error("Enter a song title and artist (up to 160 characters each).");
  return { title: title.trim(), artist: artist.trim() };
}
const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function filterKaraoke(items, song) {
  const title = normalize(song.title);
  const artistWords = normalize(song.artist).split(" ").filter((word) => word.length > 1);
  return items.filter((item) => {
    const text = normalize(item.title);
    return /^[\w-]{11}$/.test(item.id) && text.includes(title) && artistWords.every((word) => text.includes(word))
      && /\b(karaoke|instrumental|minus one|minus 1)\b/.test(text)
      && !/\b(reaction|tutorial|vocal cover|with vocals|with vocal|guide vocal)\b/.test(text)
      && (item.duration == null || item.duration >= 90);
  }).slice(0, 8);
}
async function searchKaraoke(song) {
  const query = `${song.title} ${song.artist} karaoke instrumental`;
  const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Online search is unavailable. Please try again.");
  return filterKaraoke(parseSearch(await response.text()), song);
}
module.exports = { validateQuery, filterKaraoke, searchKaraoke };
