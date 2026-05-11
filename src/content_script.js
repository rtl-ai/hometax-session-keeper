(() => {
  "use strict";

  const LOG_PREFIX = "[Hometax Auto Extend]";
  const CLICK_COOLDOWN_MS = 10_000;
  const SCAN_INTERVAL_MS = 750;
  const ESTIMATED_SESSION_SECONDS = 30 * 60;
  const ESTIMATED_TIMER_INTERVAL_MS = 1_000;
  const ESTIMATED_TIMER_HEARTBEAT_MS = 5_000;
  const AUTHORITATIVE_TIMER_STALE_MS = 7_000;
  const PROACTIVE_EXTEND_THRESHOLD_SECONDS = 5 * 60;
  const PROACTIVE_EXTEND_COOLDOWN_MS = 2 * 60_000;
  const EXTEND_BUTTON_TEXT = "연장하기";
  const PAGE_HOOK_SOURCE = "HOMETAX_AUTO_EXTEND_PAGE_HOOK";
  const CONTENT_SOURCE = "HOMETAX_AUTO_EXTEND_CONTENT_SCRIPT";
  const MSG_OPEN_BLOCKED_POPUP = "HOMETAX_OPEN_BLOCKED_SESSION_POPUP";
  const MSG_EXTEND_CLICKED = "HOMETAX_SESSION_EXTEND_CLICKED";
  const MSG_SESSION_TIMER = "HOMETAX_SESSION_TIMER";
  const MSG_CLEAR_SESSION_BADGE = "HOMETAX_CLEAR_SESSION_BADGE";
  const DEBUG_ALLOW_LOCALHOST = false;
  const LOGIN_CERTIFICATE_MARKERS = [
    "initpage=login",
    "utxppabc14",
    "popupid=mf_txppwframe_utxppabc14",
    "yessign.or.kr"
  ];
  const SESSION_POPUP_CODES = [
    "utxppabb27"
  ];
  const SERVICE_STOP_MARKERS = [
    "blockPage.html?msg=stop",
    "서비스 중지 시간"
  ];

  const extensionApi = globalThis.browser || globalThis.chrome;
  let lastClickAt = 0;
  let observerStarted = false;
  let hookInjected = false;
  let estimatedTimerAnchor = null;
  let estimatedTimerLastSeconds = null;
  let estimatedTimerLastPostedAt = 0;
  let lastAuthoritativeTimerAt = 0;
  let lastProactiveExtendAt = 0;

  function log(...args) {
    try { console.log(LOG_PREFIX, ...args); } catch (_) {}
  }

  function safeLocationLabel() {
    try { return `${location.hostname}${location.pathname}`; } catch (_) { return "unknown"; }
  }

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function currentUrlLabel() {
    try { return `${location.href}`; } catch (_) { return ""; }
  }

  function safeUrlForMessage(rawUrl) {
    try {
      const url = new URL(String(rawUrl || location.href || ""), location.href);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return "https://hometax.go.kr/";
    }
  }

  function safeReadString(readValue) {
    try { return String(readValue() || ""); } catch (_) { return ""; }
  }

  function effectiveContextLabels() {
    const values = [
      currentUrlLabel(),
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

  function shouldDisableOnThisPage() {
    return contextHasMarker(LOGIN_CERTIFICATE_MARKERS);
  }

  function isKnownSessionPopupContext() {
    return contextHasMarker(SESSION_POPUP_CODES);
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function elementLabel(el) {
    return normalizedText(
      el.getAttribute("value") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.textContent ||
      ""
    );
  }

  function pageLooksLikeTimeoutPrompt() {
    const title = normalizedText(document.title);
    const bodyText = normalizedText(document.body ? document.body.textContent : "");
    return (
      title.includes("sessionOut") ||
      bodyText.includes("로그아웃 시간이") ||
      bodyText.includes("로그아웃을 연장하시려면") ||
      bodyText.includes("로그인 시간을 연장하시겠습니까")
    );
  }

  function pageLooksLoggedIn() {
    const bodyText = normalizedText(document.body ? document.body.innerText || document.body.textContent : "");
    return (
      bodyText.includes("로그아웃") &&
      (
        bodyText.includes("회원정보조회") ||
        bodyText.includes("나의 홈택스") ||
        bodyText.includes("나의 메뉴")
      )
    );
  }

  function pageLooksServiceStopped() {
    const title = normalizedText(document.title);
    const bodyText = normalizedText(document.body ? document.body.innerText || document.body.textContent : "");
    const haystack = `${currentUrlLabel()} ${title} ${bodyText}`.toLowerCase();
    return SERVICE_STOP_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()));
  }

  function isCandidateExtendButton(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (elementLabel(el) !== EXTEND_BUTTON_TEXT) return false;
    return pageLooksLikeTimeoutPrompt();
  }

  function findExtendButton() {
    const known = document.getElementById("mf_trigger16");
    if (known && isCandidateExtendButton(known)) return known;

    const controls = document.querySelectorAll(
      'input[type="button"], input[type="submit"], button, [role="button"], .w2trigger'
    );
    for (const el of controls) {
      if (isCandidateExtendButton(el)) return el;
    }
    return null;
  }

  function runtimeSendMessage(payload) {
    if (!extensionApi || !extensionApi.runtime || !extensionApi.runtime.sendMessage) return;
    try {
      const result = extensionApi.runtime.sendMessage(payload);
      if (result && typeof result.catch === "function") {
        result.catch((err) => log("runtime message failed", err && err.message ? err.message : String(err)));
      }
    } catch (err) {
      log("runtime message failed", err && err.message ? err.message : String(err));
    }
  }

  let lastClearBadgeAt = 0;
  function notifyClearBadge(reason) {
    const now = Date.now();
    if (now - lastClearBadgeAt < 5_000) return;
    lastClearBadgeAt = now;
    runtimeSendMessage({
      type: MSG_CLEAR_SESSION_BADGE,
      page: safeLocationLabel(),
      frame: window.top === window ? "top" : "subframe",
      reason: String(reason || "inactive-context"),
      at: now
    });
  }

  function notifyExtendClicked(extra) {
    resetEstimatedLoginTimer(30 * 60);
    runtimeSendMessage({
      type: MSG_EXTEND_CLICKED,
      page: safeLocationLabel(),
      frame: window.top === window ? "top" : "subframe",
      sessionPopup: isKnownSessionPopupContext(),
      at: Date.now(),
      ...(extra && typeof extra === "object" ? extra : {})
    });
  }

  function notifySessionTimer(secondsLeft, source) {
    const sourceLabel = String(source || "unknown");
    const now = Date.now();
    if (sourceLabel !== "content-estimated-login") {
      lastAuthoritativeTimerAt = now;
      estimatedTimerAnchor = { secondsLeft: Math.max(0, Math.floor(secondsLeft)), at: now };
    }
    runtimeSendMessage({
      type: MSG_SESSION_TIMER,
      secondsLeft,
      page: safeLocationLabel(),
      frame: window.top === window ? "top" : "subframe",
      source: sourceLabel,
      sessionPopup: isKnownSessionPopupContext(),
      at: now
    });
    requestProactiveDirectExtend(secondsLeft, sourceLabel, now);
  }

  function requestProactiveDirectExtend(secondsLeft, sourceLabel, now) {
    const value = Number(secondsLeft);
    if (!Number.isFinite(value) || value < 0 || value > PROACTIVE_EXTEND_THRESHOLD_SECONDS) return;
    if (shouldDisableOnThisPage() || pageLooksServiceStopped()) return;
    if (window.top !== window && !isKnownSessionPopupContext()) return;
    if (now - lastProactiveExtendAt < PROACTIVE_EXTEND_COOLDOWN_MS) return;
    lastProactiveExtendAt = now;

    try {
      window.postMessage({
        source: CONTENT_SOURCE,
        type: "REQUEST_DIRECT_EXTEND",
        secondsLeft: Math.floor(value),
        timerSource: String(sourceLabel || "unknown"),
        reason: `proactive-low-timer:${String(sourceLabel || "unknown")}`,
        at: now
      }, location.origin || "*");
      log("requested proactive in-page session extension", {
        secondsLeft: Math.floor(value),
        source: String(sourceLabel || "unknown")
      });
    } catch (err) {
      log("proactive in-page session extension request failed", err && err.message ? err.message : String(err));
    }
  }

  function resetEstimatedLoginTimer(secondsLeft) {
    const value = Number.isFinite(secondsLeft) && secondsLeft > 0 ? Math.floor(secondsLeft) : ESTIMATED_SESSION_SECONDS;
    estimatedTimerAnchor = { secondsLeft: value, at: Date.now() };
    estimatedTimerLastSeconds = null;
    estimatedTimerLastPostedAt = 0;
  }

  function readEstimatedLoginSecondsLeft() {
    if (!estimatedTimerAnchor) resetEstimatedLoginTimer(ESTIMATED_SESSION_SECONDS);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - estimatedTimerAnchor.at) / 1000));
    return Math.max(0, estimatedTimerAnchor.secondsLeft - elapsedSeconds);
  }

  function startEstimatedLoginTimerFallback() {
    window.setInterval(() => {
      if (pageLooksServiceStopped()) {
        estimatedTimerAnchor = null;
        estimatedTimerLastSeconds = null;
        estimatedTimerLastPostedAt = 0;
        notifyClearBadge("hometax-service-stopped");
        return;
      }
      if (shouldDisableOnThisPage() || !pageLooksLoggedIn()) {
        estimatedTimerAnchor = null;
        estimatedTimerLastSeconds = null;
        estimatedTimerLastPostedAt = 0;
        notifyClearBadge(shouldDisableOnThisPage() ? "disabled-context" : "not-logged-in");
        return;
      }

      const now = Date.now();
      if (now - lastAuthoritativeTimerAt <= AUTHORITATIVE_TIMER_STALE_MS) return;

      const secondsLeft = readEstimatedLoginSecondsLeft();
      const badgeBucket = Math.ceil(secondsLeft / 60);
      const lastBadgeBucket = Number.isFinite(estimatedTimerLastSeconds) ? Math.ceil(estimatedTimerLastSeconds / 60) : null;
      const shouldPost =
        estimatedTimerLastSeconds === null ||
        secondsLeft <= 60 ||
        badgeBucket !== lastBadgeBucket ||
        now - estimatedTimerLastPostedAt >= ESTIMATED_TIMER_HEARTBEAT_MS;
      estimatedTimerLastSeconds = secondsLeft;
      if (!shouldPost) return;
      estimatedTimerLastPostedAt = now;
      notifySessionTimer(secondsLeft, "content-estimated-login");
    }, ESTIMATED_TIMER_INTERVAL_MS);
  }

  function parseRemainingSecondsFromText(text) {
    const value = normalizedText(text);
    const match = value.match(/(\d{1,2})\s*분\s*(\d{1,2})\s*초/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function findPromptRemainingSeconds() {
    const title = normalizedText(document.title);
    const bodyText = normalizedText(document.body ? document.body.textContent : "");
    const seconds = parseRemainingSecondsFromText(`${title} ${bodyText}`);
    return Number.isFinite(seconds) ? seconds : null;
  }

  function clickElement(el) {
    const now = Date.now();
    if (now - lastClickAt < CLICK_COOLDOWN_MS) return false;
    lastClickAt = now;

    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    try { if (typeof el.focus === "function") el.focus({ preventScroll: true }); } catch (_) {}

    const eventInit = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new MouseEvent("mousedown", eventInit)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", eventInit)); } catch (_) {}
    try { el.click(); } catch (_) {
      try { el.dispatchEvent(new MouseEvent("click", eventInit)); } catch (_) {}
    }

    log("clicked extend button", { page: safeLocationLabel(), frame: window.top === window ? "top" : "subframe" });
    notifyExtendClicked({ source: "button-click" });
    return true;
  }

  function scanAndClick() {
    const seconds = findPromptRemainingSeconds();
    if (Number.isFinite(seconds)) notifySessionTimer(seconds, "prompt");
    const button = findExtendButton();
    if (!button) return false;
    return clickElement(button);
  }

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;
    scanAndClick();

    const observer = new MutationObserver(() => scanAndClick());
    function observeWhenReady() {
      const target = document.documentElement || document.body;
      if (!target) return false;
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "disabled", "aria-disabled", "value"]
      });
      return true;
    }
    if (!observeWhenReady()) document.addEventListener("DOMContentLoaded", observeWhenReady, { once: true });
    window.setInterval(scanAndClick, SCAN_INTERVAL_MS);
    log("content script loaded", { page: safeLocationLabel() });
  }

  function isAllowedUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      const host = url.hostname.toLowerCase();
      const isHometax = url.protocol === "https:" && (host === "hometax.go.kr" || host === "www.hometax.go.kr" || host.endsWith(".hometax.go.kr"));
      const isDebugLocal = DEBUG_ALLOW_LOCALHOST && url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost") && url.port === "8787";
      return isHometax || isDebugLocal;
    } catch (_) {
      return false;
    }
  }

  function sendOpenPopupMessage(url, openerUrl, reason) {
    if (!isAllowedUrl(url)) return;
    runtimeSendMessage({
      type: MSG_OPEN_BLOCKED_POPUP,
      url: new URL(String(url), location.href).href,
      openerUrl: safeUrlForMessage(openerUrl),
      reason: String(reason || "popup-blocked")
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === PAGE_HOOK_SOURCE && data.type === "SESSION_TIMER") {
      const secondsLeft = Number(data.secondsLeft);
      if (Number.isFinite(secondsLeft) && secondsLeft >= 0) {
        notifySessionTimer(secondsLeft, data.timerSource || "page");
      }
      return;
    }
    if (data && data.source === PAGE_HOOK_SOURCE && data.type === "EXTEND_ATTEMPTED_IN_PAGE") {
      const secondsLeft = Number(data.secondsLeft);
      if (data.ok) {
        log("page hook attempted in-page session extension", {
          method: String(data.method || ""),
          timerMethod: String(data.timerMethod || ""),
          skipped: Boolean(data.skipped)
        });
        if (Number.isFinite(secondsLeft) && secondsLeft >= 0) {
          notifySessionTimer(secondsLeft, "page-direct-extend");
        }
        notifyExtendClicked({
          source: "page-direct-extend",
          method: String(data.method || ""),
          timerMethod: String(data.timerMethod || ""),
          skipped: Boolean(data.skipped),
          secondsLeft: Number.isFinite(secondsLeft) ? secondsLeft : 30 * 60
        });
      } else {
        log("page hook in-page session extension failed", String(data.error || "unknown"));
      }
      return;
    }
    if (!data || data.source !== PAGE_HOOK_SOURCE || data.type !== "POPUP_BLOCKED") return;
    sendOpenPopupMessage(data.url, data.openerUrl, data.reason);
  });

  function injectPageHookFallback() {
    if (hookInjected || !extensionApi || !extensionApi.runtime || !extensionApi.runtime.getURL) return;
    hookInjected = true;
    try {
      const script = document.createElement("script");
      script.src = extensionApi.runtime.getURL("page_hook.js");
      script.async = false;
      script.dataset.hometaxAutoExtend = "page-hook";
      script.addEventListener("load", () => script.remove(), { once: true });
      const parent = document.documentElement || document.head || document.body;
      if (parent) parent.insertBefore(script, parent.firstChild);
      log("page hook fallback injected", { page: safeLocationLabel() });
    } catch (err) {
      log("page hook fallback injection failed", err && err.message ? err.message : String(err));
    }
  }

  if (shouldDisableOnThisPage()) {
    notifyClearBadge("disabled-context");
    log("disabled on login/certificate page", { page: safeLocationLabel() });
    return;
  }

  if (document.documentElement) injectPageHookFallback();
  else document.addEventListener("DOMContentLoaded", injectPageHookFallback, { once: true });

  startObserver();
  startEstimatedLoginTimerFallback();
})();
