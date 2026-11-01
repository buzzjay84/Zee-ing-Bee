import test from "node:test";
import assert from "node:assert/strict";
import { isNewer, findUpdate } from "../src/mobile-remote/update.js";

const release = (tag, assets) => async () => ({ json: async () => ({ tag_name: tag, assets }) });
const apk = { name: "Zee-ing-Bee-Mobile-v1.0.7.apk", browser_download_url: "https://example.test/app.apk" };

test("compares versions numerically, not as text", () => {
  assert.equal(isNewer("1.0.10", "1.0.9"), true);
  assert.equal(isNewer("1.0.6", "1.0.6"), false);
  assert.equal(isNewer("1.0.5", "1.0.6"), false);
});

test("offers the APK only when the release is newer and has one attached", async () => {
  assert.deepEqual(await findUpdate("1.0.6", release("v1.0.7", [apk])), { version: "1.0.7", url: apk.browser_download_url });
  assert.equal(await findUpdate("1.0.7", release("v1.0.7", [apk])), null);
  assert.equal(await findUpdate("1.0.6", release("v1.0.7", [])), null, "APK not attached yet");
});
