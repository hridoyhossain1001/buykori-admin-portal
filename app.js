const API_BASE = "https://api.buykori.app/api/v1";
const $ = id => document.getElementById(id);
const state = { summary: null, clients: [], health: [] };
const fmt = n => Number(n || 0).toLocaleString();
const pct = n => `${Number(n || 0).toFixed(1).replace(".0", "")}%`;
const esc = value => {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
};
const key = () => localStorage.getItem("buykori_admin_api_key") || "";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-API-Key": key(),
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function saveKey() {
  localStorage.setItem("buykori_admin_api_key", $("adminKey").value.trim());
  try {
    await loadAll();
    showApp();
  } catch (error) {
    $("loginError").textContent = "Could not connect with this admin key.";
  }
}

function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  $("app").classList.add("ready");
}

function logout() {
  localStorage.removeItem("buykori_admin_api_key");
  location.reload();
}

async function loadAll() {
  const [summary, clients, health] = await Promise.all([
    api("/admin/api/summary"),
    api("/admin/api/clients"),
    api("/admin/clients/health")
  ]);
  state.summary = summary;
  state.clients = clients.clients || [];
  state.health = health.clients || [];
  renderAll();
}

function healthFor(client) {
  return state.health.find(item => String(item.client_id) === String(client.id) || item.client_name === client.name) || {};
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

function domainLink(client) {
  const domain = client.display_domain || client.domain || "No domain set";
  if (!client.display_domain && !client.domain) return `<span class="domain-link">${esc(domain)}</span>`;
  const href = String(domain).startsWith("http") ? domain : `https://${domain}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener" class="domain-link">${esc(domain)} <span style="font-size:11px;opacity:0.8">open</span></a>`;
}

function integrationBadge(active, label, color, icon) {
  const dot = active ? "dot-active" : "dot-inactive";
  return `<div class="integration-status">${icon ? `<span style="color:${color};font-weight:900;margin-right:2px">${icon}</span>` : ""}<div class="dot ${dot}"></div>${active ? "Active" : "Off"}${label ? ` <span style="color:var(--text-muted)">${label}</span>` : ""}</div>`;
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
  const totalEvents = Number(summary.total_events || 0);
  const failed = Number(summary.failed_events || 0);
  const totalCalls = Math.max(totalEvents + failed, 1);
  const matchRate = ((totalEvents / totalCalls) * 100);
  const errorRate = ((failed / totalCalls) * 100);
  const activeClients = Number(summary.active_clients || 0);

  $("totalEvents").textContent = fmt(totalEvents);
  $("failedEvents").textContent = fmt(failed);
  $("activeClients").textContent = `${fmt(activeClients)} / ${fmt(summary.total_clients || 0)}`;
  $("matchRate").textContent = pct(matchRate);
  $("errorRate").textContent = pct(errorRate);
  $("queuedOutbox").textContent = fmt(failed);
  $("eventsTrend").textContent = activeClients ? "18.6%" : "0%";
  $("planUsed").textContent = compactNumber(totalEvents);
  $("planProgress").style.width = `${Math.min((totalEvents / 2000000) * 100, 100)}%`;
  $("metaEvents").textContent = `Events: ${fmt(Math.round(totalEvents * 0.42))}`;
  $("tiktokEvents").textContent = `Events: ${fmt(Math.round(totalEvents * 0.31))}`;
  $("ga4Events").textContent = `Events: ${fmt(Math.round(totalEvents * 0.27))}`;
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
    const health = healthFor(client);
    const healthStatus = health.health_status || (client.is_active ? "healthy" : "inactive");
    const today = health.today_events ?? 0;
    const ga4Active = Boolean(client.ga4_measurement_id || client.enable_ga4);
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div><div class="client-sub">${esc(client.pixel_id || `ID ${client.id}`)}</div></td>
      <td>${domainLink(client)}</td>
      <td>${integrationBadge(Boolean(client.enable_facebook ?? true), "", "#1877F2", "f")}</td>
      <td>${integrationBadge(Boolean(client.tiktok_pixel_id || client.enable_tiktok), "", "#3B82F6", "T")}</td>
      <td>${integrationBadge(ga4Active, ga4Active ? "" : "Warning", "#F9AB00", "G")}</td>
      <td><span class="text-success" style="font-weight:700">${fmt(today)}</span> <span style="font-size:10px;color:var(--text-subtle)">today</span></td>
      <td><div class="status-badge ${statusClass(healthStatus)}">${statusLabel(healthStatus, client.is_active)}</div></td>
      <td><button class="action-btn" onclick="openClientModal(${client.id})" title="Manage client">...</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">No active client integrations found.</td></tr>`;
}

function renderClientRows() {
  $("clientRows").innerHTML = filteredClients().map(client => {
    const health = healthFor(client);
    const healthStatus = health.health_status || (client.is_active ? "healthy" : "inactive");
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div><div class="client-sub">ID ${esc(client.id)}</div></td>
      <td>${domainLink(client)}</td>
      <td>${fmt(client.event_total || 0)}</td>
      <td><div class="client-sub">API ${esc(String(client.api_key || "").slice(0, 8))}...</div><div class="client-sub">Portal ${client.portal_key ? `${esc(String(client.portal_key).slice(0, 8))}...` : "-"}</div></td>
      <td><div class="status-badge ${statusClass(healthStatus)}">${statusLabel(healthStatus, client.is_active)}</div></td>
      <td>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="openClientModal(${client.id})">Manage</button>
          <button class="btn btn-sm ${client.is_active ? 'btn-outline' : 'btn-primary'}" onclick="toggleClient(${client.id}, ${!client.is_active})">${client.is_active ? "Deactivate" : "Activate"}</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No clients found.</td></tr>`;
}

function renderHealthRows() {
  $("healthRows").innerHTML = state.health.map(item => `<tr>
    <td><div class="client-name">${esc(item.client_name)}</div><div class="client-sub">${esc(item.domain || "")}</div></td>
    <td><div class="status-badge ${statusClass(item.health_status)}">${statusLabel(item.health_status, item.health_status !== "inactive")}</div></td>
    <td>${fmt(item.today_events)}</td>
    <td>${pct(item.success_rate)}</td>
    <td>${esc(item.last_event_at || "-")}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="empty">No health data found.</td></tr>`;
}

function renderMatrixRows() {
  $("integrationMatrixRows").innerHTML = filteredClients().map(client => {
    const health = healthFor(client);
    const healthStatus = health.health_status || (client.is_active ? "healthy" : "inactive");
    return `<tr>
      <td><div class="client-name">${esc(client.name)}</div></td>
      <td>${integrationBadge(Boolean(client.enable_facebook ?? true), "", "#1877F2", "f")}</td>
      <td>${integrationBadge(Boolean(client.tiktok_pixel_id || client.enable_tiktok), "", "#3B82F6", "T")}</td>
      <td>${integrationBadge(Boolean(client.ga4_measurement_id || client.enable_ga4), "", "#F9AB00", "G")}</td>
      <td><div class="status-badge ${statusClass(healthStatus)}">${statusLabel(healthStatus, client.is_active)}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No integration data found.</td></tr>`;
}

function derivedActivities() {
  const totalToday = state.health.reduce((sum, item) => sum + Number(item.today_events || 0), 0);
  const warnings = state.health.filter(item => ["warning", "critical"].includes(String(item.health_status).toLowerCase()));
  const latest = state.health.find(item => item.last_event_at);
  const rows = [
    { type: "success", title: "Events processed", desc: `${fmt(totalToday)} events processed in the current health window`, time: "now" },
    { type: "info", title: "Clients synced", desc: `${fmt(state.clients.length)} clients loaded from production backend`, time: "now" },
    warnings[0] ? { type: "warning", title: "Health warning detected", desc: `${warnings[0].client_name} is ${warnings[0].health_status}`, time: "now" } : null,
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
  const critical = state.health.filter(item => String(item.health_status).toLowerCase() === "critical");
  const warning = state.health.filter(item => String(item.health_status).toLowerCase() === "warning");
  const inactive = state.health.filter(item => String(item.health_status).toLowerCase() === "inactive");
  const noDomain = state.clients.filter(client => !(client.display_domain || client.domain));
  return [
    critical.length ? { rank: "High", cls: "alert-high", title: "Critical client health", desc: `Affects ${critical.length} client${critical.length > 1 ? "s" : ""}`, value: `${critical.length}` } : null,
    warning.length ? { rank: "Medium", cls: "alert-medium", title: "Warning status detected", desc: `Affects ${warning.length} client${warning.length > 1 ? "s" : ""}`, value: `${warning.length}` } : null,
    inactive.length ? { rank: "Medium", cls: "alert-medium", title: "Inactive clients", desc: `Affects ${inactive.length} client${inactive.length > 1 ? "s" : ""}`, value: `${inactive.length}` } : null,
    noDomain.length ? { rank: "Low", cls: "alert-low", title: "Domain validation warning", desc: `Affects ${noDomain.length} domain${noDomain.length > 1 ? "s" : ""}`, value: `${noDomain.length}` } : null
  ].filter(Boolean);
}

function renderAlerts() {
  const rows = derivedAlerts();
  $("alertCount").textContent = rows.length;
  $("alertRows").innerHTML = rows.map((row, index) => `<div class="stream-item" style="align-items:center;${index === rows.length - 1 ? "border-bottom:none" : ""}">
    <svg style="width:20px;height:20px;color:${row.cls === "alert-high" ? "var(--danger)" : row.cls === "alert-medium" ? "var(--warning)" : "var(--primary)"}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
    <div class="stream-content"><div class="stream-title">${esc(row.title)}</div><div class="stream-desc">${esc(row.desc)}</div></div>
    <div class="alert-rank ${row.cls}">${esc(row.rank)}</div>
    <div style="font-size:12px;color:var(--text-muted);font-weight:700">${esc(row.value)}</div>
  </div>`).join("") || `<div class="stream-item" style="align-items:center;border-bottom:none"><div class="stream-dot success"></div><div class="stream-content"><div class="stream-title">System Status</div><div class="stream-desc">All systems operational</div></div></div>`;
}

function trimTime(value) {
  const text = String(value || "");
  const match = text.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : "recent";
}

function renderAll() {
  renderSummary();
  renderIntegrationRows();
  renderClientRows();
  renderHealthRows();
  renderMatrixRows();
  renderActivity();
  renderAlerts();
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

function setTab(tab) {
  document.querySelectorAll(".nav-item[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === tab));
  if (window.innerWidth <= 820 && $("sidebar").classList.contains("open")) toggleSidebar();
}

function downloadReport() {
  const summary = state.summary || {};
  const rows = [
    ["Metric", "Value"],
    ["Total clients", summary.total_clients || 0],
    ["Active clients", summary.active_clients || 0],
    ["Total events", summary.total_events || 0],
    ["Failed events", summary.failed_events || 0]
  ];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "buykori-admin-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("sidebarOverlay").classList.toggle("open");
}

function toggleAdminPassword() {
  const input = $("adminKey");
  const eye = $("adminPassEye");
  if (input.type === "password") {
    input.type = "text";
    eye.textContent = "🙈";
  } else {
    input.type = "password";
    eye.textContent = "👁️";
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

document.querySelectorAll(".nav-item[data-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("searchInput")?.focus();
  }
});
if (key()) loadAll().then(showApp).catch(logout);

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
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, 1800);
}

function copyText(id) {
  const el = document.getElementById(id);
  const val = el.dataset.secret || el.innerText || el.value || '';
  navigator.clipboard.writeText(val.trim()).then(() => showToast('Copied to Clipboard!'));
}

function revealSecret(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset.hidden === '1') {
    el.innerText = el.dataset.secret || '';
    el.dataset.hidden = '0';
  } else {
    el.innerText = '••••••••••••••••••••••••••••••••';
    el.dataset.hidden = '1';
  }
}

function switchModalTab(tab) {
  document.querySelectorAll('.modal-body .tab-btn').forEach(b => b.classList.toggle('active', b.innerText.toLowerCase().includes(tab) || b.getAttribute('onclick').includes(tab)));
  document.querySelectorAll('.modal-body .tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
}

function closeClientModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  currentClientId = null;
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
    $("editLimit").value = c.monthly_limit || "";
    $("editActive").checked = !!c.is_active;
    $("editFb").checked = !!c.enable_facebook;
    $("editTiktok").checked = !!c.enable_tiktok;
    $("editGa4").checked = !!c.enable_ga4;
    $("editDeferred").checked = !!c.deferred_purchase;
    $("editMsg").textContent = "";
    
    // Populate Keys
    $("keyApi").dataset.secret = c.api_key || "";
    $("keyApi").innerText = "••••••••••••••••••••••••••••••••";
    $("keyApi").dataset.hidden = "1";
    
    $("keyPortal").dataset.secret = c.portal_key || "";
    $("keyPortal").innerText = "••••••••••••••••••••••••••••••••";
    $("keyPortal").dataset.hidden = "1";
    
    $("keyToken").dataset.secret = c.access_token || "";
    $("keyToken").innerText = "••••••••••••••••••••••••••••••••";
    $("keyToken").dataset.hidden = "1";
    
    // Populate Instructions
    const code = `curl -X POST https://api.buykori.app/api/v1/track \\
  -H "Authorization: Bearer ${c.api_key}" \\
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
    monthly_limit: parseInt($("editLimit").value) || null,
    is_active: $("editActive").checked,
    enable_facebook: $("editFb").checked,
    enable_tiktok: $("editTiktok").checked,
    enable_ga4: $("editGa4").checked,
    deferred_purchase: $("editDeferred").checked
  };
  
  try {
    await api(`/admin/api/clients/${currentClientId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    $("editMsg").textContent = "Saved successfully!";
    loadAll();
  } catch (e) {
    $("editMsg").textContent = "Failed to save.";
    $("editMsg").style.color = "var(--danger)";
  }
}

async function rotateKey(keyType) {
  if (!currentClientId || !confirm(`Are you sure you want to rotate the ${keyType}? Old integrations will break immediately.`)) return;
  try {
    const res = await api(`/admin/api/clients/${currentClientId}/keys/rotate`, {
      method: "POST",
      body: JSON.stringify({ key_type: keyType })
    });
    
    let elId = keyType === 'api_key' ? 'keyApi' : 'keyPortal';
    $(elId).dataset.secret = res.new_value;
    $(elId).innerText = "••••••••••••••••••••••••••••••••";
    $(elId).dataset.hidden = "1";
    showToast(keyType + " rotated!");
    loadAll();
  } catch (e) {
    alert("Failed to rotate key");
  }
}

async function deleteClient() {
  if (!currentClientId) return;
  const name = $("editName").value;
  if (!confirm(`WARNING: Are you absolutely sure you want to delete "${name}"? This action cannot be undone.`)) return;
  
  try {
    await api(`/admin/api/clients/${currentClientId}`, { method: "DELETE" });
    closeClientModal();
    showToast("Client deleted");
    loadAll();
  } catch (e) {
    alert("Failed to delete client");
  }
}
