// Checks for and downloads app updates in the background, then waits for the person to
// choose "Restart & update" rather than ever restarting on its own mid-event. Each build
// (the lean "latest" channel built by CI, or a "full" channel built locally with song
// packs bundled in) only ever sees updates published to its own channel — that's baked
// into app-update.yml at build time by electron-builder, so there's nothing to pick here.
const CHECK_INITIAL_DELAY = 15000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

function createUpdater({ app, autoUpdater, notify = () => {}, log = console } = {}) {
  let timer;
  let ready = null; // { version } once an update has finished downloading
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
    autoUpdater.quitAndInstall();
    return true;
  }
  return { start, stop, install, get ready() { return ready; } };
}

module.exports = { createUpdater };
