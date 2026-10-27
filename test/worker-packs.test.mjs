import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createHandler } from "../worker/src/index.js";

const env = { GOOGLE_CLIENT_EMAIL: "svc@test.iam.gserviceaccount.com", GOOGLE_PRIVATE_KEY: null, PACKS_DRIVE_FOLDER_ID: "folder-123" };

// A real RSA key so the JWT-signing code path runs for real; only the network calls are mocked.
function testEnv() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { ...env, GOOGLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

function fakeFetch({ files = [], bytesByName = {} } = {}) {
  let tokenRequests = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === "https://oauth2.googleapis.com/token") {
      tokenRequests++;
      return { ok: true, json: async () => ({ access_token: `token-${tokenRequests}`, expires_in: 3600 }) };
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return { ok: true, json: async () => ({ files: files.map(({ name, id }) => ({ id, name })) }) };
    }
    const match = /\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(url);
    if (match) {
      const file = files.find((f) => f.id === match[1]);
      const body = file ? bytesByName[file.name] : undefined;
      return body === undefined ? { ok: false, status: 404 } : new Response(body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  fetchImpl.tokenRequests = () => tokenRequests;
  return fetchImpl;
}

test("serves a known file's bytes by name", async () => {
  const fetchImpl = fakeFetch({ files: [{ name: "manifest.json", id: "f1" }], bytesByName: { "manifest.json": '[{"name":"a.zip"}]' } });
  const handle = createHandler(fetchImpl);
  const response = await handle(new Request("https://packs.test/manifest.json"), testEnv());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '[{"name":"a.zip"}]');
  assert.equal(response.headers.get("content-type"), "application/json");
});

test("404s for a file not in the Drive folder", async () => {
  const fetchImpl = fakeFetch({ files: [] });
  const handle = createHandler(fetchImpl);
  const response = await handle(new Request("https://packs.test/missing.zip"), testEnv());
  assert.equal(response.status, 404);
});

test("rejects a name outside the allowed zip/json pattern", async () => {
  const handle = createHandler(fakeFetch());
  const response = await handle(new Request("https://packs.test/../escape.zip"), testEnv());
  assert.equal(response.status, 404);
});

test("rejects non-GET requests", async () => {
  const handle = createHandler(fakeFetch());
  const response = await handle(new Request("https://packs.test/manifest.json", { method: "POST" }), testEnv());
  assert.equal(response.status, 405);
});

test("reuses the access token and file listing across requests instead of re-fetching them", async () => {
  const fetchImpl = fakeFetch({ files: [{ name: "a.zip", id: "f1" }], bytesByName: { "a.zip": "zip-bytes" } });
  const handle = createHandler(fetchImpl);
  const testEnvironment = testEnv();
  await handle(new Request("https://packs.test/a.zip"), testEnvironment);
  await handle(new Request("https://packs.test/a.zip"), testEnvironment);
  assert.equal(fetchImpl.tokenRequests(), 1, "the cached token is reused for the second request");
});

test("answers 502 when Drive itself errors", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    return { ok: false, status: 500 };
  };
  const handle = createHandler(fetchImpl);
  const response = await handle(new Request("https://packs.test/manifest.json"), testEnv());
  assert.equal(response.status, 502);
});
