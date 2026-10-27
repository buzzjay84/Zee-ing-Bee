const { test } = require("node:test");
const assert = require("node:assert/strict");
const { encodeChunks, createReassembler, CHUNK_PAYLOAD_BYTES, FINAL_BIT } = require("../src/shared/bluetooth");

test("a message that fits in one chunk round-trips as a single final chunk", () => {
  const chunks = encodeChunks({ t: "r", n: 1 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0][0] & FINAL_BIT);
  const reassemble = createReassembler();
  assert.deepEqual(reassemble(chunks[0]), { t: "r", n: 1 });
});

test("a typical reserve command round-trips, however many chunks it takes", () => {
  const message = { type: "reserve", number: 10001 };
  const chunks = encodeChunks(message);
  const reassemble = createReassembler();
  let result = null;
  for (const chunk of chunks) result = reassemble(chunk) ?? result;
  assert.deepEqual(result, message);
});

test("a message larger than one chunk is split and reassembles correctly", () => {
  const songs = Array.from({ length: 10 }, (_, i) => ({ number: 10000 + i, title: `Song Title Number ${i}`, artist: "Someone" }));
  const message = { type: "searchResults", songs };
  const chunks = encodeChunks(message);
  assert.ok(chunks.length > 1, "a realistic search-results payload should need more than one chunk");
  for (const chunk of chunks) assert.ok(chunk.length <= CHUNK_PAYLOAD_BYTES + 1);
  const reassemble = createReassembler();
  let result = null;
  for (const chunk of chunks) result = reassemble(chunk) ?? result;
  assert.deepEqual(result, message);
});

test("sequence numbers increment and only the last chunk carries the final bit", () => {
  const chunks = encodeChunks({ type: "x", text: "a".repeat(100) });
  chunks.forEach((chunk, i) => {
    assert.equal(chunk[0] & 0x7f, i);
    assert.equal(Boolean(chunk[0] & FINAL_BIT), i === chunks.length - 1);
  });
});

test("the reassembler returns null until the final chunk arrives", () => {
  const chunks = encodeChunks({ type: "x", text: "b".repeat(100) });
  const reassemble = createReassembler();
  for (const chunk of chunks.slice(0, -1)) assert.equal(reassemble(chunk), null);
  assert.deepEqual(reassemble(chunks.at(-1)), { type: "x", text: "b".repeat(100) });
});

test("a non-ASCII message (multi-byte UTF-8) still round-trips across chunks", () => {
  const message = { type: "searchResults", songs: [{ number: 1, title: "Niño Perdido en el Café" }] };
  const chunks = encodeChunks(message);
  const reassemble = createReassembler();
  let result = null;
  for (const chunk of chunks) result = reassemble(chunk) ?? result;
  assert.deepEqual(result, message);
});
