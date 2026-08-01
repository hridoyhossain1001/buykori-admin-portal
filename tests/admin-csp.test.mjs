import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("admin markup and runtime templates contain no inline event handlers", async () => {
  const sources = `${await read("index.html")}\n${await read("app.js")}`;
  assert.doesNotMatch(sources, /\son(?:click|change|input|submit)\s*=/i);
  assert.match(sources, /data-admin-click=/);
  assert.match(sources, /const ADMIN_ACTION_NAMES = new Set/);
  assert.doesNotMatch(sources, /\beval\s*\(|\bnew Function\s*\(/);
});

test("production CSP blocks script attributes and is enforced", async () => {
  const config = JSON.parse(await read("vercel.json"));
  const headers = config.headers.flatMap(rule => rule.headers || []);
  const csp = headers.find(header => header.key === "Content-Security-Policy");
  assert.ok(csp, "enforced CSP header is required");
  assert.match(csp.value, /script-src-attr 'none'/);
  assert.doesNotMatch(csp.value, /script-src-attr 'unsafe-inline'/);
  assert.equal(
    headers.some(header => header.key === "Content-Security-Policy-Report-Only"),
    false
  );
});

test("dashboard uses named actions instead of expression attributes", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const dashboardStart = indexHtml.indexOf('<section id="dashboard"');
  const dashboardEnd = indexHtml.indexOf('<section id="courierQueue"', dashboardStart);
  const dashboardMarkup = indexHtml.slice(dashboardStart, dashboardEnd);

  assert.ok(
    dashboardStart >= 0 && dashboardEnd > dashboardStart,
    "dashboard section must be present"
  );
  assert.doesNotMatch(dashboardMarkup, /data-admin-(?:click|change|input|submit)=/);
  assert.match(dashboardMarkup, /data-action="dashboard:set-window"/);
  assert.match(dashboardMarkup, /data-action="dashboard:download-report"/);
  assert.match(dashboardMarkup, /data-action="dashboard:open-tab"/);

  for (const functionName of [
    "renderCourierQueueBanner",
    "renderIntegrationRows",
    "renderAlerts",
  ]) {
    const start = appJs.indexOf(`function ${functionName}`);
    const end = appJs.indexOf("\nfunction ", start + 1);
    const source = appJs.slice(start, end);
    assert.ok(start >= 0 && end > start, `${functionName} must be present`);
    assert.doesNotMatch(source, /data-admin-(?:click|change|input|submit)=/);
    assert.match(source, /data-action="dashboard:/);
  }
});
