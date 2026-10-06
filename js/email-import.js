import { $, esc, icon, field, errorMessage } from "./ui.js";
import { api } from "./data.js";
export const emailImportSection = () => `<details class="settings-detail" id="email-import"><summary><div class="grow"><p>Gmail</p><small id="gmailSummary">Checking connection…</small></div>${icon("chevron")}</summary><div class="settings-detail-body"><p class="muted mail-consent">Clear invitations are added automatically. Uncertain details stay here for review.</p><div id="mailConnections" class="stack"></div><button class="btn sm" type="button" id="connectGmail">Connect Gmail</button><p class="form-feedback" id="mailStatus" role="status" aria-live="polite"></p><div id="mailSuggestions" class="stack"></div><div id="mailHistory"></div></div></details>`;
export function bindEmailImport(root) {
  const status = $("#mailStatus", root), connect = $("#connectGmail", root);
  const say = (message, state = "") => { status.textContent = message; status.dataset.state = state; };
  const call = (path, options = {}) => api(`/api/mail/${path}`, {authenticated: true, ...options});
  let configured = false, running = false;
  const callback = new URLSearchParams(location.search).get("mail");
  if (callback) {
    say(callback === "connected" ? "Gmail connected. Prelude will check for events automatically." : "Gmail wasn’t connected. Try again and allow read-only email access.", callback === "connected" ? "success" : "error");
    const url = new URL(location.href); url.searchParams.delete("mail"); history.replaceState(history.state, "", url);
  }
  async function action(button, work) {
    if (running) return;
    running = true;
    const buttons = [...$("#email-import", root).querySelectorAll("button,input[type=checkbox]")];
    const previous = buttons.map(control => [control, control.disabled]);
    buttons.forEach(control => { control.disabled = true; });
    button.setAttribute("aria-busy", "true");
    try { await work(); } catch (error) { say(errorMessage(error), "error"); }
    finally { running = false; previous.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; }); button.removeAttribute("aria-busy"); connect.disabled = !configured; }
  }
  async function refresh() {
    const account = await call("connections");
    configured = account.configured;
    connect.disabled = !configured;
    $("#gmailSummary", root).textContent = !configured ? "Unavailable" : account.connections.length ? `Connected as ${account.connections.map(c => c.email).join(", ")}` : "Connect";
    connect.textContent = account.connections.length ? "Connect another account" : "Connect Gmail";
    if (!configured) say("Gmail permissions are not available yet. You can keep planning events manually.");
    $("#mailConnections", root).innerHTML = account.connections.map(connection => `<div class="mail-account"><p class="profile-email">${esc(connection.email)}</p><small class="muted">${connection.last_scan_error ? "Needs attention" : connection.last_scan_at ? `Last checked ${esc(new Date(connection.last_scan_at).toLocaleString())}` : "Waiting for automatic check"}</small>${connection.last_scan_error ? `<p class="form-feedback" data-state="error">${esc(connection.last_scan_error)}</p>` : ""}<div class="row wrap"><button class="text-btn" type="button" data-scan-mail="${esc(connection.id)}">Check now</button><button class="text-btn danger" type="button" data-disconnect-mail="${esc(connection.id)}">Disconnect</button></div><details class="mail-advanced"><summary>Import preferences</summary><label class="settings-row"><div class="grow"><p>Automatically add clear events</p></div><span class="switch-control"><input type="checkbox" role="switch" data-auto-mail="${esc(connection.id)}" aria-label="Automatically import from ${esc(connection.email)}" ${connection.auto_import ? "checked" : ""}></span></label></details></div>`).join("");
    if (!account.connections.length) { $("#mailSuggestions", root).innerHTML = ""; $("#mailHistory", root).innerHTML = ""; return; }
    const result = await call("suggestions");
    if (result.suggestions.length) $("#gmailSummary", root).textContent += ` · ${result.suggestions.length} to review`;
    $("#mailHistory", root).innerHTML = (result.imported || []).length ? `<h3 class="section">Recently added</h3>${result.imported.map(item => `<a class="settings-row" href="event.html?id=${encodeURIComponent(item.event_id)}"><div class="grow"><p>${esc(item.payload.title)}</p><small>${esc(item.payload.date)} · Added from Gmail</small></div>${icon("chevron")}</a>`).join("")}` : "";
    $("#mailSuggestions", root).innerHTML = result.suggestions.length ? `<h3>Review email suggestions</h3>${result.suggestions.map(suggestion => {
      const p = suggestion.payload;
      return `<details class="accordion group-card"><summary>${icon("calendar")}<div class="grow"><h3>${esc(p.title)}</h3><small>${esc(p.date)}${p.time ? ` · ${esc(p.time)}` : ""} · ${esc(p.timezone)}</small></div></summary><div class="accordion-content"><p class="muted">From ${esc(suggestion.source_sender)}</p><p class="muted">${esc(suggestion.source_subject)}</p><form data-mail-suggestion="${esc(suggestion.id)}" class="stack section">${field("Event name", "title", "text", p.title, 'required maxlength="120"')}${field("Date", "date", "date", p.date, "required")}${field("Time (optional)", "time", "time", p.time)}${field("Timezone", "timezone", "text", p.timezone, "required")}${field("Location (optional)", "location", "text", p.location, 'maxlength="500"')}<label>Description<textarea name="description" maxlength="2000">${esc(p.description)}</textarea></label><p class="form-feedback" role="status"></p><button class="btn primary full" type="submit">Create event ${icon("check")}</button><button class="text-btn" type="button" data-dismiss-mail="${esc(suggestion.id)}">Dismiss suggestion</button></form></div></details>`;
    }).join("")}` : '<p class="muted">No suggestions need review. Newly imported events appear in Events.</p>';
    for (const button of root.querySelectorAll("[data-scan-mail]")) button.onclick = () => action(button, async () => {
      say("Checking recent event emails…");
      const result = await call("scan", {method: "POST", body: {id: button.dataset.scanMail}, timeout: 65000});
      await refresh();
      if (result.busy) { say("Prelude is already checking this account."); return; }
      say(`Checked ${result.checked} emails. ${result.imported} events added. ${result.detected} new suggestions.${result.hasMore ? " Prelude will continue automatically." : ""}${result.importFailures ? " Some invitations need attention; Prelude will retry." : ""}`, result.importFailures ? "error" : "success");
    });
    for (const toggle of root.querySelectorAll("[data-auto-mail]")) toggle.onchange = () => action(toggle, async () => {
      const enabled = toggle.checked;
      try { await call("connections", {method: "POST", body: {id: toggle.dataset.autoMail, autoImport: enabled}}); say(enabled ? "Clear events will be added automatically." : "Events will stay as suggestions for review.", "success"); }
      catch (error) { toggle.checked = !enabled; throw error; }
    });
    for (const button of root.querySelectorAll("[data-disconnect-mail]")) button.onclick = () => action(button, async () => {
      const result = await call("connections", {method: "DELETE", body: {id: button.dataset.disconnectMail}});
      await refresh();
      say(result.revoked ? "Gmail disconnected. Events already created stay in Prelude." : "Gmail disconnected from Prelude. You can also remove Prelude’s access in your Google Account permissions.", "success");
    });
    for (const form of root.querySelectorAll("[data-mail-suggestion]")) form.onsubmit = event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      return action($("button[type=submit]", form), async () => {
        const result = await call("suggestions", {method: "POST", body: {id: form.dataset.mailSuggestion, action: "create", payload: Object.fromEntries(new FormData(form))}});
        await refresh();
        say("Event created.", "success");
        status.insertAdjacentHTML("beforeend", ` <a href="event.html?id=${encodeURIComponent(result.eventId)}">Open event →</a>`);
      });
    };
    for (const button of root.querySelectorAll("[data-dismiss-mail]")) button.onclick = () => action(button, async () => {
      await call("suggestions", {method: "POST", body: {id: button.dataset.dismissMail, action: "dismiss"}});
      await refresh(); say("Suggestion dismissed.");
    });
  }
  connect.onclick = () => action(connect, async () => {
    const result = await call("connect", {method: "POST", credentials: "include", body: {returnUrl: new URL("settings.html#email-import", location.href).href}});
    location.assign(result.url);
  });
  connect.disabled = true;
  refresh().catch(error => { configured = false; connect.disabled = true; say(errorMessage(error), "error"); });
}
