import { createOnlineVideo } from "./online-video.js";
import { createVideoHealth } from "./video-health.js";
const $ = (id) => document.getElementById(id);
const video = $("background-video");
const online = createOnlineVideo($("online-video"), video, savePlayingVideo);
let currentSong;
let currentPlayback;
let videoSelection;
let lastFrame;
const saving = new Set();
const health = createVideoHealth();
let lastSeek = -Infinity;
let backgroundIndex = 0;
let onlineCandidates = [];
let localFailed = false;

function tryOnlineAlternatives() {
  if (!videoSelection?.matched || videoSelection.karaoke || localFailed) return;
  localFailed = true;
  if (onlineCandidates.length) online.load(onlineCandidates);
}

async function savePlayingVideo(candidate) {
  const songPath = currentSong;
  const playback = currentPlayback;
  const key = `${songPath}|${candidate.id}`;
  if (saving.has(key)) return;
  saving.add(key);
  try {
    const saved = await window.zb.saveVideo(songPath, candidate.id);
    if (!saved || songPath !== currentSong || playback !== currentPlayback || online.candidateId !== candidate.id) return;
    videoSelection = { ...videoSelection, ...saved };
    health.reset();
    video.src = saved.url;
    video.addEventListener("loadeddata", () => {
      if (songPath === currentSong && playback === currentPlayback && videoSelection?.url === saved.url) online.reset();
    }, { once: true });
    video.load();
  } catch (error) { console.warn("Video download unavailable:", error.message); }
  finally { saving.delete(key); }
}

async function chooseVideo(songPath) {
  const playback = currentPlayback;
  const selection = await window.zb.resolveVideo(songPath);
  if (songPath !== currentSong || playback !== currentPlayback) return;
  videoSelection = selection;
  onlineCandidates = [];
  localFailed = false;
  health.reset();
  lastSeek = -Infinity;
  if (!selection?.url) {
    video.removeAttribute("src");
    video.load();
  } else {
    video.src = selection.url;
    video.loop = !selection.karaoke;
    video.load();
  }
  if (selection && !selection.karaoke) {
    const candidates = await window.zb.searchOnlineVideo(songPath);
    if (songPath !== currentSong || playback !== currentPlayback) return;
    onlineCandidates = candidates;
    if (candidates.length && (localFailed || candidates[0].id !== selection.videoId)) online.load(candidates);
  }
}
video.addEventListener("error", () => {
  tryOnlineAlternatives();
  if (videoSelection?.fallback && videoSelection.url !== videoSelection.fallback) {
    videoSelection = { ...videoSelection, matched: false, url: videoSelection.fallback };
    video.src = videoSelection.url;
    video.load();
  } else video.removeAttribute("src");
});
function syncVideo(data) {
  const now = performance.now();
  const active = Boolean(videoSelection?.url) && !data.paused && !online.visible && !document.hidden;
  const action = health.check(video.currentTime, now, active);
  if (action === "recover") {
    video.load();
    lastSeek = -Infinity;
  } else if (action === "fallback" && !videoSelection?.karaoke) {
    tryOnlineAlternatives();
    const backgrounds = videoSelection?.backgrounds ?? (videoSelection?.fallback ? [videoSelection.fallback] : []);
    if (backgrounds.length) {
      const url = backgrounds[backgroundIndex++ % backgrounds.length];
      videoSelection = { ...videoSelection, matched: false, url };
      video.src = url;
      video.loop = true;
      video.load();
      health.reset();
    }
  }
  if (video.readyState < 1) return;
  if (videoSelection?.matched) {
    const target = Number.isFinite(video.duration) && video.duration > 0 ? data.time % video.duration : data.time;
    if (!video.seeking && now - lastSeek > 2000 && Math.abs(video.currentTime - target) > 1) {
      lastSeek = now;
      video.currentTime = target;
    }
    video.playbackRate = data.tempo;
  } else video.playbackRate = 1;
  if (data.paused || online.visible || document.hidden) video.pause();
  else if (video.paused) video.play().catch(() => {});
}
video.addEventListener("loadedmetadata", () => { if (lastFrame) syncVideo(lastFrame); });
document.addEventListener("visibilitychange", () => { if (document.hidden) video.pause(); });
window.zb.onDisplayFrame((data) => {
  lastFrame = data;
  if (currentSong !== data.songPath || currentPlayback !== data.playbackId) {
    currentSong = data.songPath;
    currentPlayback = data.playbackId;
    online.reset();
    videoSelection = null;
    video.pause();
    chooseVideo(currentSong).catch(console.error);
  }
  syncVideo(data);
  online.sync(data);
  for (const id of ["tc-number", "tc-title", "tc-artist", "stage-number"]) {
    $(id).textContent = data.text[id];
  }
  $("stage-number").hidden = !data.text["stage-number"];
  $("title-card").classList.toggle("gone", data.titleGone);
  document.querySelector(".lyrics").hidden = data.mediaKind === "video";
  $("display-countin").textContent = data.countIn;
  $("display-countin").hidden = !data.countIn;
  const inIntro = Number.isFinite(data.introUntil) && data.time < data.introUntil;
  $("intro-indicator").hidden = !inIntro;
  if (inIntro) {
    const remaining = Math.ceil((data.introUntil - data.time) / Math.max(data.tempo || 1, 0.5));
    $("intro-countdown").textContent = `Vocals in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}${data.paused ? " · Paused" : ""}`;
    $("intro-progress-fill").style.width = `${Math.max(0, Math.min(100, data.time / data.introUntil * 100))}%`;
  }
  document.documentElement.style.setProperty("--lyric-size", data.size);
  document.documentElement.style.setProperty("--sung", data.color);
  data.lines.forEach((syllables, index) => {
    const line = $(`slot-${index}`);
    if (line.textContent !== syllables.map((s) => s.text).join("") || line.children.length !== syllables.length) {
      line.replaceChildren(...syllables.map((s) => {
        const span = document.createElement("span");
        span.className = "syl";
        span.textContent = s.text;
        return span;
      }));
    }
    syllables.forEach((s, i) => line.children[i].style.setProperty("--fill", s.fill));
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "F11") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});
