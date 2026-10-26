import { $, icon, esc, toast, busy, errorMessage } from "./ui.js";
import { rpc, locked } from "./data.js";
import { notifyExpiry } from "./notifications.js";
let active = null, interval, refreshInterval, refreshPromise, refreshAgain = false;
let openDialog = null;
const notifiedExpiries = new Set();
const seconds = (session) => session?.state === "running"
  ? Math.max(0, Math.ceil((Date.parse(session.deadline) - Date.now()) / 1000))
  : Math.max(0, session?.remaining_seconds || 0);
const digital = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const timerKey = (session) => session ? [session.id, session.state, session.deadline, session.remaining_seconds].join(":") : "";
const changed = (eventId, taskId, state) => window.dispatchEvent(new CustomEvent("prelude:timer-change", { detail: { eventId, taskId, state } }));
function notifyOnce(session) {
  const key = `${session.id}:${session.deadline}`;
  if (notifiedExpiries.has(key)) return;
  notifiedExpiries.add(key);
  void notifyExpiry(session);
}
function renderBar() {
  let bar = $("#timerBar");
  document.body.classList.toggle("has-timer", !!active);
  if (!active) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("a");
    bar.id = "timerBar";
    bar.className = "timer-bar";
    document.body.append(bar);
  }
  bar.href = `event.html?id=${encodeURIComponent(active.event_id)}&task=${encodeURIComponent(active.task_id)}`;
  bar.setAttribute("aria-label", `${active.task_title || "Task timer"}: ${active.state === "expired" ? "time’s up" : active.state === "paused" ? "paused" : "running"}. Open timer.`);
  bar.innerHTML = `${icon(active.state === "paused" ? "pause" : "clock")}<span class="grow"><strong>${esc(active.task_title || "Task timer")}</strong><br><small>${active.state === "paused" ? "Paused · tap to resume" : active.state === "expired" ? "Time’s up · still incomplete" : "Timer running"}</small></span><b>${digital(seconds(active))}</b>`;
  bar.classList.toggle("expired", active.state === "expired");
}
function startIntervals() {
  if (!interval) interval = setInterval(() => {
    if (!active) return;
    const digits = $("#timerBar b");
    if (digits) digits.textContent = digital(seconds(active));
    if (active.state === "running" && seconds(active) === 0) {
      active = { ...active, state: "expired", remaining_seconds: 0 };
      notifyOnce(active);
      renderBar();
      changed(active.event_id, active.task_id, "expired");
      void refreshTimer();
    }
  }, 1000);
  if (!refreshInterval) refreshInterval = setInterval(() => void refreshTimer(), 30000);
}
export async function refreshTimer() {
  if (refreshPromise) { refreshAgain = true; return refreshPromise; }
  refreshPromise = (async () => {
    do {
      refreshAgain = false;
      try {
        const previous = active, previousKey = timerKey(previous);
        active = await rpc("prelude_get_timer");
        renderBar();
        startIntervals();
        if (previousKey !== timerKey(active)) {
          if (previous && previous.event_id !== active?.event_id) changed(previous.event_id, previous.task_id, "updated");
          if (active) changed(active.event_id, active.task_id, active.state);
          else if (previous) changed(previous.event_id, previous.task_id, "stopped");
        }
      } catch (error) {
        console.warn("Timer service unavailable", error?.code || error?.name);
      }
    } while (refreshAgain);
    return active;
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}
export async function openTimer(task, event) {
  if (locked(event) || task.completed) {
    toast(task.completed ? "This task is already complete." : "Preparation is closed for this task.");
    return;
  }
  openDialog?.close();
  let session;
  try { [session] = await Promise.all([rpc("prelude_task_timer", { p_task_id: task.id }), refreshTimer()]); }
  catch (error) { toast(errorMessage(error)); return; }
  // A second click while the request was loading must not leave stacked dialogs.
  openDialog?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "modal timer-modal";
  dialog.setAttribute("aria-label", `Timer for ${task.title}`);
  document.body.append(dialog);
  openDialog = dialog;
  let working = false, tick;
  const lifecycle = new AbortController();
  function render() {
    const state = session?.state || "ready";
    const hasTime = !session || seconds(session) > 0;
    const otherTimer = active && active.task_id !== task.id && ["running", "paused"].includes(active.state);
    const caption = state === "expired" || (state === "stopped" && !hasTime)
      ? "Time’s up. Mark the task complete when you’ve finished, or add more time."
      : state === "paused" ? "Your remaining time is saved. Resume whenever you’re ready."
        : state === "stopped" ? "Your remaining time is saved. Another task can use the timer."
          : state === "running" ? "Take your time. You’ll mark this task complete when you’re finished."
            : "Start a focused session for this task.";
    const starts = state !== "running" && hasTime;
    dialog.innerHTML = `<span class="eyebrow">Task timer</span><h2>${esc(task.title)}</h2><span class="badge timer-status ${state === "expired" ? "rose" : ""}">${state === "ready" ? "Ready to begin" : state === "running" ? "In progress" : state === "paused" ? "Paused" : state === "expired" ? "Time’s up" : "Stopped"}</span><div class="timer-digits" role="timer" aria-label="Time remaining" aria-live="off">${digital(session ? seconds(session) : (task.duration_minutes || 0) * 60)}</div><p class="muted">${caption}</p>${otherTimer ? `<p class="timer-conflict">Another timer is ${active.state}. Finish or stop <a href="event.html?id=${encodeURIComponent(active.event_id)}&task=${encodeURIComponent(active.task_id)}">${esc(active.task_title || "your current task")}</a> before starting this one.</p>` : ""}<div class="stack timer-controls"><div class="form-feedback" role="alert" hidden></div>${starts ? `<button class="btn ${state === "ready" ? "primary" : ""}" data-action="start" ${otherTimer ? "disabled" : ""}>${icon("play")}${state === "ready" ? "Start timer" : "Resume timer"}</button>` : ""}${state === "running" ? `<button class="btn" data-action="pause">${icon("pause")}Pause timer</button>` : ""}${session ? `<section class="timer-extension"><p class="muted">${state === "expired" || !hasTime ? "Choose extra time to restart your timer." : "Need a little more time? Extending also resumes a paused timer."}</p><div class="row wrap">${[5, 10, 15].map((minutes) => `<button class="btn sm" data-extend="${minutes}" ${otherTimer ? "disabled" : ""}>+${minutes} min</button>`).join("")}</div><details class="inline-add" id="customTimer"><summary>More time options</summary><form class="stack"><label>Extra minutes<input id="customMinutes" type="number" min="1" max="1440" step="1" value="5" required></label><button class="btn" id="customExtend" ${otherTimer ? "disabled" : ""}>Extend timer</button></form></details></section>` : ""}<button class="btn ${state !== "ready" ? "primary" : ""}" data-action="complete">${icon("check")}Mark task complete</button>${["running", "paused", "expired"].includes(state) ? `<button class="text-btn" data-action="stop">${state === "expired" ? "Dismiss timer" : "Stop & save remaining time"}</button>` : ""}<button class="btn" id="closeTimer">Close</button></div>`;
    $("#closeTimer", dialog).onclick = () => dialog.close();
    async function update(action, extension) {
      if (working) return;
      if (locked(event)) { dialog.close(); toast("The preparation deadline has passed."); changed(event.id, task.id, "closed"); return; }
      working = true;
      const buttons = [...dialog.querySelectorAll("button")];
      const previousDisabled = buttons.map((button) => button.disabled);
      buttons.forEach((button) => { button.disabled = true; });
      try {
        session = await rpc("prelude_timer", { p_task_id: task.id, p_action: action, ...(extension ? { p_seconds: extension * 60 } : {}) });
        await refreshTimer();
        changed(event.id, task.id, action === "complete" ? "completed" : session?.state);
        if (action === "complete") {
          dialog.close();
          toast("Task completed.");
          return;
        }
        render();
      } finally {
        working = false;
        buttons.forEach((button, index) => { if (button.isConnected) button.disabled = previousDisabled[index]; });
      }
    }
    for (const button of dialog.querySelectorAll("[data-action]")) button.onclick = busy(button, () => update(button.dataset.action), "Updating timer…");
    async function extend(minutes) {
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw { friendly: "Choose between 1 and 1440 extra minutes." };
      await update("extend", minutes);
    }
    for (const button of dialog.querySelectorAll("[data-extend]")) button.onclick = busy(button, () => extend(Number(button.dataset.extend)), "Adding time…");
    const custom = $("#customTimer form", dialog);
    if (custom) custom.onsubmit = busy($("#customExtend", dialog), () => extend(Number($("#customMinutes", dialog).value)), "Adding time…");
  }
  render();
  dialog.showModal();
  tick = setInterval(() => {
    if (working) return;
    const digits = $(".timer-digits", dialog);
    if (digits) digits.textContent = digital(session ? seconds(session) : task.duration_minutes * 60);
    if (session?.state === "running" && seconds(session) === 0) {
      session = { ...session, state: "expired", remaining_seconds: 0 };
      notifyOnce({ ...session, task_title: task.title });
      render();
      changed(event.id, task.id, "expired");
      void refreshTimer();
    }
    if (locked(event)) {
      dialog.close();
      toast("The preparation deadline has passed.");
      changed(event.id, task.id, "closed");
    }
  }, 1000);
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || working) return;
    try {
      session = await rpc("prelude_task_timer", { p_task_id: task.id });
      if (!dialog.isConnected) return;
      if (session?.state === "completed" || locked(event)) { dialog.close(); changed(event.id, task.id, "updated"); }
      else render();
    } catch { /* The next user action will display a retryable error. */ }
  }, { signal: lifecycle.signal });
  dialog.addEventListener("close", () => {
    clearInterval(tick);
    lifecycle.abort();
    dialog.remove();
    if (openDialog === dialog) openDialog = null;
  }, { once: true });
}
window.addEventListener("pagehide", () => {
  clearInterval(interval);
  clearInterval(refreshInterval);
  interval = refreshInterval = null;
  openDialog?.close();
});
window.addEventListener("pageshow", (e) => { if (e.persisted) void refreshTimer(); });
