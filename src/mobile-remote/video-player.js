// Audio comes from this hidden local player. The separate display stays muted.
export class VideoPlayer {
  constructor() {
    this.media = document.createElement("video");
    this.media.hidden = true;
    this.media.preload = "auto";
    document.body.append(this.media);
    this.song = null;
    this.lines = [];
    this.headers = {};
    this.key = 0;
    this.tempo = 1;
    this.guide = false;
    this.melodyChannel = -1;
    this.onEnded = () => {};
    this.onError = () => {};
    this.media.addEventListener("ended", () => { if (this.song) this.onEnded(); });
    this.media.addEventListener("error", () => { if (this.song) this.onError(new Error("The saved karaoke video could not be played.")); });
  }
  async play(song, url) {
    this.song = song;
    this.media.src = url;
    this.media.playbackRate = this.tempo;
    await this.media.play();
  }
  stop() { this.song = null; this.media.pause(); this.media.removeAttribute("src"); this.media.load(); }
  togglePause() { if (!this.song) return; if (this.media.paused) this.media.play().catch(this.onError); else this.media.pause(); }
  get paused() { return this.media.paused; }
  get time() { return this.media.currentTime; }
  get duration() { return Number.isFinite(this.media.duration) ? this.media.duration : 0; }
  setTempo(value) { this.tempo = Math.max(0.5, Math.min(1.5, Math.round(value * 20) / 20)); this.media.playbackRate = this.tempo; }
  setVolume(value) { this.media.volume = Math.max(0, Math.min(1, value)); }
  setKey() {}
  setGuide() {}
  setMix() {}
  setEcho() {}
}
