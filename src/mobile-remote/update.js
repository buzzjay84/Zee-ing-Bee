// The installed phone app can't update itself like the desktop does, so it checks the
// latest GitHub release (the same one the desktop installers come from) and links to its APK.
const RELEASES_URL = "https://api.github.com/repos/buzzjay84/Zee-ing-Bee/releases/latest";

export function isNewer(latest, current) {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

/** Resolves to { version, url } when a newer APK is out, otherwise null. */
export async function findUpdate(currentVersion, fetchFn = fetch) {
  const release = await (await fetchFn(RELEASES_URL)).json();
  const version = release.tag_name?.replace(/^v/, "");
  const apk = release.assets?.find((asset) => asset.name.endsWith(".apk"));
  return version && apk && isNewer(version, currentVersion) ? { version, url: apk.browser_download_url } : null;
}
