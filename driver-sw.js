/* ============================================================================
 * DUD3 Driver Hub — Notification & Web Push Service Worker (driver-sw.js)
 * Lightweight, non-blocking: no background polling loops, no cache hijacking.
 * Handles:
 *   - Web Push events (background / minimized / closed where platform supports)
 *   - Driver Hub icon, batch/driver payload, timestamp, Acknowledge/Open actions
 *   - Notification click & synchronized dismissal
 * ============================================================================ */

self.addEventListener("install", function(event) {
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "DUD3 Driver Hub", body: event.data ? event.data.text() : "New batch update." };
  }

  var title = data.title || "🚨 Batch Sent — DUD3 Driver Hub";
  var body = data.body || "Your batch has been dispatched. Proceed to the station for IN scan.";
  var tag = data.tag || ("dud3-batch-" + (data.daId || "alert"));

  var options = {
    body: body,
    icon: "./driverhub-icon-192.png",
    badge: "./driverhub-icon-192.png",
    tag: tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [250, 100, 250, 100, 300],
    timestamp: data.timestamp || Date.now(),
    data: {
      url: "./driver.html",
      daId: data.daId || "",
      notifId: data.notifId || "",
      batchName: data.batchName || "",
      sentTime: data.sentTime || ""
    },
    actions: [
      { action: "ack", title: "Acknowledge" },
      { action: "open", title: "Open Driver Hub" }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("message", function(event) {
  var msg = event && event.data;
  if (!msg) return;

  if (msg.type === "DUD3_NOTIFY") {
    var opts = {
      body: msg.body || "",
      icon: "./driverhub-icon-192.png",
      badge: "./driverhub-icon-192.png",
      tag: msg.tag || ("dud3-batch-" + (msg.daId || "alert")),
      renotify: true,
      requireInteraction: true,
      vibrate: [250, 100, 250, 100, 300],
      timestamp: Date.now(),
      data: { url: "./driver.html", daId: msg.daId || "" },
      actions: [
        { action: "ack", title: "Acknowledge" },
        { action: "open", title: "Open Driver Hub" }
      ]
    };
    event.waitUntil(self.registration.showNotification(msg.title || "DUD3 Driver Hub", opts));
  } else if (msg.type === "DUD3_CLEAR_NOTIFY") {
    event.waitUntil(
      self.registration.getNotifications().then(function(list) {
        list.forEach(function(n) { n.close(); });
      })
    );
  }
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  var action = event.action || "open";
  var targetUrl = (event.notification.data && event.notification.data.url) || "./driver.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clients) {
      if (action === "ack") {
        clients.forEach(function(client) {
          try { client.postMessage({ type: "DUD3_ACK_FROM_SW" }); } catch (e) {}
        });
        return;
      }
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf("driver") !== -1 && "focus" in clients[i]) {
          return clients[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
