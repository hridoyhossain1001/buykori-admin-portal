import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("AI Chat settings stay owner-only and use the production backend contract", async () => {
  const markup = await read("index.html");
  const source = await read("app.js");

  assert.match(markup, /id="teamNavGroup"[\s\S]*data-tab="aiChatSettings"/);
  assert.match(source, /tab === "aiChatSettings"\) && state\.currentAdmin\?\.role !== "owner"/);
  assert.match(source, /\/admin\/api\/ai-chat\/provider-settings/);
  assert.match(source, /\/admin\/api\/ai-chat\/test-connection/);
  assert.match(source, /new Set\(\["POST", "PUT", "PATCH", "DELETE"\]\)/);
});

test("API credential is write-only and never rendered from a response", async () => {
  const markup = await read("index.html");
  const source = await read("app.js");

  assert.match(markup, /id="aiChatApiKey" type="password" autocomplete="new-password"/);
  assert.match(source, /settings\.api_key_masked/);
  assert.doesNotMatch(source, /settings\.api_key(?!_masked)/);
  assert.doesNotMatch(markup, /sk-[A-Za-z0-9]/);
});

test("connection test only runs from an explicit named action", async () => {
  const markup = await read("index.html");
  const source = await read("app.js");

  assert.match(markup, /data-action="ai-chat:test"/);
  assert.match(source, /"ai-chat:test": \{\s+event: "click"/);
  assert.doesNotMatch(source, /loadAll[\s\S]{0,600}testAiChatConnection/);
});
