(() => {
  "use strict";

  const INSTALL_FLAG = "__HOMETAX_AUTO_EXTEND_WINDOW_OPEN_HOOK_INSTALLED__";
  const TIMER_BRIDGE_INSTALL_FLAG = "__HOMETAX_AUTO_EXTEND_TIMER_BRIDGE_INSTALLED__";
  const SOURCE = "HOMETAX_AUTO_EXTEND_PAGE_HOOK";
  const LOG_PREFIX = "[Hometax Auto Extend Hook]";
  const DEBUG_ALLOW_LOCALHOST = false;
  const TIMER_INTERVAL_MS = 1_000;
  const TIMER_HEARTBEAT_MS = 5_000;
  const DIRECT_EXTEND_COOLDOWN_MS = 8_000;
  const ENABLE_DIRECT_SESSION_EXTEND = true;
  const LOGIN_CERTIFICATE_MARKERS = [
    "initpage=login",
    "utxppabc14",
    "popupid=mf_txppwframe_utxppabc14",
    "yessign.or.kr"
  ];
  const SESSION_POPUP_CODES = [
    "utxppabb27"
  ];

  const hookAlreadyInstalled = Boolean(window[INSTALL_FLAG]);
  if (!hookAlreadyInstalled) window[INSTALL_FLAG] = true;

  function log(...args) {
    try { console.log(LOG_PREFIX, ...args); } catch (_) {}
  }

  function currentHref() {
    try { return String(location.href || ""); } catch (_) { return ""; }
  }

  function safeReadString(readValue) {
    try { return String(readValue() || ""); } catch (_) { return ""; }
  }

  function effectiveContextLabels() {
    const values = [
      currentHref(),
      safeReadString(() => document.URL),
      safeReadString(() => document.referrer)
    ];

    try {
      if (location.ancestorOrigins) {
        for (let i = 0; i < location.ancestorOrigins.length; i += 1) {
          values.push(String(location.ancestorOrigins[i] || ""));
        }
      }
    } catch (_) {}

    values.push(safeReadString(() => window.parent && window.parent !== window ? window.parent.location.href : ""));
    values.push(safeReadString(() => window.top && window.top !== window ? window.top.location.href : ""));
    return values.filter(Boolean);
  }

  function contextHasMarker(markers) {
    return effectiveContextLabels().some((value) => {
      const lower = value.toLowerCase();
      return markers.some((marker) => lower.includes(marker));
    });
  }

  function shouldDisableHookOnThisPage() {
    return contextHasMarker(LOGIN_CERTIFICATE_MARKERS);
  }

  function isKnownSessionPopupContext() {
    return contextHasMarker(SESSION_POPUP_CODES);
  }

  function safeUrlForMessage(rawUrl) {
    try {
      const url = new URL(String(rawUrl || location.href || ""), location.href);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return "https://hometax.go.kr/";
    }
  }

  function isAllowedHost(protocol, hostname, port) {
    const h = String(hostname || "").toLowerCase();
    const isHometax = protocol === "https:" && (h === "hometax.go.kr" || h === "www.hometax.go.kr" || h.endsWith(".hometax.go.kr"));
    const isDebugLocal = DEBUG_ALLOW_LOCALHOST && protocol === "http:" && (h === "127.0.0.1" || h === "localhost") && String(port || "") === "8787";
    return isHometax || isDebugLocal;
  }

  function toAbsoluteUrl(rawUrl) {
    const raw = rawUrl == null ? "" : String(rawUrl);
    if (!raw || raw === "about:blank") return raw;
    try { return new URL(raw, location.href).href; } catch (_) { return raw; }
  }

  function looksLikeSessionPopup(rawUrl, target, features) {
    const absolute = toAbsoluteUrl(rawUrl);
    let urlObj = null;
    try { urlObj = new URL(absolute || location.href, location.href); } catch (_) {}
    if (urlObj && !isAllowedHost(urlObj.protocol, urlObj.hostname, urlObj.port)) return false;

    const haystack = String(absolute || "").toLowerCase();
    return SESSION_POPUP_CODES.some((code) => haystack.includes(code.toLowerCase()));
  }

  let timerAnchor = null;
  let lastDirectExtendAt = 0;

  function knownSessionPopupUrl(rawUrl, target, features) {
    const haystack = String(toAbsoluteUrl(rawUrl) || "").toLowerCase();
    return SESSION_POPUP_CODES.some((code) => haystack.includes(code.toLowerCase()));
  }

  function readSessionSecondsLeft() {
    try {
      const timer = window.ntsLoginVo;
      if (!timer || typeof timer !== "object") return null;
      const rawValue = Number(timer.FN_CURRENT_TIME);
      const maxValue = Number(timer.FN_MAX_TIME);
      if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 24 * 60 * 60) return null;

      const now = Date.now();
      const rawSeconds = Math.floor(rawValue);
      const maxSeconds = Number.isFinite(maxValue) && maxValue > 0 ? Math.floor(maxValue) : rawSeconds;
      const elapsedSinceAnchor = timerAnchor ? Math.max(0, Math.floor((now - timerAnchor.at) / 1000)) : 0;
      if (
        !timerAnchor ||
        timerAnchor.rawSeconds !== rawSeconds ||
        timerAnchor.maxSeconds !== maxSeconds ||
        rawSeconds > timerAnchor.rawSeconds ||
        (rawSeconds > 0 && elapsedSinceAnchor >= timerAnchor.maxSeconds)
      ) {
        timerAnchor = { rawSeconds, maxSeconds, at: now };
      }

      const elapsedSeconds = Math.max(0, Math.floor((now - timerAnchor.at) / 1000));
      const estimated = Math.max(0, Math.min(maxSeconds, timerAnchor.rawSeconds - elapsedSeconds));
      return Math.floor(estimated);
    } catch (_) {
      return null;
    }
  }

  function postSessionTimer(secondsLeft) {
    try {
      window.postMessage({
        source: SOURCE,
        type: "SESSION_TIMER",
        secondsLeft,
        timerSource: "ntsLoginVo",
        sessionPopup: isKnownSessionPopupContext()
      }, location.origin || "*");
    } catch (_) {}
  }

  function resetTimerAnchor(secondsLeft) {
    const fallbackMax = 30 * 60;
    let maxSeconds = fallbackMax;
    try {
      const timer = window.ntsLoginVo;
      const value = Number(timer && timer.FN_MAX_TIME);
      if (Number.isFinite(value) && value > 0 && value <= 24 * 60 * 60) maxSeconds = Math.floor(value);
    } catch (_) {}

    const rawSeconds = Number.isFinite(secondsLeft) && secondsLeft > 0 ? Math.floor(secondsLeft) : maxSeconds;
    timerAnchor = { rawSeconds, maxSeconds, at: Date.now() };
    postSessionTimer(rawSeconds);
    return rawSeconds;
  }

  function getTopWindow() {
    try { return window.top || window; } catch (_) { return window; }
  }

  function invokeSessionExtend() {
    const topWindow = getTopWindow();
    let topHref = "";
    try { topHref = String(topWindow.location && topWindow.location.href || ""); } catch (_) {}

    if (topHref.includes("UTXPPADA01") && typeof topWindow.fn_smpcSessionXtn === "function") {
      topWindow.fn_smpcSessionXtn();
      return "top.fn_smpcSessionXtn";
    }

    if (window.$c && window.$c.pp && typeof window.$c.pp.sessionXtn === "function") {
      window.$c.pp.sessionXtn();
      return "window.$c.pp.sessionXtn";
    }

    if (topWindow.$c && topWindow.$c.pp && typeof topWindow.$c.pp.sessionXtn === "function") {
      topWindow.$c.pp.sessionXtn();
      return "top.$c.pp.sessionXtn";
    }

    return "";
  }

  function invokeSessionTimerReset() {
    const topWindow = getTopWindow();
    if (typeof window.sessionTimer === "function") {
      window.sessionTimer("N");
      return "window.sessionTimer";
    }
    if (typeof topWindow.sessionTimer === "function") {
      topWindow.sessionTimer("N");
      return "top.sessionTimer";
    }
    return "";
  }

  function postDirectExtendResult(payload) {
    try {
      window.postMessage({
        source: SOURCE,
        type: "EXTEND_ATTEMPTED_IN_PAGE",
        sessionPopup: isKnownSessionPopupContext(),
        ...payload
      }, location.origin || "*");
    } catch (_) {}
  }

  function attemptDirectSessionExtend(rawUrl, target, features, reason) {
    if (!ENABLE_DIRECT_SESSION_EXTEND) return false;
    if (!knownSessionPopupUrl(rawUrl, target, features)) return false;
    const now = Date.now();
    if (now - lastDirectExtendAt < DIRECT_EXTEND_COOLDOWN_MS) {
      postDirectExtendResult({ ok: true, skipped: true, reason: "cooldown", secondsLeft: readSessionSecondsLeft() });
      return true;
    }
    lastDirectExtendAt = now;

    try {
      const extendMethod = invokeSessionExtend();
      if (!extendMethod) {
        postDirectExtendResult({ ok: false, error: "session extension function unavailable", reason: String(reason || "") });
        return false;
      }
      const timerMethod = invokeSessionTimerReset();
      const secondsLeft = resetTimerAnchor(30 * 60);
      postDirectExtendResult({
        ok: true,
        skipped: false,
        method: extendMethod,
        timerMethod,
        secondsLeft,
        reason: String(reason || "")
      });
      log("direct session extension attempted", { method: extendMethod, timerMethod, reason: String(reason || "") });
      return true;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      postDirectExtendResult({ ok: false, error: message, reason: String(reason || "") });
      log("direct session extension failed", message);
      return false;
    }
  }

  function startSessionTimerBridge() {
    if (window[TIMER_BRIDGE_INSTALL_FLAG]) return;
    window[TIMER_BRIDGE_INSTALL_FLAG] = true;

    let lastSeconds = null;
    let lastPostedAt = 0;
    function tick() {
      const secondsLeft = readSessionSecondsLeft();
      if (!Number.isFinite(secondsLeft)) return;
      const now = Date.now();
      const badgeBucket = Math.ceil(secondsLeft / 60);
      const lastBadgeBucket = Number.isFinite(lastSeconds) ? Math.ceil(lastSeconds / 60) : null;
      const shouldPost =
        lastSeconds === null ||
        secondsLeft <= 60 ||
        badgeBucket !== lastBadgeBucket ||
        now - lastPostedAt >= TIMER_HEARTBEAT_MS;
      if (!shouldPost) {
        lastSeconds = secondsLeft;
        return;
      }
      lastSeconds = secondsLeft;
      lastPostedAt = now;
      postSessionTimer(secondsLeft);
    }
    tick();
    window.setInterval(tick, TIMER_INTERVAL_MS);
  }

  function notifyBlockedPopup(rawUrl, target, features, reason) {
    const absolute = toAbsoluteUrl(rawUrl);
    if (!absolute || absolute === "about:blank") {
      log("blocked session popup detected, but URL is empty", { target: String(target || ""), reason: String(reason || "") });
      return;
    }

    try {
      const urlObj = new URL(absolute, location.href);
      if (!isAllowedHost(urlObj.protocol, urlObj.hostname, urlObj.port)) return;
    } catch (_) {
      return;
    }

      const payload = {
        source: SOURCE,
        type: "POPUP_BLOCKED",
        url: absolute,
        openerUrl: safeUrlForMessage(location.href),
        target: String(target || ""),
        features: String(features || ""),
        reason: String(reason || "window.open returned null")
    };

    try {
      const handledInPage = attemptDirectSessionExtend(rawUrl, target, features, payload.reason);
      if (handledInPage) return;

      window.postMessage(payload, location.origin || "*");
      log("requested fallback popup", { url: safeUrlForMessage(absolute), target: String(target || ""), reason: payload.reason });
    } catch (err) {
      log("postMessage failed", err && err.message ? err.message : String(err));
    }
  }

  const originalOpen = window.open;

  if (shouldDisableHookOnThisPage()) {
    log("window.open hook skipped on login/certificate page");
    return;
  }

  startSessionTimerBridge();

  if (hookAlreadyInstalled || typeof originalOpen !== "function" || originalOpen.__hometaxAutoExtendWrapped) return;

  function wrappedOpen(url, target, features) {
    const candidate = looksLikeSessionPopup(url, target, features);
    let opened = null;
    let threw = false;

    try {
      opened = originalOpen.apply(window, arguments);
    } catch (err) {
      threw = true;
      if (candidate) notifyBlockedPopup(url, target, features, "window.open threw: " + (err && err.message ? err.message : String(err)));
      throw err;
    } finally {
      if (candidate && !threw) {
        let blocked = !opened;
        try { blocked = blocked || opened.closed === true; }
        catch (_) { blocked = false; }
        if (blocked) notifyBlockedPopup(url, target, features, "window.open returned null/closed");
      }
    }

    return opened;
  }

  try { Object.defineProperty(wrappedOpen, "__hometaxAutoExtendWrapped", { value: true }); }
  catch (_) { wrappedOpen.__hometaxAutoExtendWrapped = true; }

  try {
    window.open = wrappedOpen;
    log("window.open hook installed");
  } catch (err) {
    log("window.open hook install failed", err && err.message ? err.message : String(err));
  }
})();
