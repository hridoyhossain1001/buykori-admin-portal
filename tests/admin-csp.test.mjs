import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("admin markup and runtime templates contain no inline event handlers", async () => {
  const sources = `${await read("index.html")}\n${await read("app.js")}`;
  assert.doesNotMatch(sources, /\son(?:click|change|input|submit)\s*=/i);
  assert.doesNotMatch(sources, /\.on(?:click|change|input|submit)\s*=/i);
  assert.doesNotMatch(sources, /getAttribute\(["']on(?:click|change|input|submit)["']\)/i);
  assert.doesNotMatch(sources, /data-admin-(?:click|change|input|submit)=/);
  assert.doesNotMatch(sources, /ADMIN_ACTION_NAMES|runAdminAction|parseAdminActionValue/);
  assert.match(sources, /const ADMIN_ACTIONS = Object\.freeze/);
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
    const start = appJs.indexOf(`function ${functionName}(`);
    const end = appJs.indexOf("\nfunction ", start + 1);
    const source = appJs.slice(start, end);
    assert.ok(start >= 0 && end > start, `${functionName} must be present`);
    assert.doesNotMatch(source, /data-admin-(?:click|change|input|submit)=/);
    assert.match(source, /(?:data-action="dashboard:|dataset\.action = "dashboard:)/);
  }
});

test("courier queue and drawer use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const sectionStart = indexHtml.indexOf('<section id="courierQueue"');
  const sectionEnd = indexHtml.indexOf('<section id="recoveryOps"', sectionStart);
  const drawerStart = indexHtml.indexOf('<div id="queueDrawerOverlay"');
  const drawerEnd = indexHtml.indexOf('<div id="notificationDrawerOverlay"', drawerStart);
  const markup = `${indexHtml.slice(sectionStart, sectionEnd)}\n${indexHtml.slice(drawerStart, drawerEnd)}`;

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "courier section must be present");
  assert.ok(drawerStart >= 0 && drawerEnd > drawerStart, "courier drawer must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.match(markup, /data-action="courier:toggle-auto-refresh"/);
  assert.match(markup, /data-action="courier:refresh"/);
  assert.match(markup, /data-action="courier:close-drawer"/);
  assert.match(markup, /data-action="courier:retry-job"/);

  for (const functionName of ["renderCourierQueue", "renderCourierJobDrawer"]) {
    const start = appJs.indexOf(`function ${functionName}(`);
    const end = appJs.indexOf("\nfunction ", start + 1);
    const source = appJs.slice(start, end);
    assert.ok(start >= 0 && end > start, `${functionName} must be present`);
    assert.doesNotMatch(source, /data-admin-(?:click|change|input|submit)=/);
    assert.doesNotMatch(source, /\.onclick\s*=/);
    assert.match(source, /data-action="courier:|dataset\.jobId/);
  }
});

test("clients directory uses named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const sectionStart = indexHtml.indexOf('<section id="clients"');
  const sectionEnd = indexHtml.indexOf('<section id="siteBindings"', sectionStart);
  const markup = indexHtml.slice(sectionStart, sectionEnd);
  const renderStart = appJs.indexOf("function renderClientRows(");
  const renderEnd = appJs.indexOf("\nfunction ", renderStart + 1);
  const renderSource = appJs.slice(renderStart, renderEnd);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "clients section must be present");
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderClientRows must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.doesNotMatch(renderSource, /data-admin-(?:click|change|input|submit)=/);
  assert.doesNotMatch(renderSource, /\.innerHTML\s*=/);
  assert.match(markup, /data-action="clients:open-create"/);
  assert.match(renderSource, /dataset\.action = "clients:open-client"/);
  assert.match(renderSource, /dataset\.action = "clients:toggle-active"/);
  assert.match(renderSource, /\.textContent\s*=/);
  assert.match(renderSource, /replaceChildren\(/);
});

test("client creation uses a named submit action", async () => {
  const indexHtml = await read("index.html");
  const sectionStart = indexHtml.indexOf('<section id="create"');
  const sectionEnd = indexHtml.indexOf("</main>", sectionStart);
  const markup = indexHtml.slice(sectionStart, sectionEnd);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "create section must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.match(markup, /<form[^>]+data-action="clients:create"/);
  assert.match(markup, /id="newName"[^>]+required/);
  assert.match(markup, /id="newDomain"[^>]+required/);
  assert.match(markup, /id="createClientSubmit"[^>]+type="submit"/);
});

test("client modal navigation, close and save controls use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const modalStart = indexHtml.indexOf('<div id="modalOverlay"');
  const modalEnd = indexHtml.indexOf('<div id="adminDecisionOverlay"', modalStart);
  const markup = indexHtml.slice(modalStart, modalEnd);
  const intelStart = appJs.indexOf("function renderClientModalIntel(");
  const intelEnd = appJs.indexOf("\nfunction ", intelStart + 1);
  const intelSource = appJs.slice(intelStart, intelEnd);

  assert.ok(modalStart >= 0 && modalEnd > modalStart, "client modal must be present");
  assert.ok(intelStart >= 0 && intelEnd > intelStart, "renderClientModalIntel must be present");
  assert.doesNotMatch(
    markup,
    /data-admin-click="(?:if\(event\.target===this\) closeClientModal\(\)|closeClientModal\(\)|switchModalTab\(|saveClientEdit\()/
  );
  assert.equal((markup.match(/data-action="client-modal:switch-tab"/g) || []).length, 5);
  assert.equal((markup.match(/data-action="client-modal:close"/g) || []).length, 2);
  assert.equal((markup.match(/data-action="client-modal:save"/g) || []).length, 1);
  assert.match(markup, /id="modalOverlay"[^>]+data-self-only="true"/);
  assert.doesNotMatch(intelSource, /data-admin-click="switchModalTab\(/);
  assert.match(intelSource, /data-action="client-modal:switch-tab"[^>]+data-modal-tab="intel"/);
});

test("client modal key controls use named actions", async () => {
  const indexHtml = await read("index.html");
  const keysStart = indexHtml.indexOf('<div id="tab-keys"');
  const keysEnd = indexHtml.indexOf('<div id="tab-instructions"', keysStart);
  const markup = indexHtml.slice(keysStart, keysEnd);

  assert.ok(keysStart >= 0 && keysEnd > keysStart, "client keys tab must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="client-modal:reveal-secret"/g) || []).length, 3);
  assert.equal((markup.match(/data-action="client-modal:copy"/g) || []).length, 3);
  assert.equal((markup.match(/data-action="client-modal:rotate-key"/g) || []).length, 2);
  assert.match(markup, /data-key-type="api_key"/);
  assert.match(markup, /data-key-type="portal_key"/);
});

test("client modal support note control uses a named action", async () => {
  const indexHtml = await read("index.html");
  const intelStart = indexHtml.indexOf('<div id="tab-intel"');
  const intelEnd = indexHtml.indexOf('<div id="tab-danger"', intelStart);
  const markup = indexHtml.slice(intelStart, intelEnd);

  assert.ok(intelStart >= 0 && intelEnd > intelStart, "client intel tab must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="client-modal:add-note"/g) || []).length, 1);
  assert.match(markup, /id="supportNoteInput"/);
});

test("client modal is fully migrated from expression actions", async () => {
  const indexHtml = await read("index.html");
  const modalStart = indexHtml.indexOf('<div id="modalOverlay"');
  const modalEnd = indexHtml.indexOf('<div id="adminDecisionOverlay"', modalStart);
  const markup = indexHtml.slice(modalStart, modalEnd);

  assert.ok(modalStart >= 0 && modalEnd > modalStart, "client modal must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="client-modal:copy"/g) || []).length, 6);
  assert.equal((markup.match(/data-action="client-modal:delete"/g) || []).length, 1);
});

test("admin decision modal uses named actions", async () => {
  const indexHtml = await read("index.html");
  const decisionStart = indexHtml.indexOf('<div id="adminDecisionOverlay"');
  const decisionEnd = indexHtml.indexOf('<div id="queueDrawerOverlay"', decisionStart);
  const markup = indexHtml.slice(decisionStart, decisionEnd);

  assert.ok(
    decisionStart >= 0 && decisionEnd > decisionStart,
    "admin decision modal must be present"
  );
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="admin-decision:close"/g) || []).length, 3);
  assert.equal((markup.match(/data-action="admin-decision:confirm"/g) || []).length, 1);
  assert.match(markup, /id="adminDecisionOverlay"[^>]+data-self-only="true"/);
});

test("shared admin shell uses named actions", async () => {
  const indexHtml = await read("index.html");
  const shellStart = indexHtml.indexOf('<button class="hamburger"');
  const shellEnd = indexHtml.indexOf("<main", shellStart);
  const markup = indexHtml.slice(shellStart, shellEnd);

  assert.ok(shellStart >= 0 && shellEnd > shellStart, "admin shell must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="shell:toggle-sidebar"/g) || []).length, 2);
  for (const action of ["refresh", "logout", "search", "toggle-theme"]) {
    assert.match(markup, new RegExp(`data-action="shell:${action}"`));
  }
});

test("recovery and client lookup sections use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const recoveryStart = indexHtml.indexOf('<section id="recoveryOps"');
  const recoveryEnd = indexHtml.indexOf('<section id="notificationOps"', recoveryStart);
  const recoveryMarkup = indexHtml.slice(recoveryStart, recoveryEnd);

  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "recovery section must be present");
  assert.doesNotMatch(recoveryMarkup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((recoveryMarkup.match(/data-action="recovery:filter"/g) || []).length, 2);
  assert.match(recoveryMarkup, /data-action="recovery:refresh"/);
  assert.doesNotMatch(appJs, /data-admin-click="(?:updateRecoveryStatus|openClientModal)\(/);
  assert.match(appJs, /data-action="recovery:update-status"/);
  assert.equal((indexHtml.match(/data-action="client-lookup:refresh"/g) || []).length, 2);
  assert.equal((appJs.match(/data-action="client-lookup:open"/g) || []).length, 3);
});

test("notification, payment, support and WhatsApp controls use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const sectionStart = indexHtml.indexOf('<section id="notificationOps"');
  const sectionEnd = indexHtml.indexOf('<section id="siteBindings"', sectionStart);
  const drawerStart = indexHtml.indexOf('<div id="notificationDrawerOverlay"');
  const sectionMarkup = indexHtml.slice(sectionStart, sectionEnd);
  const drawerMarkup = indexHtml.slice(drawerStart);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "notification section must be present");
  assert.ok(drawerStart >= 0, "notification drawer must be present");
  assert.doesNotMatch(sectionMarkup, /data-admin-(?:click|change|input|submit)=/);
  assert.doesNotMatch(drawerMarkup, /data-admin-(?:click|change|input|submit)=/);
  assert.doesNotMatch(
    appJs,
    /data-admin-click="(?:decideSmsPayment|updateSupportTicket|openNotificationJobDrawer|retryNotificationJob|(?:connect|delete|edit|logout|update)WhatsAppInstance)/
  );
  assert.equal((sectionMarkup.match(/data-action="notification:set-tab"/g) || []).length, 3);
  assert.equal((drawerMarkup.match(/data-action="notification:close-drawer"/g) || []).length, 3);
  for (const action of ["decide-payment", "update-support", "open-job", "retry-job"]) {
    assert.match(appJs, new RegExp(`data-action="notification:${action}"`));
  }
  for (const action of [
    "save-capacity",
    "edit",
    "connect",
    "check-state",
    "update-status",
    "logout",
    "delete",
  ]) {
    assert.match(appJs, new RegExp(`data-action="whatsapp:${action}"`));
  }
});

test("site binding controls use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const sectionStart = indexHtml.indexOf('<section id="siteBindings"');
  const sectionEnd = indexHtml.indexOf('<section id="events"', sectionStart);
  const markup = indexHtml.slice(sectionStart, sectionEnd);

  assert.ok(
    sectionStart >= 0 && sectionEnd > sectionStart,
    "site bindings section must be present"
  );
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.equal((markup.match(/data-action="site-bindings:filter"/g) || []).length, 2);
  assert.match(markup, /data-action="site-bindings:refresh"/);
  assert.match(markup, /data-action="site-bindings:transfer"/);
  assert.doesNotMatch(
    appJs,
    /data-admin-click="(?:prepareSiteBindingTransfer|releaseSiteBinding)\(/
  );
  assert.match(appJs, /data-action="site-bindings:prepare-transfer"/);
  assert.match(appJs, /data-action="site-bindings:release"/);
});

test("event explorer controls and rows use named actions", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const sectionStart = indexHtml.indexOf('<section id="events"');
  const sectionEnd = indexHtml.indexOf('<section id="clientIntel"', sectionStart);
  const markup = indexHtml.slice(sectionStart, sectionEnd);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "events section must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.match(markup, /data-action="events:search"/);
  assert.equal((markup.match(/data-action="events:filter"/g) || []).length, 3);
  assert.equal((markup.match(/data-action="events:change-page"/g) || []).length, 2);
  assert.match(markup, /data-action="events:refresh"/);
  assert.doesNotMatch(appJs, /data-admin-click="toggleEventDetail\(/);
  assert.match(appJs, /data-action="events:toggle-detail"[^>]+data-event-id=/);
});

test("team controls use named actions and the app runs as a module", async () => {
  const indexHtml = await read("index.html");
  const appJs = await read("app.js");
  const eslintConfig = await read("eslint.config.mjs");
  const sectionStart = indexHtml.indexOf('<section id="team"');
  const sectionEnd = indexHtml.indexOf('<div id="modalOverlay"', sectionStart);
  const markup = indexHtml.slice(sectionStart, sectionEnd);

  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "team section must be present");
  assert.doesNotMatch(markup, /data-admin-(?:click|change|input|submit)=/);
  assert.match(markup, /data-action="team:refresh"/);
  assert.match(markup, /<form[^>]+data-action="team:create"/);
  assert.doesNotMatch(appJs, /data-admin-click="updateAdminUserAccess\(/);
  assert.equal((appJs.match(/dataset\.action = "team:update-(?:role|active)"/g) || []).length, 2);
  assert.match(indexHtml, /<script type="module" src="app\.js\?v=20260817\.1"><\/script>/);
  assert.match(eslintConfig, /sourceType: "module"/);
});

test("team rows render API data with DOM text APIs", async () => {
  const appJs = await read("app.js");
  const renderStart = appJs.indexOf("function renderAdminUsers()");
  const renderEnd = appJs.indexOf("\nasync function createAdminUser", renderStart);
  const source = appJs.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderAdminUsers must be present");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /replaceChildren\(/);
});

test("courier health banner renders with DOM text APIs", async () => {
  const appJs = await read("app.js");
  const renderStart = appJs.indexOf("function renderCourierQueueBanner(");
  const renderEnd = appJs.indexOf("\nfunction renderCourierQueueRefreshMeta", renderStart);
  const source = appJs.slice(renderStart, renderEnd);

  assert.ok(
    renderStart >= 0 && renderEnd > renderStart,
    "renderCourierQueueBanner must be present"
  );
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /replaceChildren\(/);
  assert.match(source, /dataset\.action = "dashboard:open-tab"/);
});

test("integration table renders API data with DOM text APIs", async () => {
  const appJs = await read("app.js");
  const renderStart = appJs.indexOf("function renderIntegrationRows()");
  const renderEnd = appJs.indexOf("\nfunction renderClientRows", renderStart);
  const source = appJs.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderIntegrationRows must be present");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /replaceChildren\(/);
  assert.match(source, /dataset\.action = "dashboard:open-client"/);
});

test("payment history rows and pager render with DOM text APIs", async () => {
  const appJs = await read("app.js");
  const renderStart = appJs.indexOf("function renderPaymentHistory()");
  const renderEnd = appJs.indexOf("\nfunction setPaymentHistoryFilter", renderStart);
  const source = appJs.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderPaymentHistory must be present");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /replaceChildren\(/);
  assert.equal(
    (source.match(/dataset\.action = "notification:change-payment-page"/g) || []).length,
    2
  );
});
