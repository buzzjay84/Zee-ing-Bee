const test = require("node:test");
const assert = require("node:assert");
const { withDefaults, step, summary } = require("../src/shared/sound-settings.js");

test("missing or broken saved values fall back to the defaults, out-of-range ones are clamped", () => {
  const mix = withDefaults({ bass: 1.5, drums: "loud", echo: 9 });
  assert.strictEqual(mix.bass, 1.5);
  assert.strictEqual(mix.drums, 1);
  assert.strictEqual(mix.echo, 1);
  assert.strictEqual(mix.melody, 1.35);
});

test("steps stay in range and do not drift", () => {
  assert.strictEqual(step("bass", 0.7, 1), 0.8);
  assert.strictEqual(step("bass", 2, 1), 2);
  assert.strictEqual(step("low", -12, -1), -12);
  assert.strictEqual(step("volume", 0.05, -1), 0);
});

test("summary names echo and volume", () => {
  assert.strictEqual(summary(withDefaults({})), "Echo Off · Volume 100%");
});
