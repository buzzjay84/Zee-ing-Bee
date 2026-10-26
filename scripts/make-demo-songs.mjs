// Writes the starter songs: public-domain tunes arranged here, so they are free to ship.
// One is Soft Karaoke (.kar, text events), one uses standard lyric events (.mid),
// so both lyric formats get exercised.
import { MIDIBuilder } from "spessasynth_core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "resources", "demo-songs");
const PPQ = 480;
const TEXT = 0x01;
const LYRIC = 0x05;

const NOTE = { C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72 };
const CHORD = {
  C: [48, 52, 55],
  F: [53, 57, 60],
  G: [55, 59, 62],
};
const ROOT = { C: 36, F: 41, G: 43 };

/**
 * @param melody [noteName, beats, syllable?][] ; syllable "/" prefix = new line (KAR style)
 * @param chords [chordName, beats][]
 */
function buildSong({ name, bpm, melody, chords, soft }) {
  const mid = new MIDIBuilder({ name, timeDivision: PPQ, initialTempo: bpm, format: 1 });
  mid.addTrack("Melody");
  mid.addTrack("Piano");
  mid.addTrack("Bass");
  mid.addTrack("Drums");
  if (soft) mid.addTrack("Words");
  const [MEL, PNO, BASS, DRM, WORDS] = [1, 2, 3, 4, 5];
  const lead = 2 * 4 * PPQ; // two bars of intro

  mid.programChange(0, MEL, 0, 73); // flute
  mid.programChange(0, PNO, 1, 0); // piano
  mid.programChange(0, BASS, 2, 33); // finger bass
  mid.controllerChange(0, PNO, 1, 7, 80);

  if (soft) {
    mid.addEvent(0, WORDS, TEXT, bytes("@KMIDI KARAOKE FILE"));
    mid.addEvent(0, WORDS, TEXT, bytes("@LENG"));
    mid.addEvent(0, WORDS, TEXT, bytes(`@T${name}`));
    mid.addEvent(0, WORDS, TEXT, bytes("@TTraditional"));
  }

  // Intro: two bars of the first chord.
  let t = 0;
  const introChord = chords[0][0];
  for (let bar = 0; bar < 2; bar++) {
    playChord(mid, PNO, BASS, introChord, t, 4);
    t += 4 * PPQ;
  }

  // Melody and words.
  t = lead;
  const lyricLines = [];
  for (const [n, beats, syl] of melody) {
    const len = beats * PPQ;
    mid.noteOn(t, MEL, 0, NOTE[n], 100);
    mid.noteOff(t + len - 20, MEL, 0, NOTE[n]);
    if (syl !== undefined) {
      if (soft) mid.addEvent(t, WORDS, TEXT, bytes(syl));
      else lyricLines.push([t, syl]);
    }
    t += len;
  }
  // Standard lyrics: a "/" marks a new line, which becomes a trailing \r on the previous syllable.
  for (let i = 0; i < lyricLines.length; i++) {
    const [ticks, syl] = lyricLines[i];
    const endsLine = i + 1 === lyricLines.length || lyricLines[i + 1][1].startsWith("/");
    const text = syl.replace(/^\//, "") + (endsLine ? "\r" : "");
    mid.addEvent(ticks, MEL, LYRIC, bytes(text));
  }
  const end = t;

  // Chords and bass.
  t = lead;
  for (const [c, beats] of chords) {
    playChord(mid, PNO, BASS, c, t, beats);
    t += beats * PPQ;
  }

  // A soft beat all the way through.
  for (let b = 0; b * PPQ < end + 2 * PPQ; b++) {
    const at = b * PPQ;
    const drum = b % 2 === 0 ? 36 : 38; // kick, snare
    mid.noteOn(at, DRM, 9, drum, b % 4 === 0 ? 90 : 70);
    mid.noteOff(at + 120, DRM, 9, drum);
    mid.noteOn(at, DRM, 9, 42, 50);
    mid.noteOff(at + 100, DRM, 9, 42);
  }
  // Last chord rings for a bar.
  playChord(mid, PNO, BASS, chords.at(-1)[0], end, 4);

  mid.flush();
  return mid.writeMIDI();
}

function playChord(mid, pno, bass, name, t, beats) {
  const len = beats * PPQ - 30;
  for (const n of CHORD[name]) {
    mid.noteOn(t, pno, 1, n, 70);
    mid.noteOff(t + len, pno, 1, n);
  }
  mid.noteOn(t, bass, 2, ROOT[name], 95);
  mid.noteOff(t + len, bass, 2, ROOT[name]);
}

function bytes(s) {
  return new TextEncoder().encode(s);
}

// Twinkle, Twinkle, Little Star (Jane Taylor, 1806; melody traditional).
const tw = (line, notes, syls) => notes.map((n, i) => [n, i === 6 ? 2 : 1, (i === 0 ? "/" : "") + syls[i]]);
const twinkle = [
  ...tw(1, ["C4", "C4", "G4", "G4", "A4", "A4", "G4"], ["Twin", "kle ", "twin", "kle ", "lit", "tle ", "star,"]),
  ...tw(2, ["F4", "F4", "E4", "E4", "D4", "D4", "C4"], ["How ", "I ", "won", "der ", "what ", "you ", "are."]),
  ...tw(3, ["G4", "G4", "F4", "F4", "E4", "E4", "D4"], ["Up ", "a", "bove ", "the ", "world ", "so ", "high,"]),
  ...tw(4, ["G4", "G4", "F4", "F4", "E4", "E4", "D4"], ["Like ", "a ", "dia", "mond ", "in ", "the ", "sky."]),
  ...tw(5, ["C4", "C4", "G4", "G4", "A4", "A4", "G4"], ["Twin", "kle ", "twin", "kle ", "lit", "tle ", "star,"]),
  ...tw(6, ["F4", "F4", "E4", "E4", "D4", "D4", "C4"], ["How ", "I ", "won", "der ", "what ", "you ", "are."]),
];
const twinkleChords = [
  ["C", 4], ["F", 2], ["C", 2], ["F", 2], ["C", 2], ["G", 2], ["C", 2],
  ["C", 2], ["F", 2], ["C", 2], ["G", 2], ["C", 2], ["F", 2], ["C", 2], ["G", 2],
  ["C", 4], ["F", 2], ["C", 2], ["F", 2], ["C", 2], ["G", 2], ["C", 2],
];

// Mary Had a Little Lamb (Sarah Josepha Hale, 1830; melody traditional).
const mary = [
  ["E4", 1, "/Ma"], ["D4", 1, "ry "], ["C4", 1, "had "], ["D4", 1, "a "],
  ["E4", 1, "lit"], ["E4", 1, "tle "], ["E4", 2, "lamb,"],
  ["D4", 1, "/lit"], ["D4", 1, "tle "], ["D4", 2, "lamb, "],
  ["E4", 1, "lit"], ["G4", 1, "tle "], ["G4", 2, "lamb,"],
  ["E4", 1, "/Ma"], ["D4", 1, "ry "], ["C4", 1, "had "], ["D4", 1, "a "],
  ["E4", 1, "lit"], ["E4", 1, "tle "], ["E4", 1, "lamb, "],
  ["E4", 1, "/its "], ["D4", 1, "fleece "], ["D4", 1, "was "], ["E4", 1, "white "],
  ["D4", 1, "as "], ["C4", 4, "snow."],
];
const maryChords = [["C", 4], ["C", 4], ["G", 4], ["C", 4], ["C", 4], ["C", 4], ["G", 4], ["C", 4]];

fs.mkdirSync(outDir, { recursive: true });
const songs = [
  { file: "Twinkle Twinkle Little Star - Traditional.kar", name: "Twinkle Twinkle Little Star", bpm: 100, melody: twinkle, chords: twinkleChords, soft: true },
  { file: "Mary Had a Little Lamb - Traditional.mid", name: "Mary Had a Little Lamb", bpm: 110, melody: mary, chords: maryChords, soft: false },
];
for (const s of songs) {
  fs.writeFileSync(path.join(outDir, s.file), Buffer.from(buildSong(s)));
  console.log("wrote", s.file);
}
