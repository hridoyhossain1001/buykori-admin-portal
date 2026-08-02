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
  name: '<img src=x onerror="alert(2)">Offline Fixture Client',
  domain: "offline-fixture.example",
  display_domain: "offline-fixture.example",
  pixel_id: "<script data-xss>window.__xss=true</script>",
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
  [
    "/api/v1/admin/api/incomplete-checkouts",
    {
      counts: { incomplete: 1, contacted: 0, recovered: 0 },
      items: [
        {
          id: 91,
          client_id: 7,
          client_name: "Offline Fixture Client",
          customer_name: "Recovery Fixture",
          phone_masked: "01*******00",
          product_summary: "Fixture product",
          product_count: 1,
          amount: 500,
          currency: "BDT",
          status: "incomplete",
          order_id: null,
          last_activity_at: "2026-08-01T08:30:00Z",
        },
      ],
      top_clients: [{ client_name: "Offline Fixture Client", count: 1 }],
      total: 1,
    },
  ],
  [
    "/api/v1/admin/notification-jobs",
    {
      total: 1,
      items: [
        {
          id: 73,
          client_id: 7,
          channel: "whatsapp",
          whatsapp_instance_id: 4,
          event_type: "order_created",
          status: "sent",
          attempt_count: 1,
          max_attempts: 3,
          failover_count: 0,
          created_at: "2026-08-01T08:45:00Z",
          sent_at: "2026-08-01T08:46:00Z",
          message_preview: "Offline notification fixture",
          delivery_transitions: [],
        },
      ],
    },
  ],
  ["/api/v1/admin/whatsapp-instances", []],
  ["/api/v1/admin/api/support-tickets", { tickets: [], openCount: 0 }],
  ["/api/v1/admin/api/payment-reviews", { payments: [] }],
  ["/api/v1/admin/api/events", { events: [], totalCount: 0 }],
  [
    "/api/v1/admin/api/admin-users",
    {
      users: [
        {
          id: "owner-1",
          username: "offline-owner",
          displayName: '<img src=x onerror="alert(1)">Offline Owner',
          role: "owner",
          isActive: true,
          lastLoginAt: "2026-08-01T08:00:00Z",
        },
      ],
    },
  ],
]);

test("owner can navigate the admin shell with the production API offline", async ({ page }) => {
  const browserErrors = [];
  const unexpectedApiCalls = [];
  const summaryWindows = [];
  const summaryRefreshes = [];
  let courierQueueRequests = 0;
  let recoveryRequests = 0;
  let siteBindingRequests = 0;
  let eventRequests = 0;
  let adminUserRequests = 0;
  const adminUserCreates = [];
  const adminUserPatches = [];
  const recoveryPatches = [];
  const clientPatches = [];
  const clientCreates = [];
  const keyRotations = [];
  const supportNotePosts = [];
  let supportNotes = [];
  let deleteAttempts = 0;

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
      summaryRefreshes.push(requestUrl.searchParams.get("refresh"));
    }
    if (requestUrl.pathname === "/api/v1/admin/api/courier-booking-queue") {
      courierQueueRequests += 1;
    }
    if (requestUrl.pathname === "/api/v1/admin/api/incomplete-checkouts") {
      recoveryRequests += 1;
    }
    if (requestUrl.pathname === "/api/v1/admin/api/site-bindings") {
      siteBindingRequests += 1;
    }
    if (requestUrl.pathname === "/api/v1/admin/api/events") {
      eventRequests += 1;
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/admin-users" &&
      route.request().method() === "GET"
    ) {
      adminUserRequests += 1;
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/admin-users" &&
      route.request().method() === "POST"
    ) {
      adminUserCreates.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:5050",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/admin-users/owner-1" &&
      route.request().method() === "PATCH"
    ) {
      adminUserPatches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:5050",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    if (
      requestUrl.pathname === "/api/v1/admin/api/incomplete-checkouts/91" &&
      route.request().method() === "PATCH"
    ) {
      recoveryPatches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:5050",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ success: true }),
      });
      return;
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
      requestUrl.pathname === "/api/v1/admin/api/clients/7" &&
      route.request().method() === "DELETE"
    ) {
      deleteAttempts += 1;
      if (deleteAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "http://127.0.0.1:5050",
            "access-control-allow-credentials": "true",
          },
          body: JSON.stringify({ detail: "Offline delete rejection" }),
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
        body: JSON.stringify({ success: true }),
      });
      return;
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
    if (requestUrl.pathname === "/api/v1/admin/api/clients/7/support-notes") {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        supportNotePosts.push(payload);
        if (payload.note === "Rejected note") {
          await route.fulfill({
            status: 422,
            contentType: "application/json",
            headers: {
              "access-control-allow-origin": "http://127.0.0.1:5050",
              "access-control-allow-credentials": "true",
            },
            body: JSON.stringify({ detail: "Offline note rejection" }),
          });
          return;
        }
        supportNotes = [
          {
            id: supportNotes.length + 1,
            note: payload.note,
            created_at: "2026-08-01T09:00:00Z",
            created_by: "offline-owner",
          },
          ...supportNotes,
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:5050",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({ notes: supportNotes }),
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
  await expect(page.locator("#integrationRows .client-sub")).toHaveText(
    "<script data-xss>window.__xss=true</script>"
  );
  await expect(page.locator("#integrationRows script")).toHaveCount(0);
  await expect(page.locator('#integrationRows [data-action="dashboard:open-client"]')).toHaveCount(
    1
  );

  await expect(
    page.locator(
      '#hamburger[data-action="shell:toggle-sidebar"], #sidebarOverlay[data-action="shell:toggle-sidebar"]'
    )
  ).toHaveCount(2);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.locator('#hamburger[data-action="shell:toggle-sidebar"]').click();
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  await page.locator('#sidebarOverlay[data-action="shell:toggle-sidebar"]').click();
  await expect(page.locator("#sidebar")).not.toHaveClass(/open/);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.locator('[data-action="shell:refresh"]').click();
  await expect.poll(() => summaryRefreshes.includes("1")).toBe(true);

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
  await expect(page.locator("#adminDecisionOverlay [data-admin-click]")).toHaveCount(0);
  await page.locator("#adminDecisionOverlay .decision-modal").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("#adminDecisionOverlay")).toBeVisible();
  await page.locator("#adminDecisionOverlay").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();

  await page.locator('#courierQueueRows [data-action="courier:retry-job"]').click();
  await page
    .locator('#adminDecisionOverlay .modal-close[data-action="admin-decision:close"]')
    .click();
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();

  await page.locator('#courierQueueRows [data-action="courier:retry-job"]').click();
  await page.locator('#adminDecisionCancel[data-action="admin-decision:close"]').click();
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();

  await page.locator('.nav-item[data-tab="recoveryOps"]').click();
  await expect(
    page.locator("#recoveryOps [data-admin-click], #recoveryOps [data-admin-change]")
  ).toHaveCount(0);
  const recoveryRequestsBeforeFilter = recoveryRequests;
  await page
    .locator('#recoveryStatusFilter[data-action="recovery:filter"]')
    .selectOption("incomplete");
  await expect.poll(() => recoveryRequests).toBeGreaterThan(recoveryRequestsBeforeFilter);
  await page
    .locator('#recoveryRows [data-action="recovery:update-status"][data-status="contacted"]')
    .click();
  await expect(page.locator("#adminDecisionOverlay")).toBeVisible();
  await page.locator('#adminDecisionConfirm[data-action="admin-decision:confirm"]').click();
  await expect.poll(() => recoveryPatches).toEqual([{ status: "contacted" }]);

  await page.locator('.nav-item[data-tab="notificationOps"]').click();
  await expect(
    page.locator(
      "#notificationOps [data-admin-click], #notificationOps [data-admin-change], #notificationDrawerOverlay [data-admin-click]"
    )
  ).toHaveCount(0);
  await page.locator('#notificationTabJobs[data-action="notification:set-tab"]').click();
  await expect(page.locator('[data-notification-panel="jobs"]')).toBeVisible();
  await page.locator('#notificationRows [data-action="notification:open-job"]').click();
  await expect(page.locator("#notificationDrawerOverlay")).toBeVisible();
  await expect(page.locator("#notificationDrawerTitle")).toHaveText("Notification Job #73");
  await page
    .locator('#notificationDrawerOverlay .modal-close[data-action="notification:close-drawer"]')
    .click();
  await expect(page.locator("#notificationDrawerOverlay")).toBeHidden();

  await page.locator('.nav-item[data-tab="siteBindings"]').click();
  await expect(
    page.locator("#siteBindings [data-admin-click], #siteBindings [data-admin-change]")
  ).toHaveCount(0);
  const siteBindingRequestsBeforeRefresh = siteBindingRequests;
  await page.locator('#siteBindings [data-action="site-bindings:refresh"]').click();
  await expect.poll(() => siteBindingRequests).toBeGreaterThan(siteBindingRequestsBeforeRefresh);

  await page.locator('.nav-item[data-tab="events"]').click();
  await expect(
    page.locator(
      "#events [data-admin-click], #events [data-admin-change], #events [data-admin-input]"
    )
  ).toHaveCount(0);
  const eventRequestsBeforeRefresh = eventRequests;
  await page.locator('#events [data-action="events:refresh"]').click();
  await expect.poll(() => eventRequests).toBeGreaterThan(eventRequestsBeforeRefresh);
  await page.locator('#eventsSearch[data-action="events:search"]').fill("offline-event-query");

  await page.locator('.nav-item[data-tab="clients"]').click();
  await expect(
    page.locator("#clients [data-admin-click], #clients [data-admin-change]")
  ).toHaveCount(0);
  await page.locator('#searchInput[data-action="shell:search"]').fill("missing-client-query");
  await expect(page.locator("#clientRows")).toContainText("No clients match this search");
  await page.locator('#searchInput[data-action="shell:search"]').fill("");
  await expect(page.locator("#clientRows")).toContainText("Offline Fixture Client");
  await expect(page.locator("#clientRows .client-name")).toHaveText(
    '<img src=x onerror="alert(2)">Offline Fixture Client'
  );
  await expect(page.locator("#clientRows img[src='x'], #clientRows script")).toHaveCount(0);
  await page.locator('[data-action="clients:open-create"]').click();
  await expect(page.locator("#create")).toHaveClass(/active/);

  await page.locator('.nav-item[data-tab="clients"]').click();
  await page.locator('#clientRows [data-action="clients:open-client"]').click();
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await expect(page.locator("#editName")).toHaveValue(
    '<img src=x onerror="alert(2)">Offline Fixture Client'
  );
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
  await page.locator('#adminDecisionConfirm[data-action="admin-decision:confirm"]').click();
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
  await page.locator('#adminDecisionConfirm[data-action="admin-decision:confirm"]').click();
  await expect.poll(() => keyRotations.length).toBe(2);
  expect(keyRotations[1]).toEqual({ key_type: "portal_key" });
  await page
    .locator('#tab-keys [data-action="client-modal:reveal-secret"][data-target-id="keyPortal"]')
    .click();
  await expect(page.locator("#keyPortal")).toHaveText("rotated-offline-portal_key");

  const instructionsTab = page.locator(
    '#modalOverlay [data-action="client-modal:switch-tab"][data-modal-tab="instructions"]'
  );
  await instructionsTab.click();
  await expect(page.locator("#tab-instructions [data-admin-click]")).toHaveCount(0);
  await page
    .locator('#tab-instructions [data-action="client-modal:copy"][data-target-id="instrEndpoint"]')
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("https://api.buykori.app/api/v1/events");

  const intelTab = page.locator(
    '#modalOverlay [data-action="client-modal:switch-tab"][data-modal-tab="intel"]'
  );
  const addNote = page.locator('#tab-intel [data-action="client-modal:add-note"]');
  await intelTab.click();
  await expect(page.locator("#tab-intel [data-admin-click]")).toHaveCount(0);
  await expect(page.locator("#supportNotesList")).toContainText("No support notes yet.");
  await addNote.click();
  expect(supportNotePosts).toEqual([]);

  await page.locator("#supportNoteInput").fill("  Offline support note  ");
  await addNote.click();
  await expect.poll(() => supportNotePosts.length).toBe(1);
  expect(supportNotePosts[0]).toEqual({ note: "Offline support note" });
  await expect(page.locator("#supportNoteInput")).toHaveValue("");
  await expect(page.locator("#supportNotesList")).toContainText("Offline support note");
  await expect(page.locator("#supportNotesList")).toContainText("offline-owner");
  await expect(page.locator("#bk-toast")).toHaveText("Support note added.");
  await expect(addNote).toBeEnabled();

  await page.locator("#supportNoteInput").fill("Rejected note");
  await addNote.click();
  await expect.poll(() => supportNotePosts.length).toBe(2);
  await expect(page.locator("#bk-toast")).toHaveText("Offline note rejection");
  await expect(page.locator("#supportNoteInput")).toHaveValue("Rejected note");
  await expect(addNote).toBeEnabled();
  await expect.poll(() => browserErrors.length).toBe(1);
  expect(browserErrors).toEqual([
    "console: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
  browserErrors.length = 0;

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

  await page.locator('#clientRows [data-action="clients:open-client"]').click();
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await expect(page.locator("#editName")).toHaveValue(
    '<img src=x onerror="alert(2)">Offline Fixture Client'
  );
  await expect(page.locator("#modalOverlay [data-admin-click]")).toHaveCount(0);
  await page
    .locator('#modalOverlay [data-action="client-modal:switch-tab"][data-modal-tab="danger"]')
    .click();
  const deleteClientButton = page.locator('#tab-danger [data-action="client-modal:delete"]');
  await deleteClientButton.click();
  await expect(page.locator("#adminDecisionOverlay")).toBeVisible();
  await expect(page.locator("#adminDecisionTitle")).toHaveText("Delete Client");
  await expect(page.locator("#adminDecisionMessage")).toContainText(
    'Delete "<img src=x onerror="alert(2)">Offline Fixture Client"?'
  );
  await page.locator('#adminDecisionCancel[data-action="admin-decision:close"]').click();
  await expect(page.locator("#adminDecisionOverlay")).toBeHidden();
  expect(deleteAttempts).toBe(0);
  await expect(page.locator("#modalOverlay")).toBeVisible();

  await deleteClientButton.click();
  await page.locator('#adminDecisionConfirm[data-action="admin-decision:confirm"]').click();
  await expect.poll(() => deleteAttempts).toBe(1);
  await expect(page.locator("#bk-toast")).toHaveText("Offline delete rejection");
  await expect(page.locator("#modalOverlay")).toBeVisible();
  await expect(deleteClientButton).toBeEnabled();
  await expect.poll(() => browserErrors.length).toBe(1);
  expect(browserErrors).toEqual([
    "console: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
  browserErrors.length = 0;

  await deleteClientButton.click();
  await page.locator('#adminDecisionConfirm[data-action="admin-decision:confirm"]').click();
  await expect.poll(() => deleteAttempts).toBe(2);
  await expect(page.locator("#modalOverlay")).toBeHidden();
  await expect(page.locator("#bk-toast")).toHaveText("Client deleted");

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

  await page.locator('.nav-item[data-tab="team"]').click();
  await expect(page.locator("#team [data-admin-click], #team [data-admin-submit]")).toHaveCount(0);
  const adminUserRequestsBeforeRefresh = adminUserRequests;
  await page.locator('#team [data-action="team:refresh"]').click();
  await expect.poll(() => adminUserRequests).toBeGreaterThan(adminUserRequestsBeforeRefresh);
  await expect(page.locator("#teamRows strong")).toHaveText(
    '<img src=x onerror="alert(1)">Offline Owner'
  );
  await expect(page.locator("#teamRows img, #teamRows script")).toHaveCount(0);

  await page.locator("#teamUsername").fill("offline-admin");
  await page.locator("#teamDisplayName").fill("Offline Admin");
  await page.locator("#teamPassword").fill("offline-password-123");
  await page
    .locator('#team form[data-action="team:create"]')
    .evaluate(form => form.requestSubmit());
  await expect.poll(() => adminUserCreates.length).toBe(1);
  expect(adminUserCreates[0]).toEqual({
    username: "offline-admin",
    display_name: "Offline Admin",
    password: "offline-password-123",
    role: "admin",
  });
  await expect(page.locator("#teamFormMessage")).toHaveText("Administrator created.");

  page.once("dialog", dialog => dialog.accept());
  await page.locator('#teamRows [data-action="team:update-role"]').click();
  await expect.poll(() => adminUserPatches).toEqual([{ role: "admin" }]);

  const themeToggle = page.locator('#themeToggle[data-action="shell:toggle-theme"]');
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
