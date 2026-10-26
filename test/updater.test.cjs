const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdater } = require("../src/main/updater");

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.checkForUpdates = mock.fn(async () => {});
  au.quitAndInstall = mock.fn();
  return au;
}

test("does not check for updates outside a packaged build", () => {
  const autoUpdater = fakeAutoUpdater();
  const updater = createUpdater({ app: { isPackaged: false }, autoUpdater, log: { warn() {} } });
  updater.start();
  assert.equal(autoUpdater.checkForUpdates.mock.calls.length, 0);
  updater.stop();
});

test("checks for updates after the initial delay, then on an interval", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const autoUpdater = fakeAutoUpdater();
    const updater = createUpdater({ app: { isPackaged: true }, autoUpdater, log: { warn() {} } });
    updater.start();
    assert.equal(autoUpdater.checkForUpdates.mock.calls.length, 0, "not before the initial delay");
    mock.timers.tick(15000);
    assert.equal(autoUpdater.checkForUpdates.mock.calls.length, 1);
    mock.timers.tick(4 * 60 * 60 * 1000);
    assert.equal(autoUpdater.checkForUpdates.mock.calls.length, 2);
    updater.stop();
  } finally { mock.timers.reset(); }
});

test("notifies once a download finishes, and install() only acts once ready", () => {
  const autoUpdater = fakeAutoUpdater();
  let notified = null;
  const updater = createUpdater({ app: { isPackaged: true }, autoUpdater, log: { warn() {} }, notify: (info) => { notified = info; } });
  assert.equal(updater.install(), false, "nothing to install yet");
  assert.equal(autoUpdater.quitAndInstall.mock.calls.length, 0);
  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  assert.deepEqual(notified, { version: "2.0.0" });
  assert.deepEqual(updater.ready, { version: "2.0.0" });
  assert.equal(updater.install(), true);
  assert.equal(autoUpdater.quitAndInstall.mock.calls.length, 1);
});

test("a failed check is logged, not thrown", () => {
  const autoUpdater = fakeAutoUpdater();
  const warnings = [];
  createUpdater({ app: { isPackaged: true }, autoUpdater, log: { warn: (...args) => warnings.push(args) } });
  autoUpdater.emit("error", new Error("network down"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].join(" "), /network down/);
});
