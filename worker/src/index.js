// Hands the app the song pack zips (and manifest.json) kept in a private Google Drive
// folder, so the songs are never publicly listed and no Drive credential ever leaves
// this Worker. Reads the folder as a service account: GET /manifest.json and
// GET /<pack>.zip each stream the matching Drive file's bytes straight through.

const NAME = /^[\w.-]+\.(zip|json)$/;
// Kept per Worker instance, to stay well inside Drive's API rate limit.
const FILE_LIST_MS = 5 * 60 * 1000;
const TOKEN_SAFETY_MS = 60 * 1000;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value) {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Accepts a PEM private key, however it was pasted in (real newlines or literal "\n"). */
function pemToPkcs8(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Builds and signs a service-account JWT, then exchanges it for a Drive access token.
 * Each Worker instance keeps one handler closure (see createHandler), so this cache
 * naturally lives for as long as that instance does, same as Drive's own API rate limit
 * expects.
 */
function createHandler(fetchImpl = fetch) {
  let tokenCache = { token: null, expiresAt: 0 };
  let fileList = { at: 0, byName: null };

  async function getAccessToken(env) {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt - TOKEN_SAFETY_MS) return tokenCache.token;
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: env.GOOGLE_CLIENT_EMAIL,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    };
    const unsigned = `${base64urlJson({ alg: "RS256", typ: "JWT" })}.${base64urlJson(claim)}`;
    const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(env.GOOGLE_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    const jwt = `${unsigned}.${base64url(signature)}`;
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`);
    const data = await response.json();
    tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return tokenCache.token;
  }

  async function driveFiles(env) {
    if (fileList.byName && Date.now() - fileList.at < FILE_LIST_MS) return fileList.byName;
    const token = await getAccessToken(env);
    const q = encodeURIComponent(`'${env.PACKS_DRIVE_FOLDER_ID}' in parents and trashed = false`);
    const fields = encodeURIComponent("files(id,name)");
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Drive file listing failed: ${response.status}`);
    const data = await response.json();
    const byName = new Map(data.files.map((file) => [file.name, file.id]));
    fileList = { at: Date.now(), byName };
    return byName;
  }

  return async function handleRequest(request, env) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!NAME.test(name)) return new Response("Not found", { status: 404 });
    try {
      const id = (await driveFiles(env)).get(name);
      if (!id) return new Response("Not found", { status: 404 });
      const token = await getAccessToken(env);
      const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Drive download failed: ${response.status}`);
      const contentType = name.endsWith(".json") ? "application/json" : "application/zip";
      return new Response(response.body, { headers: { "Content-Type": contentType } });
    } catch (error) {
      console.error(error.message);
      return new Response("Song server unavailable", { status: 502 });
    }
  };
}

const defaultHandler = createHandler();

export default {
  fetch: (request, env) => defaultHandler(request, env),
};

export { createHandler };
