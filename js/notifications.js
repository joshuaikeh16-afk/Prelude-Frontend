import { api, preferences, updateProfile } from "./data.js";
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

  let timeout;

  try {
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject({
              friendly:
                "Reminders could not start on this device. Please try again.",
            }),
          12000,
        );
      }),
    ]);

    return registration;
  } finally {
    clearTimeout(timeout);

    if (!registration && worker.active) {
      registration = worker;
    }
  }
}

/*
 * Check whether the browser currently has a push subscription.
 *
 * The server remains authoritative for ownership. We deliberately do not
 * query push_subscriptions directly from the browser anymore.
 */
export async function notificationState(user) {
  const accountEnabled = Boolean(preferences(user).notifications);

  if (!supported()) {
    return {
      supported: false,
      accountEnabled,
      enabled: false,
      permission: "unsupported",
    };
  }

  const permission = Notification.permission;

  if (permission !== "granted") {
    return {
      supported: true,
      accountEnabled,
      enabled: false,
      permission,
    };
  }

  const worker = await existingRegistration();
  const subscription = await worker?.pushManager.getSubscription();

  return {
    supported: true,
    accountEnabled,
    enabled: accountEnabled && Boolean(subscription),
    permission,
    registered: Boolean(subscription),
  };
}

export async function enableNotifications(user) {
  if (!supported()) {
    throw {
      friendly:
        window.isSecureContext === false
          ? "Open Prelude over HTTPS or localhost to enable reminders."
          : "Push reminders are not supported here. On iPhone or iPad, open Prelude from your Home Screen and try again.",
    };
  }

  /*
   * Permission must be requested directly from the user's click.
   */
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== "granted") {
    throw {
      friendly:
        permission === "denied"
          ? "Notifications are blocked for this site. Allow them in your browser’s site settings, then try again."
          : "Reminders are still off. Choose Allow in the browser prompt to enable them.",
    };
  }

  /*
   * Get the public VAPID key.
   */
  const config = await api("/api/client-config");

  if (!config.vapidPublicKey) {
    throw {
      friendly:
        "Push reminders are not available yet. Please try again later.",
    };
  }

  const worker = await register();

  /*
   * Convert the URL-safe VAPID key to the Uint8Array expected by
   * PushManager.subscribe().
   */
  const key = config.vapidPublicKey
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const bytes = Uint8Array.from(
    atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );

  let subscription = await worker.pushManager.getSubscription();

  /*
   * If the VAPID key changed, the existing browser subscription is no
   * longer valid for Prelude.
   */
  if (subscription) {
    const existingKey = subscription.options?.applicationServerKey;
    const oldKey = existingKey ? new Uint8Array(existingKey) : null;

    const keyChanged =
      oldKey &&
      (oldKey.length !== bytes.length ||
        oldKey.some((byte, index) => byte !== bytes[index]));

    if (keyChanged) {
      await subscription.unsubscribe();
      subscription = null;
    }
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

    if (
      !json.endpoint ||
      !json.keys?.p256dh ||
      !json.keys?.auth
    ) {
      throw {
        friendly:
          "This browser could not finish setting up reminders. Please try again.",
      };
    }

    /*
     * IMPORTANT:
     *
     * Do not write to push_subscriptions directly from the browser.
     *
     * /api/push authenticates the user and safely performs the
     * insert/update server-side.
     */
    await api("/api/push", {
      method: "POST",
      authenticated: true,
      body: {
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
      },
    });

    await updateProfile(user, {
      preferences: {
        notifications: true,
      },
    });
  } catch (error) {
    /*
     * If we created a browser subscription but failed to save it on the
     * server, remove it so the user can cleanly retry.
     */
    if (created && subscription) {
      try {
        await subscription.unsubscribe();
      } catch {
        // Nothing else to clean up locally.
      }
    }

    throw error;
  }

  toast("Reminders are enabled on this device.");

  return true;
}

export async function disableNotifications(
  user,
  { preservePreference = false } = {},
) {
  /*
   * Disable the account preference first.
   */
  if (user && !preservePreference) {
    await updateProfile(user, {
      preferences: {
        notifications: false,
      },
    });
  }

  let serverError;
  let unsubscribeError;

  /*
   * Remove all push subscriptions belonging to the authenticated user.
   */
  if (user) {
    try {
      await api("/api/push", {
        method: "DELETE",
        authenticated: true,
      });
    } catch (error) {
      serverError = error;
    }
  }

  /*
   * Remove this browser's local subscription as well.
   */
  try {
    if ("serviceWorker" in navigator) {
      const worker = await existingRegistration();
      const subscription = await worker?.pushManager.getSubscription();

      if (subscription) {
        const removed = await subscription.unsubscribe();

        if (!removed) {
          unsubscribeError = new Error(
            "Browser subscription could not be removed",
          );
        }
      }
    }
  } catch (error) {
    unsubscribeError = error;
  }

  /*
   * If the account itself was disabled, the saved preference prevents
   * dispatch even if local cleanup failed.
   */
  if (
    (serverError || unsubscribeError) &&
    (!user || preservePreference)
  ) {
    throw serverError || unsubscribeError;
  }
}

export async function firstEventPrompt(user) {
  if (user.user_metadata?.prelude_profile?.notifications_prompted) {
    return;
  }

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

  /*
   * Declining on another device must not disable an existing opt-in.
   */
  try {
    await updateProfile(user, {
      notifications_prompted: true,
    });
  } catch {
    toast(
      "We couldn’t save your reminder preference. You can manage reminders in Settings.",
    );
  }
}

export async function notifyExpiry(session) {
  if (!supported() || Notification.permission !== "granted") {
    return;
  }

  try {
    const { data } = await supabaseClient.auth.getSession();

    if (
      !data.session?.user ||
      !preferences(data.session.user).notifications
    ) {
      return;
    }

    const worker = await register();

    await worker.showNotification("Time’s up", {
      body: `${session.task_title} is still incomplete. Open it to finish or extend.`,
      tag: `timer-${session.id}`,
      data: {
        url: `event.html?id=${encodeURIComponent(
          session.event_id,
        )}&task=${encodeURIComponent(session.task_id)}`,
      },
      actions: [
        {
          action: "open",
          title: "Open task",
        },
      ],
    });
  } catch {
    /*
     * Server push remains the background delivery path.
     */
  }
}