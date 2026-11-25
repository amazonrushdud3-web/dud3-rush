/* ============================================================================
 * DUD3 Driver Hub - MINIMAL notification Service Worker (2026-11-24)
 *
 * Deliberately minimal. The PREVIOUS service worker hung the app because it ran
 * its OWN background fetch loops + Periodic Background Sync. This one does NONE of
 * that. It has exactly three jobs:
 *   1) install/activate immediately (so notifications can persist when the page is
 *      backgrounded / the screen is locked / the driver is in another app),
 *   2) show a notification when the PAGE posts it a message (the page still decides
 *      WHEN to notify, during its normal 3s status poll -- the SW only renders it so
 *      it survives being backgrounded, unlike page-context new Notification()),
 *   3) focus/open the Hub when the driver taps the notification.
 *
 * No caching. No fetch interception. No background polling. No periodic sync.
 * Nothing here can block, loop, or hang the app.
 * ========================================================================= */

self.addEventListener("install", function(e) { self.skipWaiting(); });
self.addEventListener("activate", function(e) { e.waitUntil(self.clients.claim()); });

// 2026-11-25: pass-through fetch listener. It never calls respondWith(), so every
// request goes straight to the network exactly as before (no caching, nothing that can
// hang). It exists only because some Android browsers (Samsung Internet, older Chrome)
// refuse to offer "Install app" unless the service worker has a fetch handler.
self.addEventListener("fetch", function(event) { /* network as normal */ });

self.addEventListener("message", function(event) {
  var d = (event && event.data) || {};
  if (d.type !== "DUD3_NOTIFY") return;
  var title = d.title || "DUD3 Driver Hub";
  var body = d.body || "";
  var tag = d.tag || ("dud3-" + Date.now());
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      silent: false
    })
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) { if (list[i].focus) return list[i].focus(); }
      // Open the Driver Hub (not "./", which is the Yard Marshal app).
      if (self.clients.openWindow) return self.clients.openWindow("./driver.html");
    })
  );
});
