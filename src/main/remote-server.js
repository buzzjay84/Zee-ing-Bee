const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");
const { mediaResponse } = require("./media-response");

const CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

// WiFi first, since that's what almost everyone pairs over; USB tethering/Ethernet
// adapters still show up (as plain "Network"), for when there's no WiFi at all.
const WIFI_NAME = /wi-?fi|wlan|wireless/i;

function lanAddresses() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push({ name: WIFI_NAME.test(name) ? "Wi-Fi" : "Network", address: entry.address });
    }
  }
  return addresses.sort((a, b) => (a.name === "Wi-Fi" ? -1 : 0) - (b.name === "Wi-Fi" ? -1 : 0));
}

function staticFile(staticDir, urlPath) {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.resolve(staticDir, `.${relative}`);
  if (path.relative(staticDir, file).startsWith("..")) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function nodeRequestToFetchRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  return new Request(url, { method: req.method, headers });
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  if (!response.body) return res.end();
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/**
 * A local HTTP + WebSocket server so a phone on the same WiFi can search the catalog,
 * reserve songs (synced live to the desktop queue), and sync song content for
 * standalone offline playback. Never exposed outside the LAN; `token` is casual
 * same-WiFi safety, not real auth.
 */
function createRemoteServer({ staticDir, getSongs, searchSongs, readSongFile, readSoundbank, readSongVideo, onAction, onClientsChanged = () => {}, token = crypto.randomBytes(16).toString("hex"), port: preferredPort = 0 }) {
  let server;
  let wss;
  const clients = new Set();

  function checkToken(url) {
    return url.searchParams.get("token") === token;
  }

  async function handleApi(req, res, url) {
    if (!checkToken(url)) return sendJson(res, 401, { error: "Invalid token" });
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    if (parts[1] === "ping") return sendJson(res, 200, { ok: true });
    if (parts[1] === "songs") return sendJson(res, 200, getSongs());
    if (parts[1] === "search") return sendJson(res, 200, searchSongs(getSongs(), url.searchParams.get("q") ?? ""));
    if (parts[1] === "soundbank") {
      const bank = await readSoundbank();
      if (!bank) return sendJson(res, 404, { error: "No sound bank available" });
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bank.data.length, "X-Sound-Bank-Name": bank.name });
      return res.end(bank.data);
    }
    if (parts[1] === "song" && parts[3] === "midi") {
      const data = await readSongFile(parts[2]);
      if (!data) return sendJson(res, 404, { error: "Song not found" });
      res.writeHead(200, { "Content-Type": "audio/midi", "Content-Length": data.length });
      return res.end(data);
    }
    if (parts[1] === "song" && parts[3] === "video") {
      const file = await readSongVideo(parts[2]);
      if (!file) return sendJson(res, 404, { error: "No cached video for this song" });
      return sendFetchResponse(res, mediaResponse(file, nodeRequestToFetchRequest(req, url)));
    }
    return sendJson(res, 404, { error: "Not found" });
  }

  function handleRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      // The installed Android app runs at https://localhost, so every API call is cross-origin.
      // The token still guards access.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "X-Sound-Bank-Name, Content-Range, Content-Length");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Private-Network": "true" });
        return res.end();
      }
      handleApi(req, res, url).catch((error) => {
        console.warn("Remote server request failed:", error.message);
        sendJson(res, 500, { error: "Internal error" });
      });
      return;
    }
    const file = staticFile(staticDir, url.pathname);
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }

  /** Pushes the latest desktop queue/now-playing to every connected phone. */
  function broadcastState(state) {
    const message = JSON.stringify({ type: "state", ...state });
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(message);
  }

  function start() {
    server = http.createServer(handleRequest);
    wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/ws" || !checkToken(url)) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        onClientsChanged(clients.size);
        ws.on("close", () => {
          clients.delete(ws);
          onClientsChanged(clients.size);
        });
        ws.on("message", (raw) => {
          try {
            const message = JSON.parse(raw.toString());
            if (["reserve", "remove", "singNow"].includes(message.type)) onAction(message);
          } catch {
            // Ignore malformed messages from a phone.
          }
        });
      });
    });
    // A fixed port (plus a saved token) keeps the installed phone app paired across
    // desktop restarts; if something else holds it, a random port still works for a fresh scan.
    const listen = (port) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => resolve());
    });
    return listen(preferredPort).catch((error) => {
      if (error.code !== "EADDRINUSE" || !preferredPort) throw error;
      return listen(0);
    });
  }

  function stop() {
    for (const ws of clients) ws.terminate();
    wss?.close();
    server?.close();
  }

  function info() {
    const port = server.address().port;
    const networks = lanAddresses().map(({ name, address }) => ({ name, address, url: `http://${address}:${port}/?token=${token}` }));
    return { token, port, networks, clientCount: clients.size };
  }

  return { start, stop, broadcastState, info };
}

module.exports = { createRemoteServer };
