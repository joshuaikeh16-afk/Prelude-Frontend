import { $, icon, esc, heading, mount, empty } from "../ui.js";
import { listEvents, locked } from "../data.js";
export function eventCard(e, returnTo = "") {
  const date = new Date(`${e.date}T12:00:00Z`);
  const state = e.status === "past" ? "Remembered" : locked(e) ? "Preparation closed" : "Preparing";
  const returnQuery = typeof returnTo === "string" && returnTo ? `&from=${encodeURIComponent(returnTo)}` : "";
  return `<a class="glass event-card" href="event.html?id=${encodeURIComponent(e.id)}${returnQuery}"><div class="date-tile"><b>${date.getUTCDate()}</b><small>${date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase()}</small></div><div class="grow"><h3>${esc(e.title)}</h3><p>${esc(e.location || state)}${e.is_priority ? " · Priority" : ""}</p></div>${icon("chevron")}</a>`;
}
export async function events(root, user) {
  const rows = await listEvents(user);
  const stateKey = `prelude-events-view:${user.id}`;
  const params = new URLSearchParams(location.search || sessionStorage.getItem(stateKey) || "");
  let past = params.get("view") === "past";
  mount(
    root,
    `${heading("Plan it. Live it. Remember it.", "Your events.", "Preparation ahead. Memories to keep.")}<label class="search"><span class="sr-only">Search your events</span><input id="eventSearch" type="search" placeholder="Find an event…" aria-label="Search events" value="${esc(params.get("q") || "")}"></label><div class="segmented" role="group" aria-label="Event stage"><button id="upcomingToggle">Upcoming</button><button id="pastToggle">Past events</button></div><div class="stack" id="eventList"></div>`,
  );
  function render() {
    const query = $("#eventSearch").value.toLowerCase();
    const current = new URLSearchParams({ view: past ? "past" : "upcoming" });
    if (query) current.set("q", $("#eventSearch").value);
    sessionStorage.setItem(stateKey, current.toString());
    history.replaceState(null, "", `events.html?${current}`);
    const selected = rows
      .filter(
        (e) =>
          (e.status === "past") === past &&
          e.title.toLowerCase().includes(query),
      )
      .sort((a, b) =>
        past ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
      );
    $("#upcomingToggle").classList.toggle("active", !past);
    $("#pastToggle").classList.toggle("active", past);
    $("#upcomingToggle").setAttribute("aria-pressed", String(!past));
    $("#pastToggle").setAttribute("aria-pressed", String(past));
    $("#eventList").innerHTML = selected.length
      ? selected.map(e => eventCard(e, `events.html?${current}`)).join("")
      : empty(
          query
            ? "No matching moments"
            : past
              ? "Your memories will live here."
              : "What are you looking forward to?",
          query
            ? "Try another event name."
            : past
              ? "Finished events keep their preparation, photos and reflections."
              : "Create an event and give yourself something meaningful to prepare for.",
          past || query ? "" : "create.html",
        );
  }
  $("#eventSearch").oninput = render;
  $("#upcomingToggle").onclick = () => {
    past = false;
    render();
  };
  $("#pastToggle").onclick = () => {
    past = true;
    render();
  };
  render();
}
