self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Prelude", {
      body: data.body || "",
      tag: data.tag || "prelude",
      data: { url: data.url || "index.html" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = new URL(self.registration.scope);
  const target = new URL(event.notification.data?.url || "index.html", base);
  if (target.origin !== base.origin) return;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        for (const client of windows) {
          if (client.url === target.href) return client.focus();
        }
        return clients.openWindow(target.href);
      }),
  );
});
