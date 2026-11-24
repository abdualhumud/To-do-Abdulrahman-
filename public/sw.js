// TaskFlow service worker: shows phone/desktop notifications pushed by the bot server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TaskFlow", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "TaskFlow", {
      body: data.body || "",
      tag: data.tag || undefined,
      data: { url: data.url || self.registration.scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = self.registration.scope;
  try {
    const url = new URL((event.notification.data && event.notification.data.url) || target, self.registration.scope);
    if (url.origin === self.location.origin) target = url.href; // never open a foreign origin
  } catch {
    /* keep the scope */
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) if ("focus" in client) return client.focus();
      return self.clients.openWindow(target);
    }),
  );
});
