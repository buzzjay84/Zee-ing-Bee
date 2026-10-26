import { createVideoHealth } from "./video-health.js";
let apiPromise;
function hideCaptions(player) {
  // Some embeds inherit a caption preference even with the controls hidden.
  try {
    const modules = player.getOptions?.();
    if (Array.isArray(modules) && !modules.includes("captions")) return;
    player.unloadModule?.("captions");
  } catch {}
}
function youtubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { script.remove(); reject(new Error("YouTube player timed out")); }, 12000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("YouTube unavailable")); };
    document.head.append(script);
  }).catch((error) => { apiPromise = null; throw error; });
  return apiPromise;
}

export function createOnlineVideo(container, background, onPlaying = () => {}) {
  let player;
  let generation = 0;
  let timer;
  let frame;
  let ready = false;
  let visible = false;
  let lastSync = 0;
  let lastSeek = -Infinity;
  let advance;
  let candidateId = null;
  const health = createVideoHealth();

  function reset() {
    generation++;
    clearTimeout(timer);
    ready = false;
    visible = false;
    health.reset();
    advance = null;
    candidateId = null;
    container.hidden = true;
    container.dataset.status = "background";
    if (player) { player.destroy(); player = null; }
    container.replaceChildren();
  }

  async function load(candidates) {
    reset();
    if (!candidates.length) return;
    container.dataset.status = "loading";
    const token = generation;
    let YT;
    try { YT = await youtubeApi(); } catch { container.dataset.status = "unavailable"; return; }
    if (token !== generation) return;
    let index = 0;
    let attempt = 0;
    let savingId;
    function next() {
      if (token !== generation) return;
      const attemptId = ++attempt;
      const current = () => token === generation && attemptId === attempt;
      clearTimeout(timer);
      ready = false;
      health.reset();
      lastSeek = -Infinity;
      visible = false;
      container.hidden = true;
      if (player) { player.destroy(); player = null; }
      const candidate = candidates[index++];
      candidateId = candidate?.id ?? null;
      if (!candidate) { container.dataset.status = "unavailable"; return; }
      container.dataset.videoId = candidate.id;
      container.replaceChildren();
      const mount = document.createElement("div");
      container.append(mount);
      const checkStartup = () => {
        if (!current()) return;
        if (frame?.paused || document.hidden) timer = setTimeout(checkStartup, 12000);
        else next();
      };
      timer = setTimeout(checkStartup, 12000);
      player = new YT.Player(mount, {
        width: "100%", height: "100%", videoId: candidate.id,
        playerVars: { autoplay: 0, controls: 0, playsinline: 1, disablekb: 1, cc_load_policy: 0, origin: location.origin },
        events: {
          onReady: (event) => {
            if (!current()) return;
            ready = true;
            event.target.mute();
            hideCaptions(event.target);
            event.target.setVolume(0);
            event.target.seekTo(frame?.time ?? 0, true);
            if (!frame?.paused) event.target.playVideo();
          },
          onStateChange: (event) => {
            if (!current()) return;
            if (event.data === YT.PlayerState.PLAYING) {
              hideCaptions(event.target);
              clearTimeout(timer);
              visible = true;
              container.dataset.status = "playing";
              container.hidden = false;
              background.pause();
              if (savingId !== candidate.id) {
                savingId = candidate.id;
                onPlaying(candidate);
              }
            } else if (event.data === YT.PlayerState.ENDED) {
              event.target.seekTo(0, true);
              event.target.playVideo();
            }
          },
          onError: () => { if (current()) next(); },
          onApiChange: (event) => { if (current()) hideCaptions(event.target); },
          onAutoplayBlocked: () => { if (current()) next(); },
        },
      });
    }
    advance = next;
    next();
  }

  function sync(data) {
    frame = data;
    if (!ready || !player || performance.now() - lastSync < 500) return;
    lastSync = performance.now();
    player.mute();
    if (data.paused || document.hidden) player.pauseVideo();
    else {
      const duration = player.getDuration();
      const target = duration > 0 ? data.time % duration : data.time;
      const now = performance.now();
      const action = health.check(player.getCurrentTime(), now, true);
      if (action === "fallback") { advance?.(); return; }
      if (action === "recover" || now - lastSeek > 4000 && Math.abs(player.getCurrentTime() - target) > 3) {
        lastSeek = now;
        player.seekTo(target, true);
        player.playVideo();
      }
      const rates = player.getAvailablePlaybackRates();
      const rate = rates.reduce((best, value) => Math.abs(value - data.tempo) < Math.abs(best - data.tempo) ? value : best, 1);
      if (player.getPlaybackRate() !== rate) player.setPlaybackRate(rate);
      if (player.getPlayerState() !== 1 && player.getPlayerState() !== 3) player.playVideo();
    }
    if (data.paused || document.hidden) health.check(0, performance.now(), false);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && ready) player?.pauseVideo(); });
  return { load, reset, sync, get visible() { return visible; }, get candidateId() { return candidateId; } };
}
