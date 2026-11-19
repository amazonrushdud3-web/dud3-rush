/* ============================================================================
 * DUD3 Driver Hub \u2014 Service Worker (2026-11-19)
 * Purpose: let notifications survive the Driver Hub tab being backgrounded or
 * minimized, and (on supporting browsers) keep checking periodically even
 * when the page itself isn't open in the foreground.
 *
 * HONEST LIMITS (please read before assuming this behaves exactly like
 * WhatsApp/Instagram/Facebook):
 *  - WhatsApp/Instagram/Facebook are installed NATIVE apps with OS-level
 *    background process privileges and a push-notification SERVER
 *    (Apple APNs / Google FCM) that wakes the app even when fully force-quit.
 *    A plain web page can NEVER replicate "notify after the app is fully
 *    closed/force-quit" without: (a) the driver installing this as a PWA
 *    (Add to Home Screen), AND (b) a real Push server sending Web Push
 *    messages with VAPID keys. Google Apps Script does not provide this,
 *    and adding a separate push-server backend is a significant project on
 *    its own \u2014 NOT implemented here.
 *  - What THIS service worker actually achieves, using only free/standard
 *    web APIs available on a static GitHub Pages site:
 *      1. Notifications fire reliably while the Driver Hub tab is open,
 *         even if minimized / switched away from / screen locked (as long
 *         as the browser process itself is still running). This covers the
 *         vast majority of "I put my phone in my pocket" cases.
 *      2. On Android Chrome/Edge, if the driver installs the Driver Hub to
 *         their home screen (Add to Home Screen), Periodic Background Sync
 *         lets this service worker wake up roughly every few minutes EVEN
 *         WHILE THE APP ISN'T OPEN AT ALL, fetch the latest status, and
 *         fire a real OS notification. This is the closest web equivalent
 *         to "closed app" notifications that exists without a push server.
 *      3. On iOS Safari, Periodic Background Sync does not exist at all as
 *         of this writing \u2014 notifications there are reliable only while
 *         the Driver Hub tab/PWA is open or recently backgrounded.
 * ========================================================================= */

const API_URL = "https://script.google.com/macros/s/AKfycbwjKBYUa4e4MLAVSOG7deemoWWZIx5gNWnEdbA6E4QFUxRCaTuNGhSIvM9mGrI1y6Lzdg/exec";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1xmoLxFOyKipL7acCXu9ZG90d1nDpSag7xdkfP0v9wGQ/edit";
const SW_VERSION = "driver-sw-v2026.11.19-1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function getTodayTab() {
  const d = new Date();
  const m = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return ("0" + d.getDate()).slice(-2) + " " + m[d.getMonth()];
}

async function fetchDaStatus(daId) {
  const payload = { action: "getDaStatus", daId: daId, sheetUrl: SHEET_URL, dayTab: getTodayTab() };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  return res.json();
}

function hhmmToSec(str) {
  if (!str) return null;
  const m = String(str).replace(/^'+/, "").trim().match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
}

function nowSecLocal() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

// Shows a real OS-level notification FROM THE SERVICE WORKER (works even when
// the page/tab is not the active foreground tab, unlike new Notification()
// called from page JS which some browsers suppress when backgrounded).
async function showSwNotification(title, body, tag) {
  try {
    await self.registration.showNotification(title, {
      body: body,
      tag: tag || ("dud3-" + Date.now()),
      icon: undefined,
      vibrate: [160, 80, 160],
      requireInteraction: false,
      silent: false
    });
  } catch (e) {}
}

// One background check cycle: pull the latest status for the given DA and
// fire the appropriate notification. Mirrors the SAME logic as the in-page
// notifier (maybeNotifyReceiveDeadline / maybeNotifyStatusChange in
// Driver_index.html) so behavior is consistent whether the page is open or
// the SW is running this alone in the background.
async function runBackgroundCheck(daId, settingsHint) {
  if (!daId) return;
  let data;
  try {
    data = await fetchDaStatus(daId);
  } catch (e) { return; }
  if (!data || !data.success) return;

  const info = data.daInfo || null;
  const settings = data.settings || {};
  let status;
  if (data.violator) status = "Violator";
  else if (data.inBreak) status = "On Break";
  else {
    switch (data.dispatchState) {
      case "OFD": status = "OFD"; break;
      case "RECEIVED_INSIDE": status = "Received"; break;
      case "SENT_TO_OP": status = "Sent to OP"; break;
      case "WAITING": status = "Waiting"; break;
      default: status = (info && info.status) ? info.status : "Not Checked In";
    }
  }

  const cacheKey = "dud3_sw_state_" + daId;
  const prevRaw = await getSwState(cacheKey);
  const prev = prevRaw || {};

  // 1) Batch Sent from Waiting -> notify + remind once per NEW send event.
  if (status === "Sent to OP" && data.sentTime && prev.lastSentTime !== data.sentTime) {
    await showSwNotification(
      "\ud83d\ude9a Batch Sent \u2014 Proceed to Receiving",
      "Your batch has been sent from Waiting. Head to the receiving point now.",
      "dud3-sent-" + daId
    );
    prev.lastSentTime = data.sentTime;
    prev.lastFiveMinAt = 0;
  }

  // 2) Receiving timer: remind roughly every 5 minutes WHILE the receiving
  // countdown is running (not just once at the 5-min-left mark).
  if (status === "Sent to OP" && data.sentTime) {
    const sentSec = hhmmToSec(data.sentTime);
    const limitMin = Number(settings.entryViolationMin) || 15;
    if (sentSec !== null) {
      const deadlineSec = sentSec + limitMin * 60;
      const remain = deadlineSec - nowSecLocal();
      const fiveMinMs = 5 * 60 * 1000;
      const nowMs = Date.now();
      if (remain > 0 && (!prev.lastFiveMinAt || (nowMs - prev.lastFiveMinAt) >= fiveMinMs)) {
        const remMin = Math.max(1, Math.round(remain / 60));
        await showSwNotification(
          "\u23f0 Receiving Reminder",
          "You have about " + remMin + " more minute(s) to complete receiving, or you will be moved to Violator.",
          "dud3-remind-" + daId
        );
        prev.lastFiveMinAt = nowMs;
      } else if (remain <= 0 && !prev.expiredNotified) {
        await showSwNotification(
          "\u26a0\ufe0f Receiving Time Expired",
          "Your receiving window has expired. Your status will move to Violator.",
          "dud3-expired-" + daId
        );
        prev.expiredNotified = true;
      }
    }
  } else {
    prev.expiredNotified = false;
  }

  // 3) Violator transition.
  if (status === "Violator" && prev.lastStatus !== "Violator") {
    await showSwNotification(
      "\ud83d\udeab Moved to Violator",
      "You were not received within the configured time limit. Please see the Yard Marshal.",
      "dud3-violator-" + daId
    );
  }

  prev.lastStatus = status;
  await setSwState(cacheKey, prev);
}

// Minimal key-value state inside the service worker using the Cache Storage
// API (service workers cannot use localStorage directly).
async function getSwState(key) {
  try {
    const cache = await caches.open("dud3-sw-state");
    const res = await cache.match(key);
    if (!res) return null;
    return await res.json();
  } catch (e) { return null; }
}
async function setSwState(key, value) {
  try {
    const cache = await caches.open("dud3-sw-state");
    await cache.put(key, new Response(JSON.stringify(value)));
  } catch (e) {}
}

// Periodic Background Sync (Android Chrome/Edge, installed PWA only). This is
// what lets a check run even while the Driver Hub is not open at all. The
// page registers this tag (see registerPeriodicCheck() in Driver_index.html).
self.addEventListener("periodicsync", (event) => {
  if (event.tag && event.tag.indexOf("dud3-check-") === 0) {
    const daId = event.tag.replace("dud3-check-", "");
    event.waitUntil(runBackgroundCheck(daId));
  }
});

// Fallback for browsers without Periodic Background Sync: the PAGE posts a
// message to the service worker on its own interval while open/backgrounded,
// and the SW does the actual fetch + notification so it is not suppressed
// just because the tab lost focus.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DUD3_CHECK_NOW" && event.data.daId) {
    event.waitUntil(runBackgroundCheck(event.data.daId));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      if (clientsArr.length > 0) {
        return clientsArr[0].focus();
      }
      return self.clients.openWindow("./");
    })
  );
});
