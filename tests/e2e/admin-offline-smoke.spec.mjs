import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.buykori.app";
const NAV_TABS = [
  "dashboard",
  "clients",
  "siteBindings",
  "clientIntel",
  "events",
  "courierQueue",
  "recoveryOps",
  "notificationOps",
  "payments",
  "opsMonitor",
  "integrations",
  "logs",
  "health",
  "team",
];

const fixtures = new Map([
  [
    "/api/v1/admin/api/session",
    {
      csrf_token: "offline-smoke-csrf",
      user: {
        username: "offline-owner",
        displayName: "Offline Owner",
        role: "owner",
      },
    },
  ],
  [
    "/api/v1/admin/api/summary",
    {
      total_clients: 0,
      active_clients: 0,
      total_events: 0,
      failed_events: 0,
      client_events: {},
      recent_activity: [],
      integrations: [],
      courier_booking_queue: {},
      window_started_at: null,
      window_ended_at: null,
    },
  ],
  ["/api/v1/admin/api/clients", { clients: [] }],
  ["/api/v1/admin/clients/health", { clients: [] }],
  [
    "/api/v1/admin/api/courier-booking-queue",
    {
      counts: {
        alert_status: "critical",
        queued: 0,
        processing: 0,
        dead: 1,
        sent: 0,
        oldest_queued_age_seconds: 0,
        oldest_processing_age_seconds: 0,
        alerts: [{ severity: "critical", code: "dead_letter_jobs", count: 1 }],
      },
      jobs: [
        {
          id: 42,
          client_id: 7,
          order_id: "OFFLINE-ORDER-42",
          courier_order_id: 420,
          provider: "steadfast",
          status: "dead",
          attempts: 3,
          max_attempts: 3,
          created_at: "2026-08-01T08:00:00Z",
          next_attempt_at: null,
          locked_at: null,
          locked_by: null,
          sent_at: null,
          last_error: "Offline fixture provider failure",
        },
      ],
    },
  ],
  ["/api/v1/admin/api/client-intelligence", { clients: [], trial_followups: [] }],
  ["/api/v1/admin/api/server-health", {}],
  ["/api/v1/admin/api/site-bindings", { bindings: [] }],
  ["/api/v1/admin/api/incomplete-checkouts", { counts: {}, items: [], top_clients: [], total: 0 }],
  ["/api/v1/admin/notification-jobs", { total: 0, items: [] }],
  ["/api/v1/admin/whatsapp-instances", []],
  ["/api/v1/admin/api/support-tickets", { tickets: [], openCount: 0 }],
  ["/api/v1/admin/api/payment-reviews", { payments: [] }],
  ["/api/v1/admin/api/events", { events: [], totalCount: 0 }],
  ["/api/v1/admin/api/admin-users", { users: [] }],
]);

test("owner can navigate the admin shell with the production API offline", async ({ page }) => {
  const browserErrors = [];
  const unexpectedApiCalls = [];
  const summaryWindows = [];
  let courierQueueRequests = 0;

  page.on("pageerror", error => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });

  await page.route(`${API_ORIGIN}/**`, async route => {
    const requestUrl = new URL(route.request().url());
    const fixture = fixtures.get(requestUrl.pathname);

    if (requestUrl.pathname === "/api/v1/admin/api/summary") {
      summaryWindows.push(requestUrl.searchParams.get("window"));
    }
    if (requestUrl.pathname === "/api/v1/admin/api/courier-booking-queue") {
      courierQueueRequests += 1;
    }

    if (fixture === undefined) {
      unexpectedApiCalls.push(
        `${route.request().method()} ${requestUrl.pathname}${requestUrl.search}`
      );
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "No offline smoke fixture" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "http://127.0.0.1:5050",
        "access-control-allow-credentials": "true",
      },
      body: JSON.stringify(fixture),
    });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toHaveClass(/ready/);
  await expect(page.locator("#login")).toBeHidden();
  await expect(page.locator("#teamNavGroup")).toBeVisible();

  const renderedTabs = await page
    .locator(".nav-item[data-tab]")
    .evaluateAll(nodes => nodes.map(node => node.dataset.tab));
  expect(renderedTabs).toEqual(NAV_TABS);

  for (const tab of NAV_TABS) {
    const navButton = page.locator(`.nav-item[data-tab="${tab}"]`);
    await navButton.click();
    await expect(navButton).toHaveClass(/active/);
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
  }

  await page.locator('.nav-item[data-tab="courierQueue"]').click();
  await expect(
    page.locator(
      "#courierQueue [data-admin-click], #courierQueue [data-admin-change], #queueDrawerOverlay[data-admin-click], #queueDrawerOverlay [data-admin-click]"
    )
  ).toHaveCount(0);

  const requestsBeforeRefresh = courierQueueRequests;
  await page.locator('#courierQueue .header-actions [data-action="courier:refresh"]').click();
  await expect.poll(() => courierQueueRequests).toBeGreaterThan(requestsBeforeRefresh);

  const autoRefreshToggle = page.locator("#courierQueueAutoRefreshToggle");
  await autoRefreshToggle.click();
  await expect(autoRefreshToggle).toHaveText("Auto Refresh Off");

  await page.locator('#courierQueueRows [data-action="courier:open-job"]').click();
  await expect(page.locator("#queueDrawerOverlay")).toBeVisible();
  await expect(page.locator("#queueDrawerTitle")).toHaveText("Courier Job #42");
  await page
    .locator('#queueDrawerOverlay .modal-close[data-action="courier:close-drawer"]')
    .click();
  await expect(page.locator("#queueDrawerOverlay")).toBeHidden();

  await page.locator('#courierQueueRows [data-action="courier:retry-job"]').click();
  await expect(page.locator("#adminDecisionOverlay")).toBeVisible();
  await page.locator("#adminDecisionCancel").click();
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();

  const themeToggle = page.locator("#themeToggle");
  const wasDark = await page
    .locator("html")
    .evaluate(element => element.classList.contains("dark"));
  await themeToggle.click();
  await expect
    .poll(() => page.locator("html").evaluate(element => element.classList.contains("dark")))
    .toBe(!wasDark);

  await page.locator('.nav-item[data-tab="clients"]').click();
  await page.locator("[data-admin-click=\"setTab('create')\"]").click();
  await expect(page.locator("#create")).toHaveClass(/active/);

  await page.locator('.nav-item[data-tab="dashboard"]').click();
  await expect(
    page.locator("#dashboard [data-admin-click], #dashboard [data-admin-change]")
  ).toHaveCount(0);
  await page.locator('[data-action="dashboard:open-tab"][data-tab-target="clients"]').click();
  await expect(page.locator("#clients")).toHaveClass(/active/);

  await page.locator('.nav-item[data-tab="dashboard"]').click();
  const dashboardWindow = page.locator("#dashboardWindow");
  await dashboardWindow.selectOption("7d");
  await expect(dashboardWindow).toHaveValue("7d");
  await expect(dashboardWindow).toBeEnabled();
  expect(summaryWindows).toContain("7d");

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="dashboard:download-report"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("buykori-admin-7d-report.csv");

  expect(unexpectedApiCalls).toEqual([]);
  expect(browserErrors).toEqual([]);
});
