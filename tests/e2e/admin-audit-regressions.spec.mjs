import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.buykori.app";
const CORS_HEADERS = {
  "access-control-allow-origin": "http://127.0.0.1:5050",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "Content-Type, X-Admin-CSRF-Token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const CLIENT_A = {
  id: 1,
  name: "Slow Client",
  domain: "slow.example",
  display_domain: "slow.example",
  pixel_id: "pixel-slow",
  is_active: true,
  plan_tier: "free",
  billing_status: "free",
  monthly_limit: 10_000,
  orders_quota: 50,
  enable_facebook: false,
  enable_tiktok: false,
  enable_ga4: false,
};

const CLIENT_B = {
  ...CLIENT_A,
  id: 2,
  name: "=1+1",
  domain: "fast.example",
  display_domain: "fast.example",
  pixel_id: "pixel-fast",
};

function fixtureFor(pathname) {
  const fixtures = {
    "/api/v1/admin/api/session": {
      csrf_token: "audit-regression-csrf",
      user: { username: "audit-owner", displayName: "Audit Owner", role: "owner" },
    },
    "/api/v1/admin/api/summary": {
      total_clients: 2,
      active_clients: 2,
      total_events: 10,
      failed_events: 1,
      client_events: { 1: 4, 2: 6 },
      recent_activity: [],
      integrations: [],
      courier_booking_queue: {},
    },
    "/api/v1/admin/api/clients": { clients: [CLIENT_A, CLIENT_B] },
    "/api/v1/admin/clients/health": { clients: [] },
    "/api/v1/admin/api/courier-booking-queue": { counts: {}, jobs: [] },
    "/api/v1/admin/api/client-intelligence": { clients: [], trial_followups: [] },
    "/api/v1/admin/api/server-health": {},
    "/api/v1/admin/api/site-bindings": { bindings: [] },
    "/api/v1/admin/api/incomplete-checkouts": {
      counts: {},
      items: [],
      top_clients: [],
      total: 0,
    },
    "/api/v1/admin/notification-jobs": { total: 0, items: [] },
    "/api/v1/admin/whatsapp-instances": [
      {
        id: 9,
        instance_name: "Preserved sender",
        status: "paused",
        client_count: 1,
        max_clients: 10,
      },
    ],
    "/api/v1/admin/api/support-tickets": { tickets: [], openCount: 0 },
    "/api/v1/admin/api/payment-reviews": { payments: [] },
    "/api/v1/admin/api/events": { events: [], totalCount: 0 },
    "/api/v1/admin/api/admin-users": { users: [] },
    "/api/v1/admin/api/clients/1": { client: CLIENT_A },
    "/api/v1/admin/api/clients/2": { client: CLIENT_B },
    "/api/v1/admin/api/clients/1/support-notes": { notes: [] },
    "/api/v1/admin/api/clients/2/support-notes": { notes: [] },
  };
  return fixtures[pathname];
}

test("admin audit regressions remain fixed", async ({ page }) => {
  test.setTimeout(60_000);
  let failServerHealth = false;
  let slowClientRequests = 0;
  const clientPatches = [];

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    if (requestUrl.pathname === "/api/v1/admin/api/server-health" && failServerHealth) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({ detail: "Offline server health fixture" }),
      });
      return;
    }
    if (requestUrl.pathname === "/api/v1/admin/api/clients/1" && request.method() === "GET") {
      slowClientRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (requestUrl.pathname === "/api/v1/admin/api/clients/2" && request.method() === "PATCH") {
      clientPatches.push(request.postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    const fixture = fixtureFor(requestUrl.pathname);
    if (fixture === undefined) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({ detail: `Missing fixture: ${requestUrl.pathname}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS_HEADERS,
      body: JSON.stringify(fixture),
    });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#searchInput")).toHaveAttribute(
    "placeholder",
    "Filter clients and connected sites..."
  );

  await page.locator('[data-action="shell:open-notifications"]').click();
  await expect(page.locator("#notificationOps")).toHaveClass(/active/);
  await expect(page.locator('[data-notification-panel="jobs"]')).toBeVisible();
  await expect(page.locator("#whatsappHealthAlert")).toContainText(
    "preserved WhatsApp sender record"
  );
  await page.locator('[data-action="shell:open-help"]').click();
  await expect(page.locator('[data-notification-panel="support"]')).toBeVisible();

  await page.locator('.nav-item[data-tab="clients"]').click();
  const slowClientButton = page.locator(
    '#clientRows [data-action="clients:open-client"][data-client-id="1"]'
  );
  const fastClientButton = page.locator(
    '#clientRows [data-action="clients:open-client"][data-client-id="2"]'
  );
  await slowClientButton.click();
  await expect.poll(() => slowClientRequests).toBe(1);
  await page.locator('#modalOverlay [data-action="client-modal:close"]').first().click();
  await fastClientButton.click();
  await expect(page.locator("#editName")).toHaveValue("=1+1");
  await page.waitForTimeout(450);
  await expect(page.locator("#editName")).toHaveValue("=1+1");
  await expect(page.locator("#modalOverlay .modal")).toHaveAttribute("role", "dialog");
  await expect(page.locator('label[for="editName"]')).toHaveText("Name");
  await expect(
    page.locator('#modalOverlay [data-action="client-modal:close"]').first()
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modalOverlay")).toBeHidden();
  await expect(fastClientButton).toBeFocused();

  await fastClientButton.click();
  await expect(page.locator("#editName")).toHaveValue("=1+1");
  await page.locator("#editName").fill("Updated Fast Client");
  await page.locator("#clientModalSave").click();
  await expect.poll(() => clientPatches.length).toBe(1);
  expect(clientPatches[0].name).toBe("Updated Fast Client");

  await page.keyboard.press("Escape");
  await expect(page.locator("#modalOverlay")).toBeHidden();

  await page.locator('.nav-item[data-tab="dashboard"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="dashboard:download-report"]').click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain('"\'=1+1"');

  failServerHealth = true;
  await page.locator('[data-action="shell:refresh"]').click();
  await expect(page.locator("#dataHealthBanner")).toBeVisible();
  await expect(page.locator("#dataHealthDetail")).toContainText("Server health");
  failServerHealth = false;
  await page.locator('[data-action="shell:retry-degraded"]').click();
  await expect(page.locator("#dataHealthBanner")).toBeHidden();

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ["dashboard", "clients"]) {
      if (width <= 820) await page.locator("#hamburger").click();
      await page.locator(`.nav-item[data-tab="${tab}"]`).click();
      const pageWidth = await page.evaluate(() => ({
        viewport: globalThis.innerWidth,
        document: globalThis.document.documentElement.scrollWidth,
        wrapperRight: Math.ceil(
          globalThis.document.querySelector(".main-wrapper").getBoundingClientRect().right
        ),
        offenders: [...globalThis.document.querySelectorAll("body *")]
          .map(element => {
            const rect = element.getBoundingClientRect();
            return {
              selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
                element.classList.length ? `.${[...element.classList].join(".")}` : ""
              }`,
              left: Math.floor(rect.left),
              right: Math.ceil(rect.right),
              width: Math.ceil(rect.width),
            };
          })
          .filter(item => item.right > globalThis.innerWidth + 1 || item.left < -1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 12),
      }));
      expect(pageWidth.document, JSON.stringify(pageWidth.offenders, null, 2)).toBeLessThanOrEqual(
        pageWidth.viewport
      );
      expect(pageWidth.wrapperRight).toBeLessThanOrEqual(pageWidth.viewport);
    }
  }
});
