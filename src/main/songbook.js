// Builds the printable songbook as HTML; main.js prints it to PDF.

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function table(songs, showCategory) {
  const rows = songs
    .map(
      (s) =>
        `<tr><td class="num">${s.number}</td><td>${escapeHtml(s.title)}</td><td>${escapeHtml(s.artist)}</td>` +
        (showCategory ? `<td class="cat">${escapeHtml(s.category)}</td>` : "") +
        "</tr>",
    )
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
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
    .map((name) => `<section><h2>${escapeHtml(name)}</h2>${table(categories.get(name).sort(byTitle), false)}</section>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #1d1a12; font-size: 10.5pt; }
    .cover { text-align: center; padding-top: 70mm; page-break-after: always; }
    .cover h1 { font-size: 40pt; margin: 0; color: #b07800; }
    .cover p { font-size: 13pt; color: #5a5040; }
    h2 { font-size: 15pt; border-bottom: 2px solid #f2b705; padding-bottom: 3pt; margin: 16pt 0 6pt; }
    section { page-break-before: always; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2.5pt 4pt; border-bottom: 0.5pt solid #e6dcc4; vertical-align: top; }
    td.num { width: 16mm; font-weight: 700; font-variant-numeric: tabular-nums; color: #8a5d00; }
    td.cat { color: #6b6250; width: 34mm; }
  </style></head><body>
    <div class="cover"><h1>${escapeHtml(appName)}</h1><p>Songbook · ${songs.length} songs</p>
    <p>Punch in the number, press Enter, sing.</p></div>
    ${sections}
    ${byArtist.length ? `<section><h2>By artist</h2>${table(byArtist.map((s) => ({ ...s, title: `${s.artist} — ${s.title}`, artist: "" })), true)}</section>` : ""}
  </body></html>`;
}

module.exports = { buildSongbookHtml, escapeHtml };
