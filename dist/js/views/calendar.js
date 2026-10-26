import { $, icon, esc, heading, mount, empty, toast } from "../ui.js";
import { listEvents, preferences, api } from "../data.js";
import { eventCard } from "./events.js";
export async function calendar(root, user) {
  const events = await listEvents(user),
    prefs = preferences(user),
    today = window.PreludeHomeData.dateKey(new Date(), prefs.timezone);
  const stateKey = `prelude-calendar-day:${user.id}`;
  const candidate = new URLSearchParams(location.search).get("date") || sessionStorage.getItem(stateKey) || today;
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate) && Number.isFinite(Date.parse(candidate)) ? candidate : today;
  let selected = new Date(`${initialDate}T12:00:00Z`),
    month = selected.getUTCMonth(),
    year = selected.getUTCFullYear(),
    holidays = [],
    holidayMessage = "",
    holidayNote = "",
    request = 0;
  mount(
    root,
    `${heading("See what’s ahead", "Your calendar.", "Choose a day for events and holidays.")}<section class="glass pad"><div class="calendar-nav"><button class="icon-btn" id="previousMonth" aria-label="Previous month">${icon("back")}</button><div class="calendar-heading"><h2 id="monthTitle"></h2><button type="button" class="text-btn" id="todayButton">Today</button></div><button class="icon-btn" id="nextMonth" aria-label="Next month">${icon("arrow")}</button></div><div class="weekdays">${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((x) => `<span>${x}</span>`).join("")}</div><div class="calendar-grid" id="calendarGrid"></div></section><section class="section"><div class="section-head"><div><span class="eyebrow">Selected day</span><h2 id="dayTitle"></h2></div><a class="btn sm" id="createOnDay" aria-label="Create event on selected day">${icon("plus")}Create</a></div><div class="stack" id="dayEvents"></div><div class="glass pad section"><div class="row between"><h3>National holidays</h3><a href="settings.html" class="text-btn">${esc(prefs.holidayCountry)}</a></div><div id="holidays" class="muted" style="font-size:13px;margin-top:12px"></div><p id="holidayNote" class="muted" style="font-size:12px;margin-top:12px"></p><div id="monthHolidays" class="stack" style="margin-top:16px"></div></div></section>`,
  );
  function key(d) {
    return d.toISOString().slice(0, 10);
  }
  function dayInfo() {
    const date = key(selected);
    sessionStorage.setItem(stateKey, date);
    history.replaceState(null, "", `calendar.html?date=${date}`);
    $("#dayTitle").textContent = selected.toLocaleDateString(undefined, {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    });
    const rows = events.filter((e) => e.date === date);
    $("#dayEvents").innerHTML = rows.length
      ? rows.map(e => eventCard(e, `calendar.html?date=${date}`)).join("")
      : '<p class="quiet-empty">No events on this day.</p>';
    $("#createOnDay").href = `create.html?date=${date}`;
    $("#createOnDay").hidden = date < today;
    $("#holidayNote").textContent = holidayNote;
    $("#monthHolidays").innerHTML = holidays.filter(h => h.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)).map(h => `<button type="button" class="settings-row holiday-row" data-holiday-date="${esc(h.date)}"><span class="grow">${esc(h.name)}</span><small>${esc(new Date(`${h.date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" }))}</small></button>`).join("");
    for (const button of root.querySelectorAll("[data-holiday-date]")) button.onclick = () => { selected = new Date(`${button.dataset.holidayDate}T12:00:00Z`); render(); };
    $("#holidays").innerHTML = holidayMessage
      ? esc(holidayMessage)
      : holidays
          .filter((h) => h.date === date)
          .map((h) => `<p>${esc(h.name)}</p>`)
          .join("") || "No public holidays listed for this day.";
  }
  function render() {
    const first = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7,
      n = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    $("#monthTitle").textContent = new Date(
      Date.UTC(year, month, 1),
    ).toLocaleDateString(undefined, {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
    $("#calendarGrid").innerHTML =
      Array.from({ length: first }, () => "<span></span>").join("") +
      Array.from({ length: n }, (_, i) => {
        const date = new Date(Date.UTC(year, month, i + 1)),
          dateKey = key(date);
        return `<button class="calendar-day ${holidays.some(h => h.date === dateKey) ? "has-holiday" : ""} ${dateKey === today ? "today" : ""} ${dateKey === key(selected) ? "selected" : ""} ${events.some((e) => e.date === dateKey) ? "has-events" : ""}" data-date="${dateKey}" aria-label="${esc(date.toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "full" }) + holidays.filter(h => h.date === dateKey).map(h => `, ${h.name}`).join(""))}" aria-pressed="${dateKey === key(selected)}">${i + 1}</button>`;
      }).join("");
    for (const b of root.querySelectorAll("[data-date]")) {
      let timer,
        held = false,
        start;
      const clear = () => clearTimeout(timer);
      b.onpointerdown = (e) => {
        if (e.button !== 0) return;
        held = false;
        start = { x: e.clientX, y: e.clientY };
        timer = setTimeout(() => {
          held = true;
          if (b.dataset.date < today) {
            toast("Choose today or a future date.");
            return;
          }
          location.assign(`create.html?date=${b.dataset.date}`);
        }, 550);
      };
      b.onpointermove = (e) => {
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10)
          clear();
      };
      b.onpointerup = clear;
      b.onpointercancel = clear;
      b.onpointerleave = clear;
      b.oncontextmenu = (e) => e.preventDefault();
      b.onclick = () => {
        if (held) {
          held = false;
          return;
        }
        selected = new Date(`${b.dataset.date}T12:00:00Z`);
        render();
      };
    }
    dayInfo();
  }
  async function getHolidays() {
    const version = ++request;
    holidays = [];
    holidayNote = "";
    holidayMessage = "Loading holiday information…";
    render();
    dayInfo();
    try {
      const result = await api(
        `/api/holidays?year=${year}&country=${prefs.holidayCountry}`,
        { authenticated: true },
      );
      if (version !== request) return;
      holidays = Array.isArray(result.holidays) ? result.holidays : [];
      holidayNote = result.note || "";
      holidayMessage = result.available
        ? ""
        : "Holiday information is not available for this country yet.";
    } catch {
      if (version !== request) return;
      holidayMessage = "Holiday information is temporarily unavailable.";
    }
    render();
  }
  $("#previousMonth").onclick = () => {
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
    selected = new Date(Date.UTC(year, month, 1));
    render();
    getHolidays();
  };
  $("#nextMonth").onclick = () => {
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
    selected = new Date(Date.UTC(year, month, 1));
    render();
    getHolidays();
  };
  $("#todayButton").onclick = () => {
    selected = new Date(`${today}T12:00:00Z`);
    month = selected.getUTCMonth();
    year = selected.getUTCFullYear();
    render();
    getHolidays();
  };
  render();
  getHolidays();
}
