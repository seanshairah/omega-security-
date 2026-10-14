/* Omega Protection Services push service worker */
self.addEventListener("push", (event) => {
  let data = { title: "Omega Protection Services", body: "", url: "/notifications" };
  try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data ? event.data.text() : ""; }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/icon.svg", badge: "/icon.svg", tag: data.tag, renotify: Boolean(data.tag), requireInteraction: Boolean(data.critical), data: { url: data.url },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
