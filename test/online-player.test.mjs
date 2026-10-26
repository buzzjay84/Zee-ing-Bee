import { test } from "node:test";
import assert from "node:assert/strict";
import { createOnlineVideo } from "../src/renderer/online-video.js";

function setup(t) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const players = [];
  class FakePlayer {
    constructor(_mount, options) { this.events = options.events; this.modules = ["captions"]; this.unloads = 0; players.push(this); }
    destroy() { this.destroyed = true; }
    mute() {}
    setVolume() {}
    seekTo() {}
    playVideo() {}
    pauseVideo() {}
    getOptions() { return this.modules; }
    unloadModule() { this.modules = []; this.unloads++; }
  }
  globalThis.window = { YT: { Player: FakePlayer, PlayerState: { PLAYING: 1, ENDED: 0 } } };
  globalThis.document = { hidden: false, createElement: () => ({}), addEventListener() {} };
  globalThis.location = { origin: "app://bundle" };
  const container = { dataset: {}, hidden: true, replaceChildren() {}, append() {} };
  const controller = createOnlineVideo(container, { pause() {} });
  t.after(() => { controller.reset(); globalThis.window = previousWindow; globalThis.document = previousDocument; });
  return { controller, players };
}

test("failed music video advances to live and stale player events cannot replace it", async (t) => {
  const { controller, players } = setup(t);
  await controller.load([{ id: "music" }, { id: "live" }]);
  assert.equal(controller.candidateId, "music");
  const first = players[0];
  first.events.onError();
  assert.equal(controller.candidateId, "live");
  first.events.onError();
  assert.equal(players.length, 2);
  players[1].events.onStateChange({ data: 1 });
  assert.equal(controller.visible, true);
  first.events.onStateChange({ data: 1 });
  assert.equal(controller.candidateId, "live");
});

test("pausing during startup does not discard the selected video", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, players } = setup(t);
  controller.sync({ paused: true, time: 0, tempo: 1 });
  await controller.load([{ id: "music" }, { id: "live" }]);
  t.mock.timers.tick(24000);
  assert.equal(players.length, 1);
  assert.equal(controller.candidateId, "music");
  controller.sync({ paused: false, time: 0, tempo: 1 });
  t.mock.timers.tick(12000);
  assert.equal(controller.candidateId, "live");
});

test("caption removal does not repeatedly unload an already removed module", async (t) => {
  const { controller, players } = setup(t);
  await controller.load([{ id: "music" }]);
  const player = players[0];
  player.events.onReady({ target: player });
  player.events.onApiChange({ target: player });
  player.events.onApiChange({ target: player });
  assert.equal(player.unloads, 1);
});
