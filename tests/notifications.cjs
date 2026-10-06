const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/notifications.js"), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export /gm, "");
function fixture(options = {}) {
  const user = { id: "current-user", user_metadata: { prelude_profile: { preferences: { notifications: Boolean(options.enabled) } } } };
  const calls = [];
  const rows = options.rows || [];
  let subscription = options.subscription === false ? null : {
    endpoint: "https://push.example/old",
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "key", auth: "auth" } }; },
    async unsubscribe() { calls.push("unsubscribe-old"); subscription = null; return true; },
  };
  const worker = {
    active: true,
    pushManager: {
      async getSubscription() { return subscription; },
      async subscribe() {
        calls.push("subscribe");
        subscription = {
          endpoint: "https://push.example/new",
          toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "key", auth: "auth" } }; },
          async unsubscribe() { calls.push("unsubscribe-new"); subscription = null; return true; },
        };
        return subscription;
      },
    },
    async showNotification() { calls.push("show-notification"); },
  };
  const context = {
    setTimeout, clearTimeout, Uint8Array, URL, atob,
    document: { baseURI: "https://prelude.example/settings.html" },
    Notification: { permission: options.permission || "granted", requestPermission: async () => "granted" },
    navigator: { serviceWorker: {
      ready: Promise.resolve(worker),
      register: async () => worker,
      getRegistration: async () => { if (options.workerFailure) throw new Error("Worker unavailable"); return worker; },
    } },
    api: async () => ({ vapidPublicKey: "dGVzdA" }),
    preferences: (value) => value.user_metadata.prelude_profile.preferences,
    updateProfile: async (value, changes) => {
      calls.push("profile-save");
      const profile = value.user_metadata.prelude_profile;
      Object.assign(profile.preferences, changes.preferences);
      if (changes.notifications_prompted) profile.notifications_prompted = true;
    },
    unwrap: (result) => { if (result.error) throw result.error; return result.data; },
    toast: (message) => calls.push(message),
    confirmDialog: async () => Boolean(options.allowPrompt),
    errorMessage: (error) => error.friendly || error.message,
    supabaseClient: {
      auth: { getSession: async () => ({ data: { session: { user } } }) },
      from: () => {
        let operation = "select", filters = [], payload;
        const query = {
          select: () => query,
          maybeSingle: () => query,
          eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
          upsert: (value) => { operation = "upsert"; payload = value; return query; },
          delete: () => { operation = "delete"; return query; },
          then: (resolve, reject) => Promise.resolve().then(() => {
            calls.push(operation);
            if (operation === "select") return { data: rows.find((row) => filters.every((filter) => filter(row))) || null };
            if (operation === "upsert") {
              if (options.upsertFailure) return { error: new Error("Database unavailable") };
              rows.push(payload);
              return { data: payload };
            }
            if (options.deleteFailure) return { error: new Error("Database unavailable") };
            return { data: null };
          }).then(resolve, reject),
        };
        return query;
      },
    },
  };
  context.window = { isSecureContext: true, Notification: context.Notification, PushManager: {} };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.exposed = { notificationState, enableNotifications, disableNotifications, firstEventPrompt, notifyExpiry };`, context);
  return { ...context.exposed, user, calls, rows };
}

(async () => {
  let test = fixture({ enabled: true, subscription: false });
  assert.equal((await test.notificationState(test.user)).enabled, false);
  assert.equal((await test.notificationState(test.user)).accountEnabled, true);

  test = fixture({ enabled: true, rows: [{ user_id: "current-user", endpoint: "https://push.example/old" }] });
  assert.equal(await test.enableNotifications(test.user), true);
  assert.equal(test.calls.includes("subscribe"), false);
  assert(test.calls.includes("upsert"));

  test = fixture({ rows: [{ user_id: "previous-user", endpoint: "https://push.example/old" }] });
  await test.enableNotifications(test.user);
  assert(test.calls.indexOf("unsubscribe-old") < test.calls.indexOf("subscribe"));
  assert.equal(test.rows[0].user_id, "previous-user");
  assert.equal(test.rows[1].endpoint, "https://push.example/new");

  test = fixture({ permission: "denied" });
  await assert.rejects(() => test.enableNotifications(test.user), (error) => error.friendly.includes("blocked"));
  assert.equal(test.calls.length, 0);
  assert.equal(test.user.user_metadata.prelude_profile.preferences.notifications, false);

  test = fixture({ subscription: false, upsertFailure: true });
  await assert.rejects(() => test.enableNotifications(test.user), /Database unavailable/);
  assert(test.calls.includes("unsubscribe-new"));
  assert.equal(test.calls.includes("profile-save"), false);

  test = fixture({ enabled: true, workerFailure: true });
  await test.disableNotifications(test.user);
  assert.equal(test.user.user_metadata.prelude_profile.preferences.notifications, false);

  test = fixture({ enabled: true, deleteFailure: true });
  await test.disableNotifications();
  assert(test.calls.includes("unsubscribe-old"));
  assert.equal(test.user.user_metadata.prelude_profile.preferences.notifications, true);

  test = fixture({ enabled: true, allowPrompt: false });
  await test.firstEventPrompt(test.user);
  assert.equal(test.user.user_metadata.prelude_profile.preferences.notifications, true);
  assert.equal(test.user.user_metadata.prelude_profile.notifications_prompted, true);

  test = fixture({ enabled: false });
  await test.notifyExpiry({ id: "timer", task_title: "Pack" });
  assert.equal(test.calls.includes("show-notification"), false);
  test.user.user_metadata.prelude_profile.preferences.notifications = true;
  await test.notifyExpiry({ id: "timer", event_id: "event", task_id: "task", task_title: "Pack" });
  assert(test.calls.includes("show-notification"));
  console.log("9 notification checks passed: account/device state, enrollment, isolation, cleanup, permission, opt-out, and expiry.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
