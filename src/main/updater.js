// Checks for and downloads app updates in the background, then waits for the person to
// choose "Restart & update" rather than ever restarting on its own mid-event. Every build,
// including a "full" one with song packs bundled in, follows the app-only "latest" channel
// that CI publishes on each release: an app-only update drops the bundled packs, and the
// app then downloads the same songs in the background (see pack-downloader.js).
const CHECK_INITIAL_DELAY = 15000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

function createUpdater({ app, autoUpdater, notify = () => {}, log = console } = {}) {
  let timer;
  let ready = null; // { version } once an update has finished downloading
  autoUpdater.channel = "latest";
  autoUpdater.allowDowngrade = false; // setting channel turns this on
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    ready = { version: info.version };
    notify(ready);
  });
  autoUpdater.on("error", (error) => log.warn("Update check failed:", error.message));

  function check() {
    autoUpdater.checkForUpdates().catch((error) => log.warn("Update check failed:", error.message));
  }
  /** For a person-initiated "Check for updates" click: reports the outcome instead of just logging it. */
  async function checkNow() {
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo?.version ?? null;
    return { currentVersion: app.getVersion(), latestVersion, upToDate: !latestVersion || latestVersion === app.getVersion() };
  }
  function start() {
    // Outside a packaged build there is no app-update.yml, and checking would just error.
    if (!app.isPackaged) return;
    timer = setTimeout(function loop() {
      check();
      timer = setTimeout(loop, CHECK_INTERVAL);
    }, CHECK_INITIAL_DELAY);
  }
  function stop() {
    clearTimeout(timer);
  }
  function install() {
    if (!ready) return false;
    // Silent install, then reopen the app: no installer pages to click through.
    autoUpdater.quitAndInstall(true, true);
    return true;
  }
  return { start, stop, install, checkNow, get ready() { return ready; } };
}

module.exports = { createUpdater };
