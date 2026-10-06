import {
  $,
  icon,
  esc,
  heading,
  field,
  mount,
  accordion,
  busy,
  toast,
  confirmDialog,
  mapPreview,
  errorMessage,
  returnDestination,
} from "../ui.js";
import {
  rpc,
  preferences,
  profileData,
  updateProfile,
  unwrap,
  getEvent,
  queryEventRows,
  nextYearDate,
  shiftDateTime,
  api,
  uploadImage,
  signedUrls,
} from "../data.js";
const uid = () => crypto.randomUUID();
function creationError(error) {
  if (
    ["PGRST205", "42P01", "PGRST202", "42883", "PGRST204", "42703"].includes(
      error?.code,
    )
  ) {
    return {
      code: "PRELUDE_SETUP_REQUIRED",
      friendly:
        "Prelude’s database update hasn’t been installed. Complete setup, then try creating your event again.",
    };
  }
  return error;
}
const taskFields = (t) =>
  `<div class="group-card draft-task"><div class="row"><div class="grow">${field("Task", "taskTitle", "text", t?.title || "", 'required maxlength="300" placeholder="One clear next step…"')}</div><button class="text-btn danger" type="button" data-remove aria-label="Remove task">×</button></div><div style="margin-top:10px">${field("Timer minutes (optional)", "duration", "number", t?.duration_minutes || "", 'min="1" max="1440" placeholder="e.g. 45"')}</div></div>`;
const goalFields = (g) =>
  `<div class="group-card draft-goal" data-local-id="${g?.id || uid()}"><div class="row"><div class="grow">${field("Goal", "goalTitle", "text", g?.title || "", 'maxlength="300" required placeholder="What would make this event a success?"')}</div><button type="button" class="text-btn danger" data-remove aria-label="Remove goal">×</button></div><div class="goal-tasks">${(g?.tasks || []).map(taskFields).join("")}</div><button class="btn sm" data-add-goal-task type="button">${icon("plus")}Add a task</button></div>`;
export async function create(root, user) {
  const prefs = preferences(user);
  let step = 0,
    saveTimer,
    uploadQueue = Promise.resolve(),
    uploading = false,
    coverUrl = "",
    dirty = false,
    finalizing = false,
    saveVersion = 0,
    pendingSaves = 0,
    saveQueue = Promise.resolve();
  let draft = {
    title: "",
    date: new URLSearchParams(location.search).get("date") || "",
    time: "",
    timezone: prefs.timezone,
    description: "",
    location: null,
    image_path: null,
    is_priority: false,
    goals: [],
    tasks: [],
    notes: [],
    schedule: [],
  };
  const dateParam = draft.date,
    sourceId = new URLSearchParams(location.search).get("redo");
  const draftResult = await supabaseClient
    .from("event_drafts")
    .select("payload")
    .eq("user_id", user.id)
    .maybeSingle();
  if (draftResult.error) throw creationError(draftResult.error);
  const existing = draftResult.data;
  if (existing && !sourceId && !dateParam) {
    const resume = await confirmDialog(
      "A moment in the making.",
      "Continue where you left off, or start a new event.",
      "Continue draft",
      "Start new",
      null,
    );
    if (resume === null) { location.replace(returnDestination()); return; }
    if (resume) draft = { ...draft, ...existing.payload };
    else if (
      !(await confirmDialog(
        "Replace your draft?",
        "Starting a new event replaces the draft saved on your account.",
        "Start new",
      ))
    ) {
      location.replace(returnDestination());
      return;
    }
  } else if (
    existing &&
    (sourceId || dateParam) &&
    !(await confirmDialog(
      "Start a new event?",
      "This replaces the unfinished draft on your account.",
      "Start new",
    ))
  ) {
    location.replace(returnDestination());
    return;
  }
  if (sourceId) {
    const source = await getEvent(sourceId, user);
    if (!source || source.status !== "past")
      throw { friendly: "Only completed events can be repeated." };
    const [goals, tasks, notes, schedule] = await Promise.all(
      ["goals", "tasks", "notes", "schedule_items"].map((t) =>
        queryEventRows(t, sourceId),
      ),
    );
    const newDate = nextYearDate(source.date);
    draft = {
      ...draft,
      title: source.title,
      date: newDate,
      time: source.time || "",
      timezone: source.timezone,
      description: source.description || "",
      location: source.location
        ? {
            label: source.location,
            lat: source.location_lat,
            lon: source.location_lon,
            id: source.location_place_id,
          }
        : null,
      source_event_id: source.id,
      image_path: null,
      goals: goals.map((g) => ({
        id: uid(),
        title: g.content,
        tasks: tasks
          .filter((t) => t.goal_id === g.id)
          .map((t) => ({
            title: t.title,
            duration_minutes: t.duration_minutes,
          })),
      })),
      tasks: tasks
        .filter((t) => !t.goal_id)
        .map((t) => ({ title: t.title, duration_minutes: t.duration_minutes })),
      notes: notes.map((n) => ({ content: n.content })),
      schedule: schedule.map((s) => ({
        title: s.title,
        start_time: shiftDateTime(
          s.start_time,
          source.date,
          newDate,
          source.timezone,
        ),
      })),
    };
    step = 2;
  }
  if (draft.image_path) coverUrl = (await signedUrls("event-images", [draft.image_path]))[draft.image_path] || "";
  function collect() {
    if (step === 0) {
      draft.title = $("[name=title]").value.trim();
      draft.date = $("[name=date]").value;
    } else if (step === 1) {
      draft.time = $("[name=time]").value;
      draft.timezone = $("[name=timezone]").value;
      draft.description = $("[name=description]").value;
      draft.is_priority = $("[name=priority]").checked;
      const tasks = (container) =>
        Array.from(container.querySelectorAll(".draft-task")).map((el) => ({
          title: $("[name=taskTitle]", el).value.trim(),
          duration_minutes: $("[name=duration]", el).value
            ? Number($("[name=duration]", el).value)
            : null,
        }));
      draft.tasks = tasks($("#standaloneTasks"));
      draft.goals = Array.from(root.querySelectorAll(".draft-goal")).map(
        (el) => ({
          id: el.dataset.localId,
          title: $("[name=goalTitle]", el).value.trim(),
          tasks: tasks($(".goal-tasks", el)),
        }),
      );
      draft.notes = Array.from(root.querySelectorAll(".draft-note"))
        .map((el) => ({ content: $("textarea", el).value }))
        .filter((n) => n.content.trim());
    }
  }
  async function persist() {
    if (finalizing) return;
    collect();
    const snapshot = structuredClone(draft),
      version = ++saveVersion;
    dirty = false;
    pendingSaves++;
    $("#draftStatus") && ($("#draftStatus").textContent = "Saving draft…");
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        unwrap(
          await supabaseClient
            .from("event_drafts")
            .upsert(
              { user_id: user.id, payload: snapshot },
              { onConflict: "user_id" },
            ),
        );
        if (version === saveVersion && $("#draftStatus"))
          $("#draftStatus").textContent = "Draft saved to your account";
      });
    try {
      await saveQueue;
    } catch (e) {
      dirty = true;
      if ($("#draftStatus"))
        $("#draftStatus").textContent =
          "Draft not saved. Check your connection.";
      throw creationError(e);
    } finally {
      pendingSaves--;
    }
  }
  function changed() {
    dirty = true;
    if ($("#draftStatus")) $("#draftStatus").textContent = "Unsaved changes";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch(() => {}), 1200);
  }
  function render() {
    const total =
      draft.tasks.length + draft.goals.reduce((n, g) => n + g.tasks.length, 0);
    mount(
      root,
      `<a class="back" href="${esc(returnDestination())}" id="leaveCreate">${icon("back")}Back</a><ol class="creation-steps" aria-label="Create event steps">${["Event", "Details", "Review"].map((label, i) => `<li class="${i <= step ? "done" : ""}" ${i === step ? 'aria-current="step"' : ""}><span>${i+1}</span>${label}</li>`).join("")}</ol><div class="row between"><span class="step-label">STEP ${step + 1} OF 3</span><span class="saved" id="draftStatus" role="status">${pendingSaves ? "Saving draft…" : dirty ? "Unsaved changes" : saveVersion ? "Draft saved to your account" : "Preparing draft…"}</span></div>${heading(step === 0 ? "Start with a moment" : step === 1 ? "Make the preparation yours" : "One last look", step === 0 ? "Create your event." : step === 1 ? "Make it yours." : "Review your event.", step === 0 ? "Give your event a name and a day." : step === 1 ? "Add what helps. Leave the rest for later." : "Check the details. You can start preparing as soon as it’s created.")}<form id="createForm" class="stack">${
        step === 0
          ? `<section class="glass pad stack">${field("Event name", "title", "text", draft.title, 'required maxlength="120" placeholder="Something to look forward to…" ' + (sourceId ? "readonly" : ""))}${field("Event date", "date", "date", draft.date, `required min="${window.PreludeHomeData.dateKey(new Date(), draft.timezone)}" ${sourceId ? "readonly" : ""}`)}<small>Name and date define this moment and are locked after creation.</small></section>`
          : step === 1
            ? `<section class="glass pad stack"><div class="form-grid">${field("Start time (optional)", "time", "time", draft.time)}${field("Event timezone", "timezone", "text", draft.timezone, 'required list="eventTimezones"')}</div><datalist id="eventTimezones">${(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["Africa/Lagos", "UTC"]).map(zone => `<option value="${esc(zone)}">`).join("")}</datalist><small>Preparation closes at the start time, or 9 AM if unset. Events created today after that time stay editable until midnight.</small><label>Intention (optional)<textarea name="description" maxlength="2000" placeholder="What makes this moment meaningful?">${esc(draft.description)}</textarea></label><label class="row"><input type="checkbox" name="priority" ${draft.is_priority ? "checked" : ""}>Make this a priority event</label></section>${accordion("location", "Location", `<label>Search for a place<input id="placeQuery" type="search" placeholder="A venue, place or address"></label><button class="btn sm" type="button" id="searchPlace" style="margin-top:12px">Search places</button><div class="place-results" id="placeResults"></div><div id="selectedPlace">${draft.location ? `<small>${esc(draft.location.label)}</small>${mapPreview(draft.location)}<button type="button" class="text-btn" id="clearPlace">Remove location</button>` : "<small>No location selected yet.</small>"}</div>`, "pin")}${accordion("visual", "Event cover", `<label>Event cover (optional)<input id="coverFile" type="file" accept="image/jpeg,image/png,image/webp"></label><small>JPG, PNG or WebP · up to 8 MB</small><div id="coverPreview">${coverUrl ? `<img class="image-preview" src="${esc(coverUrl)}" alt="Selected event cover">` : ""}</div><p id="coverStatus" role="status"></p>`, "photo")}${accordion("goals", "Goals & their tasks", `<p class="muted" style="font-size:12px">Give each goal a few clear steps. Goals complete when their tasks do.</p><div id="draftGoals">${draft.goals.map(goalFields).join("")}</div><button class="btn sm" type="button" id="addGoal">${icon("plus")}Add goal</button>`, "goal")}${accordion("tasks", "Standalone tasks", `<div id="standaloneTasks">${draft.tasks.map(taskFields).join("")}</div><button class="btn sm" type="button" id="addTask">${icon("plus")}Add task</button>`, "check")}${accordion("notes", "Useful notes", `<div id="draftNotes">${draft.notes.map((n) => `<div class="group-card draft-note"><label>Note<textarea maxlength="10000">${esc(n.content)}</textarea></label><button class="text-btn danger" type="button" data-remove>Remove note</button></div>`).join("")}</div><button class="btn sm" type="button" id="addNote">${icon("plus")}Add note</button>`, "notes")}`
            : `<section class="glass pad"><span class="eyebrow">${esc(window.PreludeHomeData.eventDate({ date: draft.date }))}</span><h2 style="font-size:27px">${esc(draft.title)}</h2>${[
                ["Time", draft.time || "Not set · 9 AM preparation deadline"],
                ["Timezone", draft.timezone],
                ["Location", draft.location?.label || "Not set"],
                ["Goals", draft.goals.length],
                ["Tasks", total],
                ["Notes", draft.notes.length],
                ["Priority", draft.is_priority ? "Yes" : "No"],
              ]
                .map(
                  ([label, value]) =>
                    `<div class="review-row"><span class="muted">${label}</span><strong>${esc(value)}</strong></div>`,
                )
                .join(
                  "",
                )}${draft.source_event_id ? '<small style="display:block;margin-top:16px">A new moment for next year. Your original memories stay where they belong.</small>' : ""}</section>${!prefs.hideCreationWarning ? `<div class="notice"><div class="row">${icon("lock")}<strong>A moment with its own identity.</strong></div><p style="margin:10px 0">After creation, the event name and date cannot change. Time, location and preparation remain editable until their deadlines.</p><label class="row"><input name="hideWarning" type="checkbox">Don’t show this warning again</label></div>` : ""}`
      }${step ? '<button class="btn" type="button" id="previousStep">Back</button>' : ""}<p class="form-error" id="createError" role="alert"></p><button class="btn primary full" type="submit">${step === 2 ? "Create event" : step === 0 ? "Continue to details" : "Review event"}${icon("arrow")}</button></form>`,
    );
    $("#leaveCreate").onclick = async (e) => {
      e.preventDefault();
      clearTimeout(saveTimer);
      try {
        await uploadQueue;
        collect();
        await persist();
        if (step) { step--; render(); }
        else location.assign(returnDestination());
      } catch (e) {
        toast(errorMessage(e));
      }
    };
    root.oninput = changed;
    root.onchange = changed;
    root.onclick = (e) => {
      const remove = e.target.closest("[data-remove]");
      if (remove) {
        remove.closest(".draft-task,.draft-goal,.draft-note").remove();
        changed();
      }
      const add = e.target.closest("[data-add-goal-task]");
      if (add) {
        add.parentElement
          .querySelector(".goal-tasks")
          .insertAdjacentHTML("beforeend", taskFields());
        changed();
      }
    };
    if (step === 1) {
      $("#addGoal").onclick = () => {
        $("#draftGoals").insertAdjacentHTML("beforeend", goalFields());
        changed();
      };
      $("#addTask").onclick = () => {
        $("#standaloneTasks").insertAdjacentHTML("beforeend", taskFields());
        changed();
      };
      $("#addNote").onclick = () => {
        $("#draftNotes").insertAdjacentHTML(
          "beforeend",
          '<div class="group-card draft-note"><label>Note<textarea maxlength="10000"></textarea></label><button type="button" class="text-btn danger" data-remove>Remove note</button></div>',
        );
        changed();
      };
      wirePlaces();
      $("#coverFile").onchange = () => {
        const input = $("#coverFile"), file = input.files[0];
        if (!file) return;
        uploading = true;
        input.disabled = true;
        const status = $("#coverStatus");
        status.textContent = "Uploading cover…";
        uploadQueue = (async () => {
          try {
            const path = await uploadImage(user, "event-images", file);
            draft.image_path = path;
            coverUrl = (await signedUrls("event-images", [path]))[path] || "";
            if ($("#coverPreview")) $("#coverPreview").innerHTML = coverUrl ? `<img class="image-preview" src="${esc(coverUrl)}" alt="Selected event cover">` : "";
            await persist();
            status.textContent = "Cover saved.";
          } catch (error) {
            status.textContent = errorMessage(error);
            status.className = "form-error";
            input.value = "";
          } finally {
            uploading = false;
            input.disabled = false;
          }
        })();
      };
    }
    $("#createForm").addEventListener(
      "invalid",
      (e) => {
        let section = e.target.closest("details");
        while (section) {
          section.open = true;
          section = section.parentElement.closest("details");
        }
      },
      { capture: true },
    );
    if (step)
      $("#previousStep").onclick = busy($("#previousStep"), async () => {
        clearTimeout(saveTimer);
        await uploadQueue;
        collect();
        await persist();
        step--;
        render();
      });
    $("#createForm").onsubmit = busy(
      $("#createForm button[type=submit]"),
      async () => {
        await uploadQueue;
        $("#createError").textContent = "";
        collect();
        try {
          new Intl.DateTimeFormat("en", { timeZone: draft.timezone });
        } catch {
          throw { friendly: "Choose a valid event timezone." };
        }
        await persist();
        if (step < 2) {
          step++;
          render();
          window.scrollTo({ top: 0, behavior: "instant" });
          const title = root.querySelector("h1");
          title.tabIndex = -1;
          title.focus({ preventScroll: true });
          return;
        }
        clearTimeout(saveTimer);
        await saveQueue;
        finalizing = true;
        try {
          const result = await rpc("prelude_create_event", {
            p_payload: draft,
          });
          if ($("#createForm [name=hideWarning]")?.checked)
            try {
              await updateProfile(user, {
                preferences: { hideCreationWarning: true },
              });
            } catch {
              toast(
                "Event created; the warning preference could not be saved.",
              );
            }
          sessionStorage.setItem("prelude-first-event", "1");
          location.replace("index.html?created=" + encodeURIComponent(result));
        } catch (e) {
          finalizing = false;
          throw creationError(e);
        }
      },
    );
  }
  function wirePlaces() {
    const clear = () => {
      draft.location = null;
      $("#selectedPlace").innerHTML =
        "<small>No location selected yet.</small>";
      changed();
    };
    if ($("#clearPlace")) $("#clearPlace").onclick = clear;
    $("#searchPlace").onclick = busy($("#searchPlace"), async () => {
      const query = $("#placeQuery").value.trim();
      if (query.length < 3)
        throw { friendly: "Enter at least three characters to find a place." };
      const result = await api("/api/places?q=" + encodeURIComponent(query), {
        authenticated: true,
      });
      $("#placeResults").innerHTML = result.places.length
        ? result.places
            .map(
              (p, i) =>
                `<button type="button" class="btn place-result" data-place="${i}">${icon("pin")}${esc(p.label)}</button>`,
            )
            .join("")
        : "<small>No matching places. Try a different address.</small>";
      for (const b of root.querySelectorAll("[data-place]"))
        b.onclick = () => {
          draft.location = result.places[Number(b.dataset.place)];
          $("#selectedPlace").innerHTML =
            `<small>${esc(draft.location.label)}</small>${mapPreview(draft.location)}<button type="button" class="text-btn" id="clearPlace">Remove location</button>`;
          $("#clearPlace").onclick = clear;
          $("#placeResults").replaceChildren();
          changed();
        };
    });
  }
  window.addEventListener("beforeunload", (e) => {
    if ((dirty || pendingSaves || uploading) && !finalizing) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a[href]");
    if (
      !anchor ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      anchor.target === "_blank"
    )
      return;
    const target = new URL(anchor.href, location.href);
    if (
      target.origin !== location.origin ||
      target.href === location.href ||
      (target.pathname === location.pathname &&
        target.search === location.search)
    )
      return;
    e.preventDefault();
    clearTimeout(saveTimer);
    try {
      await uploadQueue;
      await persist();
      location.assign(target.href);
    } catch (error) {
      toast(errorMessage(error));
    }
  });
  window.addEventListener("pagehide", () => clearTimeout(saveTimer), {
    once: true,
  });
  render();
  await persist();
}
