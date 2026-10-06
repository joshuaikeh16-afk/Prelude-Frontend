const paths = {
  home: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7",
  events: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  plus: "M12 5v14M5 12h14",
  calendar: "M4 5h16v16H4zM8 3v4M16 3v4M4 10h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  chevron: "M9 5l7 7-7 7",
  check: "M5 12l4 4L19 6",
  goal: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 10v4M10 12h4",
  notes: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  bell: "M5 17h14l-2-4V9a5 5 0 0 0-10 0v4zM10 21h4",
  pin: "M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  photo: "M3 4h18v16H3zM3 16l6-6 4 4 3-3 5 5M16 8h.01",
  spark: "m12 3 2 6 7 3-7 3-2 6-2-6-7-3 7-3z",
  logout: "M10 4H4v16h6M9 12h12M17 8l4 4-4 4",
  lock: "M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  play: "M8 4l12 8-12 8z",
  pause: "M8 5v14M16 5v14",
  stop: "M5 5h14v14H5z",
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
export const esc = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const $ = (selector, root = document) => root.querySelector(selector);
export function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  (document.querySelector("dialog[open]") || document.body).append(el);
  setTimeout(() => el.remove(), 4500);
}
export function errorMessage(error) {
  console.warn(
    "Prelude operation failed",
    error?.code || error?.name || "request",
  );
  const known = [
    [
      "Finish or stop your current timer",
      "Finish or stop your current timer before starting another.",
    ],
    [
      "deadline",
      "The preparation deadline has passed. Unfinished tasks stay incomplete.",
    ],
    [
      "history is read only",
      "This event is complete. Its preparation history stays as you left it.",
    ],
    [
      "Event identity is fixed",
      "The event name, date and timezone cannot change after creation.",
    ],
    ["after the event", "Choose a schedule date before or on the event day."],
    ["Choose today or a future date", "Choose today or a future date."],
    ["Timer cannot exceed", "A timer can run for up to 24 hours."],
    [
      "Set a duration or extend",
      "Set a timer duration, or extend this expired timer.",
    ],
    [
      "No active timer",
      "This timer has already stopped. Reopen it to see its current state.",
    ],
  ];
  if (!error?.friendly && error?.code === "P0001") {
    const match = known.find(([text]) => error.message?.includes(text));
    if (match) return match[1];
  }
  return (
    error?.friendly ||
    "We couldn’t save that change. Check your connection and try again."
  );
}
export function busy(button, fn, label) {
  return async (event) => {
    event?.preventDefault();
    if (button?.disabled) return;
    const text = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const action = button.textContent.trim();
      button.textContent = label || button.dataset.busyLabel ||
        (/^save/i.test(action) ? "Saving…" : /^create/i.test(action) ? "Creating…" : /^search/i.test(action) ? "Searching…" : "Working…");
    }
    try {
      await fn(event);
    } catch (e) {
      const message = errorMessage(e);
      const feedback = button?.closest("form")?.querySelector(".form-error, .form-feedback");
      if (feedback) {
        feedback.textContent = message;
        feedback.dataset.state = "error";
        feedback.setAttribute("role", "alert");
      } else toast(message);
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.innerHTML = text;
      }
    }
  };
}
export function confirmDialog(title, message, action = "Continue", cancelLabel = "Cancel", dismissValue = false) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.setAttribute("aria-label", title);
    dialog.innerHTML = `<h2>${esc(title)}</h2><p>${esc(message)}</p><div class="row"><button class="btn" data-no>${esc(cancelLabel)}</button><button class="btn primary" data-yes>${esc(action)}</button></div>`;
    document.body.append(dialog);
    const close = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    $("[data-no]", dialog).onclick = () => close(false);
    $("[data-yes]", dialog).onclick = () => close(true);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(dismissValue);
    });
    dialog.showModal();
  });
}
export const heading = (eyebrow, title, description = "") =>
  `<div class="heading"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>`;
export const empty = (title, description, link = "", label = "Create event") =>
  `<div class="glass empty"><div class="empty-icon">${icon("spark")}</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${link ? `<a class="btn primary" href="${esc(link)}">${esc(label)}${icon("arrow")}</a>` : ""}</div>`;
export const field = (label, name, type = "text", value = "", extra = "") =>
  `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export function returnDestination(fallback = "index.html") {
  const pages = new Set(["index.html", "events.html", "calendar.html", "profile.html", "settings.html", "event.html"]);
  for (const candidate of [new URLSearchParams(location.search).get("from"), document.referrer]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate, location.href);
      const current = new URL(location.href);
      const directory = current.pathname.slice(0, current.pathname.lastIndexOf("/") + 1);
      if (url.origin === current.origin && url.pathname.startsWith(directory) &&
          pages.has(url.pathname.slice(directory.length)) && url.pathname !== current.pathname) {
        return url.pathname + url.search + url.hash;
      }
    } catch { /* Use the next local destination. */ }
  }
  return fallback;
}
export const back = (link, label = "Back") => {
  const destination = returnDestination(link);
  return `<a class="back" href="${esc(destination)}">${icon("back")}${esc(destination === link ? label : "Back")}</a>`;
};
export function accordion(id, title, body, kind = "notes", open = false) {
  return `<details class="glass accordion" id="${id}" ${open ? "open" : ""}><summary>${icon(kind)}${esc(title)}</summary><div class="accordion-content">${body}</div></details>`;
}
export function mount(root, html) {
  root.innerHTML = html;
  root.setAttribute("aria-busy", "false");
}
export function navigation(page) {
  return `<div class="nav-dock"><nav class="nav" aria-label="Main navigation">${[
    ["index.html", "Home", "home"],
    ["events.html", "Events", "events"],
    ["calendar.html", "Calendar", "calendar"],
  ]
    .map(
      ([href, title, symbol]) =>
        `<a href="${href}" class="${page === href ? "active" : ""}" ${page === href ? 'aria-current="page"' : ""} aria-label="${title}">${icon(symbol)}<span>${title}</span></a>`,
    )
    .join("")}</nav><a href="create.html" class="create-nav" aria-label="Create event" ${page === "create.html" ? 'aria-current="page"' : ""}>${icon("plus")}</a></div>`;
}
export function mapPreview(place) {
  if (
    place?.lat == null ||
    place?.lon == null ||
    Math.abs(Number(place.lat)) > 90 ||
    Math.abs(Number(place.lon)) > 180 ||
    !Number.isFinite(Number(place?.lat)) ||
    !Number.isFinite(Number(place?.lon))
  )
    return "";
  const lat = Number(place.lat),
    lon = Number(place.lon);
  const bbox = [lon - 0.012, lat - 0.008, lon + 0.012, lat + 0.008].join(",");
  return `<iframe class="map" title="Selected event location" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}"></iframe><small>Map © OpenStreetMap contributors</small>`;
}
