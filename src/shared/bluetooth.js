// The Bluetooth LE fallback transport's service/characteristic UUIDs, shared by the
// desktop renderer (central, via Web Bluetooth) and the Android app (peripheral, via the
// BlePeripheral Capacitor plugin) so both sides always agree on them. UMD-style so both
// `require` (Node/Electron main/preload if ever needed) and a plain <script> tag can use it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZBBluetooth = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Every raw GATT packet (one write or one notify value) is [header byte][payload].
  // Header: bit 7 = "this is the final chunk", bits 0-6 = sequence number. The payload
  // size is deliberately tiny (fits inside the default, un-negotiated 23-byte ATT MTU)
  // because nothing on either side of this app can force a larger MTU to actually get
  // negotiated - this is the one framing both the Android plugin (Kotlin) and the
  // desktop's Web Bluetooth central (bluetooth-remote.js) must agree on byte-for-byte.
  const CHUNK_PAYLOAD_BYTES = 19;
  const FINAL_BIT = 0x80;

  function encodeChunks(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const chunks = [];
    for (let offset = 0; offset < bytes.length || chunks.length === 0; offset += CHUNK_PAYLOAD_BYTES) {
      const slice = bytes.slice(offset, offset + CHUNK_PAYLOAD_BYTES);
      const isFinal = offset + CHUNK_PAYLOAD_BYTES >= bytes.length;
      const chunk = new Uint8Array(slice.length + 1);
      chunk[0] = chunks.length | (isFinal ? FINAL_BIT : 0);
      chunk.set(slice, 1);
      chunks.push(chunk);
    }
    return chunks;
  }

  /** Call with each chunk as it arrives; returns the decoded message once the final chunk lands, else null. */
  function createReassembler() {
    let parts = [];
    return function pushChunk(chunk) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const isFinal = Boolean(bytes[0] & FINAL_BIT);
      parts.push(bytes.slice(1));
      if (!isFinal) return null;
      const total = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
      let at = 0;
      for (const part of parts) { total.set(part, at); at += part.length; }
      parts = [];
      return JSON.parse(new TextDecoder().decode(total));
    };
  }

  return {
    // Randomly generated, fixed for this app - not a well-known UUID.
    SERVICE_UUID: "7b1f5a10-4b8e-4e1a-9c3d-6a2f8e0c9d41",
    // Peripheral -> central (notify): phone-initiated commands (reserve/remove/singNow/search).
    COMMANDS_CHARACTERISTIC_UUID: "7b1f5a11-4b8e-4e1a-9c3d-6a2f8e0c9d41",
    // Central -> peripheral (write): desktop-pushed state/search results.
    STATE_CHARACTERISTIC_UUID: "7b1f5a12-4b8e-4e1a-9c3d-6a2f8e0c9d41",
    // Advertised local name, so the desktop can show something readable while scanning.
    DEVICE_NAME: "Zee-ing Bee Remote",
    CHUNK_PAYLOAD_BYTES,
    FINAL_BIT,
    encodeChunks,
    createReassembler,
  };
});
