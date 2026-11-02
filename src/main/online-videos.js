const fs = require("node:fs");
const path = require("node:path");

const clean = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SELECTION_POLICY = "music-video-then-live-v6";
// TV and radio uploads (ASAP, Wish 107.5, MYX, GMA...) carry the station's logo burned into the
// picture, so only the artist's own channel and record labels count as sources.
const WATERMARKED = /\b(asap|wish 10\d|wishclusive|wish bus|wish usa|myx|all out sundays|showtime|gma|tv patrol|rappler|billboard)\b/;
// What may follow the song title in a video title, so "Ikaw" doesn't match "Ikaw ang Aking Pahinga".
const TITLE_END = /^(?:\s*$|\s*[-–—|(\[:,'"‘’“”!?.]|\s+(?:official|live|music|video|mv|performance|lyric|lyrics|by|ft|feat|featuring|x|with|from|on|at|in|acoustic|version|session|concert)\b)/;
const HD = 1080;
const PROBE_WAIT_MS = 4000;
const PROBE_RETRY_MS = 24 * 60 * 60 * 1000;
const OLD_MUSIC_VIDEO_DAYS = 5 * 365;

/** For videos saved under older, looser rules: a title that names a TV or radio show. */
function looksWatermarked(videoTitle) {
  return WATERMARKED.test(clean(videoTitle ?? ""));
}

function titleStandsAlone(videoTitle, title) {
  const plain = videoTitle.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = clean(title).split(" ");
  for (const match of plain.matchAll(new RegExp(`(?<![a-z0-9])${words.join("[^a-z0-9]*")}(?![a-z0-9])`, "g"))) {
    if (TITLE_END.test(plain.slice(match.index + match[0].length))) return true;
  }
  return false;
}

/**
 * 1080p first. Among those, a recent music video leads (or live, with liveFirst) and a music
 * video older than five years gives way to newer and live ones. With no 1080p at all, the order stays.
 */
function preferHD(items, { liveFirst = false } = {}) {
  const hd = (item) => item.height >= HD;
  const live = (item) => item.kind === "live";
  const ordered = liveFirst ? [...items.filter(live), ...items.filter((item) => !live(item))] : items;
  if (!ordered.some(hd)) return ordered;
  const tier = (item) => {
    if (!hd(item)) return 3;
    if (!live(item) && ageInDays(item.published) > OLD_MUSIC_VIDEO_DAYS) return 2;
    return live(item) === liveFirst ? 0 : 1;
  };
  return ordered.map((item, index) => ({ item, index })).sort((a, b) => tier(a.item) - tier(b.item) || a.index - b.index).map(({ item }) => item);
}
function ageInDays(text = "") {
  const match = text.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|[smhdwy])\b/i);
  if (!match) return Infinity;
  return Number(match[1]) * ({ second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365, s: 1 / 86400, m: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 30, y: 365 })[match[2].toLowerCase().replace(/s$/, "") || "s"];
}

function rankVideos(items, song) {
  const title = clean(song.title);
  const artist = clean(song.artist);
  const ranked = items.filter((item) => {
    const text = clean(`${item.title} ${item.channel}`);
    const channel = clean(item.channel);
    const artistChannel = artist && channel.replace(/\s*(official|vevo|tv)$/, "").replace(/ /g, "") === artist.replace(/ /g, "");
    const labelChannel = /\b(sony music|star music|universal records|warner music|viva records|polyeast records|the first take|tower sessions)\b/.test(channel);
    const trusted = artistChannel || labelChannel;
    const live = /\b(live|performance|performs|sessions?|wishclusive|wish bus|wish 107|asap|concert|reunion)\b/i.test(item.title);
    const musicVideo = !live && /\bofficial\s+(?:(?:music|hd|4k)\s+)*(?:video|mv)\b|\bmusic video\b/i.test(item.title);
    return /^[\w-]{11}$/.test(item.id) && title && titleStandsAlone(item.title, song.title) && !WATERMARKED.test(text) && !/\bwish\b/.test(channel)
      && (!artist || artist.split(" ").filter((word) => word.length > 1).every((word) => text.includes(word)))
      && trusted && (musicVideo || live) && (item.duration == null || item.duration >= 90)
      && !/\b(karaoke|reaction|tutorial|cover|lyric|lyrics|audio only|watermark|reupload|fancam|fan cam|unofficial|360p|240p|shorts)\b/.test(clean(item.title));
  }).map((item) => ({ ...item, kind: /\b(live|performance|performs|sessions?|wishclusive|wish bus|wish 107|asap|concert|reunion)\b/i.test(item.title) ? "live" : "music-video" }))
    .sort((a, b) => ageInDays(a.published) - ageInDays(b.published));
  // Keep candidates from both tiers: several blocked MVs must not crowd out live.
  return [...ranked.filter((item) => item.kind === "music-video").slice(0, 3), ...ranked.filter((item) => item.kind === "live").slice(0, 3)];
}

function parseSearch(html) {
  const raw = html.match(/(?:var\s+ytInitialData\s*=\s*|window\["ytInitialData"\]\s*=\s*)(\{.*?\});\s*<\/script>/s)?.[1];
  if (!raw) return [];
  const items = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.videoRenderer) {
      const v = node.videoRenderer;
      const verified = (v.ownerBadges ?? []).some((badge) => /VERIFIED/.test(badge.metadataBadgeRenderer?.style ?? ""));
      const length = v.lengthText?.simpleText;
      items.push({ id: v.videoId, title: (v.title?.runs ?? []).map((r) => r.text).join(""), channel: (v.ownerText?.runs ?? []).map((r) => r.text).join(""), verified,
        published: v.publishedTimeText?.simpleText ?? "", duration: length ? length.split(":").reduce((total, part) => total * 60 + Number(part), 0) : null });
      return;
    }
    for (const value of Object.values(node)) visit(value);
  }
  visit(JSON.parse(raw));
  return items;
}

function createOnlineSearch(cacheFile, { probeHeight = null } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  const heightsFile = path.join(path.dirname(cacheFile), "video-sizes.json");
  let heights = {};
  const probing = new Set();
  try { heights = JSON.parse(fs.readFileSync(heightsFile, "utf8")); } catch {}
  async function withHeights(items) {
    if (!probeHeight) return items;
    const stale = (id) => !(id in heights) || (heights[id]?.failedAt && Date.now() - heights[id].failedAt > PROBE_RETRY_MS);
    const unknown = items.filter((item) => stale(item.id) && !probing.has(item.id));
    if (unknown.length) {
      const probes = Promise.all(unknown.map(async (item) => {
        probing.add(item.id);
        heights[item.id] = (await probeHeight(item.id).catch(() => null)) ?? { failedAt: Date.now() };
        probing.delete(item.id);
      })).then(() => {
        fs.mkdirSync(path.dirname(heightsFile), { recursive: true });
        fs.writeFileSync(heightsFile, JSON.stringify(heights));
      }).catch(() => {});
      // Never hold the video up for long: unchecked ones keep the usual order this time, and
      // the check carries on in the background for the next time the song plays.
      await Promise.race([probes, new Promise((resolve) => setTimeout(resolve, PROBE_WAIT_MS))]);
    }
    return items.map((item) => ({ ...item, height: heights[item.id]?.height ?? null, aspect: heights[item.id]?.aspect ?? null }));
  }
  const pending = new Map();
  return async function search(song, { refresh = false } = {}) {
    const key = `${SELECTION_POLICY}|${clean(song.title)}|${clean(song.artist)}`;
    const cached = cache[key];
    if (!refresh && cached && Date.now() - cached.at < 300000) return cached.items;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        const searches = ["official music video", "live performance", "tower sessions"].flatMap((suffix) => ["&sp=CAI%3D", ""].map((sort) => ({ query: `${song.title} ${song.artist} ${suffix}`, sort })));
        const results = await Promise.allSettled(searches.map(async ({ query, sort }) => {
          const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en${sort}`, { signal: AbortSignal.timeout(12000) });
          return response.ok ? parseSearch(await response.text()) : [];
        }));
        const unique = new Map(results.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((item) => [item.id, item]));
        const items = await withHeights(rankVideos([...unique.values()], song));
        cache[key] = { at: Date.now(), items };
        cache = Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 500));
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
        return items;
      } catch (error) {
        console.warn("Music video search unavailable:", error.message);
        return [];
      } finally { pending.delete(key); }
    })();
    pending.set(key, task);
    return task;
  };
}

module.exports = { createOnlineSearch, rankVideos, preferHD, looksWatermarked, parseSearch, SELECTION_POLICY };
