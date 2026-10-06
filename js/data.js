import { invalidSavedSession, clearInvalidSession } from "./auth-session.js";
const db = () => supabaseClient;
export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
export async function allRows(table, configure = (q) => q) {
  let rows = [];
  for (let offset = 0; ; offset += 200) {
    const result = await configure(db().from(table).select("*")).range(
      offset,
      offset + 199,
    );
    unwrap(result);
    rows.push(...result.data);
    if (result.data.length < 200) return rows;
  }
}
export const rpc = async (name, payload = {}) =>
  unwrap(await db().rpc(name, payload));
export async function api(
  path,
  { method = "GET", body, authenticated = false, credentials = "same-origin", timeout = 20000 } = {},
) {
  const headers = { "Content-Type": "application/json" };
  if (authenticated) {
    const { data, error } = await db().auth.getSession();
    if (error || !data.session) throw { friendly: "Please sign in again." };
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let response;
  try {
    response = await fetch(`${window.PreludeConfig.apiBase}${path}`, {
      method,
      headers,
      credentials,
      signal: AbortSignal.timeout(timeout),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw {
      friendly:
        "We couldn’t reach Prelude’s API. Check your connection and try again.",
    };
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw {
      friendly:
        "Prelude’s API returned an unexpected response. Please try again.",
    };
  }
  if (!result || typeof result !== "object")
    throw {
      friendly:
        "Prelude’s API returned an unexpected response. Please try again.",
    };
  if (!response.ok)
    throw {
      friendly:
        typeof result.error === "string"
          ? result.error
          : "This service is unavailable. Please try again.",
    };
  return result;
}
export const getUser = async () => {
  const result = await db().auth.getUser();
  if (invalidSavedSession(result.error)) {
    await clearInvalidSession();
    return null;
  }
  if (result.error && result.error.name !== "AuthSessionMissingError")
    throw result.error;
  return result.data.user;
};
export const profileData = (user) => user.user_metadata?.prelude_profile || {};
export const preferences = (user) => ({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  holidayCountry: "NG",
  notifications: false,
  hideCreationWarning: false,
  ...profileData(user).preferences,
});
const profileSaves = new Map();
export function updateProfile(user, changes) {
  const queued = (profileSaves.get(user.id) || Promise.resolve())
    .catch(() => {})
    .then(() => saveProfile(user, changes));
  profileSaves.set(user.id, queued);
  queued.finally(() => {
    if (profileSaves.get(user.id) === queued) profileSaves.delete(user.id);
  }).catch(() => {});
  return queued;
}
async function saveProfile(user, changes) {
  for (const [field, max] of [
    ["name", 80],
    ["nickname", 40],
  ]) {
    if (
      field in changes &&
      (typeof changes[field] !== "string" ||
        !changes[field].trim() ||
        changes[field].length > max)
    )
      throw { friendly: "Enter your full name and preferred name." };
  }
  const latest = await getUser();
  if (!latest || latest.id !== user.id)
    throw { friendly: "Please sign in again before saving your changes." };
  const current = profileData(latest);
  const next = {
    ...current,
    ...changes,
    preferences: { ...current.preferences, ...changes.preferences },
  };
  if (changes.name || changes.nickname)
    unwrap(
      await db()
        .from("profiles")
        .upsert(
          { id: user.id, display_name: next.nickname || next.name },
          { onConflict: "id" },
        ),
    );
  const updated = unwrap(await db().auth.updateUser({ data: { prelude_profile: next } })).user;
  user.user_metadata = updated.user_metadata;
  return updated;
}
export const listEvents = (user) =>
  allRows("events", (q) => q.eq("user_id", user.id).order("date").order("id"));
export const getEvent = async (id, user) =>
  unwrap(
    await db()
      .from("events")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
  );
export const queryEventRows = (table, eventId) =>
  allRows(table, (q) =>
    q.eq("event_id", eventId).order("created_at").order("id"),
  );
export const insertRow = async (table, row) =>
  unwrap(await db().from(table).insert(row).select("*").single());
export const updateRow = async (table, id, row) =>
  unwrap(await db().from(table).update(row).eq("id", id).select("*").single());
export const deleteRow = async (table, id) =>
  unwrap(await db().from(table).delete().eq("id", id));
export async function signedUrls(bucket, paths) {
  const valid = [...new Set(paths.filter(Boolean))];
  if (!valid.length) return {};
  const { data, error } = await db()
    .storage.from(bucket)
    .createSignedUrls(valid, 3600);
  if (error) return {};
  return Object.fromEntries(
    (data || [])
      .filter((x) => x.signedUrl && !x.error)
      .map((x) => [x.path, x.signedUrl]),
  );
}
export async function uploadImage(user, bucket, file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw { friendly: "Choose a JPG, PNG or WebP image smaller than 8 MB." };
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[file.type];
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
  unwrap(
    await db()
      .storage.from(bucket)
      .upload(path, file, { contentType: file.type, upsert: false }),
  );
  return path;
}
export const signOut = async () => {
  try {
    const { disableNotifications } = await import("./notifications.js");
    await disableNotifications();
  } catch {
    console.warn("Could not remove this device’s notification subscription");
  }
  unwrap(await db().auth.signOut());
  sessionStorage.removeItem("prelude-banner-dismissed");
  location.replace("signin.html");
};
export async function synchronize() {
  try {
    return await rpc("prelude_sync_events");
  } catch (error) {
    console.warn("Lifecycle migration not available", error.code);
    return false;
  }
}
export const deadline = (event) =>
  event.preparation_deadline
    ? Date.parse(event.preparation_deadline)
    : window.PreludeHomeData.eventStart({
        ...event,
        time: event.time || "09:00:00",
      });
export const locked = (event) =>
  event.status === "past" ||
  (deadline(event) !== null && Date.now() >= deadline(event));
export const progress = (tasks) => window.PreludeHomeData.preparation(tasks);
export function nextYearDate(date, now = new Date()) {
  const [y, m, d] = date.split("-").map(Number);
  const year = Math.max(y + 1, now.getFullYear() + 1);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function shiftDateTime(value, from, to, timezone = "UTC") {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  const shifted = new Date(
    Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day),
    ) +
      Date.parse(`${to}T12:00:00Z`) -
      Date.parse(`${from}T12:00:00Z`),
  );
  const time = `${fields.hour}:${fields.minute}:${fields.second}`,
    date = shifted.toISOString().slice(0, 10);
  let instant = window.PreludeHomeData.eventStart({ date, time, timezone });
  // If next year's clock skips this wall time, use the next valid local minute.
  for (let minutes = 1; instant === null && minutes <= 120; minutes++) {
    const candidate = new Date(`${date}T${time}Z`);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + minutes);
    instant = window.PreludeHomeData.eventStart({
      date: candidate.toISOString().slice(0, 10),
      time: candidate.toISOString().slice(11, 19),
      timezone,
    });
  }
  if (instant === null)
    throw { friendly: "This schedule time could not be moved to next year." };
  return new Date(instant).toISOString();
}
