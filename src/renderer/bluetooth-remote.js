// Desktop side of the Bluetooth fallback transport. The desktop can only be a BLE
// *central* here (no Windows-compatible Node library exists for peripheral/advertising
// mode), so it's the phone that advertises and the desktop that scans/connects, via the
// Web Bluetooth API Electron already provides - no native module needed on this side.
// See src/main/main.js's "select-bluetooth-device" handler for the other half of this:
// Electron intercepts the device picker itself, so requestDevice() below never shows a
// visible chooser.
const { searchSongs } = window.ZBSearch;
const BT = window.ZBBluetooth;

/**
 * Makes a Bluetooth-connected phone a remote, same as WiFi: it searches here (the phone
 * has no catalog over Bluetooth), then sends reserve/singNow/remove to `onCommand`.
 */
export function createBluetoothRemote({ getSongs, onCommand, onConnected }) {
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
      const results = searchSongs(getSongs(), message.query).songs.slice(0, 20).map((s) => ({ number: s.number, title: s.title, artist: s.artist }));
      await sendState({ type: "searchResults", songs: results }).catch(() => {});
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
    onConnected(); // the phone shows nothing until it has the current queue
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
