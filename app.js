const API_BASE = "https://api.buykori.app/api/v1";
const $ = id => document.getElementById(id);
const COURIER_QUEUE_REFRESH_MS = 15000;
const ADMIN_CSRF_COOKIE = "buykori_admin_csrf";
const ADMIN_CSRF_HEADER = "X-Admin-CSRF-Token";
const CSRF_MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const PLAN_DEFAULTS = Object.freeze({
  free: Object.freeze({ events: 5000, orders: 100 }),
  trial: Object.freeze({ events: 25000, orders: 300 }),
  growth: Object.freeze({ events: 500000, orders: 2000 }),
  scale: Object.freeze({ events: 1000000, orders: 10000 }),
  agency: Object.freeze({ events: 0, orders: 0 })
});
let adminCsrfToken = "";
const state = {
  summary: null,
  clients: [],
  health: [],
  intelligence: null,
  serverHealth: null,
  supportNotes: [],
  courierQueue: null,
  incompleteOps: null,
  notificationJobs: null,
  whatsappInstances: [],
  siteBindings: [],
  courierQueueAutoRefresh: true,
  courierQueueLastRefresh: null,
  courierQueueTimer: null,
  courierQueueRefreshing: false,
  activeCourierJobId: null,
  dashboardWindow: "24h",
  dashboardWindowRequestId: 0,
  dashboardWindowAbortController: null
};
const modalSecrets = new Map();
const eventsState = {
  events: [],
  totalCount: 0,
  limit: 50,
  offset: 0,
  currentPage: 1,
  expandedEventId: null
};
const fmt = n => Number(n || 0).toLocaleString();
const pct = n => `${Number(n || 0).toFixed(1).replace(".0", "")}%`;
let adminDecisionResolve = null;
let latestPairingInstanceId = null;
let latestPairingCode = "";
const optionalInteger = value => {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? null : parsed;
};
const esc = value => {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
};

function csrfFromCookie() {
  const prefix = `${ADMIN_CSRF_COOKIE}=`;
  return document.cookie
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function currentCsrfToken() {
  adminCsrfToken = adminCsrfToken || csrfFromCookie();
  return adminCsrfToken;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (CSRF_MUTATION_METHODS.has(method)) {
    const token = currentCsrfToken();
    if (token) headers[ADMIN_CSRF_HEADER] = token;
  }

  const res = await fetch(API_BASE + path, {
    ...options,
    credentials: "include",
    headers
  });
  if (!res.ok) {
    const error = new Error(await res.text());
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function readableApiError(error, fallback = "Request failed.") {
  const raw = String(error?.message || "").trim();
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.detail || parsed.message || raw;
  } catch {
    detail = raw;
  }
  if (Array.isArray(detail)) {
    detail = detail.map(item => item?.msg || item?.message || JSON.stringify(item)).join("; ");
  }
  if (!detail) detail = fallback;
  if (error?.status === 401 || error?.status === 403) {
    return `${detail} Please refresh the admin panel and login again if this continues.`;
  }
  return detail;
}

function isAuthError(error) {
  return error?.status === 401 || error?.status === 403;
}

async function apiOrFallback(path, fallback, label) {
  try {
    return await api(path);
  } catch (error) {
    if (isAuthError(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, 400));
    try {
      return await api(path);
    } catch (retryError) {
      if (isAuthError(retryError)) throw retryError;
      console.warn(`Admin data source failed after retry: ${label || path}`, retryError);
      return fallback;
    }
  }
}

function selectedPlanDefaults() {
  const billingStatus = $("editBillingStatus")?.value || "free";
  const planTier = $("editPlanTier")?.value || "free";
  if (billingStatus === "trial") return PLAN_DEFAULTS.trial;
  if (billingStatus === "free" || planTier === "free") return PLAN_DEFAULTS.free;
  return PLAN_DEFAULTS[planTier] || PLAN_DEFAULTS.growth;
}

function syncPlanQuotaFields() {
  const planTier = $("editPlanTier");
  const billingStatus = $("editBillingStatus");
  if (!planTier || !billingStatus) return;

  if (billingStatus.value === "trial") {
    planTier.value = "growth";
  } else if (billingStatus.value === "free") {
    planTier.value = "free";
  } else if (planTier.value === "free") {
    planTier.value = "growth";
  }

  const defaults = selectedPlanDefaults();
  $("editLimit").value = defaults.events;
  $("editOrderLimit").value = defaults.orders;
}

function syncBillingForPlanSelection() {
  const planTier = $("editPlanTier");
  const billingStatus = $("editBillingStatus");
  if (!planTier || !billingStatus) return;

  if (planTier.value === "free") {
    billingStatus.value = "free";
  } else if (billingStatus.value === "free") {
    billingStatus.value = "paid";
  }
  syncPlanQuotaFields();
}

async function loginAdmin() {
  const username = $("adminUsername").value.trim();
  const password = $("adminPassword").value;
  
  if (!username || !password.trim()) {
    $("loginError").style.color = "var(--danger)";
    $("loginError").textContent = "Please fill in all fields.";
    return;
  }
  
  $("loginError").textContent = "Signing in...";
  $("loginError").style.color = "var(--primary)";
  
  try {
    const res = await fetch(API_BASE + "/admin/api/login", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Authentication failed");
    }
    
    const data = await res.json();
    adminCsrfToken = data.csrf_token || csrfFromCookie();
    
    await loadAll();
    showApp();
    $("loginError").textContent = "";
  } catch (error) {
    $("loginError").style.color = "var(--danger)";
    $("loginError").textContent = error.message || "Could not connect with this admin key.";
  }
}

function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  $("app").classList.add("ready");
}

function logout() {
  stopCourierQueueAutoRefresh();
  const token = currentCsrfToken();
  fetch(API_BASE + "/admin/api/logout", {
    method: "POST",
    credentials: "include",
    headers: token ? { [ADMIN_CSRF_HEADER]: token } : {}
  }).finally(() => location.reload());
}

async function loadAll(options = {}) {
  const refreshDashboard = Boolean(options.refreshDashboard);
  const summaryUrl = `/admin/api/summary?window=${encodeURIComponent(state.dashboardWindow)}${refreshDashboard ? "&refresh=1" : ""}`;
  const [summary, clients, health, courierQueue, intelligence, serverHealth, siteBindings, incompleteOps, notificationJobs, whatsappInstances] = await Promise.all([
    apiOrFallback(summaryUrl, state.summary || {}, "summary"),
    apiOrFallback("/admin/api/clients", { clients: state.clients || [] }, "clients"),
    apiOrFallback("/admin/clients/health", { clients: state.health || [] }, "client health"),
    apiOrFallback("/admin/api/courier-booking-queue?limit=20", state.courierQueue || {}, "courier queue"),
    apiOrFallback("/admin/api/client-intelligence", state.intelligence || { clients: [] }, "client intelligence"),
    apiOrFallback("/admin/api/server-health", state.serverHealth || {}, "server health"),
    apiOrFallback("/admin/api/site-bindings?status=all", { bindings: [] }, "site bindings"),
    apiOrFallback("/admin/api/incomplete-checkouts?limit=100", { counts: {}, items: [], top_clients: [], total: 0 }, "incomplete checkouts"),
    apiOrFallback("/admin/notification-jobs?limit=100", { total: 0, items: [] }, "notification jobs"),
    apiOrFallback("/admin/whatsapp-instances", [], "whatsapp instances")
  ]);
  state.summary = summary;
  state.clients = clients.clients || [];
  state.health = health.clients || [];
  state.intelligence = intelligence;
  state.serverHealth = serverHealth;
  state.courierQueue = courierQueue;
  state.incompleteOps = incompleteOps;
  state.notificationJobs = notificationJobs;
  state.whatsappInstances = Array.isArray(whatsappInstances) ? whatsappInstances : [];
  state.siteBindings = siteBindings.bindings || [];
  state.courierQueueLastRefresh = new Date();
  renderAll();
  startCourierQueueAutoRefresh();
  
  // Populate event logs filters and fetch
  populateClientFilter();
  populateBindingClientFilters();
  loadEvents();
}

function healthFor(client) {
  return state.health.find(item => String(item.client_id) === String(client.id) || item.client_name === client.name) || {};
}

function intelligenceFor(clientId) {
  return (state.intelligence?.clients || []).find(row => String(row.client?.id) === String(clientId)) || null;
}

function overviewHealthFor(client) {
  const intel = intelligenceFor(client.id);
  const legacy = healthFor(client);
  if (!client.is_active) {
    return { status: "inactive", score: undefined, reasons: ["Client inactive"], periodEvents: 0, lastEventAt: legacy.last_event_at || client.last_event_at || null };
  }
  return {
    status: intel?.health_score?.status || legacy.health_status || "healthy",
    score: intel?.health_score?.score,
    reasons: intel?.health_score?.reasons || [],
    periodEvents: Number(state.summary?.client_events?.[String(client.id)] || 0),
    lastEventAt: legacy.last_event_at || client.last_event_at || null
  };
}

function dashboardWindowLabel(window = state.dashboardWindow) {
  return window === "7d" ? "Last 7 Days" : window === "30d" ? "Last 30 Days" : "Last 24 Hours";
}

function dashboardWindowShortLabel(window = state.dashboardWindow) {
  return window === "7d" ? "7d" : window === "30d" ? "30d" : "24h";
}

function sparklinePoints(values) {
  const items = (values || []).map(Number);
  if (!items.length) return "0,18 100,18";
  const max = Math.max(...items, 1);
  const widthStep = items.length === 1 ? 100 : 100 / (items.length - 1);
  return items.map((value, index) => `${(index * widthStep).toFixed(2)},${(18 - (Math.max(value, 0) / max) * 16).toFixed(2)}`).join(" ");
}

function renderDashboardTrends() {
  const trend = state.summary?.trend || [];
  const series = {
    attemptsSparkline: trend.map(item => item.attempts || 0),
    successSparkline: trend.map(item => item.successful || 0),
    failedSparkline: trend.map(item => item.failed || 0)
  };
  Object.entries(series).forEach(([id, values]) => {
    const line = $(id);
    if (line) line.setAttribute("points", sparklinePoints(values));
  });
}
function integrationState(client, platform) {
  const setup = intelligenceFor(client.id)?.setup_snapshot?.[platform];
  const enabledFallback = platform === "meta"
    ? Boolean(client.enable_facebook)
    : platform === "tiktok"
      ? Boolean(client.enable_tiktok)
      : Boolean(client.enable_ga4);
  if (!setup) return enabledFallback ? { state: "attention", label: "Needs setup" } : { state: "off", label: "Off" };
  if (!setup.enabled) return { state: "off", label: "Off" };
  if (setup.configured) return { state: "ready", label: "Ready" };
  return { state: "attention", label: "Needs setup" };
}

function statusClass(status) {
  const clean = String(status || "inactive").toLowerCase();
  if (clean === "healthy") return "status-healthy";
  if (clean === "warning") return "status-warning";
  if (clean === "critical") return "status-critical";
  return "status-inactive";
}

function statusLabel(status, isActive) {
  if (!isActive) return "Inactive";
  const clean = String(status || "healthy").toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  if (value >= 86400) return `${Math.floor(value / 86400)}d ${Math.floor((value % 86400) / 3600)}h`;
  if (value >= 3600) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
  if (value >= 60) return `${Math.floor(value / 60)}m ${Math.floor(value % 60)}s`;
  return `${Math.floor(value)}s`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "-";
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function doneCount(items) {
  return (items || []).filter(item => item.done).length;
}

function courierQueueCounts() {
  return state.courierQueue?.counts || state.summary?.courier_booking_queue || {};
}

function courierQueueStatusClass(status) {
  const clean = String(status || "healthy").toLowerCase();
  if (clean === "critical") return "status-critical";
  if (clean === "warning") return "status-warning";
  return "status-healthy";
}

function courierQueueJobById(jobId) {
  return (state.courierQueue?.jobs || []).find(job => Number(job.id) === Number(jobId));
}

function queueStatusText(queue) {
  const status = String(queue.alert_status || "healthy").toLowerCase();
  const queued = Number(queue.queued || 0);
  const processing = Number(queue.processing || 0);
  const dead = Number(queue.dead || 0);
  const oldest = Math.max(queue.oldest_queued_age_seconds || 0, queue.oldest_processing_age_seconds || 0);
  if (status === "critical") return `${fmt(dead)} dead job${dead === 1 ? "" : "s"} need retry. Oldest active job: ${formatDuration(oldest)}.`;
  if (status === "warning") return `${fmt(queued + processing)} active job${queued + processing === 1 ? "" : "s"} need attention. Oldest: ${formatDuration(oldest)}.`;
  if (queued + processing > 0) return `${fmt(queued + processing)} active courier booking job${queued + processing === 1 ? "" : "s"} moving through the worker.`;
  return "Courier booking queue is healthy.";
}

function renderCourierQueueBanner(queue) {
  const banner = $("courierQueueHealthBanner");
  if (!banner) return;
  const status = String(queue.alert_status || "healthy").toLowerCase();
  const activeJobs = Number(queue.queued || 0) + Number(queue.processing || 0);
  const deadJobs = Number(queue.dead || 0);
  if (status === "healthy" && activeJobs === 0 && deadJobs === 0) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  banner.style.display = "flex";
  banner.className = `queue-health-banner queue-health-${status === "critical" ? "critical" : status === "warning" ? "warning" : "healthy"}`;
  banner.innerHTML = `
    <div>
      <strong>Courier queue ${esc(status)}</strong>
      <span>${esc(queueStatusText(queue))}</span>
    </div>
    <button class="btn btn-outline btn-sm" onclick="setTab('courierQueue')">Open Queue</button>
  `;
}

function renderCourierQueueRefreshMeta() {
  const statusEl = $("courierQueueRefreshStatus");
  if (statusEl) {
    statusEl.textContent = state.courierQueueLastRefresh
      ? `Last refresh ${trimTime(state.courierQueueLastRefresh.toISOString())}`
      : "Not refreshed yet";
  }
  const toggle = $("courierQueueAutoRefreshToggle");
  if (toggle) {
    toggle.textContent = state.courierQueueAutoRefresh ? "Auto Refresh On" : "Auto Refresh Off";
    toggle.className = `btn btn-sm ${state.courierQueueAutoRefresh ? "btn-primary" : "btn-outline"}`;
  }
}

function domainLink(client) {
  const domain = client.display_domain || client.domain || "No domain set";
  if (!client.display_domain && !client.domain) return `<span class="domain-link">${esc(domain)}</span>`;
  const href = String(domain).startsWith("http") ? domain : `https://${domain}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener" class="domain-link">${esc(domain)} <span style="font-size:11px;opacity:0.8">open</span></a>`;
}

function integrationBadge(integration, color, icon) {
  const stateName = integration?.state || "off";
  const dot = stateName === "ready" ? "dot-active" : stateName === "attention" ? "dot-warning" : "dot-inactive";
  return `<div class="integration-status">${icon ? `<span style="color:${color};font-weight:900;margin-right:2px">${icon}</span>` : ""}<div class="dot ${dot}"></div>${esc(integration?.label || "Off")}</div>`;
}

function filteredClients() {
  const query = ($("searchInput")?.value || "").toLowerCase().trim();
  if (!query) return state.clients;
  return state.clients.filter(client => {
    const health = healthFor(client);
    return [client.name, client.display_domain, client.domain, client.pixel_id, health.health_status]
      .some(value => String(value || "").toLowerCase().includes(query));
  });
}

function renderSummary() {
  const summary = state.summary || {};
  const queue = courierQueueCounts();
  const totalEvents = Number(summary.total_events || 0);
  const failed = Math.min(Number(summary.failed_events || 0), totalEvents);
  const successful = Math.max(totalEvents - failed, 0);
  const hasEvents = totalEvents > 0;
  const deliveryRate = hasEvents ? (successful / totalEvents) * 100 : null;
  const errorRate = hasEvents ? (failed / totalEvents) * 100 : null;
  const activeClients = Number(summary.active_clients || 0);
  const eventOutbox = state.serverHealth?.event_outbox || {};
  const queuedOutbox = Number(eventOutbox.queued || 0) + Number(eventOutbox.processing || 0);
  const metaReady = state.clients.filter(client => integrationState(client, "meta").state === "ready").length;
  const tiktokReady = state.clients.filter(client => integrationState(client, "tiktok").state === "ready").length;
  const ga4Ready = state.clients.filter(client => integrationState(client, "ga4").state === "ready").length;

  $("totalEvents").textContent = fmt(totalEvents);
  $("failedEvents").textContent = fmt(failed);
  $("activeClients").textContent = `${fmt(activeClients)} / ${fmt(summary.total_clients || 0)}`;
  $("matchRate").textContent = hasEvents ? pct(deliveryRate) : "No data";
  $("errorRate").textContent = hasEvents ? pct(errorRate) : "No data";
  $("queuedOutbox").textContent = fmt(queuedOutbox);
  $("eventsTrend").textContent = totalEvents ? `${dashboardWindowLabel()}: all recorded delivery attempts` : `${dashboardWindowLabel()}: no events`;
  if ($("dashboardFreshness")) {
    const generatedAt = summary.cache_generated_at ? new Date(summary.cache_generated_at) : null;
    const source = summary.cache_source === "fresh"
      ? "Live"
      : summary.cache_source === "local-fallback"
        ? "Fallback cache"
        : "Cached";
    $("dashboardFreshness").textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
      ? `${source} · updated ${generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : source;
    $("dashboardFreshness").className = `dashboard-freshness ${summary.cache_source === "fresh" ? "is-live" : ""}`;
  }
  if ($("dashboardWindow")) $("dashboardWindow").value = state.dashboardWindow;
  if ($("periodEventsHeader")) $("periodEventsHeader").textContent = `Events ${dashboardWindowShortLabel()}`;
  renderDashboardTrends();
  renderCourierQueueBanner(queue);
  if ($("courierQueueDashboardStatus")) {
    $("courierQueueDashboardStatus").className = `status-badge ${courierQueueStatusClass(queue.alert_status)}`;
    $("courierQueueDashboardStatus").textContent = String(queue.alert_status || "healthy").toUpperCase();
    $("courierQueueDashboardDepth").textContent = fmt((queue.queued || 0) + (queue.processing || 0));
    $("courierQueueDashboardDead").textContent = fmt(queue.dead || 0);
    $("courierQueueDashboardOldest").textContent = formatDuration(Math.max(queue.oldest_queued_age_seconds || 0, queue.oldest_processing_age_seconds || 0));
  }
  const lifetimeEvents = Number(summary.lifetime_total_events ?? totalEvents);
  $("planUsed").textContent = compactNumber(lifetimeEvents);
  $("planProgress").style.width = `${Math.min((lifetimeEvents / 2000000) * 100, 100)}%`;
  $("metaEvents").textContent = `${fmt(metaReady)} ready client${metaReady === 1 ? "" : "s"}`;
  $("tiktokEvents").textContent = `${fmt(tiktokReady)} ready client${tiktokReady === 1 ? "" : "s"}`;
  $("ga4Events").textContent = `${fmt(ga4Ready)} ready client${ga4Ready === 1 ? "" : "s"}`;
}
function compactNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(".0", "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".0", "")}K`;
  return fmt(n);
}

function renderIntegrationRows() {
  const clients = filteredClients();
  $("tableMeta").textContent = `Showing ${clients.length} of ${state.clients.length} clients`;
  $("integrationRows").innerHTML = clients.map(client => {
    const health = overviewHealthFor(client);
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div><div class="client-sub">${esc(client.pixel_id || `ID ${client.id}`)}</div></td>
      <td>${domainLink(client)}</td>
      <td>${integrationBadge(integrationState(client, "meta"), "#1877F2", "f")}</td>
      <td>${integrationBadge(integrationState(client, "tiktok"), "#3B82F6", "T")}</td>
      <td>${integrationBadge(integrationState(client, "ga4"), "#F9AB00", "G")}</td>
      <td><span class="text-success" style="font-weight:700">${fmt(health.periodEvents)}</span> <span style="font-size:10px;color:var(--text-subtle)">${esc(dashboardWindowShortLabel())}</span></td>
      <td><div class="status-badge ${statusClass(health.status)}" title="${esc(health.reasons.join(", "))}">${health.score !== undefined ? `${fmt(health.score)}%` : statusLabel(health.status, client.is_active)}</div></td>
      <td><button class="action-btn" onclick="openClientModal(${client.id})" title="Manage client">...</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">No clients yet. Use Add Client to get started.</td></tr>`;
}
function renderClientRows() {
  $("clientRows").innerHTML = filteredClients().map(client => {
    const health = healthFor(client);
    const intel = intelligenceFor(client.id);
    const healthStatus = health.health_status || (client.is_active ? "healthy" : "inactive");
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div><div class="client-sub">ID ${esc(client.id)}${intel?.owner?.phone_number ? ` - ${esc(intel.owner.phone_number)}` : ""}</div></td>
      <td>${domainLink(client)}</td>
      <td>${fmt(client.event_total || 0)}</td>
      <td><div class="client-sub">API ${esc(String(client.api_key || "").slice(0, 8))}...</div><div class="client-sub">Portal ${client.portal_key ? `${esc(String(client.portal_key).slice(0, 8))}...` : "-"}</div></td>
      <td><div class="status-badge ${statusClass(intel?.health_score?.status || healthStatus)}">${intel?.health_score ? `${fmt(intel.health_score.score)}%` : statusLabel(healthStatus, client.is_active)}</div></td>
      <td>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="openClientModal(${client.id})">Manage</button>
          <button class="btn btn-sm ${client.is_active ? 'btn-outline' : 'btn-primary'}" onclick="toggleClient(${client.id}, ${!client.is_active})">${client.is_active ? "Deactivate" : "Activate"}</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No clients match this search. Clear the search or add a new client.</td></tr>`;
}

function bindingStatusClass(status) {
  const clean = String(status || "active").toLowerCase();
  if (clean === "active") return "status-healthy";
  if (clean === "released") return "status-warning";
  if (clean === "transferred") return "status-inactive";
  return "status-inactive";
}

function filteredSiteBindings() {
  const status = $("bindingStatusFilter")?.value || "all";
  const clientId = $("bindingClientFilter")?.value || "";
  const query = ($("searchInput")?.value || "").toLowerCase().trim();
  return (state.siteBindings || []).filter(binding => {
    if (status !== "all" && String(binding.status || "").toLowerCase() !== status) return false;
    if (clientId && String(binding.client_id) !== clientId) return false;
    if (!query) return true;
    return [
      binding.site_host,
      binding.root_domain,
      binding.client_name,
      binding.client_id,
      binding.status,
      binding.source,
      binding.release_reason
    ].some(value => String(value || "").toLowerCase().includes(query));
  });
}

function populateBindingClientFilters() {
  const bindingFilter = $("bindingClientFilter");
  const transferTarget = $("transferTargetClient");
  if (!bindingFilter || !transferTarget) return;
  const selectedFilter = bindingFilter.value;
  const selectedTarget = transferTarget.value;
  bindingFilter.innerHTML = '<option value="">All clients</option>';
  transferTarget.innerHTML = '<option value="">Select client</option>';
  state.clients.forEach(client => {
    const filterOpt = document.createElement("option");
    filterOpt.value = client.id;
    filterOpt.textContent = `${client.name} (#${client.id})`;
    bindingFilter.appendChild(filterOpt);

    const targetOpt = document.createElement("option");
    targetOpt.value = client.id;
    targetOpt.textContent = `${client.name} (#${client.id})`;
    transferTarget.appendChild(targetOpt);
  });
  if (selectedFilter && state.clients.some(c => String(c.id) === selectedFilter)) bindingFilter.value = selectedFilter;
  if (selectedTarget && state.clients.some(c => String(c.id) === selectedTarget)) transferTarget.value = selectedTarget;
}

function renderSiteBindingMetrics() {
  const bindings = state.siteBindings || [];
  const counts = bindings.reduce((acc, binding) => {
    const status = String(binding.status || "active").toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    if (binding.installation_id) acc.fingerprinted += 1;
    return acc;
  }, { active: 0, released: 0, transferred: 0, fingerprinted: 0 });
  if ($("bindingActiveCount")) $("bindingActiveCount").textContent = fmt(counts.active);
  if ($("bindingReleasedCount")) $("bindingReleasedCount").textContent = fmt(counts.released);
  if ($("bindingTransferredCount")) $("bindingTransferredCount").textContent = fmt(counts.transferred);
  if ($("bindingFingerprintCount")) $("bindingFingerprintCount").textContent = fmt(counts.fingerprinted);
}

function renderSiteBindings() {
  renderSiteBindingMetrics();
  const tbody = $("siteBindingRows");
  if (!tbody) return;
  const bindings = filteredSiteBindings();
  const meta = $("siteBindingMeta");
  if (meta) meta.textContent = `Showing ${bindings.length} of ${(state.siteBindings || []).length} bindings`;
  tbody.innerHTML = bindings.map(binding => {
    const status = String(binding.status || "active").toLowerCase();
    const canRelease = status === "active";
    const canTransfer = status === "active";
    return `<tr>
      <td>
        <div class="client-name">${esc(binding.site_host || binding.root_domain)}</div>
        <div class="client-sub">${esc(binding.root_domain || "-")} · ${esc(binding.source || "-")}</div>
      </td>
      <td>
        <div class="client-name">${esc(binding.client_name || "Unknown client")}</div>
        <div class="client-sub">Client #${esc(binding.client_id)}</div>
      </td>
      <td><div class="status-badge ${bindingStatusClass(status)}">${esc(status.toUpperCase())}</div></td>
      <td>
        <div class="code-text">${esc(binding.installation_id || "not captured")}</div>
        <div class="client-sub">Connected ${esc(toDeviceDateTime(binding.connected_at))}</div>
      </td>
      <td>
        <div class="client-sub">Seen ${esc(toDeviceDateTime(binding.last_seen_at))}</div>
        <div class="client-sub">Event ${esc(toDeviceDateTime(binding.last_event_at))}</div>
      </td>
      <td>
        <div class="client-sub">${binding.released_at ? esc(toDeviceDateTime(binding.released_at)) : "-"}</div>
        <div class="client-sub">${esc(binding.release_reason || "")}</div>
      </td>
      <td>
        <div class="queue-actions">
          <button class="btn btn-outline btn-sm" onclick="prepareSiteBindingTransfer(${Number(binding.id)})" ${canTransfer ? "" : "disabled"}>Transfer</button>
          <button class="btn btn-danger btn-sm" onclick="releaseSiteBinding(${Number(binding.id)})" ${canRelease ? "" : "disabled"}>Release</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No connected sites match these filters.</td></tr>`;
}

function renderHealthRows() {
  $("healthRows").innerHTML = state.health.map(item => `<tr>
    <td><div class="client-name">${esc(item.client_name)}</div><div class="client-sub">${esc(item.domain || "")}</div></td>
    <td><div class="status-badge ${statusClass(item.health_status)}">${statusLabel(item.health_status, item.health_status !== "inactive")}</div></td>
    <td>${fmt(item.today_events)}</td>
    <td>${pct(item.success_rate)}</td>
    <td>${esc(toDeviceDateTime(item.last_event_at))}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="empty">Health data will appear when clients start sending events.</td></tr>`;
}

function renderClientIntelligence() {
  const rows = state.intelligence?.clients || [];
  const followups = state.intelligence?.trial_followups || [];
  if ($("trialFollowupRows")) {
    $("trialFollowupRows").innerHTML = followups.map(row => {
      const c = row.client || {};
      const owner = row.owner || {};
      const followup = row.trial_followup || {};
      return `<tr>
        <td><div class="client-name">${esc(c.name)}</div><div class="client-sub">${esc(owner.full_name || "-")} - ${esc(owner.phone_number || "no phone")}</div></td>
        <td><div class="status-badge ${followup.priority === "high" ? "status-critical" : followup.priority === "medium" ? "status-warning" : "status-healthy"}">${esc(followup.priority)}</div></td>
        <td>${esc(followup.reason)}</td>
        <td>${esc(followup.action)}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openClientModal(${Number(c.id)})">Open</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" class="empty">No trial follow-ups right now.</td></tr>`;
  }
  if ($("clientIntelRows")) {
    $("clientIntelRows").innerHTML = rows.map(row => {
      const c = row.client || {};
      const owner = row.owner || {};
      const funnel = row.onboarding_funnel || [];
      const score = row.health_score || {};
      const followup = row.trial_followup;
      return `<tr>
        <td><div class="client-name">${esc(c.name)}</div><div class="client-sub">${esc(owner.email || "-")} - ${esc(owner.phone_number || "no phone")}</div></td>
        <td><div class="status-badge ${statusClass(score.status)}">${fmt(score.score)}%</div><div class="client-sub">${esc((score.reasons || []).slice(0, 2).join(", ") || "Looks good")}</div></td>
        <td>${doneCount(funnel)} / ${funnel.length}</td>
        <td>${followup ? esc(followup.reason) : "No action"}</td>
        <td>${fmt(row.support_note_count || 0)}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openClientModal(${Number(c.id)})">Open</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">Client details will appear after intelligence data loads.</td></tr>`;
  }
}

function renderOpsMonitor() {
  const health = state.serverHealth || {};
  const server = health.server || {};
  const cpu = server.cpu || {};
  const memory = server.memory || {};
  const disk = server.disk || {};
  const worker = health.worker_monitor || {};
  if ($("serverHealthStatus")) $("serverHealthStatus").textContent = String(health.status || "-").toUpperCase();
  if ($("serverCpuUsed")) $("serverCpuUsed").textContent = cpu.used_percent == null ? "-" : pct(cpu.used_percent);
  if ($("serverCpuMeta")) $("serverCpuMeta").textContent = cpu.cores ? `${fmt(cpu.cores)} cores, load/core ${cpu.load_1m_per_core ?? "-"}` : "cores unavailable";
  if ($("serverRamUsed")) $("serverRamUsed").textContent = memory.used_percent == null ? "-" : pct(memory.used_percent);
  if ($("serverLoadAvg")) $("serverLoadAvg").textContent = (server.load_average || []).length ? server.load_average.map(n => Number(n).toFixed(2)).join(" / ") : "-";
  if ($("serverDiskUsed")) $("serverDiskUsed").textContent = disk.used_percent == null ? "-" : pct(disk.used_percent);
  if ($("serverUptime")) $("serverUptime").textContent = formatDuration(server.uptime_seconds || 0);
  if ($("serverProcessMem")) $("serverProcessMem").textContent = formatBytes(server.process?.rss_bytes);
  if ($("serverDbStatus")) $("serverDbStatus").textContent = health.db ? "OK" : "FAIL";
  if ($("serverRedisStatus")) $("serverRedisStatus").textContent = health.redis ? "OK" : "FAIL";
  if ($("workerMonitorStatus")) {
    $("workerMonitorStatus").className = `status-badge ${statusClass(worker.status)}`;
    $("workerMonitorStatus").textContent = String(worker.status || "unknown").toUpperCase();
  }
  if ($("workerMonitorRows")) {
    const eventOutbox = worker.event_outbox || {};
    const failedEvents = worker.failed_events || {};
    const courier = worker.courier_booking_queue || {};
    const courierStatuses = worker.courier_status_monitor || {};
    const webhookMonitor = worker.courier_webhook_monitor || {};
    const webhookTotals = webhookMonitor.totals || {};
    const webhookProviders = webhookMonitor.providers || {};
    const smokeMonitor = worker.courier_smoke_monitor || {};
    $("workerMonitorRows").innerHTML = [
      ["Event outbox queued", eventOutbox.queued || 0],
      ["Event outbox processing", eventOutbox.processing || 0],
      ["Event outbox dead", eventOutbox.dead || 0],
      ["Failed events pending", failedEvents.pending || 0],
      ["Failed events dead", failedEvents.dead || 0],
      ["Courier queued", courier.queued || 0],
      ["Courier processing", courier.processing || 0],
      ["Courier dead", courier.dead || 0],
      ["Unknown courier statuses (24h)", courierStatuses.unknown_status_total || 0],
      ["Courier webhooks received (24h)", webhookTotals.received || 0],
      ["Courier webhooks applied (24h)", webhookTotals.applied || 0],
      ["Courier webhooks replayed (24h)", webhookTotals.replayed || 0],
      ["Courier webhook auth failures (24h)", webhookTotals.auth_failed || 0],
      ["Courier webhook rate limited (24h)", webhookTotals.rate_limited || 0],
      ["SteadFast webhooks received", webhookProviders.steadfast?.received || 0],
      ["Pathao webhooks received", webhookProviders.pathao?.received || 0],
      ["RedX webhooks received", webhookProviders.redx?.received || 0],
      ["Courier smoke monitor", smokeMonitor.status || "never_run"],
      ["Courier smoke age", smokeMonitor.age_seconds == null ? "-" : formatDuration(smokeMonitor.age_seconds)],
    ].map(row => `<tr><td>${esc(row[0])}</td><td>${typeof row[1] === "number" ? fmt(row[1]) : esc(row[1])}</td></tr>`).join("");
  }
}

function renderMatrixRows() {
  $("integrationMatrixRows").innerHTML = filteredClients().map(client => {
    const health = overviewHealthFor(client);
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div></td>
      <td>${integrationBadge(integrationState(client, "meta"), "#1877F2", "f")}</td>
      <td>${integrationBadge(integrationState(client, "tiktok"), "#3B82F6", "T")}</td>
      <td>${integrationBadge(integrationState(client, "ga4"), "#F9AB00", "G")}</td>
      <td><div class="status-badge ${statusClass(health.status)}">${health.score !== undefined ? `${fmt(health.score)}%` : statusLabel(health.status, client.is_active)}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No integration data yet. Add a client to start tracking setup.</td></tr>`;
}
function derivedActivities() {
  const periodEvents = Number(state.summary?.total_events || 0);
  const overviewRows = state.clients.map(client => ({ client, health: overviewHealthFor(client) }));
  const warnings = overviewRows.filter(row => ["warning", "critical"].includes(String(row.health.status).toLowerCase()));
  const latest = state.health.find(item => item.last_event_at);
  const rows = [
    { type: "success", title: "Events processed", desc: `${fmt(periodEvents)} attempts in ${dashboardWindowLabel().toLowerCase()}`, time: "now" },
    { type: "info", title: "Clients synced", desc: `${fmt(state.clients.length)} clients loaded from production backend`, time: "now" },
    warnings[0] ? { type: "warning", title: "Health warning detected", desc: `${warnings[0].client.name} is ${warnings[0].health.status}`, time: "now" } : null,
    latest ? { type: "success", title: "Latest event received", desc: `${latest.client_name} reported activity`, time: trimTime(latest.last_event_at) } : null,
    { type: "info", title: "User admin logged in", desc: "sysop@buykori.app", time: "session" }
  ].filter(Boolean);
  return rows;
}
function renderActivity() {
  const rows = derivedActivities();
  const html = rows.map((row, index) => `<div class="stream-item" style="${index === rows.length - 1 ? "border-bottom:none" : ""}">
    <div class="stream-dot ${row.type}"></div>
    <div class="stream-content"><div class="stream-title">${esc(row.title)}</div><div class="stream-desc">${esc(row.desc)}</div></div>
    <div class="stream-time">${esc(row.time)}</div>
  </div>`).join("");
  $("activityRows").innerHTML = html;
  $("logsRows").innerHTML = html;
}

function derivedAlerts() {
  const rows = state.clients.map(client => ({ client, health: overviewHealthFor(client) }));
  const critical = rows.filter(row => String(row.health.status).toLowerCase() === "critical");
  const warning = rows.filter(row => String(row.health.status).toLowerCase() === "warning");
  const inactive = state.clients.filter(client => !client.is_active);
  const noDomain = state.clients.filter(client => !(client.display_domain || client.domain));
  const courierStatusMonitor = state.serverHealth?.worker_monitor?.courier_status_monitor || {};
  const unknownCourierStatuses = Number(courierStatusMonitor.unknown_status_total || 0);
  const latestUnknownCourierStatus = (courierStatusMonitor.recent || [])[0];
  const unknownCourierDescription = latestUnknownCourierStatus
    ? `${String(latestUnknownCourierStatus.provider || "courier").toUpperCase()} order ${latestUnknownCourierStatus.order_reference || "-"}: ${latestUnknownCourierStatus.raw_status || "unknown"}`
    : "Review provider status mapping in Server Status";
  const webhookTotals = state.serverHealth?.worker_monitor?.courier_webhook_monitor?.totals || {};
  const webhookAuthFailures = Number(webhookTotals.auth_failed || 0);
  const webhookRateLimited = Number(webhookTotals.rate_limited || 0);
  const smokeMonitor = state.serverHealth?.worker_monitor?.courier_smoke_monitor || {};
  const smokeUnhealthy = ["failed", "stale", "never_run"].includes(String(smokeMonitor.status || "never_run"));
  return [
    smokeUnhealthy ? { rank: "High", cls: "alert-high", title: "Courier production smoke monitor unhealthy", desc: smokeMonitor.status === "failed" ? "The latest automated courier health check failed" : "The automated courier health check is stale or has not run", value: String(smokeMonitor.status || "never_run") } : null,
    webhookAuthFailures ? { rank: "Medium", cls: "alert-medium", title: "Courier webhook authentication failures", desc: "Review provider webhook secrets and recent callback traffic", value: `${webhookAuthFailures}` } : null,
    webhookRateLimited ? { rank: "Medium", cls: "alert-medium", title: "Courier webhook rate limit triggered", desc: "Review provider burst traffic in Server Status", value: `${webhookRateLimited}` } : null,
    unknownCourierStatuses ? { rank: "Medium", cls: "alert-medium", title: "Unknown courier statuses", desc: unknownCourierDescription, value: `${unknownCourierStatuses}`, action: "acknowledge-courier-statuses" } : null,
    critical.length ? { rank: "High", cls: "alert-high", title: "Critical client health", desc: `Affects ${critical.length} client${critical.length > 1 ? "s" : ""}`, value: `${critical.length}` } : null,
    warning.length ? { rank: "Medium", cls: "alert-medium", title: "Warning status detected", desc: `Affects ${warning.length} client${warning.length > 1 ? "s" : ""}`, value: `${warning.length}` } : null,
    inactive.length ? { rank: "Medium", cls: "alert-medium", title: "Inactive clients", desc: `Affects ${inactive.length} client${inactive.length > 1 ? "s" : ""}`, value: `${inactive.length}` } : null,
    noDomain.length ? { rank: "Low", cls: "alert-low", title: "Domain validation warning", desc: `Affects ${noDomain.length} domain${noDomain.length > 1 ? "s" : ""}`, value: `${noDomain.length}` } : null
  ].filter(Boolean);
}
function renderAlerts() {
  const queue = courierQueueCounts();
  const queueAlerts = (queue.alerts || []).map(alert => ({
    rank: alert.severity === "critical" ? "High" : "Medium",
    cls: alert.severity === "critical" ? "alert-high" : "alert-medium",
    title: alert.code === "dead_letter_jobs" ? "Courier booking dead letters" : alert.code === "processing_stalled" ? "Courier worker stalled" : "Courier booking queue delayed",
    desc: alert.count ? `${fmt(alert.count)} job${alert.count > 1 ? "s" : ""} need operator retry` : `Age ${formatDuration(alert.age_seconds)}`,
    value: alert.count || formatDuration(alert.age_seconds)
  }));
  const rows = [...queueAlerts, ...derivedAlerts()];
  $("alertCount").textContent = rows.length;
  $("alertRows").innerHTML = rows.map((row, index) => `<div class="stream-item" style="align-items:center;${index === rows.length - 1 ? "border-bottom:none" : ""}">
    <svg style="width:20px;height:20px;color:${row.cls === "alert-high" ? "var(--danger)" : row.cls === "alert-medium" ? "var(--warning)" : "var(--primary)"}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
    <div class="stream-content"><div class="stream-title">${esc(row.title)}</div><div class="stream-desc">${esc(row.desc)}</div></div>
    <div class="alert-rank ${row.cls}">${esc(row.rank)}</div>
    <div style="font-size:12px;color:var(--text-muted);font-weight:700">${esc(row.value)}</div>
    ${row.action === "acknowledge-courier-statuses" ? `<button class="btn btn-outline btn-sm" onclick="acknowledgeUnknownCourierStatuses()">Acknowledge</button>` : ""}
  </div>`).join("") || `<div class="stream-item" style="align-items:center;border-bottom:none"><div class="stream-dot success"></div><div class="stream-content"><div class="stream-title">System Status</div><div class="stream-desc">All systems operational</div></div></div>`;
}

async function acknowledgeUnknownCourierStatuses() {
  if (!window.confirm("Acknowledge the current unknown courier status alerts?")) return;
  try {
    await api("/admin/api/courier-status-monitor/acknowledge", { method: "POST" });
    await loadAll();
  } catch (error) {
    window.alert(readableApiError(error, "Could not acknowledge courier status alerts."));
  }
}

function renderCourierQueue() {
  const queue = courierQueueCounts();
  const jobs = state.courierQueue?.jobs || [];
  const status = String(queue.alert_status || "healthy").toLowerCase();
  renderCourierQueueRefreshMeta();
  if ($("courierQueueStatus")) {
    $("courierQueueStatus").className = `status-badge ${courierQueueStatusClass(status)}`;
    $("courierQueueStatus").textContent = status.toUpperCase();
  }
  if ($("courierQueueQueued")) $("courierQueueQueued").textContent = fmt(queue.queued || 0);
  if ($("courierQueueProcessing")) $("courierQueueProcessing").textContent = fmt(queue.processing || 0);
  if ($("courierQueueDead")) $("courierQueueDead").textContent = fmt(queue.dead || 0);
  if ($("courierQueueSent")) $("courierQueueSent").textContent = fmt(queue.sent || 0);
  if ($("courierQueueOldestQueued")) $("courierQueueOldestQueued").textContent = formatDuration(queue.oldest_queued_age_seconds || 0);
  if ($("courierQueueOldestProcessing")) $("courierQueueOldestProcessing").textContent = formatDuration(queue.oldest_processing_age_seconds || 0);
  if ($("courierQueueAlerts")) {
    $("courierQueueAlerts").innerHTML = (queue.alerts || []).map(alert => `
      <div class="queue-alert queue-alert-${esc(alert.severity)}">
        <strong>${esc(alert.code.replaceAll("_", " "))}</strong>
        <span>${alert.count ? `${fmt(alert.count)} affected` : `age ${formatDuration(alert.age_seconds)}`}</span>
      </div>
    `).join("") || `<div class="queue-alert queue-alert-healthy"><strong>Healthy</strong><span>No courier queue alerts.</span></div>`;
  }
  if ($("courierQueueRows")) {
    $("courierQueueRows").innerHTML = jobs.map(job => `
      <tr>
        <td><div class="client-name">#${esc(job.id)}</div><div class="client-sub">client ${esc(job.client_id)}</div></td>
        <td><div class="client-name">${esc(job.order_id || "-")}</div><div class="client-sub">order row ${esc(job.courier_order_id)}</div></td>
        <td>${esc(job.provider)}</td>
        <td><div class="status-badge ${statusClass(job.status === "sent" ? "healthy" : job.status === "dead" ? "critical" : ["queued", "processing"].includes(job.status) ? "warning" : "inactive")}">${esc(job.status)}</div></td>
        <td>${fmt(job.attempts)} / ${fmt(job.max_attempts)}</td>
        <td>${esc(toDeviceDateTime(job.next_attempt_at))}</td>
        <td><div class="client-sub" style="max-width:260px;white-space:normal">${esc(job.last_error || "-")}</div></td>
        <td>
          <div class="queue-actions">
            <button class="btn btn-outline btn-sm" onclick="openCourierJobDrawer(${Number(job.id)})">Details</button>
            ${job.status === "dead" ? `<button class="btn btn-primary btn-sm" onclick="retryCourierBookingJob(${Number(job.id)})">Retry</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="empty">No courier jobs in queue. All clear.</td></tr>`;
  }
}

function renderRecoveryOps() {
  const data = state.incompleteOps || { counts: {}, items: [], top_clients: [], total: 0 };
  const counts = data.counts || {};
  if ($("recoveryTotal")) $("recoveryTotal").textContent = fmt(data.total || 0);
  if ($("recoveryIncomplete")) $("recoveryIncomplete").textContent = fmt(counts.incomplete || 0);
  if ($("recoveryContacted")) $("recoveryContacted").textContent = fmt(counts.contacted || 0);
  if ($("recoveryRecovered")) $("recoveryRecovered").textContent = fmt(counts.recovered || 0);
  if ($("recoveryRows")) {
    $("recoveryRows").innerHTML = (data.items || []).map(item => {
      const locked = ["recovered", "expired"].includes(String(item.status || "").toLowerCase());
      return `
        <tr>
          <td><div class="client-name">#${esc(item.id)}</div><div class="client-sub">${esc(toDeviceDateTime(item.last_activity_at))}</div></td>
          <td><div class="client-name">${esc(item.client_name)}</div><div class="client-sub">client ${esc(item.client_id)}</div></td>
          <td><div class="client-name">${esc(item.customer_name || "-")}</div><div class="client-sub">${esc(item.phone_masked || "")}</div></td>
          <td><div class="client-name">${esc(item.product_summary || "-")}</div><div class="client-sub">${fmt(item.product_count)} item${Number(item.product_count || 0) === 1 ? "" : "s"}</div></td>
          <td>${esc(item.currency || "BDT")} ${fmt(item.amount)}</td>
          <td><div class="status-badge ${statusClass(item.status === "recovered" ? "healthy" : item.status === "incomplete" ? "warning" : item.status === "ignored" ? "inactive" : "warning")}">${esc(item.status)}</div></td>
          <td><div class="client-sub">${esc(item.order_id || "-")}</div></td>
          <td>
            <div class="queue-actions">
              ${item.page_url ? `<a class="btn btn-outline btn-sm" href="${esc(item.page_url)}" target="_blank" rel="noreferrer">Open</a>` : ""}
              ${!locked ? `<button class="btn btn-outline btn-sm" onclick="updateRecoveryStatus(${Number(item.id)}, 'contacted')">Contacted</button><button class="btn btn-outline btn-sm" onclick="updateRecoveryStatus(${Number(item.id)}, 'ignored')">Ignore</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="8" class="empty">No recovery leads found.</td></tr>`;
  }
  if ($("recoveryTopClients")) {
    $("recoveryTopClients").innerHTML = (data.top_clients || []).map(row => `
      <div class="queue-alert queue-alert-warning">
        <strong>${esc(row.client_name)}</strong>
        <span>${fmt(row.count)} lead${Number(row.count || 0) === 1 ? "" : "s"}</span>
      </div>
    `).join("") || `<div class="queue-alert queue-alert-healthy"><strong>Quiet</strong><span>No recovery concentration.</span></div>`;
  }
}

function renderNotificationOps() {
  const jobs = state.notificationJobs || { total: 0, items: [] };
  const items = jobs.items || [];
  const failed = items.filter(item => item.status === "failed").length;
  const pending = items.filter(item => item.status === "pending").length;
  const sent = items.filter(item => item.status === "sent").length;
  if ($("notificationTotal")) $("notificationTotal").textContent = fmt(jobs.total || items.length);
  if ($("notificationPending")) $("notificationPending").textContent = fmt(pending);
  if ($("notificationFailed")) $("notificationFailed").textContent = fmt(failed);
  if ($("whatsappActive")) $("whatsappActive").textContent = fmt((state.whatsappInstances || []).filter(inst => inst.status === "active").length);
  const activeSenders = (state.whatsappInstances || []).filter(inst => inst.status === "active");
  const assignedInactiveSenders = (state.whatsappInstances || []).filter(inst => inst.status !== "active" && Number(inst.client_count || 0) > 0);
  if ($("whatsappHealthAlert")) {
    const alert = $("whatsappHealthAlert");
    if (!activeSenders.length || assignedInactiveSenders.length) {
      alert.style.display = "block";
      alert.className = "queue-health-banner queue-alert-critical";
      alert.textContent = !activeSenders.length
        ? "No active WhatsApp sender is available. Pair or activate a sender before notifications can be delivered."
        : `${assignedInactiveSenders.length} disconnected sender(s) still have assigned clients. Reassign those clients to an active sender.`;
    } else {
      alert.style.display = "none";
      alert.textContent = "";
    }
  }
  if ($("notificationRows")) {
    $("notificationRows").innerHTML = items.map(job => `
      <tr>
        <td><div class="client-name">#${esc(job.id)}</div><div class="client-sub">${esc(toDeviceDateTime(job.created_at))}</div></td>
        <td><div class="client-name">Client ${esc(job.client_id)}</div><div class="client-sub">WA ${esc(job.whatsapp_instance_id || "-")}</div></td>
        <td>${esc(job.event_type)}</td>
        <td><div class="status-badge ${statusClass(job.status === "sent" ? "healthy" : job.status === "failed" ? "critical" : "warning")}">${esc(job.status)}</div></td>
        <td>${fmt(job.attempt_count)} / ${fmt(job.max_attempts)}</td>
        <td>
          <div class="client-sub" style="max-width:300px;white-space:normal">${esc(job.error_message || job.message_preview || "-")}</div>
          ${job.status === "failed" ? `<button class="copy-icon danger-link" onclick="retryNotificationJob(${Number(job.id)})">Retry now</button>` : ""}
        </td>
        <td>${esc(toDeviceDateTime(job.next_attempt_at || job.sent_at))}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" class="empty">No notification jobs found.</td></tr>`;
  }
  if ($("whatsappInstanceRows")) {
    const ageLabel = value => {
      if (!value) return "Never checked";
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
      if (seconds < 120) return `${seconds}s ago`;
      if (seconds < 7200) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 172800) return `${Math.floor(seconds / 3600)}h ago`;
      return `${Math.floor(seconds / 86400)}d ago`;
    };
    $("whatsappInstanceRows").innerHTML = (state.whatsappInstances || []).map(inst => `
      <tr>
        <td><div class="client-name">${esc(inst.instance_name)}</div><div class="client-sub">#${esc(inst.id)} ${esc(inst.provider)}</div></td>
        <td>${esc(inst.phone_number || "-")}</td>
        <td><div class="status-badge ${statusClass(inst.status === "active" ? "healthy" : "inactive")}">${esc(inst.status)}</div><div class="client-sub">Health ${esc(ageLabel(inst.last_health_check_at))}</div>${inst.status !== "active" ? `<div class="client-sub">Disconnected ${esc(ageLabel(inst.updated_at))}</div>` : ""}</td>
        <td>${fmt(inst.client_count)}</td>
        <td><div class="client-name">${fmt(inst.sent_24h)} sent / 24h</div><div class="client-sub">${fmt(inst.sent_7d)} sent, ${fmt(inst.failed_7d)} failed / 7d</div></td>
        <td>${esc(toDeviceDateTime(inst.last_sent_at || inst.last_health_check_at))}</td>
        <td>
          <button class="copy-icon" onclick="editWhatsAppInstance(${Number(inst.id)})">Edit</button>
          <button class="copy-icon" onclick="connectWhatsAppInstance(${Number(inst.id)})">Pair Code</button>
          <button class="copy-icon" onclick="checkWhatsAppInstanceState(${Number(inst.id)})">Check</button>
          <button class="copy-icon" onclick="updateWhatsAppInstanceStatus(${Number(inst.id)}, 'active')">Activate</button>
          <button class="copy-icon" onclick="updateWhatsAppInstanceStatus(${Number(inst.id)}, 'paused')">Pause</button>
          <button class="copy-icon" onclick="updateWhatsAppInstanceStatus(${Number(inst.id)}, 'banned')">Banned</button>
          <button class="copy-icon" onclick="logoutWhatsAppInstance(${Number(inst.id)})" ${inst.status === "active" ? "" : "disabled title=\"Sender is already disconnected\""}>Logout</button>
          <button class="copy-icon danger-link" onclick="deleteWhatsAppInstance(${Number(inst.id)})" ${Number(inst.client_count || 0) === 0 ? "" : `disabled title=\"Assigned to ${Number(inst.client_count)} client(s)\"`}>Remove</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="7" class="empty">No WhatsApp senders configured.</td></tr>`;
  }
}

function renderWhatsAppInstanceSelect(selectedId) {
  const select = $("editWhatsAppInstance");
  if (!select) return;
  const selected = selectedId ? String(selectedId) : "";
  const options = (state.whatsappInstances || []).map(inst => {
    const label = `${inst.instance_name} (${inst.status}${inst.phone_number ? `, ${inst.phone_number}` : ""})`;
    return `<option value="${esc(inst.id)}" ${String(inst.id) === selected ? "selected" : ""}>${esc(label)}</option>`;
  }).join("");
  select.innerHTML = `<option value="">Auto-select active sender</option>${options}`;
}

function renderPairingResult(data) {
  latestPairingInstanceId = data?.instance?.id || null;
  latestPairingCode = data?.pairing?.pairingCode || "";
  const panel = $("waPairingPanel");
  if (!panel) return;
  panel.style.display = "block";
  $("waPairingCode").textContent = latestPairingCode || "QR code required";
  $("waPairingHelp").textContent = latestPairingCode
    ? "Open WhatsApp on the sender phone, go to Linked devices, choose Link with phone number instead, then enter this code."
    : "Pairing code was not returned. Copy the raw QR code value below and scan/connect it from Evolution if needed.";
  const raw = data?.pairing?.code || "";
  const qrSection = $("waQrSection");
  const qrCanvas = $("waQrCanvas");
  if (qrCanvas) {
    qrCanvas.replaceChildren();
    qrCanvas.classList.remove("is-unavailable");
  }
  if (qrSection) qrSection.style.display = raw ? "block" : "none";
  if (raw && qrCanvas) {
    if (typeof QRCode === "function") {
      new QRCode(qrCanvas, {
        text: raw,
        width: 240,
        height: 240,
        colorDark: "#111827",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrCanvas.textContent = "QR renderer could not load. Use the pairing code instead.";
      qrCanvas.classList.add("is-unavailable");
    }
  }
  const rawDetails = $("waQrRawDetails");
  if (rawDetails) rawDetails.style.display = raw ? "block" : "none";
  if ($("waQrRaw")) {
    $("waQrRaw").textContent = raw;
  }
}

function copyPairingCode() {
  if (!latestPairingCode) {
    showToast("No pairing code available yet.");
    return;
  }
  navigator.clipboard.writeText(latestPairingCode).then(() => showToast("Pairing code copied."));
}

async function createWhatsAppInstance() {
  const msg = $("waInstanceMsg");
  const payload = {
    instance_name: $("waInstanceName")?.value.trim() || "",
    phone_number: $("waInstancePhone")?.value.trim() || null,
    provider: $("waInstanceProvider")?.value.trim() || "evolution",
    base_url: $("waInstanceBaseUrl")?.value.trim() || null,
    status: "active"
  };
  if (!payload.instance_name) {
    if (msg) {
      msg.textContent = "Instance name is required.";
      msg.style.color = "var(--danger)";
    }
    return;
  }
  if (!payload.phone_number) {
    if (msg) {
      msg.textContent = "Sender phone is required for pairing.";
      msg.style.color = "var(--danger)";
    }
    return;
  }
  try {
    if (msg) {
      msg.textContent = "Creating sender and requesting pairing code...";
      msg.style.color = "var(--success)";
    }
    const result = await api("/admin/whatsapp-instances/provision", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    renderPairingResult(result);
    ["waInstanceName", "waInstancePhone", "waInstanceBaseUrl"].forEach(id => {
      if ($(id)) $(id).value = "";
    });
    if ($("waInstanceProvider")) $("waInstanceProvider").value = "evolution";
    await refreshNotificationOps({ silent: true });
    showToast("WhatsApp sender created. Enter the pairing code on the phone.");
    if (msg) msg.textContent = "Pairing code ready.";
  } catch (error) {
    if (msg) {
      msg.textContent = readableApiError(error, "Failed to connect sender.");
      msg.style.color = "var(--danger)";
    }
  }
}

async function registerExistingWhatsAppInstance() {
  const msg = $("waInstanceMsg");
  const payload = {
    instance_name: $("waInstanceName")?.value.trim() || "",
    phone_number: $("waInstancePhone")?.value.trim() || null,
    provider: $("waInstanceProvider")?.value.trim() || "evolution",
    base_url: $("waInstanceBaseUrl")?.value.trim() || null,
    status: "active"
  };
  if (!payload.instance_name) {
    if (msg) {
      msg.textContent = "Instance name is required.";
      msg.style.color = "var(--danger)";
    }
    return;
  }
  try {
    if (msg) {
      msg.textContent = "Registering existing connected sender...";
      msg.style.color = "var(--success)";
    }
    await api("/admin/whatsapp-instances", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshNotificationOps({ silent: true });
    showToast("Existing WhatsApp sender registered.");
    if (msg) msg.textContent = "Existing sender registered.";
  } catch (error) {
    if (msg) {
      msg.textContent = readableApiError(error, "Failed to register sender.");
      msg.style.color = "var(--danger)";
    }
  }
}

async function editWhatsAppInstance(instanceId) {
  const inst = (state.whatsappInstances || []).find(item => String(item.id) === String(instanceId));
  if (!inst) return;
  const instance_name = window.prompt("Instance name", inst.instance_name || "");
  if (instance_name === null) return;
  const phone_number = window.prompt("Sender phone number", inst.phone_number || "");
  if (phone_number === null) return;
  const base_url = window.prompt("Provider base URL (optional)", inst.base_url || "");
  if (base_url === null) return;
  try {
    await api(`/admin/whatsapp-instances/${instanceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        instance_name,
        phone_number,
        base_url
      })
    });
    await refreshNotificationOps({ silent: true });
    showToast("WhatsApp sender updated.");
  } catch (error) {
    showToast(`Sender update failed: ${readableApiError(error)}`);
  }
}

async function updateWhatsAppInstanceStatus(instanceId, status) {
  const confirmed = await askAdminDecision({
    title: "Update WhatsApp Sender",
    message: `Mark sender #${instanceId} as ${status}?`,
    detail: status === "active"
      ? "This sender can be used for new WhatsApp notifications."
      : "Workers will skip this sender and use another active sender when possible.",
    confirmLabel: "Update Status"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/whatsapp-instances/${instanceId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await refreshNotificationOps({ silent: true });
    showToast(`WhatsApp sender marked ${status}.`);
  } catch (error) {
    showToast(`Status update failed: ${readableApiError(error)}`);
  }
}

async function connectWhatsAppInstance(instanceId) {
  try {
    const result = await api(`/admin/whatsapp-instances/${instanceId}/connect`, { method: "POST" });
    renderPairingResult(result);
    await refreshNotificationOps({ silent: true });
    showToast("Pairing code refreshed.");
  } catch (error) {
    showToast(`Pairing failed: ${readableApiError(error)}`);
  }
}

async function checkWhatsAppInstanceState(instanceId) {
  try {
    const result = await api(`/admin/whatsapp-instances/${instanceId}/connection-state`);
    state.whatsappInstances = (state.whatsappInstances || []).map(inst => String(inst.id) === String(instanceId) ? result.instance : inst);
    renderNotificationOps();
    showToast(`WhatsApp state: ${result.state || result.instance?.status || "unknown"}`);
  } catch (error) {
    showToast(`State check failed: ${readableApiError(error)}`);
  }
}

async function checkLatestPairingState() {
  if (!latestPairingInstanceId) {
    showToast("No recent pairing sender selected.");
    return;
  }
  await checkWhatsAppInstanceState(latestPairingInstanceId);
}

async function logoutWhatsAppInstance(instanceId) {
  const instance = (state.whatsappInstances || []).find(item => Number(item.id) === Number(instanceId));
  if (instance && instance.status !== "active") {
    showToast("WhatsApp sender is already disconnected.");
    return;
  }
  const confirmed = await askAdminDecision({
    title: "Logout WhatsApp Sender",
    message: `Logout sender #${instanceId} from WhatsApp?`,
    detail: "The sender will stop sending until it is paired again.",
    confirmLabel: "Logout Sender",
    confirmClass: "btn-danger"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/whatsapp-instances/${instanceId}/logout`, { method: "POST" });
    await refreshNotificationOps({ silent: true });
    showToast("WhatsApp sender logged out.");
  } catch (error) {
    showToast(`Logout failed: ${readableApiError(error)}`);
  }
}

async function deleteWhatsAppInstance(instanceId) {
  const instance = (state.whatsappInstances || []).find(item => Number(item.id) === Number(instanceId));
  if (!instance) return;
  if (Number(instance.client_count || 0) > 0) {
    showToast(`Reassign ${instance.client_count} client(s) before removing this sender.`);
    return;
  }
  const confirmed = await askAdminDecision({
    title: "Remove WhatsApp Sender",
    message: `Permanently remove ${instance.instance_name}?`,
    detail: "This deletes the Evolution instance and its portal record. This action cannot be undone.",
    confirmLabel: "Remove Sender",
    confirmClass: "btn-danger"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/whatsapp-instances/${instanceId}`, { method: "DELETE" });
    if (Number(latestPairingInstanceId) === Number(instanceId)) {
      latestPairingInstanceId = null;
      latestPairingCode = "";
      if ($("waPairingPanel")) $("waPairingPanel").style.display = "none";
    }
    await refreshNotificationOps({ silent: true });
    showToast("WhatsApp sender removed.");
  } catch (error) {
    await refreshNotificationOps({ silent: true });
    showToast(`Remove failed: ${readableApiError(error)}`);
  }
}

async function retryNotificationJob(jobId) {
  const confirmed = await askAdminDecision({
    title: "Retry WhatsApp Notification",
    message: `Retry notification job #${jobId} now?`,
    detail: "The job will use the currently available active sender and restart its retry allowance.",
    confirmLabel: "Retry Now"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/notification-jobs/${jobId}/retry`, { method: "POST" });
    await refreshNotificationOps({ silent: true });
    showToast("Notification queued for retry.");
  } catch (error) {
    showToast(`Retry failed: ${readableApiError(error)}`);
  }
}

async function refreshCourierQueue(options = {}) {
  if (state.courierQueueRefreshing) return;
  state.courierQueueRefreshing = true;
  const silent = Boolean(options.silent);
  try {
    state.courierQueue = await api("/admin/api/courier-booking-queue?limit=20");
    state.summary = { ...(state.summary || {}), courier_booking_queue: state.courierQueue.counts };
    state.courierQueueLastRefresh = new Date();
    renderSummary();
    renderAlerts();
    renderCourierQueue();
    if (state.activeCourierJobId) renderCourierJobDrawer(state.activeCourierJobId);
  } catch (error) {
    if (!silent) showToast(`Queue refresh failed: ${error.message || "unknown error"}`);
  } finally {
    state.courierQueueRefreshing = false;
    renderCourierQueueRefreshMeta();
  }
}

function startCourierQueueAutoRefresh() {
  stopCourierQueueAutoRefresh();
  if (!state.courierQueueAutoRefresh) {
    renderCourierQueueRefreshMeta();
    return;
  }
  state.courierQueueTimer = window.setInterval(() => {
    refreshCourierQueue({ silent: true });
  }, COURIER_QUEUE_REFRESH_MS);
  renderCourierQueueRefreshMeta();
}

function stopCourierQueueAutoRefresh() {
  if (state.courierQueueTimer) {
    window.clearInterval(state.courierQueueTimer);
    state.courierQueueTimer = null;
  }
}

function toggleCourierQueueAutoRefresh() {
  state.courierQueueAutoRefresh = !state.courierQueueAutoRefresh;
  startCourierQueueAutoRefresh();
  showToast(`Courier queue auto refresh ${state.courierQueueAutoRefresh ? "enabled" : "disabled"}.`);
}

function renderCourierJobDrawer(jobId) {
  const job = courierQueueJobById(jobId);
  if (!job) {
    closeCourierJobDrawer();
    return;
  }
  state.activeCourierJobId = Number(job.id);
  const title = $("queueDrawerTitle");
  const body = $("queueDrawerBody");
  const retryButton = $("queueDrawerRetry");
  if (title) title.textContent = `Courier Job #${job.id}`;
  if (retryButton) {
    retryButton.style.display = job.status === "dead" ? "inline-flex" : "none";
    retryButton.onclick = () => retryCourierBookingJob(job.id);
  }
  if (body) {
    body.innerHTML = `
      <div class="drawer-status-row">
        <div class="status-badge ${statusClass(job.status === "sent" ? "healthy" : job.status === "dead" ? "critical" : ["queued", "processing"].includes(job.status) ? "warning" : "inactive")}">${esc(job.status)}</div>
        <span>${esc(job.provider || "-")}</span>
      </div>
      <div class="drawer-grid">
        <div><span>Order ID</span><strong>${esc(job.order_id || "-")}</strong></div>
        <div><span>Client ID</span><strong>${esc(job.client_id)}</strong></div>
        <div><span>Courier Order Row</span><strong>${esc(job.courier_order_id)}</strong></div>
        <div><span>Attempts</span><strong>${fmt(job.attempts)} / ${fmt(job.max_attempts)}</strong></div>
        <div><span>Created</span><strong>${esc(toDeviceDateTime(job.created_at))}</strong></div>
        <div><span>Next Attempt</span><strong>${esc(toDeviceDateTime(job.next_attempt_at))}</strong></div>
        <div><span>Locked At</span><strong>${esc(toDeviceDateTime(job.locked_at))}</strong></div>
        <div><span>Locked By</span><strong>${esc(job.locked_by || "-")}</strong></div>
        <div><span>Sent At</span><strong>${esc(toDeviceDateTime(job.sent_at))}</strong></div>
      </div>
      <div class="drawer-block">
        <span>Last Error</span>
        <pre>${esc(job.last_error || "No provider error recorded.")}</pre>
      </div>
    `;
  }
}

function openCourierJobDrawer(jobId) {
  renderCourierJobDrawer(jobId);
  const overlay = $("queueDrawerOverlay");
  if (overlay) overlay.style.display = "flex";
}

function closeCourierJobDrawer() {
  state.activeCourierJobId = null;
  const overlay = $("queueDrawerOverlay");
  if (overlay) overlay.style.display = "none";
}

async function retryCourierBookingJob(jobId) {
  const confirmed = await askAdminDecision({
    title: "Retry Courier Job",
    message: `Retry courier booking job #${jobId}?`,
    detail: "The job will be moved back to the queue and the worker will try to book it again.",
    confirmLabel: "Retry Job"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/api/courier-booking-queue/${jobId}/retry`, { method: "POST" });
    showToast(`Courier booking job #${jobId} requeued.`);
    await refreshCourierQueue();
  } catch (error) {
    showToast(`Retry failed: ${error.message || "unknown error"}`);
  }
}

function toDeviceDateTime(value) {
  if (!value) return "-";
  try {
    let iso = String(value);
    if (!iso.endsWith("Z") && !iso.includes("+") && !iso.includes("-", 10)) {
      iso += "Z";
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) return value;
    const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return `${dateStr} ${timeStr}`;
  } catch (e) {
    return value;
  }
}

function trimTime(value) {
  if (!value) return "recent";
  try {
    let iso = String(value);
    if (!iso.endsWith("Z") && !iso.includes("+") && !iso.includes("-", 10)) {
      iso += "Z";
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "recent";
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch (e) {
    return "recent";
  }
}

function renderAll() {
  renderSummary();
  renderIntegrationRows();
  renderClientRows();
  renderSiteBindings();
  renderHealthRows();
  renderMatrixRows();
  renderActivity();
  renderAlerts();
  renderCourierQueue();
  renderRecoveryOps();
  renderNotificationOps();
  renderClientIntelligence();
  renderOpsMonitor();
}

async function refreshRecoveryOps(options = {}) {
  const silent = Boolean(options.silent);
  try {
    const status = $("recoveryStatusFilter")?.value || "";
    const clientId = $("recoveryClientFilter")?.value || "";
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    if (clientId) params.set("client_id", clientId);
    state.incompleteOps = await api(`/admin/api/incomplete-checkouts?${params.toString()}`);
    renderRecoveryOps();
    if (!silent) showToast("Recovery data refreshed.");
  } catch (error) {
    if (!silent) showToast(`Recovery refresh failed: ${readableApiError(error)}`);
  }
}

async function refreshNotificationOps(options = {}) {
  const silent = Boolean(options.silent);
  try {
    const status = $("notificationStatusFilter")?.value || "";
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    const [jobs, instances] = await Promise.all([
      api(`/admin/notification-jobs?${params.toString()}`),
      api("/admin/whatsapp-instances")
    ]);
    state.notificationJobs = jobs;
    state.whatsappInstances = Array.isArray(instances) ? instances : [];
    renderNotificationOps();
    if (!silent) showToast("Notification data refreshed.");
  } catch (error) {
    if (!silent) showToast(`Notification refresh failed: ${readableApiError(error)}`);
  }
}

async function updateRecoveryStatus(checkoutId, status) {
  const confirmed = await askAdminDecision({
    title: "Update Recovery Lead",
    message: `Mark recovery lead #${checkoutId} as ${status}?`,
    detail: "This updates the client-visible recovery status.",
    confirmLabel: "Update Status"
  });
  if (!confirmed) return;
  try {
    await api(`/admin/api/incomplete-checkouts/${checkoutId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    showToast(`Recovery lead #${checkoutId} marked ${status}.`);
    await refreshRecoveryOps({ silent: true });
  } catch (error) {
    showToast(`Recovery update failed: ${readableApiError(error)}`);
  }
}

async function refreshSiteBindings(options = {}) {
  try {
    const res = await api("/admin/api/site-bindings?status=all");
    state.siteBindings = res.bindings || [];
    populateBindingClientFilters();
    renderSiteBindings();
    if (!options.silent) showToast("Site bindings refreshed.");
  } catch (error) {
    if (!options.silent) showToast(`Site binding refresh failed: ${error.message || "unknown error"}`);
  }
}

function prepareSiteBindingTransfer(bindingId) {
  const binding = (state.siteBindings || []).find(item => Number(item.id) === Number(bindingId));
  if (!binding) return;
  if ($("transferSiteHost")) $("transferSiteHost").value = binding.site_host || binding.root_domain || "";
  if ($("bindingClientFilter")) $("bindingClientFilter").value = String(binding.client_id || "");
  if ($("transferReason") && !$("transferReason").value.trim()) {
    $("transferReason").value = `Verified owner requested transfer for ${binding.root_domain || binding.site_host}.`;
  }
  renderSiteBindings();
  $("transferSiteHost")?.focus();
}

async function releaseSiteBinding(bindingId) {
  const binding = (state.siteBindings || []).find(item => Number(item.id) === Number(bindingId));
  if (!binding) return;
  const siteName = binding.root_domain || binding.site_host;
  const reason = await askAdminDecision({
    title: "Release Connected Site",
    message: `Release active binding for ${siteName}?`,
    detail: "Tracking will require reconnect after this site is released.",
    confirmLabel: "Release Site",
    confirmClass: "btn-danger",
    inputLabel: "Support Reason",
    inputPlaceholder: `Why are you releasing ${siteName}?`,
    inputRequired: true
  });
  if (!reason) return;
  try {
    await api(`/admin/api/site-bindings/${bindingId}/release`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
    showToast("Site binding released.");
    await refreshSiteBindings();
  } catch (error) {
    showToast(`Release failed: ${error.message || "unknown error"}`);
  }
}

async function transferSiteBinding() {
  const siteHost = $("transferSiteHost")?.value.trim();
  const targetClientId = $("transferTargetClient")?.value;
  const reason = $("transferReason")?.value.trim();
  const msg = $("siteBindingMsg");
  if (msg) {
    msg.style.color = "var(--danger)";
    msg.textContent = "";
  }
  if (!siteHost || !targetClientId || !reason) {
    if (msg) msg.textContent = "Site host, target client, and support reason are required.";
    return;
  }
  const confirmed = await askAdminDecision({
    title: "Transfer Connected Site",
    message: `Transfer ${siteHost} to client #${targetClientId}?`,
    detail: "The selected client will own this connected site after the transfer.",
    confirmLabel: "Transfer Site"
  });
  if (!confirmed) return;
  if (msg) {
    msg.style.color = "var(--success)";
    msg.textContent = "Transferring binding...";
  }
  try {
    await api("/admin/api/site-bindings/transfer", {
      method: "POST",
      body: JSON.stringify({
        site_host: siteHost,
        target_client_id: Number(targetClientId),
        reason
      })
    });
    if (msg) msg.textContent = "Binding transferred.";
    $("transferReason").value = "";
    await loadAll();
    setTab("siteBindings");
  } catch (error) {
    if (msg) {
      msg.style.color = "var(--danger)";
      msg.textContent = `Transfer failed: ${error.message || "unknown error"}`;
    }
  }
}

async function toggleClient(id, is_active) {
  await api(`/admin/api/clients/${id}`, { method: "PATCH", body: JSON.stringify({ is_active }) });
  await loadAll();
}

async function createClient() {
  $("createMsg").style.color = "var(--success)";
  $("createMsg").textContent = "Creating...";
  try {
    await api("/admin/api/clients", {
      method: "POST",
      body: JSON.stringify({
        name: $("newName").value,
        domain: $("newDomain").value,
        pixel_id: $("newPixel").value,
        access_token: $("newToken").value,
        tiktok_pixel_id: $("newTiktokPixel").value || null,
        ga4_measurement_id: $("newGa4").value || null
      })
    });
    $("createMsg").textContent = "Client created.";
    await loadAll();
    setTab("clients");
  } catch (error) {
    $("createMsg").style.color = "var(--danger)";
    $("createMsg").textContent = "Create failed. Check required fields and admin key.";
  }
}

async function setDashboardWindow(window) {
  const allowed = new Set(["24h", "7d", "30d"]);
  const nextWindow = allowed.has(window) ? window : "24h";
  const requestId = ++state.dashboardWindowRequestId;
  state.dashboardWindow = nextWindow;
  state.dashboardWindowAbortController?.abort();
  const controller = new AbortController();
  state.dashboardWindowAbortController = controller;
  if ($("dashboardWindow")) $("dashboardWindow").disabled = true;
  if ($("eventsTrend")) $("eventsTrend").textContent = `Loading ${dashboardWindowLabel(nextWindow).toLowerCase()}...`;
  try {
    const summary = await api(`/admin/api/summary?window=${encodeURIComponent(nextWindow)}`, { signal: controller.signal });
    if (requestId !== state.dashboardWindowRequestId) return;
    state.summary = summary;
    renderSummary();
    renderIntegrationRows();
    renderActivity();
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== state.dashboardWindowRequestId) return;
    showToast(readableApiError(error, "Could not load the selected timeframe."), "error");
    renderSummary();
  } finally {
    if (requestId === state.dashboardWindowRequestId) {
      state.dashboardWindowAbortController = null;
      if ($("dashboardWindow")) $("dashboardWindow").disabled = false;
    }
  }
}
function setTab(tab) {
  document.querySelectorAll(".nav-item[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === tab));
  if (window.innerWidth <= 820 && $("sidebar").classList.contains("open")) toggleSidebar();
  if (tab === "courierQueue") refreshCourierQueue({ silent: true });
  if (tab === "siteBindings") refreshSiteBindings({ silent: true });
  if (tab === "recoveryOps") refreshRecoveryOps({ silent: true });
  if (tab === "notificationOps") refreshNotificationOps({ silent: true });
}

function downloadReport() {
  const summary = state.summary || {};
  const attempts = Number(summary.total_events || 0);
  const failed = Math.min(Number(summary.failed_events || 0), attempts);
  const successful = Math.max(attempts - failed, 0);
  const rows = [
    ["Buykori Admin Report", dashboardWindowLabel()],
    ["Period start", summary.window_started_at || ""],
    ["Period end", summary.window_ended_at || ""],
    [],
    ["Metric", "Value"],
    ["Total clients", summary.total_clients || 0],
    ["Active clients", summary.active_clients || 0],
    ["Event attempts", attempts],
    ["Successful deliveries", successful],
    ["Failed deliveries", failed],
    ["Delivery success", attempts ? `${((successful / attempts) * 100).toFixed(2)}%` : "No data"],
    [],
    ["Client", `Events ${dashboardWindowShortLabel()}`],
    ...state.clients.map(client => [client.name, Number(summary.client_events?.[String(client.id)] || 0)])
  ];
  const csv = rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `buykori-admin-${state.dashboardWindow}-report.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("open");
  $("hamburger").classList.toggle("open");
}

function toggleAdminPassword() {
  const input = $("adminPassword");
  const eye = $("adminPassEye");
  if (input.type === "password") {
    input.type = "text";
    eye.textContent = "Hide";
  } else {
    input.type = "password";
    eye.textContent = "Show";
  }
}

function toggleTheme() {
  const docEl = document.documentElement;
  if (docEl.classList.contains("dark")) {
    docEl.classList.remove("dark");
    localStorage.setItem("buykori_admin_theme", "light");
  } else {
    docEl.classList.add("dark");
    localStorage.setItem("buykori_admin_theme", "dark");
  }
}

let searchTimeout;
function handleSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    renderAll();
  }, 200);
}

document.querySelectorAll(".nav-item[data-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));
$("editPlanTier")?.addEventListener("change", syncBillingForPlanSelection);
$("editBillingStatus")?.addEventListener("change", syncPlanQuotaFields);
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("searchInput")?.focus();
  }
});
function showLogin() {
  adminCsrfToken = "";
  $("login").style.display = "flex";
  $("app").style.display = "none";
}

async function restoreAdminSession() {
  const response = await fetch(API_BASE + "/admin/api/session", {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) return false;

  const data = await response.json();
  adminCsrfToken = data.csrf_token || csrfFromCookie();
  return Boolean(adminCsrfToken);
}

restoreAdminSession()
  .then(restored => restored ? loadAll().then(showApp) : showLogin())
  .catch(showLogin);

// Modal Functions
let currentClientId = null;

function showToast(msg) {
  let t = document.getElementById('bk-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'bk-toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg, rgba(99,102,241,0.95), rgba(139,92,246,0.95));color:white;font-weight:700;font-size:13px;padding:12px 24px;border-radius:12px;z-index:9999;box-shadow:0 8px 24px rgba(99,102,241,0.3);transition:opacity .3s;pointer-events:none;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}

function askAdminDecision(options = {}) {
  const overlay = $("adminDecisionOverlay");
  if (!overlay) return Promise.resolve(false);
  const {
    title = "Confirm Action",
    message = "Please confirm this action.",
    detail = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    confirmClass = "btn-primary",
    inputLabel = "",
    inputPlaceholder = "",
    inputValue = "",
    inputRequired = false
  } = options;

  $("adminDecisionTitle").textContent = title;
  $("adminDecisionMessage").textContent = message;
  $("adminDecisionDetail").textContent = detail;
  $("adminDecisionDetail").style.display = detail ? "block" : "none";
  $("adminDecisionConfirm").textContent = confirmLabel;
  $("adminDecisionConfirm").className = `btn ${confirmClass}`;
  $("adminDecisionCancel").textContent = cancelLabel;
  $("adminDecisionError").textContent = "";

  const inputWrap = $("adminDecisionInputWrap");
  const input = $("adminDecisionInput");
  inputWrap.style.display = inputLabel ? "block" : "none";
  input.dataset.required = inputRequired ? "1" : "0";
  $("adminDecisionInputLabel").textContent = inputLabel || "Reason";
  input.placeholder = inputPlaceholder;
  input.value = inputValue;

  overlay.style.display = "flex";
  setTimeout(() => (inputLabel ? input : $("adminDecisionConfirm"))?.focus(), 20);

  return new Promise(resolve => {
    adminDecisionResolve = resolve;
  });
}

function closeAdminDecision(result) {
  const overlay = $("adminDecisionOverlay");
  if (overlay) overlay.style.display = "none";
  const resolve = adminDecisionResolve;
  adminDecisionResolve = null;
  if (resolve) resolve(result);
}

function confirmAdminDecision() {
  const input = $("adminDecisionInput");
  const hasInput = $("adminDecisionInputWrap")?.style.display !== "none";
  if (hasInput && input?.dataset.required === "1" && !input.value.trim()) {
    $("adminDecisionError").textContent = "Please add a support reason.";
    input.focus();
    return;
  }
  closeAdminDecision(hasInput ? input.value.trim() : true);
}

function copyText(id) {
  const el = document.getElementById(id);
  const val = modalSecrets.get(id) || el.innerText || el.value || '';
  if (!val || val.includes('*') || val.startsWith('Rotate to view')) {
    showToast('Rotate this key to generate a new revealable value.');
    return;
  }
  navigator.clipboard.writeText(val.trim()).then(() => showToast('Copied to Clipboard!'));
}

function revealSecret(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!modalSecrets.has(id)) {
    el.innerText = 'Rotate to view a new value';
    el.dataset.hidden = '1';
    showToast('Existing secrets are not loaded into the browser. Rotate to reveal a new value once.');
    return;
  }
  if (el.dataset.hidden === '1') {
    el.innerText = modalSecrets.get(id) || '';
    el.dataset.hidden = '0';
  } else {
    el.innerText = '********************************';
    el.dataset.hidden = '1';
  }
}

function switchModalTab(tab) {
  document.querySelectorAll('.modal-body .tab-btn').forEach(b => b.classList.toggle('active', b.innerText.toLowerCase().includes(tab) || b.getAttribute('onclick').includes(tab)));
  document.querySelectorAll('.modal-body .tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
}

function renderClientModalIntel(clientId) {
  const intel = intelligenceFor(clientId);
  const detailedEl = $("client360Summary");
  const quickEl = $("client360QuickSummary");
  if (!detailedEl && !quickEl) return;
  if (!intel) {
    const emptyHtml = `<div class="empty">Client intelligence not loaded yet.</div>`;
    if (detailedEl) detailedEl.innerHTML = emptyHtml;
    if (quickEl) quickEl.innerHTML = emptyHtml;
    return;
  }
  const score = intel.health_score || {};
  const owner = intel.owner || {};
  const funnel = intel.onboarding_funnel || [];
  const setup = intel.setup_snapshot || {};
  const routing = setup.event_routing || {};
  const courier = setup.courier || {};
  const whatsapp = setup.whatsapp || {};
  const hasIdentifier = value => !["", "0", "none", "null"].includes(String(value || "").trim().toLowerCase());
  const metaIdReady = hasIdentifier(setup.meta?.pixel_id);
  const tiktokIdReady = hasIdentifier(setup.tiktok?.pixel_id);
  const ga4IdReady = hasIdentifier(setup.ga4?.measurement_id);
  const metaMissing = setup.meta?.enabled ? (metaIdReady ? "Needs token" : "Needs Pixel ID") : "Off";
  const tiktokMissing = setup.tiktok?.enabled ? (tiktokIdReady ? "Needs token" : "Needs Pixel ID") : "Off";
  const ga4Missing = setup.ga4?.enabled ? (ga4IdReady ? "Needs secret" : "Needs Measurement ID") : "Off";
  const statusBadge = (ok, labelOk = "Ready", labelBad = "Missing") => (
    `<span class="status-badge ${statusClass(ok ? "healthy" : "critical")}">${ok ? labelOk : labelBad}</span>`
  );
  const routingCounts = routing.platform_counts || {};
  const courierProviders = courier.providers || {};
  const courierProviderLabel = courier.provider_label || (courier.default_provider ? courier.default_provider.toUpperCase() : "No default provider");
  const courierMissing = Array.isArray(courier.missing_credentials) ? courier.missing_credentials : [];
  const courierStatusLabel = courier.status_label || (courier.default_provider ? "Missing credentials" : "Missing");
  const courierDetail = courier.detail || `${courierProviderLabel}${courier.auto_send ? " with auto-send" : ""}`;
  const courierActionHint = courier.action_hint || (courier.auto_send && courierMissing.length ? "Auto-booking will be skipped until credentials are added." : "");
  const courierMeta = courierMissing.length
    ? `Missing: ${courierMissing.join(", ")}${courierActionHint ? ` - ${courierActionHint}` : ""}`
    : `Providers: SF ${courierProviders.steadfast ? "yes" : "no"}, Pathao ${courierProviders.pathao ? "yes" : "no"}, RedX ${courierProviders.redx ? "yes" : "no"}`;
  const whatsappDetail = whatsapp.enabled
    ? `${whatsapp.number_set ? "Owner number set" : "Owner number missing"}${whatsapp.instance_name ? ` via ${whatsapp.instance_name}` : ""}`
    : "Owner alerts are off";
  const setupCard = (title, statusHtml, detail, meta = "", action = "") => `
    <div class="setup-card">
      <div class="setup-card-head"><strong>${esc(title)}</strong>${statusHtml}</div>
      <p>${esc(detail || "-")}</p>
      ${meta ? `<span>${esc(meta)}</span>` : ""}
      ${action ? `<em>${esc(action)}</em>` : ""}
    </div>
  `;
  const summaryHtml = `
    <div class="client360-title"><strong>Setup Readiness</strong><span>Portal-managed client status</span></div>
    <div class="drawer-grid">
      <div><span>Owner</span><strong>${esc(owner.full_name || "-")}</strong></div>
      <div><span>Phone</span><strong>${esc(owner.phone_number || "-")}</strong></div>
      <div><span>Health Score</span><strong>${fmt(score.score)}% (${esc(score.status)})</strong></div>
      <div><span>Onboarding</span><strong>${doneCount(funnel)} / ${funnel.length}</strong></div>
      <div><span>Trial Follow-up</span><strong>${esc(intel.trial_followup?.reason || "No action")}</strong></div>
      <div><span>Support Notes</span><strong>${fmt(intel.support_note_count || 0)}</strong></div>
    </div>
    <div class="setup-snapshot">
      ${setupCard(
        "Meta CAPI",
        statusBadge(setup.meta?.configured, "Configured", metaMissing),
        metaIdReady ? `Pixel ${setup.meta.pixel_id}` : "No pixel ID",
        setup.meta?.test_event_code_set ? "Test code is set" : "No test code",
        setup.meta?.configured ? "Ready for Meta delivery." : "Fix in Client Portal > Settings > Conversions API."
      )}
      ${setupCard(
        "TikTok Events API",
        statusBadge(setup.tiktok?.configured, "Configured", tiktokMissing),
        tiktokIdReady ? `Pixel ${setup.tiktok.pixel_id}` : "No TikTok pixel",
        setup.tiktok?.test_event_code_set ? "Test code is set" : "No test code",
        setup.tiktok?.configured ? "Ready for TikTok delivery." : "Fix in Client Portal > Settings > Conversions API."
      )}
      ${setupCard(
        "GA4",
        statusBadge(setup.ga4?.configured, "Configured", ga4Missing),
        ga4IdReady ? `Measurement ${setup.ga4.measurement_id}` : "No measurement ID",
        "",
        setup.ga4?.configured ? "Ready for GA4 delivery." : "Fix in Client Portal > Settings > Conversions API."
      )}
      ${setupCard(
        "COD Protection",
        statusBadge(setup.cod_protection?.enabled, "On", "Off"),
        setup.cod_protection?.enabled
          ? `Auto-confirm: ${setup.cod_protection.auto_confirm_days || 0} day(s), status ${setup.cod_protection.auto_confirm_status || "completed"}`
          : "Portal master setting is off",
        "",
        "Open Client Portal > COD Protection to change purchase timing."
      )}
      ${setupCard(
        "WordPress Plugin",
        statusBadge(
          setup.plugin?.connected && !setup.plugin?.update_available,
          setup.plugin?.installed_version ? "Up to date" : "Connected",
          setup.plugin?.connected ? "Update available" : "Not connected"
        ),
        setup.plugin?.installed_version
          ? `Installed v${setup.plugin.installed_version} - Latest v${setup.plugin.latest_version || "-"}`
          : setup.plugin?.site_host || setup.plugin?.root_domain || "No active site binding",
        setup.plugin?.reported_at
          ? `WordPress ${setup.plugin.wordpress_version || "unknown"} - Reported ${toDeviceDateTime(setup.plugin.reported_at)}`
          : "Installed version not reported",
        setup.plugin?.connected ? "Reported by the WordPress plugin handshake." : "Ask client to connect the plugin."
      )}
      ${setupCard(
        "Event Routing",
        statusBadge(routing.configured, "Configured", "Default"),
        `${fmt(routing.rule_count || 0)} route(s): Meta ${fmt(routingCounts.meta || 0)}, TikTok ${fmt(routingCounts.tiktok || 0)}, GA4 ${fmt(routingCounts.ga4 || 0)}`,
        routing.configured ? "Portal-managed rules" : "Using platform defaults",
        "Fix in Client Portal > Settings > Conversions API > Event routing."
      )}
      ${setupCard(
        "Courier",
        statusBadge(courier.configured, "Configured", courierStatusLabel),
        courierDetail,
        courierMeta,
        courier.configured ? "Courier booking can run." : "Fix in Client Portal > Settings > Courier Logistics."
      )}
      ${setupCard(
        "WhatsApp Alerts",
        statusBadge(whatsapp.enabled && whatsapp.number_set && whatsapp.instance_id, "Ready", whatsapp.enabled ? "Needs setup" : "Off"),
        whatsappDetail,
        whatsapp.instance_status ? `Sender status: ${whatsapp.instance_status}` : "No sender assigned",
        whatsapp.enabled ? "Fix in Client Portal > Settings > Alerts & Notifications." : "Client has WhatsApp alerts disabled."
      )}
    </div>
    <div class="funnel-list">${funnel.map(item => `<div class="funnel-item ${item.done ? "done" : ""}"><span>${item.done ? "Done" : "Todo"}</span>${esc(item.label)}</div>`).join("")}</div>
  `;
  const quickItems = [
    ["Meta", setup.meta?.configured, metaMissing],
    ["TikTok", setup.tiktok?.configured, tiktokMissing],
    ["GA4", setup.ga4?.configured, ga4Missing],
    ["Plugin", setup.plugin?.connected && !setup.plugin?.update_available, setup.plugin?.connected ? "Update available" : "Not connected"],
    ["Courier", courier.configured, courierStatusLabel],
    ["WhatsApp", whatsapp.enabled && whatsapp.number_set && whatsapp.instance_id, whatsapp.enabled ? "Needs setup" : "Off"]
  ];
  const quickHtml = `
    <div class="client360-quick-head">
      <div><strong>Setup Readiness</strong><span>${fmt(score.score)}% health, ${doneCount(funnel)} / ${funnel.length} onboarding</span></div>
      <button type="button" class="btn btn-outline btn-sm" onclick="switchModalTab('intel')">View details</button>
    </div>
    <div class="client360-quick-items">
      ${quickItems.map(([label, ok, bad]) => `<div class="client360-quick-item ${ok ? "ready" : "attention"}"><span>${esc(label)}</span><strong>${ok ? "Ready" : esc(bad)}</strong></div>`).join("")}
    </div>
  `;
  if (detailedEl) detailedEl.innerHTML = summaryHtml;
  if (quickEl) quickEl.innerHTML = quickHtml;
}
function renderSupportNotes() {
  if (!$("supportNotesList")) return;
  $("supportNotesList").innerHTML = state.supportNotes.map(note => `
    <div class="support-note">
      <div>${esc(note.note)}</div>
      <span>${esc(toDeviceDateTime(note.created_at))} by ${esc(note.created_by || "admin")}</span>
    </div>
  `).join("") || `<div class="empty">No support notes yet.</div>`;
}

async function loadSupportNotes(clientId) {
  const res = await api(`/admin/api/clients/${clientId}/support-notes`);
  state.supportNotes = res.notes || [];
  renderSupportNotes();
}

async function addSupportNote() {
  if (!currentClientId) return;
  const note = $("supportNoteInput").value.trim();
  if (!note) return;
  await api(`/admin/api/clients/${currentClientId}/support-notes`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
  $("supportNoteInput").value = "";
  await loadSupportNotes(currentClientId);
  await loadAll();
  showToast("Support note added.");
}

function closeClientModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  currentClientId = null;
  modalSecrets.clear();
  state.supportNotes = [];
}

async function openClientModal(id) {
  currentClientId = id;
  document.getElementById('modalOverlay').style.display = 'flex';
  switchModalTab('edit');
  $("editMsg").textContent = "Loading...";
  
  try {
    const res = await api(`/admin/api/clients/${id}`);
    const c = res.client;
    
    // Populate Edit
    $("editName").value = c.name || "";
    $("editDomain").value = c.domain || "";
    $("editPlanTier").value = c.plan_tier || "free";
    $("editBillingStatus").value = c.billing_status || "free";
    $("editLimit").value = c.monthly_limit || "";
    $("editOrderLimit").value = c.orders_quota ?? selectedPlanDefaults().orders;
    $("editDailyQuota").value = c.daily_quota !== undefined && c.daily_quota !== null ? c.daily_quota : "";
    $("editRateLimit").value = c.rate_limit !== undefined && c.rate_limit !== null ? c.rate_limit : "";
    $("editFbTestCode").value = c.test_event_code || "";
    $("editTiktokTestCode").value = c.tiktok_test_event_code || "";
    $("editWebhookUrl").value = c.webhook_url || "";
    $("editActive").checked = !!c.is_active;
    $("editFb").checked = !!c.enable_facebook;
    $("editTiktok").checked = !!c.enable_tiktok;
    $("editGa4").checked = !!c.enable_ga4;
    $("editDeferred").checked = !!c.deferred_purchase;
    $("editOwnerNotifyWhatsApp").checked = !!c.owner_notify_whatsapp;
    $("editOwnerWhatsAppNumber").value = c.owner_whatsapp_number || "";
    renderWhatsAppInstanceSelect(c.whatsapp_instance_id);
    $("editMsg").textContent = "";
    
    // Populate Keys. Existing secrets are masked server-side and are not stored in browser memory.
    $("keyApi").innerText = c.api_key || "********************************";
    $("keyApi").dataset.hidden = "1";
    
    $("keyPortal").innerText = c.portal_key || "********************************";
    $("keyPortal").dataset.hidden = "1";
    
    $("keyToken").innerText = c.access_token || "********************************";
    $("keyToken").dataset.hidden = "1";
    
    // Populate setup details
    const code = `curl -X POST https://api.buykori.app/api/v1/events \\
  -H "X-API-Key: <rotate-or-copy-current-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event_name": "Purchase",
    "event_time": ` + Math.floor(Date.now()/1000) + `,
    "action_source": "website",
    "user_data": {
      "em": ["7b17fb0bd173f625b58636fb796407c22b3d16fc78302d79f0fd30c2fc2fc068"],
      "ph": ["254aa248acb47dd654ca3ea53f48c2c26d641d23d7e2e93a1ec56258df7674c4"],
      "client_ip_address": "192.168.1.1",
      "client_user_agent": "Mozilla/5.0..."
    },
    "custom_data": {
      "currency": "BDT",
      "value": 1500.00
    }
  }'`;
    $("instrCurl").innerText = code;
    renderClientModalIntel(id);
    await loadSupportNotes(id);
    
  } catch (e) {
    $("editMsg").textContent = "Failed to load client data.";
    $("editMsg").style.color = "var(--danger)";
  }
}

async function saveClientEdit() {
  if (!currentClientId) return;
  $("editMsg").textContent = "Saving...";
  $("editMsg").style.color = "var(--success)";
  
  const payload = {
    name: $("editName").value,
    domain: $("editDomain").value,
    monthly_limit: optionalInteger($("editLimit").value),
    rate_limit: optionalInteger($("editRateLimit").value),
    daily_quota: optionalInteger($("editDailyQuota").value),
    is_active: $("editActive").checked,
    enable_facebook: $("editFb").checked,
    enable_tiktok: $("editTiktok").checked,
    enable_ga4: $("editGa4").checked,
    deferred_purchase: $("editDeferred").checked,
    plan_tier: $("editPlanTier").value,
    billing_status: $("editBillingStatus").value,
    webhook_url: $("editWebhookUrl").value.trim() || null,
    test_event_code: $("editFbTestCode").value.trim() || null,
    tiktok_test_event_code: $("editTiktokTestCode").value.trim() || null,
    owner_notify_whatsapp: $("editOwnerNotifyWhatsApp").checked,
    owner_whatsapp_number: $("editOwnerWhatsAppNumber").value.trim() || null,
    whatsapp_instance_id: optionalInteger($("editWhatsAppInstance").value)
  };
  
  try {
    await api(`/admin/api/clients/${currentClientId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    $("editMsg").textContent = "Saved successfully!";
    loadAll();
  } catch (e) {
    $("editMsg").textContent = readableApiError(e, "Failed to save.");
    $("editMsg").style.color = "var(--danger)";
  }
}

async function rotateKey(keyType) {
  if (!currentClientId) return;
  const confirmed = await askAdminDecision({
    title: "Rotate Key",
    message: `Rotate the ${keyType}?`,
    detail: keyType === "api_key"
      ? "The previous API key remains valid for 15 minutes so integrations can be updated safely."
      : "Existing sessions or integrations using this key will stop working immediately.",
    confirmLabel: "Rotate Key",
    confirmClass: "btn-danger"
  });
  if (!confirmed) return;
  try {
    const res = await api(`/admin/api/clients/${currentClientId}/keys/rotate`, {
      method: "POST",
      body: JSON.stringify({ key_type: keyType })
    });
    
    let elId = keyType === 'api_key' ? 'keyApi' : 'keyPortal';
    modalSecrets.set(elId, res.new_value);
    $(elId).innerText = "********************************";
    $(elId).dataset.hidden = "1";
    showToast(keyType + " rotated!");
    loadAll();
  } catch (e) {
    showToast("Failed to rotate key.");
  }
}

async function deleteClient() {
  if (!currentClientId) return;
  const name = $("editName").value;
  const confirmed = await askAdminDecision({
    title: "Delete Client",
    message: `Delete "${name}"?`,
    detail: "This action cannot be undone. Events, logs, and authentication keys for this client will be removed.",
    confirmLabel: "Delete Client",
    confirmClass: "btn-danger"
  });
  if (!confirmed) return;
  
  try {
    await api(`/admin/api/clients/${currentClientId}`, { method: "DELETE" });
    closeClientModal();
    showToast("Client deleted");
    loadAll();
  } catch (e) {
    showToast("Failed to delete client.");
  }
}

function populateClientFilter() {
  ["eventsClientFilter", "recoveryClientFilter"].forEach(id => {
    const filterEl = $(id);
    if (!filterEl) return;
    const selected = filterEl.value;
    filterEl.innerHTML = '<option value="">All Clients</option>';
    state.clients.forEach(client => {
      const opt = document.createElement("option");
      opt.value = client.id;
      opt.textContent = client.name;
      filterEl.appendChild(opt);
    });
    if (selected && state.clients.some(c => String(c.id) === selected)) {
      filterEl.value = selected;
    }
  });
}

async function loadEvents() {
  const client_id = $("eventsClientFilter")?.value || "";
  const platform = $("eventsPlatformFilter")?.value || "";
  const statusVal = $("eventsStatusFilter")?.value || "";
  const search = ($("eventsSearch")?.value || "").trim();
  
  let status = "";
  if (statusVal === "Success") status = "success";
  if (statusVal === "Failed") status = "failed";
  
  let queryParams = [];
  queryParams.push(`limit=${eventsState.limit}`);
  queryParams.push(`offset=${eventsState.offset}`);
  if (client_id) queryParams.push(`client_id=${client_id}`);
  if (platform) queryParams.push(`platform=${encodeURIComponent(platform)}`);
  if (status) queryParams.push(`status=${status}`);
  if (search) queryParams.push(`search=${encodeURIComponent(search)}`);
  
  const queryString = queryParams.join("&");
  
  const tbody = $("eventsTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Loading events...</td></tr>`;
  }

  try {
    const res = await api(`/admin/api/events?${queryString}`);
    eventsState.events = res.events || [];
    eventsState.totalCount = res.totalCount || 0;
    renderEvents();
  } catch (e) {
    console.error("Failed to load events", e);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty text-danger">Failed to load events. Please try again.</td></tr>`;
    }
  }
}

function renderEvents() {
  const tbody = $("eventsTableBody");
  if (!tbody) return;
  
  const count = eventsState.events.length;
  const startIdx = eventsState.offset + 1;
  const endIdx = Math.min(eventsState.offset + eventsState.limit, eventsState.totalCount);
  
  const metaEl = $("eventsTableMeta");
  if (metaEl) {
    metaEl.textContent = eventsState.totalCount > 0 
      ? `Showing ${startIdx}-${endIdx} of ${fmt(eventsState.totalCount)} events` 
      : "Showing 0 events";
  }
  
  const pageEl = $("eventsCurrentPage");
  if (pageEl) {
    pageEl.textContent = eventsState.currentPage;
  }
  
  if (count === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No events found matching your criteria.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = eventsState.events.flatMap(event => {
    const isExpanded = eventsState.expandedEventId === event.id;
    const statusClass = event.status === "Success" ? "status-healthy" : "status-critical";
    const displayTime = toDeviceDateTime(event.timestamp);
    const sampleLabel = event.isReconstructedSample ? " (reconstructed sample)" : "";
    const sampleNotice = event.sampleNotice || "These JSON blocks are reconstructed from stored EventLog fields.";
    
    const mainRow = `
      <tr onclick="toggleEventDetail('${event.id}')" style="cursor:pointer;" class="event-row">
        <td class="code-text" style="white-space:nowrap;">${esc(displayTime)}</td>
        <td><div class="client-name" style="font-size:12.5px;">${esc(event.client_name)}</div><div class="client-sub">ID ${event.client_id}</div></td>
        <td><span style="color:#818cf8;font-weight:700">${esc(event.name)}</span></td>
        <td style="font-weight:600; font-size:12px;">${esc(event.platform)}</td>
        <td><div class="status-badge ${statusClass}">${esc(event.status)}</div></td>
        <td class="code-text">${esc(event.httpCode)}</td>
        <td class="code-text" style="font-size:11px; color:var(--text-muted);">${esc(event.deduplicationKey)}</td>
      </tr>
    `;
    
    const detailRow = `
      <tr id="detail-${event.id}" style="display: ${isExpanded ? "table-row" : "none"};">
        <td colspan="7" style="padding:20px; background:rgba(0,0,0,0.06); border-bottom:1px solid var(--card-border);">
          ${event.isReconstructedSample ? `<div style="margin-bottom:12px; color:var(--warning); font-size:12px; font-weight:700;">${esc(sampleNotice)}</div>` : ""}
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
            <div>
              <div style="font-weight:800; font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; letter-spacing:0.05em;">Payload${sampleLabel}</div>
              <pre class="instr-box" style="margin:0; font-family:JetBrains Mono, monospace; font-size:11.5px; max-height:250px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;">${esc(JSON.stringify(event.payload, null, 2))}</pre>
            </div>
            <div>
              <div style="font-weight:800; font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; letter-spacing:0.05em;">HTTP Headers${sampleLabel}</div>
              <pre class="instr-box" style="margin:0; font-family:JetBrains Mono, monospace; font-size:11.5px; max-height:250px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;">${esc(JSON.stringify(event.headers, null, 2))}</pre>
            </div>
            <div>
              <div style="font-weight:800; font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; letter-spacing:0.05em;">Upstream Response${sampleLabel}</div>
              <pre class="instr-box" style="margin:0; font-family:JetBrains Mono, monospace; font-size:11.5px; max-height:180px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;">${esc(JSON.stringify(event.responseBody, null, 2))}</pre>
              <div style="margin-top:12px; display:flex; gap:16px; font-size:11px; color:var(--text-muted);">
                <div><strong>Latency:</strong> <span style="color:var(--primary); font-weight:700;">${event.latencyMs != null ? event.latencyMs + 'ms' : 'N/A'}</span></div>
                <div><strong>HTTP Code:</strong> <span style="color:${event.status === 'Success' ? 'var(--success)' : 'var(--danger)'}; font-weight:700;">${event.httpCode}</span></div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
    
    return [mainRow, detailRow];
  }).join("");
}

function toggleEventDetail(id) {
  const row = document.getElementById(`detail-${id}`);
  if (!row) return;
  
  if (eventsState.expandedEventId === id) {
    row.style.display = "none";
    eventsState.expandedEventId = null;
  } else {
    if (eventsState.expandedEventId) {
      const oldRow = document.getElementById(`detail-${eventsState.expandedEventId}`);
      if (oldRow) oldRow.style.display = "none";
    }
    row.style.display = "table-row";
    eventsState.expandedEventId = id;
  }
}

function handleEventsFilterChange() {
  eventsState.offset = 0;
  eventsState.currentPage = 1;
  eventsState.expandedEventId = null;
  loadEvents();
}

function changeEventsPage(dir) {
  const newPage = eventsState.currentPage + dir;
  if (newPage < 1) return;
  
  const maxPage = Math.ceil(eventsState.totalCount / eventsState.limit);
  if (newPage > maxPage && maxPage > 0) return;
  
  eventsState.currentPage = newPage;
  eventsState.offset = (newPage - 1) * eventsState.limit;
  eventsState.expandedEventId = null;
  loadEvents();
}
