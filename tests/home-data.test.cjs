const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ Intl, Date });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/home-data.js"), "utf8"), context);
const home = context.PreludeHomeData;
const event = (overrides = {}) => ({
  id: "event-1", date: "2026-10-02", time: "16:00:00", timezone: "Africa/Lagos",
  status: "upcoming", is_priority: false, ...overrides
});

test("countdown uses the event timezone, not the machine timezone", () => {
  assert.equal(home.eventStart(event()), Date.parse("2026-10-02T15:00:00Z"));
  const remaining = home.countdown(event(), new Date("2026-10-02T13:30:00Z"));
  assert.equal(remaining.days, 0);
  assert.equal(remaining.hours, 1);
  assert.equal(remaining.minutes, 30);
});

test("timezone conversion handles daylight saving and rejects nonexistent wall times", () => {
  assert.equal(home.eventStart(event({ timezone: "America/New_York", date: "2026-07-01", time: "10:00" })),
    Date.parse("2026-07-01T14:00:00Z"));
  assert.equal(home.eventStart(event({ timezone: "America/New_York", date: "2026-01-01", time: "10:00" })),
    Date.parse("2026-01-01T15:00:00Z"));
  assert.equal(home.eventStart(event({ timezone: "America/New_York", date: "2026-03-08", time: "02:30" })), null);
});

test("missing or invalid date/time/zone does not fabricate a countdown", () => {
  for (const overrides of [{ timezone: null }, { timezone: "invalid" }, { date: "2026-02-30" }, { time: "25:00" }]) {
    assert.equal(home.eventStart(event(overrides)), null);
    assert.equal(home.countdown(event(overrides)).status, "Time unavailable");
  }
});

test("today and date-only events never imply recorded completion", () => {
  assert.equal(home.countdown(event(), new Date("2026-10-02T16:00:00Z")).status, "Happening today");
  assert.equal(home.countdown(event({ time: null }), new Date("2026-10-02T10:00:00Z")).status, "Happening today");
  assert.equal(home.countdown(event(), new Date("2026-10-03T10:00:00Z")).status, "Event date has passed");
});

test("events are selected by their local calendar date across the date boundary", () => {
  const west = event({ id: "west", date: "2026-10-01", timezone: "America/Los_Angeles" });
  const east = event({ id: "east", date: "2026-10-01", timezone: "Asia/Tokyo" });
  const selected = home.selectEvents([west, east], new Date("2026-10-02T01:00:00Z"));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "west");
});

test("nearest events lead, priority breaks ties, past events are excluded, and the summary stays bounded", () => {
  const rows = [event({ id: "later", date: "2026-11-01", is_priority: true }),
    event({ id: "normal" }), event({ id: "priority", is_priority: true }),
    event({ id: "past", status: "past" }), event({ id: "old", date: "2026-09-30" }),
    event({ id: "next", date: "2026-10-03" }), event({ id: "next2", date: "2026-10-04" })];
  const selected = home.selectEvents(rows, new Date("2026-10-02T10:00:00Z"));
  assert.deepEqual(Array.from(selected, (item) => item.id), ["priority", "normal", "next", "next2"]);
});

test("progress is derived exclusively from completed tasks, including empty and complete cases", () => {
  const empty = home.preparation([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.percent, 0);
  assert.equal(home.preparation([{ completed: true }, { completed: false }, { completed: false }]).percent, 33);
  assert.equal(home.preparation([{ completed: true }, { completed: true }]).percent, 100);
  assert.equal(home.preparation([{ completed: "true" }]).completed, 0);
});

test("event date formatting preserves the calendar day and missing location is graceful", () => {
  assert.match(home.eventDate(event()), /2/);
  assert.equal(home.details(event({ time: null, location: null })), "Location not set");
});
