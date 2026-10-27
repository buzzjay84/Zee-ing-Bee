import { WorkletSynthesizer, Sequencer } from "spessasynth_lib";
import { BasicMIDI } from "spessasynth_core";
import { extractLyrics, findMelodyChannel, karaokeHeaders, channelRoles, DRUMS } from "./lyrics.js";

const PROCESSOR_URL = "./vendor/spessasynth_lib/spessasynth_processor.min.js";

/** One synth for the whole session; songs come and go through the sequencer. */
export class Player {
  constructor() {
    this.ctx = null;
    this.synth = null;
    this.seq = null;
    this.song = null;
    this.lines = [];
    this.roles = [];
    this.melodyChannel = -1;
    this.key = 0;
    this.tempo = 1;
    this.guide = true;
    this.mix = { melody: 1.35, bass: 1, drums: 1, band: 1 };
    this.soundBankPath = null;
    this.onEnded = () => {};
  }

  async init() {
    this.ctx = new AudioContext({ latencyHint: "playback" });
    await this.ctx.audioWorklet.addModule(PROCESSOR_URL);
    this.synth = new WorkletSynthesizer(this.ctx);
    this.master = this.ctx.createGain();
    this.echo = this.buildEcho();
    this.synth.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.master.connect(this.echo.input);
    this.echo.output.connect(this.ctx.destination);
    await this.synth.isReady;
    this.seq = new Sequencer(this.synth, { skipToFirstNoteOn: false });
    this.seq.loopCount = 0;
    this.seq.eventHandler.addEvent("songEnded", "zb", () => this.onEnded());
    this.seq.eventHandler.addEvent("songChange", "zb", () => this.applyChannels());
  }

  buildEcho() {
    const input = this.ctx.createGain();
    const delay = this.ctx.createDelay(1);
    const feedback = this.ctx.createGain();
    const output = this.ctx.createGain();
    delay.delayTime.value = 0.28;
    feedback.gain.value = 0.3;
    output.gain.value = 0;
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(output);
    return { input, output };
  }

  async loadSoundBank(path, buffer) {
    if (this.soundBankPath === path) return;
    if (this.soundBankPath) await this.synth.soundBankManager.deleteSoundBank("main");
    await this.synth.soundBankManager.addSoundBank(buffer, "main");
    this.soundBankPath = path;
  }

  /** Loads and starts a song. `buffer` is the raw .mid/.kar file. */
  async play(song, buffer) {
    await this.ctx.resume();
    const midi = BasicMIDI.fromArrayBuffer(buffer.slice(0), song.path);
    this.song = song;
    this.lines = extractLyrics(midi);
    this.headers = karaokeHeaders(midi);
    this.roles = channelRoles(midi);
    this.melodyChannel = findMelodyChannel(midi.getNoteTimes(), this.lines);
    this.seq.loadNewSongList([midi]);
    this.seq.currentTime = 0;
    this.seq.play();
    this.applyChannels();
  }

  stop() {
    this.seq?.pause();
    this.synth?.stopAll(true);
    this.song = null;
    this.lines = [];
  }

  togglePause() {
    if (!this.song) return;
    if (this.seq.paused) this.seq.play();
    else this.seq.pause();
  }

  get paused() {
    return !this.song || this.seq.paused;
  }

  get time() {
    return this.seq ? this.seq.currentHighResolutionTime : 0;
  }

  get duration() {
    return this.seq?.duration ?? 0;
  }

  setKey(semitones) {
    this.key = Math.max(-6, Math.min(6, semitones));
    this.applyChannels();
  }

  setTempo(rate) {
    this.tempo = Math.max(0.5, Math.min(1.5, Math.round(rate * 20) / 20));
    if (this.seq) this.seq.playbackRate = this.tempo;
  }

  setGuide(on) {
    this.guide = on;
    this.applyChannels();
  }

  setMix(part, value) {
    this.mix[part] = value;
    this.applyChannels();
  }

  setVolume(v) {
    this.master.gain.value = v;
  }

  setEcho(amount) {
    this.echo.output.gain.value = amount * 0.6;
  }

  /** Key, guide melody and mixer are per-channel system settings in the synth. */
  applyChannels() {
    if (!this.synth) return;
    this.synth.midiChannels.forEach((channel, i) => {
      const ch = i % 16;
      const role = ch === this.melodyChannel ? "melody" : this.roles[ch] ?? "band";
      channel.setSystemParameter("keyShift", ch === DRUMS ? 0 : this.key);
      channel.setSystemParameter("gain", this.mix[role] ?? 1);
      channel.setSystemParameter("isMuted", role === "melody" && !this.guide);
    });
  }
}
