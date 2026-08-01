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

const OFFLINE_CLIENT = {
  id: 7,
  name: "Offline Fixture Client",
  domain: "offline-fixture.example",
  display_domain: "offline-fixture.example",
  pixel_id: "fixture-pixel-7",
  is_active: true,
  plan_tier: "free",
  billing_status: "free",
  monthly_limit: 1_000,
  orders_quota: 100,
  orders_used: 0,
  event_total: 0,
  created_at: "2026-08-01T07:00:00Z",
  enable_facebook: false,
  enable_tiktok: false,
  enable_ga4: false,
};

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
  ["/api/v1/admin/api/clients", { clients: [OFFLINE_CLIENT] }],
  ["/api/v1/admin/clients/health", { clients: [] }],
  ["/api/v1/admin/api/clients/7", { client: OFFLINE_CLIENT }],
  ["/api/v1/admin/api/clients/7/support-notes", { notes: [] }],
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
  const clientPatches = [];
  const clientCreates = [];
  const keyRotations = [];

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:5050",
  });

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
    if (
      requestUrl.pathname === "/api/v1/admin/api/clients/7" &&
      route.request().method() === "PATCH"
    ) {
      const payload = route.request().postDataJSON();
      clientPatches.push(payload);
      if (payload.name === "Rejected Edit") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "http://127.0.0.1:5050",
            "access-control-allow-credentials": "true",
          },
          body: JSON.stringify({ detail: "Offline edit rejection" }),
        });
        return;
      }
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/clients/7/keys/rotate" &&
      route.request().method() === "POST"
    ) {
      const payload = route.request().postDataJSON();
      keyRotations.push(payload);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:5050",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ new_value: `rotated-offline-${payload.key_type}` }),
      });
      return;
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/clients" &&
      route.request().method() === "POST"
    ) {
      const payload = route.request().postDataJSON();
      clientCreates.push(payload);
      if (payload.name === "Rejected Client") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "http://127.0.0.1:5050",
            "access-control-allow-credentials": "true",
          },
          body: JSON.stringify({ detail: "Offline fixture rejection" }),
        });
        return;
      }
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

  await page.locator('.nav-item[data-tab="clients"]').click();
  await expect(
    page.locator("#clients [data-admin-click], #clients [data-admin-change]")
  ).toHaveCount(0);
  await page.locator('[data-action="clients:open-create"]').click();
  await expect(page.locator("#create")).toHaveClass(/active/);

  await page.locator('.nav-item[data-tab="clients"]').click();
  await page.locator('#clientRows [data-action="clients:open-client"]').click();
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await expect(page.locator("#editName")).toHaveValue("Offline Fixture Client");
  await expect(
    page.locator(
      '#modalOverlay [data-admin-click*="switchModalTab"], #modalOverlay [data-admin-click*="closeClientModal"], #modalOverlay [data-admin-click*="saveClientEdit"]'
    )
  ).toHaveCount(0);
  await page.locator("#editName").fill("Updated Offline Client");
  await page.locator("#editDomain").fill("updated-offline.example");
  await page.locator('[data-action="client-modal:save"]').click();
  await expect(page.locator("#editMsg")).toHaveText("Saved successfully!");
  await expect.poll(() => clientPatches.length).toBe(1);
  expect(clientPatches[0]).toEqual(
    expect.objectContaining({
      name: "Updated Offline Client",
      domain: "updated-offline.example",
      is_active: true,
      plan_tier: "free",
      billing_status: "free",
    })
  );

  await page.locator("#editName").fill("Rejected Edit");
  await page.locator('[data-action="client-modal:save"]').click();
  await expect(page.locator("#editMsg")).toHaveText("Offline edit rejection");
  await expect.poll(() => clientPatches.length).toBe(2);
  await expect.poll(() => browserErrors.length).toBe(1);
  expect(browserErrors).toEqual([
    "console: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
  browserErrors.length = 0;

  const keysTab = page.locator(
    '#modalOverlay [data-action="client-modal:switch-tab"][data-modal-tab="keys"]'
  );
  await keysTab.click();
  await expect(page.locator("#tab-keys [data-admin-click]")).toHaveCount(0);
  await page
    .locator('#tab-keys [data-action="client-modal:reveal-secret"][data-target-id="keyApi"]')
    .click();
  await expect(page.locator("#keyApi")).toHaveText("Rotate to view a new value");
  await expect(page.locator("#bk-toast")).toHaveText(
    "Existing secrets are not loaded into the browser. Rotate to reveal a new value once."
  );
  await page
    .locator('#tab-keys [data-action="client-modal:copy"][data-target-id="keyApi"]')
    .click();
  await expect(page.locator("#bk-toast")).toHaveText(
    "Rotate this key to generate a new revealable value."
  );

  await page
    .locator('#tab-keys [data-action="client-modal:rotate-key"][data-key-type="api_key"]')
    .click();
  await expect(page.locator("#adminDecisionOverlay")).toBeVisible();
  await expect(page.locator("#adminDecisionTitle")).toHaveText("Rotate Key");
  await page.locator("#adminDecisionConfirm").click();
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();
  await expect.poll(() => keyRotations.length).toBe(1);
  expect(keyRotations[0]).toEqual({ key_type: "api_key" });
  await page
    .locator('#tab-keys [data-action="client-modal:reveal-secret"][data-target-id="keyApi"]')
    .click();
  await expect(page.locator("#keyApi")).toHaveText("rotated-offline-api_key");
  await page
    .locator('#tab-keys [data-action="client-modal:copy"][data-target-id="keyApi"]')
    .click();
  await expect(page.locator("#bk-toast")).toHaveText("Copied to Clipboard!");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("rotated-offline-api_key");

  await page
    .locator('#tab-keys [data-action="client-modal:rotate-key"][data-key-type="portal_key"]')
    .click();
  await page.locator("#adminDecisionConfirm").click();
  await expect.poll(() => keyRotations.length).toBe(2);
  expect(keyRotations[1]).toEqual({ key_type: "portal_key" });
  await page
    .locator('#tab-keys [data-action="client-modal:reveal-secret"][data-target-id="keyPortal"]')
    .click();
  await expect(page.locator("#keyPortal")).toHaveText("rotated-offline-portal_key");

  for (const tab of ["keys", "instructions", "intel", "danger", "edit"]) {
    const tabButton = page.locator(
      `#modalOverlay [data-action="client-modal:switch-tab"][data-modal-tab="${tab}"]`
    );
    await tabButton.click();
    await expect(tabButton).toHaveClass(/active/);
    await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
  }
  await page.locator("#modalOverlay .modal").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await page.locator("#modalOverlay").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#modalOverlay")).toBeHidden();

  await page.locator('#clientRows [data-action="clients:open-client"]').click();
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await page.locator('#modalOverlay .modal-close[data-action="client-modal:close"]').click();
  await expect(page.locator("#modalOverlay")).toBeHidden();

  await page.locator('#clientRows [data-action="clients:toggle-active"]').click();
  await expect.poll(() => clientPatches.length).toBe(3);
  expect(clientPatches[2]).toEqual({ is_active: false });

  await page.locator('[data-action="clients:open-create"]').click();
  const createSubmit = page.locator("#createClientSubmit");
  await createSubmit.click();
  expect(clientCreates).toEqual([]);
  expect(
    await page.locator("#newName").evaluate(element => element.validationMessage.length > 0)
  ).toBe(true);

  await page.locator("#newName").fill("  Created Offline Client  ");
  await page.locator("#newDomain").fill("  created-offline.example  ");
  await page.locator("#newPixel").fill("pixel-created");
  await page.locator("#newToken").fill("secret-created");
  await page.locator("#newTiktokPixel").fill("tiktok-created");
  await page.locator("#newGa4").fill("G-CREATED");
  await createSubmit.click();
  await expect.poll(() => clientCreates.length).toBe(1);
  expect(clientCreates[0]).toEqual({
    name: "Created Offline Client",
    domain: "created-offline.example",
    pixel_id: "pixel-created",
    access_token: "secret-created",
    tiktok_pixel_id: "tiktok-created",
    ga4_measurement_id: "G-CREATED",
  });
  await expect(page.locator("#clients")).toHaveClass(/active/);
  await expect(page.locator("#newToken")).toHaveValue("");

  await page.locator('[data-action="clients:open-create"]').click();
  await page.locator("#newName").fill("Rejected Client");
  await page.locator("#newDomain").fill("rejected.example");
  await createSubmit.click();
  await expect.poll(() => clientCreates.length).toBe(2);
  await expect(page.locator("#create")).toHaveClass(/active/);
  await expect(page.locator("#createMsg")).toContainText("Offline fixture rejection");
  await expect(createSubmit).toBeEnabled();
  const expectedRejectionIndex = browserErrors.findIndex(message =>
    message.includes("422 (Unprocessable Entity)")
  );
  expect(expectedRejectionIndex).toBeGreaterThanOrEqual(0);
  browserErrors.splice(expectedRejectionIndex, 1);

  const themeToggle = page.locator("#themeToggle");
  const wasDark = await page
    .locator("html")
    .evaluate(element => element.classList.contains("dark"));
  await themeToggle.click();
  await expect
    .poll(() => page.locator("html").evaluate(element => element.classList.contains("dark")))
    .toBe(!wasDark);

  await page.locator('.nav-item[data-tab="clients"]').click();
  await page.locator('[data-action="clients:open-create"]').click();
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
