import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("admin bootstrap only treats the session endpoint as authoritative", () => {
  assert.match(source, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /async function bootstrapAdminPortal\(\)/);
  assert.match(source, /const stillAuthenticated = await restoreAdminSession\(\)/);
  assert.doesNotMatch(source, /\.catch\(showLogin\)/);
});
