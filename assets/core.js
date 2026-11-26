/* ============================================================================
 * DUD3 shared runtime — used by index.html (Yard Marshal) and driver.html (Driver Hub).
 *   DUD3.CONFIG    backend URL + sheet URL (one place to change them)
 *   SAFE_STORE     localStorage that falls back to memory (private mode / blocked storage)
 *   fetchWithTimeout, escapeHtml, DUD3.api(action, payload, opts)
 *   DUD3.install   install-the-app sheet (auto pops up; one tap on Android,
 *                  Share-sheet steps on iPhone, "Open in Chrome" inside chat apps)
 * ========================================================================= */
(function (w) {
  "use strict";

  var CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbwjKBYUa4e4MLAVSOG7deemoWWZIx5gNWnEdbA6E4QFUxRCaTuNGhSIvM9mGrI1y6Lzdg/exec",
    SHEET_URL: "https://docs.google.com/spreadsheets/d/1xmoLxFOyKipL7acCXu9ZG90d1nDpSag7xdkfP0v9wGQ/edit",
    REQUEST_TIMEOUT_MS: 15000
  };

  /* ---------- storage ---------- */
  var SAFE_STORE = (function () {
    var mem = {}, ok = false;
    try { var t = "__dud3__"; w.localStorage.setItem(t, "1"); w.localStorage.removeItem(t); ok = true; } catch (e) {}
    return {
      getItem: function (k) { if (ok) { try { return w.localStorage.getItem(k); } catch (e) {} } return (k in mem) ? mem[k] : null; },
      setItem: function (k, v) { if (ok) { try { w.localStorage.setItem(k, v); return; } catch (e) {} } mem[k] = String(v); },
      removeItem: function (k) { if (ok) { try { w.localStorage.removeItem(k); return; } catch (e) {} } delete mem[k]; }
    };
  })();

  /* ---------- network ---------- */
  // Browsers put no timeout on fetch(); a hung Apps Script call would otherwise
  // spin forever. This always settles within timeoutMs.
  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var opts = Object.assign({}, options || {});
    if (controller) opts.signal = controller.signal;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetch(url, opts).finally(function () { if (timer) clearTimeout(timer); });
  }

  /**
   * Call the backend. POST (text/plain avoids a CORS preflight); if that fails,
   * retry once as GET. Resolves with the parsed JSON, rejects on network failure.
   */
  function api(action, payload, opts) {
    opts = opts || {};
    var apiUrl = opts.apiUrl || CONFIG.API_URL;
    var timeout = opts.timeout || CONFIG.REQUEST_TIMEOUT_MS;
    var body = { action: action, payload: payload || {} };
    if (opts.clientId) body.clientId = opts.clientId;
    return fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      cache: "no-store"
    }, timeout)
      .then(function (res) { return res.json(); })
      .catch(function () {
        var url = apiUrl + "?action=" + encodeURIComponent(action) +
          (opts.clientId ? "&clientId=" + encodeURIComponent(opts.clientId) : "") +
          "&payload=" + encodeURIComponent(JSON.stringify(payload || {}));
        return fetchWithTimeout(url, { cache: "no-store" }, timeout).then(function (res) { return res.json(); });
      });
  }

  /* ---------- html ---------- */
  // Escapes quotes too, so values are safe inside attributes.
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- install ---------- */
  var UA = navigator.userAgent || "";
  var IS_IOS = /iphone|ipad|ipod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  // In-app browsers of chat / social apps cannot install web apps.
  var IS_IN_APP = /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|Telegram|WhatsApp|MicroMessenger/i.test(UA);
  var SNOOZE_MS = 12 * 60 * 60 * 1000;

  var install = (function () {
    var deferred = null, mode = "", cfg = {}, autoShown = false;

    function isInstalled() {
      try {
        if (w.matchMedia && (w.matchMedia("(display-mode: standalone)").matches || w.matchMedia("(display-mode: fullscreen)").matches)) return true;
        if (w.navigator && w.navigator.standalone) return true;
      } catch (e) {}
      return false;
    }
    function key(k) { return "dud3_" + (cfg.id || "app") + "_" + k; }
    function snoozed() {
      var t = Number(SAFE_STORE.getItem(key("install_snooze")) || 0);
      return t > 0 && (Date.now() - t) < SNOOZE_MS;
    }
    function el(id) { return document.getElementById(id); }

    function ensureMarkup() {
      if (el("install-sheet")) return;
      var d = document.createElement("div");
      d.id = "install-sheet";
      d.setAttribute("role", "dialog");
      d.setAttribute("aria-modal", "true");
      d.setAttribute("aria-labelledby", "is-title");
      d.innerHTML =
        '<div class="is-panel">' +
          '<img class="is-icon" src="' + escapeHtml(cfg.icon || "") + '" alt="">' +
          '<div class="is-title" id="is-title">Install ' + escapeHtml(cfg.appName || "the app") + '</div>' +
          '<div class="is-sub" id="is-sub"></div>' +
          '<div class="is-steps" id="is-steps" style="display:none;"></div>' +
          '<button type="button" class="is-action" id="is-action">Install App</button>' +
          '<button type="button" class="is-later" id="is-later">Not now</button>' +
        '</div>';
      document.body.appendChild(d);
      el("is-action").onclick = action;
      el("is-later").onclick = dismiss;
      d.addEventListener("click", function (e) { if (e.target === d) dismiss(); });
    }

    function pickMode() {
      if (IS_IN_APP) return IS_IOS ? "inapp-ios" : "inapp-android";
      if (deferred) return "native";
      if (IS_IOS) return "ios";
      return "manual";
    }

    function show(m) {
      if (isInstalled()) return;
      ensureMarkup();
      mode = m;
      var sub = el("is-sub"), steps = el("is-steps"), act = el("is-action");
      var name = cfg.appName || "the app";
      steps.style.display = "none"; steps.innerHTML = "";
      var stepList = null;
      if (m === "native") {
        sub.textContent = cfg.nativeText || ("One tap adds " + name + " to your home screen — it opens instantly like a normal app.");
        act.textContent = "⬇️  Install App";
      } else if (m === "inapp-android") {
        sub.textContent = "This page is open inside another app (like WhatsApp), which can't install apps. Open it in Chrome to install.";
        act.textContent = "Open in Chrome";
      } else if (m === "inapp-ios") {
        sub.textContent = "This page is open inside another app, which can't install apps. Open it in Safari first:";
        stepList = ["Tap the <b>⋯</b> or <b>Share</b> button in this app.", "Choose <b>Open in Safari</b> (or Open in Browser).", "In Safari, this screen will show the next steps."];
        act.textContent = "Got it";
      } else if (m === "ios") {
        sub.textContent = "iPhone needs 3 quick taps to add " + name + " to your home screen:";
        stepList = ["Tap the <b>Share</b> button (square with an arrow) in Safari.", "Scroll down and tap <b>Add to Home Screen</b>.", "Tap <b>Add</b> (top right)."];
        act.textContent = "Got it";
      } else {
        sub.textContent = "Add " + name + " to your home screen:";
        stepList = ["Open the browser menu <b>⋮</b> (top right).", "Tap <b>Install app</b> or <b>Add to Home screen</b>.", "Tap <b>Install</b> to confirm."];
        act.textContent = "Got it";
      }
      if (stepList) { steps.innerHTML = "<ol><li>" + stepList.join("</li><li>") + "</li></ol>"; steps.style.display = "block"; }
      el("install-sheet").classList.add("show");
    }

    function close() { var s = el("install-sheet"); if (s) s.classList.remove("show"); }
    function dismiss() { SAFE_STORE.setItem(key("install_snooze"), String(Date.now())); close(); }

    function action() {
      if (mode === "native" && deferred) {
        var p = deferred;
        deferred = null; // an install prompt can only be used once
        close();
        p.prompt();
        p.userChoice.then(function (c) {
          if (c && c.outcome === "dismissed") SAFE_STORE.setItem(key("install_snooze"), String(Date.now()));
        }).catch(function () {});
        return;
      }
      if (mode === "inapp-android") {
        var loc = w.location;
        w.location.href = "intent://" + loc.host + loc.pathname + loc.search +
          "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(loc.href) + ";end";
        return;
      }
      close();
    }

    function hideButtons() {
      (cfg.buttons || []).forEach(function (b) { var e = typeof b === "string" ? el(b) : b; if (e) e.classList.add("hide"); });
      close();
    }

    w.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      (cfg.buttons || []).forEach(function (b) { var x = typeof b === "string" ? el(b) : b; if (x) x.classList.add("show"); });
      if (cfg.auto && autoShown && !IS_IN_APP && !snoozed()) show("native");
    });
    w.addEventListener("appinstalled", function () {
      deferred = null;
      SAFE_STORE.setItem(key("installed"), "1");
      hideButtons();
      if (cfg.onInstalled) cfg.onInstalled();
    });

    /**
     * init({ id, appName, icon, nativeText, buttons: [ids], auto: bool, delayMs, onInstalled })
     * auto=true pops the sheet up by itself after delayMs (unless installed / snoozed).
     */
    function init(options) {
      cfg = options || {};
      if (isInstalled()) { hideButtons(); return; }
      if (!cfg.auto) return;
      setTimeout(function () {
        if (isInstalled() || snoozed()) return;
        autoShown = true;
        var m = pickMode();
        if (m !== "manual") { show(m); return; }
        // Chrome may fire beforeinstallprompt a few seconds after load; if it never
        // does, it is usually because the app is already installed — check first.
        setTimeout(function () {
          if (deferred || snoozed() || SAFE_STORE.getItem(key("installed")) === "1") return;
          var manual = function () { if (!deferred) show("manual"); };
          if (navigator.getInstalledRelatedApps) {
            navigator.getInstalledRelatedApps().then(function (apps) {
              if (apps && apps.length) { SAFE_STORE.setItem(key("installed"), "1"); return; }
              manual();
            }).catch(manual);
          } else manual();
        }, 4000);
      }, cfg.delayMs || 1500);
    }

    // Header "Install" button: always works, ignores the snooze.
    function open() {
      if (isInstalled()) { hideButtons(); return false; }
      show(pickMode());
      return true;
    }

    return { init: init, open: open, isInstalled: isInstalled };
  })();

  w.DUD3 = { CONFIG: CONFIG, store: SAFE_STORE, api: api, fetchWithTimeout: fetchWithTimeout, escapeHtml: escapeHtml, install: install };
  // Plain globals for the page scripts.
  w.SAFE_STORE = SAFE_STORE;
  w.fetchWithTimeout = fetchWithTimeout;
  w.escapeHtml = escapeHtml;
})(window);
