const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const context = vm.createContext({ Intl, Date });
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../js/home-data.js"), "utf8"),
  context,
);
global.window = { PreludeHomeData: context.PreludeHomeData };
test("Repeat dates preserve the month/day, handle leap years and historic events", async () => {
  const { nextYearDate } = await import("../js/data.js");
  assert.equal(
    nextYearDate("2024-02-29", new Date("2026-10-02T12:00:00Z")),
    "2027-02-28",
  );
  assert.equal(
    nextYearDate("2026-12-25", new Date("2026-10-02T12:00:00Z")),
    "2027-12-25",
  );
});
test("Repeating a schedule preserves local wall time across different DST offsets", async () => {
  const { shiftDateTime } = await import("../js/data.js");
  assert.equal(
    shiftDateTime(
      "2026-03-09T13:00:00Z",
      "2026-03-11",
      "2027-03-11",
      "America/New_York",
    ),
    "2027-03-09T14:00:00.000Z",
  );
});
test("Deadline uses the stored midnight grace and keeps past events locked", async () => {
  const { deadline, locked } = await import("../js/data.js");
  const event = {
    date: "2099-10-02",
    timezone: "Africa/Lagos",
    time: null,
    preparation_deadline: "2099-10-02T23:00:00Z",
  };
  assert.equal(deadline(event), Date.parse(event.preparation_deadline));
  assert.equal(locked(event), false);
  assert.equal(locked({ ...event, status: "past" }), true);
  assert.equal(
    deadline({ ...event, preparation_deadline: null }),
    Date.parse("2099-10-02T08:00:00Z"),
  );
});
test("Map coordinates are required and untrusted labels are escaped", async () => {
  const { mapPreview, esc, errorMessage } = await import("../js/ui.js");
  assert.equal(mapPreview({ lat: null, lon: null }), "");
  assert.equal(mapPreview({ lat: 91, lon: 0 }), "");
  assert.match(mapPreview({ lat: 0, lon: 0 }), /openstreetmap/);
  assert.equal(
    esc('<img onerror="test">'),
    "&lt;img onerror=&quot;test&quot;&gt;",
  );
  assert.equal(
    errorMessage({
      code: "P0001",
      message: "Finish or stop your current timer first",
    }),
    "Finish or stop your current timer before starting another.",
  );
  assert(
    !errorMessage({ message: "sensitive table details" }).includes("sensitive"),
  );
});
