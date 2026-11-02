// Builds the printable songbook as HTML; main.js prints it to PDF.

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

// Two compact columns per page: a full library is tens of thousands of songs.
function list(songs) {
  return `<div class="list">${songs.map((s) => `<p><b>${s.number}</b>${escapeHtml(s.title)}${s.artist ? ` <i>${escapeHtml(s.artist)}</i>` : ""}</p>`).join("")}</div>`;
}

function buildSongbookHtml(songs, appName) {
  const categories = new Map();
  for (const s of songs) {
    if (!categories.has(s.category)) categories.set(s.category, []);
    categories.get(s.category).push(s);
  }
  const catNames = [...categories.keys()].sort((a, b) => a.localeCompare(b));
  const byArtist = songs.filter((s) => s.artist).sort((a, b) => a.artist.localeCompare(b.artist) || byTitle(a, b));

  const sections = catNames
    .map((name) => `<section><h2>${escapeHtml(name)}</h2>${list(categories.get(name).sort(byTitle))}</section>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #1d1a12; font-size: 8.5pt; }
    .cover { text-align: center; padding-top: 70mm; page-break-after: always; }
    .cover h1 { font-size: 40pt; margin: 0; color: #b07800; }
    .cover p { font-size: 13pt; color: #5a5040; }
    h2 { font-size: 15pt; border-bottom: 2px solid #f2b705; padding-bottom: 3pt; margin: 16pt 0 6pt; }
    section { page-break-before: always; }
    .list { column-count: 2; column-gap: 8mm; }
    .list p { margin: 0; padding: 1pt 0 1pt 12mm; text-indent: -12mm; border-bottom: 0.4pt solid #eee4cc; break-inside: avoid; }
    .list b { display: inline-block; width: 12mm; text-indent: 0; font-variant-numeric: tabular-nums; color: #8a5d00; }
    .list i { font-style: normal; color: #6b6250; }
  </style></head><body>
    <div class="cover"><h1>${escapeHtml(appName)}</h1><p>Songbook · ${songs.length} songs</p>
    <p>Punch in the number, press Enter, sing.</p></div>
    ${sections}
    ${byArtist.length ? `<section><h2>By artist</h2>${list(byArtist.map((s) => ({ ...s, title: `${s.artist} — ${s.title}`, artist: "" })))}</section>` : ""}
  </body></html>`;
}

module.exports = { buildSongbookHtml, escapeHtml };
