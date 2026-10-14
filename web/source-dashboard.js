/* Source connections and scan selection for the browser dashboard. */
(() => {
  const el = id => document.getElementById(id);
  const providers = {
    gdrive: { label: "Google Drive", key: "SMART_CLEANER_GOOGLE_CLIENT_ID", placeholder: "YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com" },
    dropbox: { label: "Dropbox", key: "SMART_CLEANER_DROPBOX_APP_KEY", placeholder: "YOUR_DROPBOX_APP_KEY" }
  };
  let selected = new Set(), known = new Set(), connections = [];
  const node = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = String(value);
    if (cls) n.className = cls;
    return n;
  };
  function normalize(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.sources)) return value.sources;
    throw new Error("Source list was not returned in the expected format.");
  }
  function configured(type) {
    const p = providers[type], value = p && window[p.key];
    return Boolean(value && !value.startsWith("YOUR_"));
  }
  function summary() {
    el("cloud-selection-summary").textContent = selected.size + " cloud accounts selected for scanning.";
  }
  function selectedSources(sources) {
    const current = normalize(sources);
    const ids = new Set(current.map(s => s.id));
    selected = new Set([...selected].filter(id => ids.has(id)));
    for (const source of current) {
      if (!known.has(source.id) && providers[source.type]) selected.add(source.id);
      known.add(source.id);
    }
    return current.filter(s => providers[s.type] && selected.has(s.id));
  }
  function status(id, message, error = false) {
    const target = document.getElementById("source-state-" + id);
    if (target) { target.textContent = message; target.classList.toggle("error-msg", error); }
  }
  async function load() {
    const list = el("sources-list");
    list.replaceChildren(node("p", "Loading connected accounts…", "scan-help"));
    try {
      const payload = await api("/sources");
      if (!token) return;
      connections = normalize(payload);
      selectedSources(connections);
      list.replaceChildren();
      if (!connections.length) list.append(node("p", "No cloud accounts connected. Add an account below, or choose files from your device.", "scan-help"));
      for (const source of connections) {
        const supported = Boolean(providers[source.type]);
        const row = node("div", undefined, "source-row");
        const label = node("label", undefined, "source-account");
        const checkbox = node("input");
        checkbox.type = "checkbox"; checkbox.checked = selected.has(source.id); checkbox.disabled = !supported;
        checkbox.setAttribute("aria-label", "Scan " + source.label);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(source.id); else selected.delete(source.id);
          summary();
        });
        const info = node("div");
        info.append(node("strong", source.label || source.type));
        info.append(node("p", providers[source.type]?.label || source.type, "scan-help"));
        const state = node("p", supported ? "Saved connection · checked when you scan" : "Scanning not available in this web version", "scan-help");
        state.id = "source-state-" + source.id; info.append(state);
        label.append(checkbox, info);
        const actions = node("div", undefined, "scan-actions");
        if (supported) {
          const reconnect = node("button", "Reconnect", "ghost");
          reconnect.type = "button"; reconnect.addEventListener("click", () => connect(source.type));
          actions.append(reconnect);
        }
        const remove = node("button", "Disconnect here", "ghost");
        remove.type = "button";
        remove.addEventListener("click", () => disconnect(source.id, source.label, remove));
        actions.append(remove); row.append(label, actions); list.append(row);
      }
      summary();
    } catch (error) {
      list.replaceChildren(node("p", "Could not load sources: " + error.message, "error-msg"));
      el("cloud-selection-summary").textContent = "Reload connections before scanning.";
    }
  }
  function connect(type) {
    if (Cleaner.isBusy()) { toast("Stop the scan before connecting a source."); return; }
    const provider = providers[type];
    if (!provider || !token) { toast("Log in before connecting a source."); return; }
    if (!configured(type)) {
      showManual(type);
      el("connection-status").textContent = provider.label + " sign-in needs OAuth setup. Advanced token connection is available below.";
      return;
    }
    const state = crypto.randomUUID();
    const redirect = window.location.origin + window.location.pathname;
    sessionStorage.setItem("file-manager-oauth", JSON.stringify({ state, type, created: Date.now() }));
    const query = new URLSearchParams({ client_id: window[provider.key], redirect_uri: redirect, response_type: "token", state });
    if (type === "gdrive") { query.set("scope", "https://www.googleapis.com/auth/drive"); query.set("prompt", "consent"); }
    window.location.href = (type === "gdrive" ? "https://accounts.google.com/o/oauth2/v2/auth?" : "https://www.dropbox.com/oauth2/authorize?") + query;
  }
  async function callback() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has("access_token") && !params.has("error")) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const raw = sessionStorage.getItem("file-manager-oauth");
    sessionStorage.removeItem("file-manager-oauth");
    let pending;
    try { pending = JSON.parse(raw); } catch {}
    if (!token || !pending || !providers[pending.type] || pending.state !== params.get("state") || Date.now() - pending.created > 600000) {
      el("connection-status").textContent = "Connection could not be verified. Log in and reconnect from this dashboard.";
      return;
    }
    if (params.has("error")) {
      el("connection-status").textContent = "Connection cancelled or denied. You can try again.";
      return;
    }
    await save(pending.type, params.get("access_token"), "My " + providers[pending.type].label);
  }
  function showManual(type = "gdrive") {
    if (!providers[type]) return;
    el("connect-form").classList.remove("hidden");
    el("connect-type").value = type;
    el("connect-label").value = "My " + providers[type].label;
    el("connect-token").value = "";
  }
  function hideManual() {
    el("connect-form").classList.add("hidden"); el("connect-token").value = "";
  }
  async function save(type, accessToken, label) {
    if (Cleaner.isBusy()) { toast("Stop the scan before connecting a source."); return; }
    if (!providers[type] || !accessToken?.trim()) { el("connection-status").textContent = "Choose a supported source and enter its access token."; return; }
    el("connection-status").textContent = "Checking " + providers[type].label + " connection…";
    try {
      await api("/sources/" + type, { method: "POST", body: JSON.stringify({ access_token: accessToken.trim(), account_label: label?.trim() || "My " + providers[type].label }) });
      hideManual();
      el("connection-status").textContent = providers[type].label + " connected. Select the account below for scanning. If reconnecting, disconnect the older saved connection.";
      await load(); await loadStats();
    } catch (error) {
      el("connect-token").value = "";
      el("connection-status").textContent = "Connection failed: " + error.message;
    }
  }
  async function disconnect(id, label, button) {
    if (Cleaner.isBusy()) { toast("Stop the scan before disconnecting a source."); return; }
    if (!confirm("Disconnect " + (label || "this account") + " from AI File Manager? Original cloud files stay unchanged. To revoke provider permissions too, use your provider's account settings.")) return;
    if (button) button.disabled = true;
    try {
      await api("/sources/" + encodeURIComponent(id), { method: "DELETE" });
      selected.delete(id); known.delete(id);
      el("connection-status").textContent = "Disconnected here. Original files and previously scanned records remain unchanged.";
      await load(); await loadStats();
    } catch (error) { toast(error.message); if (button) button.disabled = false; }
  }
  function reset() {
    selected.clear(); known.clear(); connections = [];
    sessionStorage.removeItem("file-manager-oauth");
    hideManual(); el("sources-list").replaceChildren(); el("connection-status").textContent = ""; summary();
  }
  window.SourceDashboard = { normalize, selectedSources, status, load, connect, callback, showManual, hideManual, save, disconnect, reset };
})();
