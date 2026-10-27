// Turns the words inside a karaoke MIDI into timed lines of syllables.
//
// Formats seen in the wild:
//  - Soft Karaoke (.kar): text events (type 1), normally announced by an
//    "@KMIDI KARAOKE FILE" header. "/" starts a new line, "\" a new verse.
//  - Standard lyric events (type 5): a "\r" or "\n" ends a line.
//  - Some files use the "/" and "\" line/verse markers from Soft Karaoke, but
//    put them in type-5 lyric events and skip the header entirely, so the
//    MIDI parser's isKaraokeFile flag never gets set. Detected from the
//    content itself: a real lyric line essentially never starts with "/" or
//    "\" on its own, so seeing that is a reliable sign of the convention.

const TEXT = 0x01;
const LYRIC = 0x05;
export const DRUMS = 9;
// General MIDI programs 32–39 are the basses.
const isBassProgram = (p) => p >= 32 && p <= 39;

const utf8 = new TextDecoder("utf-8", { fatal: true });
const latin = new TextDecoder("windows-1252");

export function decodeText(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin.decode(bytes);
  }
}

function collect(midi, type) {
  const events = [];
  midi.tracks.forEach((track) => {
    for (const e of track.events) {
      if (e.statusByte === type) events.push({ ticks: e.ticks, text: decodeText(e.data) });
    }
  });
  return events.sort((a, b) => a.ticks - b.ticks);
}

/** Header info from Soft Karaoke "@T" lines: the first is the title, the second the artist. */
export function karaokeHeaders(midi) {
  const titles = collect(midi, TEXT)
    .filter((e) => e.text.startsWith("@T"))
    .map((e) => e.text.slice(2).trim())
    .filter(Boolean);
  return { title: titles[0], artist: titles[1] };
}

/**
 * @returns {{start:number,end:number,verseStart:boolean,syllables:{text:string,time:number}[]}[]}
 *          times in song seconds.
 */
export function extractLyrics(midi) {
  let events = collect(midi, LYRIC);
  const textEvents = collect(midi, TEXT).filter((e) => !e.text.startsWith("@"));
  const looksSoft = (list) => list.some((e) => e.text.startsWith("/") || e.text.startsWith("\\"));
  let soft = false;
  if (events.length === 0 || (midi.isKaraokeFile && textEvents.length > events.length)) {
    events = textEvents;
    soft = true;
  } else if (looksSoft(events)) {
    soft = true;
  }

  const lines = [];
  let current = null;
  let verseNext = true;
  const close = () => {
    if (current && current.syllables.some((s) => s.text.trim())) lines.push(current);
    current = null;
  };

  for (const e of events) {
    const time = midi.midiTicksToSeconds(e.ticks);
    let text = e.text;
    let breakAfter = false;

    if (soft) {
      if (text.startsWith("\\")) {
        close();
        verseNext = true;
        text = text.slice(1);
      } else if (text.startsWith("/")) {
        close();
        text = text.slice(1);
      }
    } else {
      // A line break can lead or trail the syllable.
      if (/^[\r\n]/.test(text)) close();
      if (/[\r\n]$/.test(text)) breakAfter = true;
      text = text.replace(/[\r\n]/g, "");
    }

    if (text) {
      if (!current) {
        current = { start: time, end: time, verseStart: verseNext, syllables: [] };
        verseNext = false;
      }
      current.syllables.push({ text, time });
    }
    if (breakAfter) close();
  }
  close();

  for (let i = 0; i < lines.length; i++) {
    const last = lines[i].syllables.at(-1).time;
    const next = lines[i + 1]?.start ?? Infinity;
    lines[i].end = Math.min(next, last + 2);
  }
  return lines;
}

/**
 * How far through each syllable the singer is, 0..1.
 * A syllable fills over the gap to the next one, at most one second.
 */
export function syllableFill(line, i, t) {
  const s = line.syllables[i];
  if (t < s.time) return 0;
  const next = line.syllables[i + 1]?.time ?? line.end;
  const span = Math.min(Math.max(next - s.time, 0.05), 1);
  return Math.min((t - s.time) / span, 1);
}

/**
 * Finds which channel carries the sung melody: the non-drum channel whose
 * notes start closest to the syllables. Returns -1 when no channel fits well.
 */
export function findMelodyChannel(noteTimes, lines) {
  const syllables = lines.flatMap((l) => l.syllables.map((s) => s.time));
  if (syllables.length < 4) return -1;
  let best = -1;
  let bestScore = 0.4;
  noteTimes.forEach((notes, ch) => {
    if (ch % 16 === 9 || notes.length === 0) return;
    const starts = notes.map((n) => n.start).sort((a, b) => a - b);
    let hits = 0;
    for (const t of syllables) {
      if (nearest(starts, t) < 0.08) hits++;
    }
    const score = hits / syllables.length;
    if (score > bestScore) {
      bestScore = score;
      best = ch;
    }
  });
  return best;
}

/** Sorts each MIDI channel into drums, bass or band from its first program change. */
export function channelRoles(midi) {
  const roles = Array(16).fill("band");
  roles[DRUMS] = "drums";
  const seen = new Set();
  for (const track of midi.tracks) {
    for (const e of track.events) {
      if ((e.statusByte & 0xf0) !== 0xc0) continue;
      const ch = e.statusByte & 0x0f;
      if (seen.has(ch) || ch === DRUMS) continue;
      seen.add(ch);
      if (isBassProgram(e.data[0])) roles[ch] = "bass";
    }
  }
  return roles;
}

function nearest(sorted, t) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = Math.abs(sorted[lo] - t);
  const b = lo > 0 ? Math.abs(sorted[lo - 1] - t) : Infinity;
  return Math.min(a, b);
}
