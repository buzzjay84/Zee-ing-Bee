// Decides whether this phone is talking live to a desktop over WiFi (Remote mode),
// over Bluetooth (last resort, see ble.js), or has to play songs itself (Standalone
// mode), and keeps rechecking so it upgrades itself automatically once something better
// becomes available.
import { createBleTransport } from "./ble.js";

const PING_TIMEOUT_MS = 2000;
const BLE_START_TIMEOUT_MS = 5000;
const RECHECK_MS = 20000;
const STORAGE_KEY = "zb-remote-pairing";

/** Bounds a promise that has no timeout of its own (e.g. a native plugin call that could
 * hang) so one slow/stuck step can never block the whole mode check forever. */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

function loadPairing() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function savePairing(pairing) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
  } catch {
    // No localStorage (private browsing, etc.) - pairing just won't survive a reload.
  }
}

/** A QR scan lands here with ?token=... in the URL; remember it, then tidy the address bar. */
function pairFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (!token) return null;
  const pairing = { origin: location.origin, token };
  savePairing(pairing);
  history.replaceState(null, "", location.pathname);
  return pairing;
}

async function ping(pairing) {
  if (!pairing) return false;
  try {
    const response = await fetch(`${pairing.origin}/api/ping?token=${pairing.token}`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Calls `onChange(mode, pairing)` whenever the Remote (WiFi) / Bluetooth / Standalone
 * decision changes - once immediately, then on a timer (paused while the tab/app is in
 * the background) and right away when it comes back to the foreground. WiFi always wins
 * when it's reachable; Bluetooth is the last resort, tried only once WiFi has failed,
 * and only where the native BlePeripheral plugin exists at all (plain mobile browsers
 * never see it). `onBleMessage` receives whatever the desktop pushes over Bluetooth
 * (`{type: "state"|"searchResults", ...}`) once connected, same shape as a WS message.
 */
export function createModeWatcher({ onChange, onBleMessage }) {
  let pairing = pairFromUrl() ?? loadPairing();
  let mode = null;
  let timer = null;

  const bleTransport = createBleTransport({
    onMessage: onBleMessage,
    onConnectionChange: (connected) => (connected ? setMode("bluetooth") : check()),
  });

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    onChange(mode, pairing);
  }

  async function check() {
    if (await ping(pairing)) {
      await bleTransport.stop();
      return setMode("remote");
    }
    if (bleTransport.isConnected()) return setMode("bluetooth");
    // Bluetooth setup (permission prompts, native advertising) is best-effort and must
    // never block the UI from showing Standalone mode - a stuck/slow native call here
    // previously left the page stuck on its static "Checking for a desktop…" text forever.
    if (bleTransport.available()) await withTimeout(bleTransport.start().catch(() => {}), BLE_START_TIMEOUT_MS);
    setMode("standalone");
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(() => check().then(schedule), RECHECK_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check().then(schedule);
  });

  check().then(schedule);

  return {
    getPairing: () => pairing,
    bleTransport,
    /** Called once pairing from a fresh QR scan is confirmed, in case the page never reloaded. */
    repair(nextPairing) {
      pairing = nextPairing;
      savePairing(pairing);
      check().then(schedule);
    },
  };
}
