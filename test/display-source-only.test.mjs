import { test } from "node:test";
import assert from "node:assert/strict";

test("an installation without local background videos still searches online", async (t) => {
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location };
  const nodes = new Map();
  class Node extends EventTarget {
    constructor() {
      super();
      this.dataset = {};
      this.style = { setProperty() {} };
      this.classList = { toggle() {} };
      this.readyState = 0;
      this.currentTime = 0;
    }
    pause() {}
    load() {}
    removeAttribute() {}
    replaceChildren() {}
  }
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  let receiveFrame;
  let searches = 0;
  globalThis.document = { hidden: false, documentElement: node("root"), getElementById: node, querySelector: node, addEventListener() {} };
  globalThis.location = { origin: "app://bundle" };
  globalThis.window = { zb: {
    onDisplayFrame: (callback) => { receiveFrame = callback; },
    resolveVideo: async () => ({ matched: false, url: null, fallback: null, backgrounds: [] }),
    searchOnlineVideo: async () => { searches++; return []; },
  } };
  t.after(() => { for (const [key, value] of Object.entries(previous)) globalThis[key] = value; });
  await import("../src/renderer/display.js");
  receiveFrame({ songPath: "song.mid", playbackId: 1, mediaKind: "midi", time: 0, tempo: 1, paused: false, text: {}, lines: [], introUntil: null, countIn: "", size: "5vw", color: "#ffd34d" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(searches, 1);
});
