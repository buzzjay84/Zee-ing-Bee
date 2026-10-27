// Phone side of the Bluetooth fallback transport. The phone is always the BLE
// *peripheral* here (it advertises; the desktop scans and connects as central - see
// src/renderer/bluetooth-remote.js), via a custom native plugin
// (mobile-app/android/.../BlePeripheralPlugin.kt) since no Capacitor plugin does
// peripheral/advertising mode out of the box. Only available inside the Capacitor app -
// a plain mobile browser has no peripheral-mode API at all, so `available()` is false
// there and this transport is simply never offered.
const BT = window.ZBBluetooth;

export function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createBleTransport({ onMessage, onConnectionChange }) {
  const plugin = window.Capacitor?.Plugins?.BlePeripheral;
  let reassemble = BT.createReassembler();
  let connected = false;

  function available() {
    return Boolean(plugin);
  }

  async function start() {
    if (!plugin) return;
    plugin.addListener("stateWrite", ({ data }) => {
      const message = reassemble(fromBase64(data));
      if (message) onMessage(message);
    });
    plugin.addListener("centralConnected", () => {
      connected = true;
      onConnectionChange(true);
    });
    plugin.addListener("centralDisconnected", () => {
      connected = false;
      reassemble = BT.createReassembler();
      onConnectionChange(false);
    });
    await plugin.startAdvertising();
  }

  async function stop() {
    await plugin?.stopAdvertising().catch(() => {});
  }

  async function send(message) {
    if (!plugin || !connected) return;
    for (const chunk of BT.encodeChunks(message)) await plugin.notify({ data: toBase64(chunk) });
  }

  return { available, start, stop, send, isConnected: () => connected };
}
