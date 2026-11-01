import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readZipEntries, readZipEntry, numberSongs } from "../src/mobile-remote/packs.js";

/** A minimal zip: stored or deflated entries, with a central directory. */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test("reads stored and deflated zip entries", async () => {
  const zip = makeZip([["01 OPM/a.mid", "stored bytes", false], ["01 OPM/b.kar", "deflated bytes ".repeat(20), true]]);
  const entries = readZipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), ["01 OPM/a.mid", "01 OPM/b.kar"]);
  const blob = new Blob([zip]);
  assert.equal(Buffer.from(await readZipEntry(blob, entries[0])).toString(), "stored bytes");
  assert.equal(Buffer.from(await readZipEntry(blob, entries[1])).toString(), "deflated bytes ".repeat(20));
});

test("numbers songs like a fresh desktop library: pack order, then sorted paths", () => {
  const entry = (name) => ({ name });
  const songs = numberSongs([
    { name: "02-intl-1.zip", entries: [entry("02 International/Yesterday - The Beatles.kar")] },
    { name: "01-opm-1.zip", entries: [entry("01 OPM/10002 - 214 - Rivermaya.mid"), entry("01 OPM/10001 - Anak - Freddie Aguilar.mid"), entry("01 OPM/readme.txt"), entry("loose.mid")] },
  ]);
  assert.deepEqual(
    songs.map(({ number, title, artist, category }) => ({ number, title, artist, category })),
    [
      { number: 10001, title: "Anak", artist: "Freddie Aguilar", category: "OPM" },
      { number: 10002, title: "214", artist: "Rivermaya", category: "OPM" },
      { number: 10003, title: "Yesterday", artist: "The Beatles", category: "International" },
    ],
  );
});
