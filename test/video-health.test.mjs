import { test } from "node:test";
import assert from "node:assert/strict";
import { createVideoHealth } from "../src/renderer/video-health.js";

test("frozen video is recovered once, then replaced if still stuck", () => {
  const health = createVideoHealth();
  assert.equal(health.check(10, 0, true), null);
  assert.equal(health.check(10, 5900, true), null);
  assert.equal(health.check(10, 6000, true), "recover");
  assert.equal(health.check(10, 12000, true), "fallback");
  health.reset();
  assert.equal(health.check(0, 15000, true), null);
});
test("advancing, paused and hidden videos do not trigger stall recovery", () => {
  const health = createVideoHealth();
  health.check(0, 0, true);
  assert.equal(health.check(5, 5000, true), null);
  assert.equal(health.check(5, 12000, false), null);
  assert.equal(health.check(5, 25000, true), null);
  assert.equal(health.check(6, 26000, true), null);
});
