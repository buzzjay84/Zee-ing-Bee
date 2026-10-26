const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

function mediaResponse(file, request) {
  let size;
  try { size = fs.statSync(file).size; } catch { return new Response("Not found", { status: 404 }); }
  const headers = { "Content-Type": path.extname(file).toLowerCase() === ".webm" ? "video/webm" : "video/mp4", "Accept-Ranges": "bytes" };
  const range = request.headers.get("range");
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || !size || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(Math.max(0, end - start + 1));
  const body = request.method === "HEAD" || !size ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}
module.exports = { mediaResponse };
