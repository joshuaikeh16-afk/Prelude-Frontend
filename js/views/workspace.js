import {
  $, icon, esc, field, mount, empty, back, accordion, busy, toast,
  confirmDialog, mapPreview,
} from "../ui.js";
import {
  getEvent, queryEventRows, progress, deadline, locked, insertRow, updateRow,
  deleteRow, rpc, signedUrls, uploadImage, unwrap, api,
} from "../data.js";
import { openTimer, refreshTimer } from "../timer.js";

const controllers = new WeakMap();
const formKey = (form) => form.id || (form.classList.contains("save-note")
  ? `note:${form.dataset.id}` : form.classList.contains("add-task-form")
    ? `task:${form.dataset.goal || "standalone"}` : null);
const fieldValue = (control) => control.type === "checkbox" || control.type === "radio"
  ? control.checked : control.value;

// Capture only user edits: freshly loaded server values must remain authoritative.
function captureState(root) {
  const forms = new Map();
  for (const form of root.querySelectorAll("form")) {
    const key = formKey(form);
    if (!key) continue;
    const values = [];
    for (const control of form.elements) {
      if (!control.name || control.type === "file") continue;
      if (JSON.stringify(fieldValue(control)) !== control.dataset.savedValue)
        values.push([control.name, fieldValue(control)]);
    }
    if (values.length) forms.set(key, values);
  }
  const active = document.activeElement;
  return {
    forms,
    open: new Map([...root.querySelectorAll("details[id]")].map((el) => [el.id, el.open])),
    scroll: window.scrollY,
    focus: root.contains(active) ? {
      id: active.id, form: active.form && formKey(active.form), name: active.name,
      start: active.selectionStart, end: active.selectionEnd,
    } : null,
  };
}
function rememberValues(form, values = null) {
  for (const control of form.elements) {
    if (!control.name || control.type === "file") continue;
    control.dataset.savedValue = JSON.stringify(values?.has(control.name)
      ? (control.type === "checkbox" ? values.has(control.name) : values.get(control.name))
      : fieldValue(control));
  }
}
function restoreState(root, state) {
  for (const form of root.querySelectorAll("form")) {
    rememberValues(form);
    for (const [name, value] of state?.forms.get(formKey(form)) || []) {
      const control = form.elements.namedItem(name);
      if (!control || control.disabled) continue;
      if (control.type === "checkbox" || control.type === "radio") control.checked = value;
      else control.value = value;
    }
  }
  if (!state) return;
  for (const details of root.querySelectorAll("details[id]"))
    if (state.open.has(details.id)) details.open = state.open.get(details.id);
  const focusedForm = [...root.querySelectorAll("form")].find((form) => formKey(form) === state.focus?.form);
  const focused = state.focus?.id
    ? root.querySelector(`#${CSS.escape(state.focus.id)}`)
    : focusedForm?.elements.namedItem(state.focus?.name);
  focused?.focus({ preventScroll: true });
  if (focused?.setSelectionRange && state.focus?.start != null) {
    try { focused.setSelectionRange(state.focus.start, state.focus.end); } catch { /* Non-text control. */ }
  }
  window.scrollTo({ top: state.scroll, behavior: "instant" });
}
const addDisclosure = (id, title, body) =>
  `<details class="inline-add" id="${esc(id)}"><summary>${icon("plus")}${esc(title)}</summary><div class="stack">${body}</div></details>`;

export async function workspace(root, user) {
  controllers.get(root)?.destroy();
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    mount(root, empty("Choose an event.", "Open an event from Home, Events or Calendar.", "events.html", "View events"));
    return;
  }
  let deadlineTimeout, refreshing, refreshAgain = false, disposed = false;
  let currentEvent, currentTasks = [], firstRender = true;
  const lifecycle = new AbortController();
  const destroy = () => {
    disposed = true;
    clearTimeout(deadlineTimeout);
    lifecycle.abort();
  };
  controllers.set(root, { destroy });
  window.addEventListener("pagehide", destroy, { signal: lifecycle.signal, once: true });
  window.addEventListener("beforeunload", (e) => {
    if (captureState(root).forms.size) { e.preventDefault(); e.returnValue = ""; }
  }, { signal: lifecycle.signal });
  document.addEventListener("click", async (e) => {
    const link = e.target.closest?.("a[href]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.target === "_blank") return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (link.id === "timerBar" && url.searchParams.get("id") === id) {
      e.preventDefault();
      const task = currentTasks.find((item) => item.id === url.searchParams.get("task"));
      if (task && currentEvent) await openTimer(task, currentEvent);
      return;
    }
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    if (!captureState(root).forms.size) return;
    e.preventDefault();
    if (await confirmDialog("Leave without saving?", "You have unsaved changes on this event. Save them before leaving to keep them.", "Leave without saving")) {
      destroy();
      location.assign(link.href);
    }
  }, { signal: lifecycle.signal });
  window.addEventListener("prelude:timer-change", (e) => {
    if (e.detail?.eventId === id) void refresh();
  }, { signal: lifecycle.signal });

  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        try { await render(true); }
        catch { toast("We couldn’t refresh this event. Your unsaved changes are still here. Try again in a moment."); }
      } while (refreshAgain && !disposed);
    })();
    try { await refreshing; } finally { refreshing = null; }
  }

  async function render(preserve = false) {
    const event = await getEvent(id, user);
    if (disposed) return;
    if (!event) {
      mount(root, empty("This event isn’t here.", "It may have been deleted, or it may belong to another account.", "events.html", "Back to events"));
      destroy();
      return;
    }
    const past = event.status === "past";
    const [goals, tasks, notes, schedule, reminders, sessions] = await Promise.all(
      ["goals", "tasks", "notes", "schedule_items", "reminders", "task_sessions"].map((table) => queryEventRows(table, id)),
    );
    let photos = [], reflection = null;
    if (past) [photos, reflection] = await Promise.all([
      queryEventRows("event_memory_photos", id),
      supabaseClient.from("event_reflections").select("content").eq("event_id", id).maybeSingle().then(unwrap),
    ]);
    const [images, memoryImages] = await Promise.all([
      signedUrls("event-images", [event.image_path]),
      past ? signedUrls("memory-photos", photos.map((photo) => photo.storage_path)) : {},
    ]);
    if (disposed) return;
    currentEvent = event;
    currentTasks = tasks;
    const p = progress(tasks), start = deadline(event);
    let isLocked = locked(event);
    const today = window.PreludeHomeData.dateKey(new Date(), event.timezone);
    const when = (value) => new Date(value).toLocaleString(undefined, {
      timeZone: event.timezone, dateStyle: "medium", timeStyle: "short",
    });
    const prepMessage = past ? "Your preparation is saved in your event history."
      : isLocked ? "Preparation is closed. Unfinished tasks stay incomplete."
        : `Preparation closes ${start ? when(start) : "on the event day"} (${event.timezone}).`;

    function taskRow(task) {
      const timer = sessions.filter((session) => session.task_id === task.id)
        .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0];
      const expired = !task.completed && (isLocked || timer?.state === "expired");
      const timerLabel = timer?.state === "running" ? "View timer" : timer?.state === "paused" || timer?.state === "stopped" ? "Resume timer" : timer?.state === "expired" ? "Extend timer" : "Start timer";
      return `<div class="item ${task.completed ? "done" : ""} ${expired ? "overdue" : ""}" data-task-row="${esc(task.id)}"><button class="check ${task.completed ? "done" : ""}" data-task="${esc(task.id)}" ${isLocked ? "disabled" : ""} aria-label="${task.completed ? "Mark incomplete" : "Mark complete"}: ${esc(task.title)}" aria-pressed="${task.completed}">${task.completed ? icon("check") : ""}</button><div class="grow"><p class="item-title">${esc(task.title)}</p><small>${expired ? "Incomplete · " + (isLocked ? "preparation closed" : "time’s up") : task.completed ? "Completed" : task.duration_minutes ? `${task.duration_minutes} minute timer` : "Ready when you are"}</small>${task.duration_minutes && !task.completed && !isLocked ? `<button class="text-btn" data-timer="${esc(task.id)}">${icon(timer?.state === "running" ? "clock" : "play")}${timerLabel}</button>` : ""}</div>${!isLocked ? `<div class="task-actions"><button class="text-btn" data-edit-task="${esc(task.id)}" aria-label="Edit task: ${esc(task.title)}">Edit</button><button class="text-btn danger" data-delete-task="${esc(task.id)}" aria-label="Delete task: ${esc(task.title)}">×</button></div>` : ""}</div>`;
    }
    const taskForm = (goalId) => addDisclosure(`add-task-${goalId || "standalone"}`, "Add task", `<form class="stack add-task-form" data-goal="${esc(goalId || "")}">${field("Task", "title", "text", "", 'required maxlength="300" placeholder="A small, practical next step"')}${field("Timer minutes (optional)", "duration", "number", "", 'min="1" max="1440"')}<button class="btn sm">Add task</button></form>`);
    function taskList(items, key) {
      const pending = items.filter((task) => !task.completed), complete = items.filter((task) => task.completed);
      return `${pending.map(taskRow).join("")}${complete.length ? `<details class="completed-tasks" id="completed-${esc(key)}"><summary>${icon("check")}${complete.length} completed ${complete.length === 1 ? "task" : "tasks"}</summary>${complete.map(taskRow).join("")}</details>` : ""}`;
    }
    function goalCard(goal) {
      const child = tasks.filter((task) => task.goal_id === goal.id), gp = progress(child);
      return `<details class="group-card goal-card" id="goal-${esc(goal.id)}" ${!past && (!child.length || gp.completed < gp.total) ? "open" : ""}><summary><div class="row grow"><span class="goal-icon">${icon(child.length && gp.completed === gp.total ? "check" : "goal")}</span><div class="grow"><h3>${esc(goal.content)}</h3><small>${child.length ? `${gp.completed} of ${gp.total} tasks complete` : past ? "No tasks added" : "Add a task to get started"}</small></div></div></summary>${child.length ? `<div class="progress"><span style="width:${gp.percent}%"></span></div>${taskList(child, goal.id)}` : ""}${!isLocked ? `${taskForm(goal.id)}<div class="row wrap"><button class="text-btn" data-edit-goal="${esc(goal.id)}">Edit goal</button><button class="text-btn danger" data-delete-goal="${esc(goal.id)}">Delete goal</button></div>` : ""}</details>`;
    }
    const standalone = tasks.filter((task) => !task.goal_id);
    const goalsSection = (goals.length || !past) ? accordion("goals", "Goals", `${goals.map(goalCard).join("") || '<p class="goal-empty">Give your preparation a direction, then break it into small tasks.</p>'}${!isLocked ? addDisclosure("newGoal", "Add goal", `<form class="stack" id="addGoal">${field("Goal", "content", "text", "", 'required maxlength="300" placeholder="What would make this event a success?"')}<button class="btn sm">Add goal</button></form>`) : ""}`, "goal", !past && (!!goals.length || !standalone.length)) : "";
    const tasksSection = (standalone.length || !past) ? accordion("tasks", "Other tasks", `${taskList(standalone, "standalone") || '<p class="goal-empty">Add any preparation that doesn’t belong to a goal.</p>'}${!isLocked ? taskForm(null) : ""}`, "check", !past && standalone.some((task) => !task.completed)) : "";
    const notesSection = (notes.length || !past) ? accordion("notes", "Notes", `${notes.map((note) => `<div class="group-card">${past ? `<p class="note-content">${esc(note.content)}</p>` : `<form class="stack save-note" data-id="${esc(note.id)}"><label>Note<textarea name="content" required maxlength="10000">${esc(note.content)}</textarea></label><div class="row"><button class="btn sm">Save note</button><button class="text-btn danger" type="button" data-delete-note="${esc(note.id)}">Delete</button></div></form>`}</div>`).join("") || '<p class="goal-empty">Keep useful details here so they’re easy to find.</p>'}${!past ? addDisclosure("newNote", "Add note", '<form class="stack" id="addNote"><label>Note<textarea name="content" required maxlength="10000" placeholder="A detail you want to keep with this event"></textarea></label><button class="btn sm">Save note</button></form>') : ""}`, "notes") : "";
    const scheduleSection = (schedule.length || !past) ? accordion("schedule", "Schedule", `${schedule.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)).map((item) => `<div class="item"><span class="goal-icon">${icon("clock")}</span><div class="grow"><h3>${esc(item.title)}</h3><small>${esc(when(item.start_time))}</small></div>${!past ? `<button class="text-btn" data-edit-schedule="${esc(item.id)}">Edit</button><button class="text-btn danger" data-delete-schedule="${esc(item.id)}" aria-label="Delete schedule item">×</button>` : ""}</div>`).join("") || '<p class="goal-empty">Give the important moments a place in your day.</p>'}${!past ? addDisclosure("newSchedule", "Add to schedule", `<form class="stack" id="addSchedule">${field("What’s happening?", "title", "text", "", 'required maxlength="200"')}<div class="form-grid">${field("Date", "date", "date", event.date, `required max="${event.date}"`)}${field("Start time", "time", "time", "", "required")}</div><small>Times use ${esc(event.timezone)}. Choose a date before or on the event day.</small><button class="btn sm">Add to schedule</button></form>`) : ""}`, "calendar", !past && today >= event.date && !!schedule.length) : "";
    const reminderSection = (reminders.length || !past) ? accordion("reminders", "Reminders", `${reminders.map((reminder) => `<div class="item"><span class="goal-icon">${icon("bell")}</span><div class="grow"><h3>${esc(reminder.title)}</h3><small>${esc(when(reminder.remind_at))} · ${reminder.sent_at ? "Sent" : esc(reminder.status || "Scheduled")}</small></div>${!past && !reminder.automatic_key ? `<button class="text-btn danger" data-delete-reminder="${esc(reminder.id)}" aria-label="Delete reminder">×</button>` : ""}</div>`).join("") || '<p class="goal-empty">No reminders scheduled.</p>'}${!past ? addDisclosure("newReminder", "Add reminder", `<form class="stack" id="addReminder">${field("Remind me to…", "title", "text", "", 'required maxlength="200"')}${field("Date & time", "at", "datetime-local", "", "required")}<label>Related task (optional)<select name="task"><option value="">Event reminder</option>${tasks.map((task) => `<option value="${esc(task.id)}">${esc(task.title)}</option>`).join("")}</select></label><small>Uses ${esc(event.timezone)}. <a href="settings.html#notifications">Enable notifications in Settings</a> to receive reminders.</small><button class="btn sm">Set reminder</button></form>`) : ""}`, "bell") : "";
    const locationSection = (event.location || !past) ? accordion("location", "Location & directions", `${event.location ? `<p>${esc(event.location)}</p>${event.location_lat != null ? mapPreview({ lat: event.location_lat, lon: event.location_lon }) : ""}<div class="spacer"></div><label>Travel mode<select id="travelMode"><option value="driving">Driving</option><option value="walking">Walking</option><option value="transit">Public transport</option></select></label><a class="btn full" id="directions" target="_blank" rel="noopener noreferrer">${icon("pin")}Get directions</a>` : '<p class="goal-empty">Add a location to keep directions close at hand.</p>'}${!past ? `<button class="text-btn" id="editLocation">${event.location ? "Change location" : "Add location"}</button>` : ""}`, "pin", !past && today >= event.date && !!event.location) : "";
    const detailsSection = !past ? accordion("eventDetails", "Event details", `<form id="editEvent" class="stack">${!isLocked ? field("Start time", "time", "time", event.time || "") : ""}<label>Intention<textarea name="description" maxlength="2000">${esc(event.description || "")}</textarea></label><label class="row"><input type="checkbox" name="priority" ${event.is_priority ? "checked" : ""}>Priority event</label><small>The event name, date and timezone are fixed.</small><button class="btn sm">Save changes</button></form>`, "settings") : "";
    const memorySection = past ? `<section class="section glass pad memory-section"><span class="eyebrow">Remember it</span><h2>Keep what mattered.</h2><p class="muted">A photograph, a feeling, a detail worth remembering.</p><div class="section"><div class="memory-grid">${photos.map((photo) => `<div class="memory-photo">${memoryImages[photo.storage_path] ? `<img src="${esc(memoryImages[photo.storage_path])}" alt="Event memory">` : "<small>Photo unavailable</small>"}<button class="icon-btn" data-delete-photo="${esc(photo.id)}" aria-label="Delete memory photo">×</button></div>`).join("")}</div><label class="upload-control">${icon("photo")}Add a photograph<input id="memoryUpload" type="file" accept="image/jpeg,image/png,image/webp"></label><small>JPG, PNG or WebP · up to 8 MB</small></div><form class="stack section" id="reflection"><label>Your reflection<textarea name="content" maxlength="10000" placeholder="What would you like to remember?">${esc(reflection?.content || "")}</textarea></label><button class="btn sm">Save reflection</button></form></section><a class="btn full section" href="create.html?redo=${encodeURIComponent(event.id)}">${icon("calendar")}Plan this again next year</a>` : "";
    const preparation = `${goalsSection}${tasksSection}${notesSection}${scheduleSection}${reminderSection}${locationSection}${detailsSection}`;
    const state = preserve ? captureState(root) : null;
    clearTimeout(deadlineTimeout);
    mount(root, `${back(past ? "events.html?view=past" : "events.html", past ? "Past events" : "Your events")}<section class="glass hero workspace-hero"><div class="hero-cover">${images[event.image_path] ? `<img src="${esc(images[event.image_path])}" alt="">` : '<div class="hero-art"></div>'}<div class="hero-meta row between"><span class="badge ${past ? "green" : ""}">${past ? "Remember" : today >= event.date ? "Event day" : "Prepare"}</span>${event.is_priority ? '<span class="badge rose">Priority</span>' : ""}</div><div class="hero-title"><span class="date">${esc(window.PreludeHomeData.eventDate(event))}</span><h1>${esc(event.title)}</h1>${event.location ? `<p>${esc(event.location)}</p>` : ""}</div></div><div class="hero-bottom workspace-summary">${p.total ? `<div class="row between"><strong>${p.completed} of ${p.total} tasks complete</strong><span class="muted">${p.percent}%</span></div><div class="progress"><span style="width:${p.percent}%"></span></div>` : !past ? '<strong>Make this event your own.</strong>' : ""}<p class="deadline workspace-state">${esc(prepMessage)}</p></div></section>${event.description ? `<p class="workspace-intention">${esc(event.description)}</p>` : ""}${!past && today >= event.date ? `<section class="workspace-actions section"><button class="btn primary full" id="completeEvent">Mark event complete${icon("check")}</button><small>Your preparation will be kept in Remember, where you can add photographs and a reflection.</small></section>` : ""}${memorySection}${past ? (preparation ? `<details class="preparation-history section" id="preparationHistory"><summary>${icon("notes")}View preparation history</summary><div class="stack section">${preparation}</div></details>` : '<p class="muted section">No preparation was recorded for this event.</p>') : `<div class="stack section">${preparation}</div>`}<details class="event-danger section" id="eventOptions"><summary>Event options</summary><p class="muted">Deleting this event also removes its preparation and memories.</p><button class="btn sm danger" id="deleteEvent">Delete event</button></details>`);
    restoreState(root, state);

    for (const button of root.querySelectorAll("[data-edit-task]")) button.onclick = () => {
      const task = tasks.find((item) => item.id === button.dataset.editTask);
      editDialog("Edit task", `${field("Task", "title", "text", task.title, 'required maxlength="300"')}${field("Timer minutes (optional)", "duration", "number", task.duration_minutes || "", 'min="1" max="1440"')}`, (fd) => updateRow("tasks", task.id, {
        title: requiredText(fd, "title"), duration_minutes: fd.get("duration") ? Number(fd.get("duration")) : null,
      }), refresh);
    };
    for (const button of root.querySelectorAll("[data-edit-goal]")) button.onclick = () => {
      const goal = goals.find((item) => item.id === button.dataset.editGoal);
      editDialog("Edit goal", field("Goal", "content", "text", goal.content, 'required maxlength="300"'), (fd) => updateRow("goals", goal.id, { content: requiredText(fd, "content") }), refresh);
    };
    for (const button of root.querySelectorAll("[data-edit-schedule]")) button.onclick = () => {
      const item = schedule.find((row) => row.id === button.dataset.editSchedule);
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(item.start_time)).map((part) => [part.type, part.value]));
      editDialog("Edit schedule", `${field("Title", "title", "text", item.title, 'required maxlength="200"')}${field("Date", "date", "date", `${parts.year}-${parts.month}-${parts.day}`, `required max="${event.date}"`)}${field("Start time", "time", "time", `${parts.hour}:${parts.minute}`, "required")}`, (fd) => updateRow("schedule_items", item.id, { title: requiredText(fd, "title"), start_time: scheduleInstant(fd, event) }), refresh);
    };
    for (const button of root.querySelectorAll("[data-task]")) button.onclick = busy(button, async () => {
      const task = tasks.find((item) => item.id === button.dataset.task);
      await updateRow("tasks", task.id, { completed: !task.completed });
      await refreshTimer();
      await refresh();
      toast(task.completed ? "Task marked incomplete." : "Task completed.");
    });
    for (const button of root.querySelectorAll("[data-timer]")) button.onclick = () => openTimer(tasks.find((task) => task.id === button.dataset.timer), event);
    for (const form of root.querySelectorAll(".add-task-form")) form.onsubmit = busy($("button", form), async () => {
      const fd = new FormData(form);
      await insertRow("tasks", { event_id: id, goal_id: form.dataset.goal || null, title: requiredText(fd, "title"), duration_minutes: fd.get("duration") ? Number(fd.get("duration")) : null });
      clearSavedInputs(form, fd);
      await refresh();
      toast("Task added.");
    });
    const bindForm = (selector, save, message, reset = false) => {
      const form = $(selector, root);
      if (!form) return;
      form.onsubmit = busy($("button", form), async () => {
        const fd = new FormData(form);
        await save(fd);
        if (reset) clearSavedInputs(form, fd); else rememberValues(form, fd);
        await refresh();
        toast(message);
      });
    };
    bindForm("#addGoal", (fd) => insertRow("goals", { event_id: id, content: requiredText(fd, "content") }), "Goal added.", true);
    bindForm("#addNote", (fd) => insertRow("notes", { event_id: id, content: requiredText(fd, "content") }), "Note saved.", true);
    bindForm("#addSchedule", (fd) => insertRow("schedule_items", { event_id: id, title: requiredText(fd, "title"), start_time: scheduleInstant(fd, event) }), "Schedule updated.", true);
    bindForm("#addReminder", (fd) => {
      const [date, time] = fd.get("at").split("T"), instant = window.PreludeHomeData.eventStart({ date, time, timezone: event.timezone });
      if (instant === null || instant <= Date.now()) throw { friendly: "Choose a future reminder time." };
      return insertRow("reminders", { event_id: id, title: requiredText(fd, "title"), remind_at: new Date(instant).toISOString(), task_id: fd.get("task") || null });
    }, "Reminder saved.", true);
    bindForm("#editEvent", (fd) => {
      const changes = { description: fd.get("description"), is_priority: fd.has("priority") };
      if (!locked(event)) changes.time = fd.get("time") || null;
      return updateRow("events", id, changes);
    }, "Event details saved.");
    for (const form of root.querySelectorAll(".save-note")) form.onsubmit = busy($("button", form), async () => {
      const fd = new FormData(form);
      await updateRow("notes", form.dataset.id, { content: requiredText(fd, "content") });
      rememberValues(form, fd);
      toast("Note saved.");
    });
    for (const [attribute, table, message] of [
      ["delete-task", "tasks", "This task and its timer sessions will be deleted."],
      ["delete-goal", "goals", "This goal and all of its tasks will be permanently deleted."],
      ["delete-note", "notes", "This note will be deleted."],
      ["delete-schedule", "schedule_items", "This item will be removed from your schedule."],
      ["delete-reminder", "reminders", "This reminder will be removed."],
    ]) for (const button of root.querySelectorAll(`[data-${attribute}]`)) button.onclick = busy(button, async () => {
      if (!(await confirmDialog("Remove this item?", message, "Delete"))) return;
      await deleteRow(table, button.getAttribute("data-" + attribute));
      if (table === "tasks" || table === "goals") await refreshTimer();
      await refresh();
      toast("Item removed.");
    });
    if ($("#directions", root)) {
      const setDirections = () => {
        const destination = event.location_lat != null ? `${event.location_lat},${event.location_lon}` : event.location;
        $("#directions", root).href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${$("#travelMode", root).value}`;
      };
      $("#travelMode", root).onchange = setDirections;
      setDirections();
    }
    if ($("#editLocation", root)) $("#editLocation", root).onclick = () => locationDialog(event, refresh);
    if ($("#completeEvent", root)) $("#completeEvent", root).onclick = busy($("#completeEvent", root), async () => {
      if (captureState(root).forms.size) {
        toast("Save your notes and event details before marking this event complete.");
        return;
      }
      if (p.completed < p.total && !(await confirmDialog("Complete this event?", `${p.total - p.completed} unfinished tasks will stay incomplete in your history.`, "Complete event"))) return;
      await rpc("prelude_complete_event", { p_event_id: id });
      await refreshTimer();
      await refresh();
      $(".memory-section", root)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      toast("Event complete. Keep a memory of your day.");
    });
    $("#deleteEvent", root).onclick = busy($("#deleteEvent", root), async () => {
      if (!(await confirmDialog("Delete this event?", "The event, its preparation and memory records will be permanently deleted.", "Delete event"))) return;
      await rpc("prelude_delete_event", { p_event_id: id });
      try {
        const files = photos.map((photo) => photo.storage_path);
        if (files.length) unwrap(await supabaseClient.storage.from("memory-photos").remove(files));
        if (event.image_path) unwrap(await supabaseClient.storage.from("event-images").remove([event.image_path]));
      } catch { sessionStorage.setItem("prelude-flash", "Event deleted. Some photographs could not be removed from storage."); }
      destroy();
      location.replace(past ? "events.html?view=past" : "events.html");
    });
    if (past) {
      bindForm("#reflection", (fd) => supabaseClient.from("event_reflections").upsert({ event_id: id, content: fd.get("content") }, { onConflict: "event_id" }).then(unwrap), "Reflection saved.");
      $("#memoryUpload", root).onchange = busy(null, async (e) => {
        const input = e.currentTarget, file = input.files[0];
        if (!file) return;
        input.disabled = true;
        try {
          const path = await uploadImage(user, "memory-photos", file);
          try { await insertRow("event_memory_photos", { event_id: id, storage_path: path }); }
          catch (error) { await supabaseClient.storage.from("memory-photos").remove([path]); throw error; }
          await refresh();
          toast("Photograph added.");
        } finally { if (input.isConnected) { input.disabled = false; input.value = ""; } }
      });
      for (const button of root.querySelectorAll("[data-delete-photo]")) button.onclick = busy(button, async () => {
        if (!(await confirmDialog("Delete this photograph?", "It will be removed from this memory.", "Delete photo"))) return;
        const photo = photos.find((item) => item.id === button.dataset.deletePhoto);
        await deleteRow("event_memory_photos", photo.id);
        let message = "Photograph removed.";
        try { unwrap(await supabaseClient.storage.from("memory-photos").remove([photo.storage_path])); }
        catch { message = "Photograph removed from this memory. Its stored file could not be deleted."; }
        await refresh();
        toast(message);
      });
    }
    function closePreparation() {
      if (disposed) return;
      isLocked = true;
      for (const checkbox of root.querySelectorAll("[data-task]")) {
        checkbox.disabled = true;
        if (!checkbox.classList.contains("done")) {
          const row = checkbox.closest(".item");
          row.classList.add("overdue");
          $("small", row).textContent = "Incomplete · preparation closed";
        }
      }
      for (const control of root.querySelectorAll(".add-task-form,#newGoal,[id^=add-task-],[data-timer],[data-edit-task],[data-delete-task],[data-edit-goal],[data-delete-goal]")) control.remove();
      $("#editEvent [name=time]", root)?.closest("label")?.remove();
      $(".deadline", root).textContent = "Preparation is closed. Unfinished tasks stay incomplete.";
      void refreshTimer();
    }
    if (!isLocked && start !== null && start > Date.now() && start - Date.now() < 2147483647)
      deadlineTimeout = setTimeout(closePreparation, start - Date.now() + 100);
    if (firstRender) {
      firstRender = false;
      const taskId = new URLSearchParams(location.search).get("task");
      const task = tasks.find((item) => item.id === taskId);
      if (task?.duration_minutes && !task.completed && !isLocked) {
        const control = root.querySelector(`[data-task="${CSS.escape(taskId)}"]`);
        let section = control?.closest("details");
        while (section) { section.open = true; section = section.parentElement.closest("details"); }
        control?.closest(".item")?.scrollIntoView({ block: "center" });
        await openTimer(task, event);
      }
    }
  }
  try { await render(); } catch (error) { destroy(); throw error; }
}
function requiredText(fd, name) {
  const value = String(fd.get(name) || "").trim();
  if (!value) throw { friendly: "Enter a few words before saving." };
  return value;
}
function scheduleInstant(fd, event) {
  if (fd.get("date") > event.date) throw { friendly: "Choose a schedule date before or on the event day." };
  const instant = window.PreludeHomeData.eventStart({ date: fd.get("date"), time: fd.get("time"), timezone: event.timezone });
  if (instant === null) throw { friendly: "Choose a valid local date and time." };
  return new Date(instant).toISOString();
}
function clearSavedInputs(form, values) {
  for (const control of form.elements) {
    if (!control.name || control.type === "file") continue;
    // Leave any new text entered while the request was running untouched.
    if (String(fieldValue(control)) === String(values.get(control.name) ?? "")) {
      control.value = control.defaultValue;
      control.dataset.savedValue = JSON.stringify(fieldValue(control));
    }
  }
}
function locationDialog(event, done) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.setAttribute("aria-label", "Event location");
  dialog.innerHTML = `<h2>Where will it happen?</h2><form class="stack section"><label>Search for a place<input name="locationQuery" type="search" required minlength="2" placeholder="A venue, place or address"></label><button class="btn sm">Search places</button></form><div class="place-results" id="locationResults" aria-live="polite"></div><button class="btn" data-close>Close</button>`;
  document.body.append(dialog);
  $("[data-close]", dialog).onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  $("form", dialog).onsubmit = busy($("form button", dialog), async () => {
    const query = $("[name=locationQuery]", dialog).value.trim();
    if (query.length < 2) throw { friendly: "Enter a place or address to search." };
    const result = await api(`/api/places?q=${encodeURIComponent(query)}`, { authenticated: true });
    $("#locationResults", dialog).innerHTML = result.places.map((place, index) => `<button class="btn place-result" data-location="${index}">${esc(place.label)}</button>`).join("") || "<small>No places found. Try a nearby address or a more specific name.</small>";
    for (const button of dialog.querySelectorAll("[data-location]")) button.onclick = busy(button, async () => {
      const place = result.places[Number(button.dataset.location)];
      await updateRow("events", event.id, { location: place.label, location_lat: place.lat, location_lon: place.lon, location_place_id: place.id });
      dialog.close();
      await done();
      toast("Location saved.");
    });
  });
}
function editDialog(title, fields, save, done) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `<h2>${esc(title)}</h2><form class="stack section">${fields}<button class="btn primary">Save changes</button><button type="button" class="btn" data-close>Cancel</button></form>`;
  document.body.append(dialog);
  $("[data-close]", dialog).onclick = () => dialog.close();
  $("form", dialog).onsubmit = busy($("button", dialog), async (e) => {
    await save(new FormData(e.currentTarget));
    dialog.close();
    await done();
    toast("Changes saved.");
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}
