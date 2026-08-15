import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("admin bootstrap only treats the session endpoint as authoritative", () => {
  assert.match(source, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /async function bootstrapAdminPortal\(\)/);
  assert.match(source, /const stillAuthenticated = await restoreAdminSession\(\)/);
  assert.doesNotMatch(source, /\.catch\(showLogin\)/);
});

test("admin login stays hidden until session restoration finishes", () => {
  assert.match(markup, /id="authBootstrap"/);
  assert.match(markup, /id="login" class="login" style="display:none"/);
  assert.match(source, /function hideAuthBootstrap\(\)/);
  assert.match(source, /function showApp\(\) \{\s+hideAuthBootstrap\(\)/);
  assert.match(source, /function showLogin\(\) \{\s+hideAuthBootstrap\(\)/);
});
