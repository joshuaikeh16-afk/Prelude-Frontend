import { api, unwrap, preferences, updateProfile } from "./data.js";
import { toast, confirmDialog, errorMessage } from "./ui.js";

let registration;
const supported = () =>
  window.isSecureContext !== false &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;
const workerUrl = () => new URL("sw.js", document.baseURI).href;
const existingRegistration = () =>
  navigator.serviceWorker.getRegistration(workerUrl());

async function register() {
  if (registration?.active) return registration;
  const worker = await navigator.serviceWorker.register(workerUrl());
  // A failed installation must not leave the Settings button waiting forever.
  let timeout;
  try {
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject({ friendly: "Reminders could not start on this device. Please try again." }),
          12000,
        );
      }),
    ]);
    return registration;
  } finally {
    clearTimeout(timeout);
    if (!registration && worker.active) registration = worker;
  }
}

async function ownedSubscription(user, subscription) {
  if (!subscription) return null;
  return unwrap(
    await supabaseClient
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", user.id)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle(),
  );
}

/** Account preferences and this browser's permission/subscription are separate. */
export async function notificationState(user) {
  const accountEnabled = Boolean(preferences(user).notifications);
  if (!supported())
    return { supported: false, accountEnabled, enabled: false, permission: "unsupported" };
  const permission = Notification.permission;
  if (permission !== "granted")
    return { supported: true, accountEnabled, enabled: false, permission };
  const worker = await existingRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  const registered = Boolean(await ownedSubscription(user, subscription));
  return {
    supported: true,
    accountEnabled,
    enabled: accountEnabled && registered,
    permission,
    registered,
  };
}

export async function enableNotifications(user) {
  if (!supported())
    throw {
      friendly: window.isSecureContext === false
        ? "Open Prelude over HTTPS or localhost to enable reminders."
        : "Push reminders are not supported here. On iPhone or iPad, open Prelude from your Home Screen and try again.",
    };
  // Request directly from the user's click, before network or worker setup.
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted")
    throw {
      friendly: permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser’s site settings, then try again."
        : "Reminders are still off. Choose Allow in the browser prompt to enable them.",
    };
  const config = await api("/api/client-config");
  if (!config.vapidPublicKey)
    throw { friendly: "Push reminders are not available yet. Please try again later." };
  const worker = await register();
  const key = config.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
  let subscription = await worker.pushManager.getSubscription();
  const existingKey = subscription?.options?.applicationServerKey;
  const oldKey = existingKey ? new Uint8Array(existingKey) : null;
  const keyChanged = oldKey && (oldKey.length !== bytes.length || oldKey.some((byte, index) => byte !== bytes[index]));
  // Shared browsers can still have a previous account's endpoint. Never attach
  // that endpoint to another account: replace the browser subscription first.
  if (subscription && (keyChanged || !(await ownedSubscription(user, subscription)))) {
    const removed = await subscription.unsubscribe();
    if (!removed)
      throw { friendly: "This device’s previous reminder setup could not be cleared. Please try again." };
    subscription = null;
  }
  let created = false;
  try {
    if (!subscription) {
      subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      created = true;
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
      throw { friendly: "This browser could not finish setting up reminders. Please try again." };
    unwrap(
      await supabaseClient.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: json.endpoint,
          p256dh_key: json.keys.p256dh,
          auth_key: json.keys.auth,
        },
        { onConflict: "endpoint" },
      ),
    );
    await updateProfile(user, { preferences: { notifications: true } });
  } catch (error) {
    if (created && subscription) {
      // A failed enrollment must remain retryable and must not receive pushes.
      await subscription.unsubscribe().catch(() => {});
      try {
        await supabaseClient.from("push_subscriptions").delete()
          .eq("user_id", user.id).eq("endpoint", subscription.endpoint);
      } catch { /* The revoked endpoint cannot receive notifications. */ }
    }
    throw error;
  }
  toast("Reminders are enabled on this device.");
  return true;
}

export async function disableNotifications(user, { preservePreference = false } = {}) {
  // Account-level disabling is authoritative even when a browser cannot remove
  // its local subscription. Omitting user (sign out) only removes this device.
  if (user && !preservePreference)
    await updateProfile(user, { preferences: { notifications: false } });
  try {
    if (!("serviceWorker" in navigator)) return;
    const worker = await existingRegistration();
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) return;
    const removal = supabaseClient.from("push_subscriptions").delete()
      .eq("endpoint", subscription.endpoint);
    if (user) removal.eq("user_id", user.id);
    let removalError;
    try {
      removalError = (await removal).error;
    } catch (error) {
      removalError = error;
    }
    let unsubscribeError;
    try {
      const removed = await subscription.unsubscribe();
      if (!removed) unsubscribeError = new Error("Browser subscription could not be removed");
    } catch (error) {
      unsubscribeError = error;
    }
    // During sign out, either a deleted row or a revoked endpoint prevents
    // delivery. Attempt both, including when one of the services is offline.
    if (removalError && unsubscribeError) throw removalError;
  } catch (error) {
    if (!user || preservePreference) throw error;
    // Saving the account preference already stopped dispatch on every device.
  }
}

export async function firstEventPrompt(user) {
  if (user.user_metadata?.prelude_profile?.notifications_prompted) return;
  const allow = await confirmDialog(
    "A reminder before your event?",
    "Get a heads-up the day before your event, at its start, and when a timed task ends.",
    "Enable reminders",
  );
  if (allow) {
    try {
      await enableNotifications(user);
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  // Declining a prompt on another device must not disable an existing opt-in.
  try {
    await updateProfile(user, { notifications_prompted: true });
  } catch {
    toast("We couldn’t save your reminder preference. You can manage reminders in Settings.");
  }
}

export async function notifyExpiry(session) {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session?.user || !preferences(data.session.user).notifications) return;
    const worker = await register();
    await worker.showNotification("Time’s up", {
      body: `${session.task_title} is still incomplete. Open it to finish or extend.`,
      tag: `timer-${session.id}`,
      data: {
        url: `event.html?id=${encodeURIComponent(session.event_id)}&task=${encodeURIComponent(session.task_id)}`,
      },
      actions: [{ action: "open", title: "Open task" }],
    });
  } catch {
    /* The server push remains the background delivery path. */
  }
}
