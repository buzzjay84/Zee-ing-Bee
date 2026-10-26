import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../src/renderer/player.js";

test("guide melody is audible by default and switches off without muting the band", () => {
  const player = new Player();
  const params = Array.from({ length: 16 }, () => ({}));
  player.synth = { midiChannels: params.map((state) => ({ setSystemParameter: (key, value) => { state[key] = value; } })) };
  player.melodyChannel = 2;
  player.applyChannels();
  assert.equal(player.guide, true);
  assert.equal(params[2].gain, 1.35);
  assert.equal(params[2].isMuted, false);
  player.setGuide(false);
  assert.equal(params[2].isMuted, true);
  assert.equal(params[1].isMuted, false);
  assert.equal(params[9].isMuted, false);
  player.setMix("melody", 1.8);
  player.setGuide(true);
  assert.equal(params[2].gain, 1.8);
  assert.equal(params[1].gain, 1);
  player.setKey(2);
  assert.equal(params[2].keyShift, 2);
  assert.equal(params[9].keyShift, 0);
});
