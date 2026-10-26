/* Pure home-page calculations. No sample data or database credentials. */
(function (root) {
  "use strict";

  function dateKey(now, timezone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function eventStart(event) {
    if (!event.timezone || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return null;
    const time = event.time || "00:00:00";
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
    const [year, month, day] = event.date.split("-").map(Number);
    const [hour, minute, second = 0] = time.split(":").map(Number);
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    const check = new Date(desired);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
    try {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: event.timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
      });
      let instant = desired;
      // Resolve the event's wall time using the zone's offset at that instant,
      // including daylight-saving changes. Impossible local times return null.
      for (let attempt = 0; attempt < 4; attempt++) {
        const parts = formatter.formatToParts(new Date(instant));
        const part = (type) => Number(parts.find((item) => item.type === type).value);
        const wallTime = Date.UTC(part("year"), part("month") - 1, part("day"),
          part("hour"), part("minute"), part("second"));
        if (wallTime === desired) return instant;
        instant += desired - wallTime;
      }
    } catch { /* Missing/invalid timezone: display the date without a fake countdown. */ }
    return null;
  }

  function selectEvents(events, now = new Date()) {
    return events.filter((event) => {
      if (event.status !== "upcoming") return false;
      try { return event.date >= dateKey(now, event.timezone); }
      catch { return event.date >= dateKey(now, "UTC"); }
    }).sort((a, b) => {
      const aStart = eventStart(a) ?? Date.parse(`${a.date}T00:00:00Z`);
      const bStart = eventStart(b) ?? Date.parse(`${b.date}T00:00:00Z`);
      return aStart - bStart || Number(Boolean(b.is_priority)) - Number(Boolean(a.is_priority)) ||
        String(a.id).localeCompare(String(b.id));
    }).slice(0, 4);
  }

  function preparation(tasks) {
    const total = tasks.length;
    const completed = tasks.filter((task) => task.completed === true).length;
    return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 };
  }

  function countdown(event, now = new Date()) {
    const start = eventStart(event);
    if (start === null) return { status: "Time unavailable" };
    let today;
    try { today = dateKey(now, event.timezone); } catch { return { status: "Time unavailable" }; }
    if (event.date < today) return { status: "Event date has passed" };
    if (!event.time && event.date === today) return { status: "Happening today" };
    const diff = start - now.getTime();
    if (diff <= 0) return { status: "Happening today" };
    const minutes = Math.floor(diff / 60000);
    return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 };
  }

  function eventDate(event, short = false) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC", day: "numeric", month: short ? "short" : "long",
      ...(short ? {} : { year: "numeric" })
    }).format(new Date(`${event.date}T12:00:00Z`));
  }

  function details(event) {
    const parts = [event.location || "Location not set"];
    const start = eventStart(event);
    if (event.time && start !== null) {
      parts.push(new Intl.DateTimeFormat(undefined, {
        timeZone: event.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short"
      }).format(new Date(start)));
    }
    return parts.join(" · ");
  }

  root.PreludeHomeData = { dateKey, eventStart, selectEvents, preparation, countdown, eventDate, details };
})(globalThis);
