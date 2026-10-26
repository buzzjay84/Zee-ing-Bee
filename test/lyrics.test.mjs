import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BasicMIDI } from "spessasynth_core";
import { extractLyrics, findMelodyChannel, karaokeHeaders, channelRoles, syllableFill } from "../src/renderer/lyrics.js";

const demo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "resources", "demo-songs");
const load = (name) => {
  const buf = fs.readFileSync(path.join(demo, name));
  return BasicMIDI.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
};
const lineText = (l) => l.syllables.map((s) => s.text).join("").trim();

test("Soft Karaoke (.kar) lyrics split into lines on '/'", () => {
  const midi = load("Twinkle Twinkle Little Star - Traditional.kar");
  const lines = extractLyrics(midi);
  assert.equal(lines.length, 6);
  assert.equal(lineText(lines[0]), "Twinkle twinkle little star,");
  assert.equal(lineText(lines[3]), "Like a diamond in the sky.");
  assert.ok(lines[0].start > 4, "first line comes after the two-bar intro");
  assert.ok(lines.every((l, i) => i === 0 || l.start > lines[i - 1].start));
  assert.deepEqual(karaokeHeaders(midi), { title: "Twinkle Twinkle Little Star", artist: "Traditional" });
});

test("standard lyric events split into lines on carriage returns", () => {
  const lines = extractLyrics(load("Mary Had a Little Lamb - Traditional.mid"));
  assert.deepEqual(lines.map(lineText), [
    "Mary had a little lamb,",
    "little lamb, little lamb,",
    "Mary had a little lamb,",
    "its fleece was white as snow.",
  ]);
});

test("the guide melody channel is found from the syllable timing", () => {
  for (const name of ["Twinkle Twinkle Little Star - Traditional.kar", "Mary Had a Little Lamb - Traditional.mid"]) {
    const midi = load(name);
    assert.equal(findMelodyChannel(midi.getNoteTimes(), extractLyrics(midi)), 0, name);
  }
});

test("channels are sorted into bass, drums and band", () => {
  const roles = channelRoles(load("Mary Had a Little Lamb - Traditional.mid"));
  assert.equal(roles[2], "bass");
  assert.equal(roles[9], "drums");
  assert.equal(roles[1], "band");
});

test("a syllable fills over the gap to the next one", () => {
  const line = { end: 10, syllables: [{ text: "a", time: 1 }, { text: "b", time: 1.5 }] };
  assert.equal(syllableFill(line, 0, 0.5), 0);
  assert.equal(syllableFill(line, 0, 1.25), 0.5);
  assert.equal(syllableFill(line, 0, 2), 1);
  assert.equal(syllableFill(line, 1, 2), 0.5, "the last syllable fills over at most a second");
});
