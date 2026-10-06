const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
let lastPage;
const origin = process.env.PRELUDE_TEST_ORIGIN || "http://127.0.0.1:8081";
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let checks = 0;
  async function setup(mode = "normal", width = 390) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      timezoneId: "Africa/Lagos",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    lastPage = page;
    await page.route(origin + "/js/app-v1.js", route => route.fulfill({contentType: "text/javascript", body: require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../js/app-v1.js"), "utf8").replace('console.warn("Prelude page failed", error?.code || error?.name);', 'window.__testBootError = error.stack;')}));
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.supabase={createClient:()=>window.__db}",
      }),
    );
    let mailAccounts = [{id: "mail-1", email: "connected@example.com", auto_import: true, last_scan_at: null}];
    let mailSuggestions = [{id: "suggestion-1", source_subject: "Appointment confirmed", source_sender: "organizer@example.com", confidence: "review", payload: {title: "Email appointment", date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), time: "14:00", timezone: "Africa/Lagos", location: "Lagos", description: "Confirm the details"}}];
    await page.route(/^http:\/\/(?:localhost|127\.0\.0\.1):3000\/api\//, (route) => {
      const url = route.request().url();
      if (url.includes("/api/mail/")) {
        const method = route.request().method();
        const input = method === "GET" ? {} : route.request().postDataJSON();
        let body;
        if (url.includes("connections")) {
          if (method === "POST") mailAccounts[0].auto_import = input.autoImport;
          if (method === "DELETE") { mailAccounts = []; mailSuggestions = []; }
          body = method === "GET" ? {configured: mode === "mail", connections: mode === "mail" ? mailAccounts : []} : {success: true, revoked: true};
        } else if (url.includes("scan")) body = {checked: 20, detected: 1, imported: 1, hasMore: false};
        else if (url.includes("suggestions")) {
          if (method === "POST") mailSuggestions = [];
          body = method === "GET" ? {suggestions: mailSuggestions} : {success: true, eventId: "event-1"};
        } else body = {url: "https://accounts.google.com/o/oauth2/v2/auth"};
        return route.fulfill({contentType: "application/json", body: JSON.stringify(body)});
      }
      const body = url.includes("holidays")
        ? mode === "holidays" ? {available: true, partial: true, note: "Showing recurring Nigerian holidays.", holidays: [{name: "Independence Day", date: "2026-10-01"}]} : { available: true, holidays: [] }
        : url.includes("places")
          ? {
              places: [
                { label: "Lagos venue", lat: 6.5, lon: 3.3, id: "place-1" },
              ],
            }
          : url.includes("email/verify")
            ? { verified: true, verificationToken: "verified-proof" }
            : { success: true };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.addInitScript(
      ({ mode }) => {
        if (mode !== "intro") localStorage.setItem("prelude-intro-done", "1");
        const user = {
          id: "11111111-1111-4111-8111-111111111111",
          email: "ada@example.com",
          user_metadata: {
            prelude_profile: {
              name: "Ada Test",
              nickname: "Ada",
              complete: true,
              walkthrough_completed: mode !== "tour",
              preferences: {
                holidayCountry: "NG",
                timezone: "Africa/Lagos",
                notifications: false,
              },
            },
          },
        };
        const future = new Date(Date.now() + 4 * 86400000)
            .toISOString()
            .slice(0, 10),
          today = new Date().toLocaleDateString("en-CA", {
            timeZone: "Africa/Lagos",
          });
        const tables = {
          events: [
            {
              id: "event-1",
              user_id: user.id,
              title: "Prepare for graduation",
              date: future,
              time: "14:00",
              timezone: "Africa/Lagos",
              status: "upcoming",
              location: null,
              preparation_deadline: new Date(
                Date.now() + 4 * 86400000,
              ).toISOString(),
            },
            {
              id: "past-1",
              user_id: user.id,
              title: "A remembered moment",
              date: "2025-06-10",
              timezone: "Africa/Lagos",
              status: "past",
            },
          ],
          tasks: [
            {
              id: "task-1",
              event_id: "event-1",
              title: "Pack the essentials",
              duration_minutes: 10,
              completed: false,
              goal_id: "goal-1",
            },
            {
              id: "task-2",
              event_id: "event-1",
              title: "Confirm the venue",
              completed: true,
              goal_id: null,
            },
          ],
          goals: [
            { id: "goal-1", event_id: "event-1", content: "Arrive prepared" },
          ],
          notes: [
            {
              id: "note-1",
              event_id: "event-1",
              content: "Bring the invitation.",
            },
          ],
          schedule_items: [],
          reminders: [],
          task_sessions: [],
          event_drafts: [],
          event_memory_photos: [],
          event_reflections: [],
          profiles: [],
          push_subscriptions: [],
        };
        if (mode === "locked") {
          tables.events[0].preparation_deadline = new Date(
            Date.now() - 60000,
          ).toISOString();
          tables.events[0].date = today;
        }
        if (mode === "closing")
          tables.events[0].preparation_deadline = new Date(
            Date.now() + 5000,
          ).toISOString();
        if (mode === "empty") tables.events = [];
        if (mode === "google-mail") {
          window.PreludeConfig = {authCallback: {hasTokens: true}};
          sessionStorage.setItem("prelude-gmail-permission", String(Date.now()));
        }
        window.__tables = tables;
        window.__user = user;
        window.__calls = [];
        function from(table) {
          let filters = [],
            operation = "read",
            value,
            single = false,
            range = [0, 199];
          const q = {
            select: () => q,
            order: () => q,
            eq: (k, v) => {
              filters.push((row) => row[k] === v);
              return q;
            },
            in: (k, v) => {
              filters.push((row) => v.includes(row[k]));
              return q;
            },
            range: (a, b) => {
              range = [a, b];
              return q;
            },
            maybeSingle: () => {
              single = true;
              return q;
            },
            single: () => {
              single = true;
              return q;
            },
            insert: (v) => {
              operation = "insert";
              value = v;
              return q;
            },
            upsert: (v) => {
              operation = "upsert";
              value = v;
              return q;
            },
            update: (v) => {
              operation = "update";
              value = v;
              return q;
            },
            delete: () => {
              operation = "delete";
              return q;
            },
            then(resolve, reject) {
              try {
                window.__calls.push({ table, operation, value });
                let rows = tables[table] || [];
                let matches = rows.filter((r) => filters.every((f) => f(r)));
                if (operation === "read") {
                  if (
                    mode === "missing-creation-schema" &&
                    table === "event_drafts"
                  )
                    return Promise.resolve({
                      data: null,
                      error: { code: "PGRST205" },
                    }).then(resolve, reject);
                  if (mode === "task-error" && table === "tasks")
                    return Promise.resolve({
                      data: null,
                      error: { code: "TEST_FAILURE" },
                    }).then(resolve, reject);
                  const result = matches.slice(range[0], range[1] + 1);
                  return Promise.resolve({
                    data: single ? result[0] || null : result,
                    error: null,
                  }).then(resolve, reject);
                }
                if (operation === "update")
                  matches.forEach((r) => Object.assign(r, value));
                if (operation === "delete")
                  tables[table] = rows.filter((r) => !matches.includes(r));
                if (operation === "insert" || operation === "upsert") {
                  if (table === "event_drafts")
                    localStorage.setItem(
                      "test-draft",
                      JSON.stringify(value.payload),
                    );
                  const previous =
                    operation === "upsert"
                      ? rows.find(
                          (r) =>
                            (value.user_id && r.user_id === value.user_id) ||
                            (value.event_id && r.event_id === value.event_id) ||
                            (value.id && r.id === value.id),
                        )
                      : null;
                  if (previous) {
                    Object.assign(previous, value);
                    matches = [previous];
                  } else {
                    const item = { id: crypto.randomUUID(), ...value };
                    rows.push(item);
                    tables[table] = rows;
                    matches = [item];
                  }
                }
                return Promise.resolve({
                  data: single ? matches[0] || null : matches,
                  error: null,
                }).then(resolve, reject);
              } catch (e) {
                return Promise.reject(e).then(resolve, reject);
              }
            },
          };
          return q;
        }
        window.__db = {
          from,
          storage: {
            from: () => ({
              createSignedUrls: async () => ({ data: [], error: null }),
              upload: async () => ({ data: {}, error: null }),
              remove: async () => ({ data: {}, error: null }),
            }),
          },
          auth: {
            getUser: async () => ({
              ...(mode === "deleted-user" && !localStorage.getItem("test-auth-cleared") ? {data: {user: null}, error: {code: "user_not_found", status: 403}} : {data: {
                user: ["signed-out", "intro", "signup", "deleted-user"].includes(mode)
                  ? null
                  : user,
              },
              error: null}),
            }),
            signOut: async options => {
              if (options?.scope === "local") localStorage.setItem("test-auth-cleared", "1");
              return {error: null};
            },
            getSession: async () => ({
              data: { session: { access_token: "test-token", ...(mode === "google-mail" ? {user, provider_refresh_token: "google-refresh"} : {}) } },
              error: null,
            }),
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe() {} } },
            }),
            signInWithPassword: async () => ({ data: { user }, error: null }),
            updateUser: async ({ data }) => {
              if (mode === "save-failure") return {data: null, error: {message: "Fixture save failed"}};
              Object.assign(user.user_metadata, data);
              localStorage.setItem(
                "test-profile",
                JSON.stringify(user.user_metadata.prelude_profile),
              );
              return { data: { user }, error: null };
            },
          },
          rpc: async (name, args) => {
            window.__calls.push({ rpc: name, args });
            if (name === "prelude_create_event")
              localStorage.setItem(
                "test-created-payload",
                JSON.stringify(args.p_payload),
              );
            if (name === "prelude_get_timer")
              return {
                data:
                  tables.task_sessions.find((s) =>
                    ["running", "paused", "expired"].includes(s.state),
                  ) || null,
                error: null,
              };
            if (name === "prelude_task_timer")
              return {
                data:
                  tables.task_sessions.find(
                    (s) => s.task_id === args.p_task_id,
                  ) || null,
                error: null,
              };
            if (name === "prelude_timer") {
              let s = tables.task_sessions.find(
                (s) => s.task_id === args.p_task_id,
              );
              const task = tables.tasks.find((t) => t.id === args.p_task_id);
              if (!s) {
                s = {
                  id: "session-1",
                  task_id: task.id,
                  event_id: task.event_id,
                  task_title: task.title,
                  remaining_seconds: task.duration_minutes * 60,
                };
                tables.task_sessions.push(s);
              }
              if (args.p_action === "complete") {
                task.completed = true;
                s.state = "completed";
              } else {
                s.state =
                  args.p_action === "pause"
                    ? "paused"
                    : args.p_action === "stop"
                      ? "stopped"
                      : "running";
                s.remaining_seconds += args.p_seconds || 0;
                s.deadline = new Date(
                  Date.now() + s.remaining_seconds * 1000,
                ).toISOString();
              }
              return { data: s, error: null };
            }
            return {
              data: name === "prelude_create_event" ? "created-id" : null,
              error: null,
            };
          },
        };
      },
      { mode },
    );
    return { context, page, errors };
  }
  async function loaded(page, path) {
    await page.goto(origin + "/" + path);
    await page.locator('#app[aria-busy="false"]').waitFor();
    assert(
      !(await page.getByText("Let’s try that again.").count()),
      "Page failed to render",
    );
  }
  async function clean(t, label) {
    assert.deepEqual(t.errors, [], label + " JavaScript errors");
    assert(
      await t.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      label + " overflows mobile viewport",
    );
    console.log("PASS " + label);
    checks++;
    await t.context.close();
  }
  let t = await setup("intro");
  await loaded(t.page, "index.html");
  await t.page.waitForURL("**/intro.html");
  for (let i = 0; i < 3; i++) await t.page.locator("#introNext").click();
  await t.page.waitForURL("**/signin.html");
  await clean(t, "Required intro and sign-in routing");
  t = await setup("tour");
  await loaded(t.page, "index.html");
  await t.page.locator("#tourNext").waitFor();
  for (let i = 0; i < 4; i++) await t.page.locator("#tourNext").click();
  await t.page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("test-profile")).walkthrough_completed,
  );
  await clean(t, "Required walkthrough saved to account");
  t = await setup();
  await loaded(t.page, "index.html");
  assert(await t.page.getByText("1 of 2 tasks completed").count());
  await t.page.screenshot({
    path: "/tmp/prelude-home-validation/home-upgraded-mobile.png",
    fullPage: true,
  });
  await clean(t, "Home uses real tasks for progress");
  t = await setup();
  await loaded(t.page, "events.html");
  await t.page
    .getByRole("button", { name: "Past events", exact: true })
    .click();
  await t.page.getByText("A remembered moment").waitFor();
  await clean(t, "Events toggle and remembered moments");
  t = await setup();
  await loaded(t.page, "event.html?id=event-1");
  await t.page.locator("#goals details").first().evaluate(el => { el.open = true; });
  await t.page.locator('[data-timer="task-1"]').click();
  await t.page.locator("[data-action=start]").click();
  await t.page.locator("[data-action=pause]").click();
  await t.page.locator('[data-extend="5"]').click();
  await t.page.locator("[data-action=stop]").click();
  await t.page.locator("#closeTimer").click();
  await clean(t, "Workspace timer start, pause, extend and stop");
  t = await setup("locked");
  await loaded(t.page, "event.html?id=event-1");
  assert(await t.page.locator('[data-task="task-1"]').isDisabled());
  assert.equal(await t.page.locator("[data-timer]").count(), 0);
  assert(
    await t.page
      .getByText("Preparation is closed. Unfinished tasks stay incomplete.")
      .count(),
  );
  await clean(t, "Deadline disables preparation and shows incomplete tasks");
  t = await setup();
  await loaded(t.page, "event.html?id=past-1");
  await t.page.locator("#reflection textarea").fill("A wonderful memory");
  await t.page.locator("#reflection button").click();
  assert(await t.page.getByText("Reflection saved.").count());
  assert.equal(await t.page.locator(".add-task-form").count(), 0);
  assert.equal(
    await t.page.locator(".back").getAttribute("href"),
    "events.html?view=past",
  );
  await clean(t, "Remember is read-only with editable reflection");
  t = await setup();
  await loaded(t.page, "profile.html");
  assert(await t.page.getByText("ada@example.com").count());
  assert.equal(await t.page.locator(".nav a").count(), 3);
  assert.equal(await t.page.locator(".nav .create-nav").count(), 0);
  assert.equal(await t.page.locator(".nav-dock > .create-nav").count(), 1);
  await t.page.locator("[data-memory-id=past-1] summary").click();
  await t.page.getByText("No reflection saved yet.").waitFor();
  assert(t.page.url().includes("profile.html"));
  await clean(t, "Profile and live event statistics");
  t = await setup();
  await loaded(t.page, "calendar.html?date=2025-06-10");
  await t.page.locator('#dayEvents a[href*="past-1"]').click();
  await t.page.locator(".back").click();
  await t.page.waitForURL("**/calendar.html?date=2025-06-10");
  await clean(t, "Memory returns to the selected calendar day");
  t = await setup();
  await loaded(t.page, "events.html?view=past&q=remembered");
  await t.page.locator('#eventList a[href*="past-1"]').click();
  await t.page.locator(".back").click();
  await t.page.waitForURL("**/events.html?view=past&q=remembered");
  assert.equal(await t.page.locator("#eventSearch").inputValue(), "remembered");
  await clean(t, "Memory returns to filtered past events");
  t = await setup();
  await loaded(t.page, "calendar.html");
  await t.page.locator(".avatar").click();
  await t.page.locator('.settings-row[href="settings.html"]').click();
  await t.page.evaluate(() => window.__tables.event_reflections.push({event_id: "past-1", content: "A lovely day to remember."}));
  await t.page.locator("#recent-settings-memories > summary").click();
  await t.page.locator("[data-memory-id=past-1] summary").click();
  await t.page.getByText("A lovely day to remember.").waitFor();
  assert(t.page.url().includes("settings.html"));
  await t.page.locator('.recent-memories a[href*="past-1"]').click();
  await t.page.locator(".back").click();
  await t.page.waitForURL("**/settings.html?*");
  await t.page.locator(".back").click();
  await t.page.waitForURL("**/profile.html?*");
  await t.page.locator(".back").click();
  await t.page.waitForURL("**/calendar.html?*");
  await clean(t, "Settings memory preview and contextual back links");
  t = await setup();
  await loaded(t.page, "calendar.html");
  const selectedCalendar = t.page.url();
  await t.page.locator(".create-nav").click();
  await t.page.locator("[name=title]").fill("Keep my new draft");
  await t.page.locator("[name=date]").fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  await t.page.locator("#createForm button[type=submit]").click();
  await t.page.locator("#leaveCreate").click();
  await t.page.locator("[name=title]").waitFor();
  assert.equal(await t.page.locator("[name=title]").inputValue(), "Keep my new draft");
  await t.page.locator("#leaveCreate").click();
  await t.page.waitForURL(selectedCalendar);
  assert.equal(await t.page.evaluate(() => JSON.parse(localStorage.getItem("test-draft")).title), "Keep my new draft");
  await clean(t, "Create back returns through steps to its origin with draft saved");
  t = await setup();
  await loaded(t.page, "settings.html");
  await t.page.locator("#personal > summary").click();
  await t.page.locator("[name=nickname]").fill("Ada Updated");
  await t.page.locator("#region > summary").click();
  await t.page.locator("[name=holidayCountry]").selectOption("GH");
  await t.page.getByText("Saved", {exact: true}).waitFor();
  await t.page.locator("#personalForm button[type=submit]").click();
  await t.page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("test-profile") || "{}").nickname ===
      "Ada Updated",
  );
  await t.page.locator('[name=timezone]').fill('Europe/London');
  await t.page.locator('[name=timezone]').blur();
  await t.page.waitForFunction(() => window.__user.user_metadata.prelude_profile.preferences.timezone === 'Europe/London');
  assert.equal(await t.page.locator('#calendarForm button[type=submit]').count(), 0);
  assert.equal(await t.page.locator('#creationForm').count(), 0);
  await t.page.locator('[name=timezone]').fill('invalid-zone');
  await t.page.locator('[name=timezone]').blur();
  await t.page.getByText('Choose a country or timezone from the list.').waitFor();
  assert.equal(await t.page.locator('[name=timezone]').inputValue(), 'Europe/London');
  await clean(t, "Settings persist profile and calendar preferences");
  t = await setup();
  await loaded(t.page, "calendar.html");
  await t.page.locator(".calendar-day").last().click();
  await t.page.getByText("No public holidays listed for this day.").waitFor();
  assert(await t.page.locator("#createOnDay").getAttribute("href"));
  await clean(t, "Calendar date details and keyboard create link");
  t = await setup();
  await loaded(t.page, "create.html");
  await t.page.locator("[name=title]").fill("My next moment");
  await t.page
    .locator("[name=date]")
    .fill(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  await t.page.locator("#createForm button[type=submit]").click();
  await t.page.locator("#tasks summary").click();
  await t.page.locator("#addTask").click();
  await t.page.locator("[name=taskTitle]").fill("Bring everything");
  await t.page.locator("[name=duration]").fill("15");
  await t.page.locator("#createForm button[type=submit]").click();
  await t.page.getByText("One last look").waitFor();
  const draft = await t.page.evaluate(
    () => window.__tables.event_drafts[0].payload,
  );
  assert.equal(draft.tasks[0].duration_minutes, 15);
  assert.equal(draft.title, "My next moment");
  await t.page.locator("#createForm button[type=submit]").click();
  await t.page.waitForURL("**/index.html?created=created-id");
  assert.equal(
    await t.page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("test-created-payload")).tasks[0]
          .duration_minutes,
    ),
    15,
  );
  await clean(t, "Creation submits to Supabase and returns Home");
  t = await setup("missing-creation-schema");
  await loaded(t.page, "create.html");
  await t.page.getByText("Event creation needs setup.").waitFor();
  assert(
    await t.page
      .getByText("Prelude’s database update hasn’t been installed.", {
        exact: false,
      })
      .count(),
  );
  await clean(
    t,
    "Missing creation schema shows setup error instead of connection error",
  );
  t = await setup();
  await loaded(t.page, "create.html");
  await t.page.locator("[name=title]").fill("Saved before leaving");
  await t.page.locator('.nav a[href="events.html"]').click();
  await t.page.waitForURL("**/events.html");
  assert.equal(
    await t.page.evaluate(
      () => JSON.parse(localStorage.getItem("test-draft")).title,
    ),
    "Saved before leaving",
  );
  await clean(t, "Draft flushes before internal navigation");
  t = await setup("closing");
  await loaded(t.page, "event.html?id=event-1");
  await t.page.locator("#notes > summary").click();
  await t.page.locator(".save-note textarea").fill("Keep this unsaved thought");
  await t.page.waitForFunction(
    () => document.querySelector('[data-task="task-1"]').disabled,
  );
  assert.equal(
    await t.page.locator(".save-note textarea").inputValue(),
    "Keep this unsaved thought",
  );
  await clean(t, "Deadline locks tasks without clearing unsaved notes");
  t = await setup("signup");
  await loaded(t.page, "signup.html");
  await t.page.locator("[name=email]").fill("new@example.com");
  await t.page.locator("[name=password]").fill("test-password-123");
  await t.page.locator("[name=confirm]").fill("test-password-123");
  await t.page.locator("#signupForm button[type=submit]").click();
  await t.page.locator("[name=code]").fill("123456");
  await t.page.locator("#signupForm button[type=submit]").click();
  await t.page.locator("[name=nickname]").waitFor();
  assert.equal(
    await t.page.evaluate(() =>
      sessionStorage.getItem("prelude_signup_password"),
    ),
    null,
  );
  await clean(
    t,
    "Signup verifies email before profile without storing passwords",
  );

  t = await setup("task-error");
  await loaded(t.page, "index.html");
  assert(await t.page.getByText("Progress temporarily unavailable.").count());
  assert(await t.page.getByText("Prepare for graduation").count());
  await clean(t, "Home preserves the event when preparation is unavailable");
  t = await setup("empty");
  await loaded(t.page, "index.html");
  assert(await t.page.getByText("What’s your next moment?").count());
  await clean(t, "Truthful empty Home");
  t = await setup("deleted-user");
  await t.page.goto(origin + "/settings.html");
  await t.page.waitForURL("**/signin.html");
  await t.page.getByText("Your saved sign-in is no longer valid. Please sign in again.").waitFor();
  assert.equal(await t.page.evaluate(() => localStorage.getItem("test-auth-cleared")), "1");
  assert.equal(await t.page.locator("#signinForm").count(), 1);
  assert.equal(await t.page.evaluate(() => sessionStorage.getItem("prelude-return-to")), "settings.html");
  await clean(t, "Deleted-account session recovers to sign-in without a page failure");
  t = await setup("google-mail");
  await loaded(t.page, "index.html");
  await t.page.getByText("Gmail access granted. Clear invitations will be created automatically; manage this in Settings.").waitFor();
  assert.equal(await t.page.evaluate(() => sessionStorage.getItem("prelude-gmail-permission")), null);
  await clean(t, "Gmail permission finishes during Google sign-in without a separate connect step");
  t = await setup("signed-out", 320);
  await loaded(t.page, "signin.html");
  assert.equal(await t.page.locator("#googleGmailPermission").isChecked(), false);
  await clean(t, "Gmail permission is optional on the sign-in screen");
  t = await setup("holidays");
  await loaded(t.page, "calendar.html?date=2026-10-01");
  await t.page.locator('.calendar-day.has-holiday[data-date="2026-10-01"]').waitFor();
  assert((await t.page.locator('[data-date="2026-10-01"]').getAttribute("aria-label")).includes("Independence Day"));
  await t.page.getByText("Showing recurring Nigerian holidays.").waitFor();
  await t.page.locator("#nextMonth").click();
  assert.equal(await t.page.locator(".calendar-day.has-holiday").count(), 0);
  await clean(t, "National holiday dates are marked and refresh with the displayed month");
  t = await setup("mail", 320);
  await loaded(t.page, "settings.html#email-import");
  await t.page.getByText("connected@example.com", {exact: true}).waitFor();
  assert.equal(await t.page.locator('#email-import').evaluate(el => el.open), true);
  await t.page.locator('.mail-advanced > summary').click();
  const toggle = t.page.locator("[data-auto-mail]");
  assert(await toggle.isChecked());
  await toggle.uncheck();
  await t.page.getByText("Events will stay as suggestions for review.", {exact: true}).waitFor();
  await t.page.locator("[data-scan-mail]").click();
  await t.page.getByText(/Checked 20 emails/).waitFor();
  await t.page.locator("#mailSuggestions summary").click();
  await t.page.locator('[data-mail-suggestion] [name=title]').fill("Reviewed email appointment");
  await t.page.locator('[data-mail-suggestion] button[type=submit]').click();
  await t.page.getByText("Event created.", {exact: false}).waitFor();
  assert.equal(await t.page.locator("[data-mail-suggestion]").count(), 0);
  await t.page.locator("[data-disconnect-mail]").click();
  await t.page.getByText("Gmail disconnected. Events already created stay in Prelude.", {exact: true}).waitFor();
  await clean(t, "Gmail secondary preferences, manual fallback, editable review and disconnect on a small phone");
  t = await setup("normal", 320);
  await loaded(t.page, "settings.html");
  assert(await t.page.locator('.settings-compact').evaluate(el => el.getBoundingClientRect().height < 760));
  assert.equal(await t.page.locator('.settings-detail[open]').count(), 0);
  await t.page.screenshot({path: '/tmp/prelude-settings-320.png', fullPage: true});
  await clean(t, "Compact Settings on a small phone");
  t = await setup("save-failure", 390);
  await loaded(t.page, "settings.html#region");
  await t.page.locator('[name=holidayCountry]').selectOption('GH');
  await t.page.locator('#calendarForm .form-feedback[data-state=error]').waitFor();
  assert.equal(await t.page.locator('[name=holidayCountry]').inputValue(), 'NG');
  assert.equal(await t.page.locator('[name=holidayCountry]').isDisabled(), false);
  await clean(t, "Autosave failure restores the saved country");
  t = await setup("normal", 390);
  await loaded(t.page, "settings.html#notifications");
  await t.page.locator('[name=notifications]').check();
  await t.page.locator('#notificationsForm .form-feedback[data-state=error]').waitFor();
  assert.equal(await t.page.locator('[name=notifications]').isChecked(), false);
  assert.equal(await t.page.locator('#notificationsForm button[type=submit]').count(), 0);
  await clean(t, "Unavailable notification setup restores the preference without a Save button");
  t = await setup("normal", 1024);
  await loaded(t.page, "index.html");
  assert.equal(
    await t.page
      .locator(".page")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await clean(t, "Desktop layout and reduced motion");
  await browser.close();
  console.log(`${checks} browser flow checks passed`);
})().catch(async (e) => {
  if (lastPage && !lastPage.isClosed()) console.error(await lastPage.evaluate(() => window.__testBootError || document.body.innerText));
  console.error(e);
  process.exit(1);
});
