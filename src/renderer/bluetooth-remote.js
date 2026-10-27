// Desktop side of the Bluetooth fallback transport. The desktop can only be a BLE
// *central* here (no Windows-compatible Node library exists for peripheral/advertising
// mode), so it's the phone that advertises and the desktop that scans/connects, via the
// Web Bluetooth API Electron already provides - no native module needed on this side.
// See src/main/main.js's "select-bluetooth-device" handler for the other half of this:
// Electron intercepts the device picker itself, so requestDevice() below never shows a
// visible chooser.
const { searchSongs } = window.ZBSearch;
const BT = window.ZBBluetooth;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192; // avoids blowing the call stack on String.fromCharCode(...bytes) for a large file
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

/**
 * `getSongs`/`getSoundBank` here return the *full* desktop song/bank objects (with their
 * real file paths), unlike the stripped-down catalog the WiFi `/api/songs` endpoint
 * hands a phone - this module runs in the renderer, so it reads files the same way
 * `singNow()` does, via `window.zb.readFile`, rather than through remote-server.js.
 */
export function createBluetoothRemote({ getSongs, getSoundBank, onCommand }) {
  let device = null;
  let commandsChar = null;
  let stateChar = null;
  let reassemble = BT.createReassembler();
  let reconnectTimer = null;

  async function sendState(message) {
    if (!stateChar) return;
    for (const chunk of BT.encodeChunks(message)) await stateChar.writeValue(chunk);
  }

  async function handleCommandNotification(event) {
    const view = event.target.value;
    const message = reassemble(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    if (!message) return; // still waiting on more chunks
    if (message.type === "search") {
      const results = searchSongs(getSongs(), message.query).songs.slice(0, 8).map((s) => ({ number: s.number, title: s.title, artist: s.artist }));
      await sendState({ type: "searchResults", songs: results }).catch(() => {});
      return;
    }
    if (message.type === "getSong") {
      const song = getSongs().find((s) => String(s.number) === String(message.number));
      if (!song || song.mediaKind === "video" || song.mediaKind === "music-video") {
        await sendState({ type: "songNotFound", number: message.number }).catch(() => {});
        return;
      }
      try {
        const buffer = await window.zb.readFile(song.path);
        await sendState({ type: "songData", number: message.number, data: arrayBufferToBase64(buffer) });
      } catch {
        await sendState({ type: "songNotFound", number: message.number }).catch(() => {});
      }
      return;
    }
    if (message.type === "getSoundbank") {
      const bank = getSoundBank();
      if (!bank) {
        await sendState({ type: "soundbankNotFound" }).catch(() => {});
        return;
      }
      try {
        const buffer = await window.zb.readFile(bank.path);
        await sendState({ type: "soundbankData", name: bank.name, data: arrayBufferToBase64(buffer) });
      } catch {
        await sendState({ type: "soundbankNotFound" }).catch(() => {});
      }
      return;
    }
    onCommand(message);
  }

  async function connectGatt() {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BT.SERVICE_UUID);
    commandsChar = await service.getCharacteristic(BT.COMMANDS_CHARACTERISTIC_UUID);
    stateChar = await service.getCharacteristic(BT.STATE_CHARACTERISTIC_UUID);
    reassemble = BT.createReassembler();
    await commandsChar.startNotifications();
    commandsChar.addEventListener("characteristicvaluechanged", handleCommandNotification);
  }

  function scheduleReconnect() {
    commandsChar = null;
    stateChar = null;
    clearTimeout(reconnectTimer);
    // No new requestDevice() call here - reusing the same `device` is what makes every
    // reconnect after the first pairing silent (no picker, no renewed permission).
    reconnectTimer = setTimeout(() => connectGatt().catch(() => scheduleReconnect()), 3000);
  }

  async function connect() {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BT.SERVICE_UUID] }], optionalServices: [BT.SERVICE_UUID] });
    device.addEventListener("gattserverdisconnected", scheduleReconnect);
    await connectGatt();
  }

  return { connect, sendState, isConnected: () => Boolean(stateChar) };
}
