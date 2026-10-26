// Hands the app short-lived download links for song packs kept in a private GitHub release,
// so the songs are never publicly listed and the GitHub token never leaves this Worker.
// GET /manifest.json and GET /<pack>.zip each answer with a redirect to a signed link
// that GitHub expires after a few minutes.

const NAME = /^[\w.-]+\.(zip|json)$/;
// Kept per Worker instance, to stay well inside GitHub's API rate limit.
const ASSET_LIST_MS = 5 * 60 * 1000;
const SIGNED_LINK_MS = 60 * 1000;

let assetList = { at: 0, byName: null };
const signedLinks = new Map();

const github = (env, extra = {}) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  "User-Agent": "zee-ing-bee-packs",
  "X-GitHub-Api-Version": "2022-11-28",
  ...extra,
});

async function releaseAssets(env) {
  if (assetList.byName && Date.now() - assetList.at < ASSET_LIST_MS) return assetList.byName;
  const response = await fetch(`https://api.github.com/repos/${env.PACKS_REPO}/releases/tags/${env.PACKS_TAG}`, { headers: github(env) });
  if (!response.ok) throw new Error(`GitHub release lookup failed: ${response.status}`);
  const byName = new Map((await response.json()).assets.map((asset) => [asset.name, asset.url]));
  assetList = { at: Date.now(), byName };
  return byName;
}

async function signedLink(env, apiUrl) {
  const cached = signedLinks.get(apiUrl);
  if (cached && Date.now() - cached.at < SIGNED_LINK_MS) return cached.location;
  const response = await fetch(apiUrl, { headers: github(env, { Accept: "application/octet-stream" }), redirect: "manual" });
  const location = response.headers.get("Location");
  if (!location) throw new Error(`GitHub asset link failed: ${response.status}`);
  signedLinks.set(apiUrl, { at: Date.now(), location });
  return location;
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!NAME.test(name)) return new Response("Not found", { status: 404 });
    try {
      const apiUrl = (await releaseAssets(env)).get(name);
      if (!apiUrl) return new Response("Not found", { status: 404 });
      return Response.redirect(await signedLink(env, apiUrl), 302);
    } catch (error) {
      console.error(error.message);
      return new Response("Song server unavailable", { status: 502 });
    }
  },
};
