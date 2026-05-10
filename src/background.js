(() => {
  "use strict";

  const LOG_PREFIX = "[Hometax Auto Extend Background]";
  const MSG_OPEN_BLOCKED_POPUP = "HOMETAX_OPEN_BLOCKED_SESSION_POPUP";
  const MSG_EXTEND_CLICKED = "HOMETAX_SESSION_EXTEND_CLICKED";
  const MSG_SESSION_TIMER = "HOMETAX_SESSION_TIMER";
  const MSG_CLEAR_SESSION_BADGE = "HOMETAX_CLEAR_SESSION_BADGE";
  const OPEN_COOLDOWN_MS = 8_000;
  const FALLBACK_WINDOW_TTL_MS = 90_000;
  const CLOSE_AFTER_CLICK_MS = 650;
  const BADGE_STALE_MS = 10_000;
  const BADGE_STALE_REGRESSION_SECONDS = 5 * 60;
  const DEBUG_ALLOW_LOCALHOST = false;
  const SESSION_POPUP_CODES = [
    "utxppabb27"
  ];

  const lastOpenAtByUrl = new Map();
  const fallbackWindowIds = new Set();
  const lastTimerAtByTabId = new Map();
  const badgeAnchorByTabId = new Map();
  const api = globalThis.browser || globalThis.chrome;

  function log(...args) { try { console.log(LOG_PREFIX, ...args); } catch (_) {} }

  function isAllowedHost(protocol, hostname, port) {
    const h = String(hostname || "").toLowerCase();
    const isHometax = protocol === "https:" && (h === "hometax.go.kr" || h === "www.hometax.go.kr" || h.endsWith(".hometax.go.kr"));
    const isDebugLocal = DEBUG_ALLOW_LOCALHOST && protocol === "http:" && (h === "127.0.0.1" || h === "localhost") && String(port || "") === "8787";
    return isHometax || isDebugLocal;
  }

  function normalizeAndValidateUrl(rawUrl, openerUrl) {
    const base = openerUrl && /^https?:\/\//i.test(String(openerUrl)) ? String(openerUrl) : "https://hometax.go.kr/";
    const u = new URL(String(rawUrl || ""), base);
    if (!isAllowedHost(u.protocol, u.hostname, u.port)) throw new Error("only allowed Hometax URLs are permitted");

    const haystack = (u.pathname + " " + u.search + " " + u.hash).toLowerCase();
    const hasKnownHometaxSessionPopup = SESSION_POPUP_CODES.some((code) => haystack.includes(code.toLowerCase()));
    if (!hasKnownHometaxSessionPopup) throw new Error("URL is not the known Hometax session-extension popup");
    return u.href;
  }

  function senderLooksLikeKnownSessionPopup(sender) {
    const senderUrl = sender && sender.url;
    if (!senderUrl) return false;
    try {
      const u = new URL(senderUrl);
      if (!isAllowedHost(u.protocol, u.hostname, u.port)) return false;
      const haystack = (u.pathname + " " + u.search + " " + u.hash).toLowerCase();
      return SESSION_POPUP_CODES.some((code) => haystack.includes(code.toLowerCase()));
    } catch (_) {
      return false;
    }
  }

  function senderLooksAllowed(sender) {
    const senderUrl = sender && sender.url;
    if (!senderUrl) return false;
    try {
      const u = new URL(senderUrl);
      return isAllowedHost(u.protocol, u.hostname, u.port);
    } catch (_) {
      return false;
    }
  }

  function promisifyChromeCall(fn, ...args) {
    return new Promise((resolve, reject) => {
      try {
        fn(...args, (value) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(value);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function createWindow(createData) {
    if (!api || !api.windows || !api.windows.create) throw new Error("windows.create API unavailable");
    if (typeof globalThis.browser !== "undefined" && api === globalThis.browser) return api.windows.create(createData);
    return promisifyChromeCall(api.windows.create, createData);
  }

  function removeWindow(windowId) {
    if (!api || !api.windows || !api.windows.remove) return Promise.resolve();
    if (typeof windowId !== "number" || windowId < 0) return Promise.resolve();
    if (typeof globalThis.browser !== "undefined" && api === globalThis.browser) return api.windows.remove(windowId);
    return promisifyChromeCall(api.windows.remove, windowId);
  }

  function rememberFallbackWindow(windowId) {
    if (typeof windowId !== "number") return;
    fallbackWindowIds.add(windowId);
    setTimeout(() => fallbackWindowIds.delete(windowId), FALLBACK_WINDOW_TTL_MS);
  }

  function actionApi() {
    return (api && (api.action || api.browserAction)) || null;
  }

  function setBadgeText(details) {
    const action = actionApi();
    if (!action || !action.setBadgeText) return Promise.resolve();
    if (typeof globalThis.browser !== "undefined" && api === globalThis.browser) return action.setBadgeText(details);
    return promisifyChromeCall(action.setBadgeText, details);
  }

  function setBadgeBackgroundColor(details) {
    const action = actionApi();
    if (!action || !action.setBadgeBackgroundColor) return Promise.resolve();
    if (typeof globalThis.browser !== "undefined" && api === globalThis.browser) return action.setBadgeBackgroundColor(details);
    return promisifyChromeCall(action.setBadgeBackgroundColor, details);
  }

  function formatBadge(secondsLeft) {
    if (!Number.isFinite(secondsLeft) || secondsLeft < 0) return "";
    if (secondsLeft < 60) return `${Math.max(0, Math.floor(secondsLeft))}s`;
    return `${Math.ceil(secondsLeft / 60)}m`;
  }

  function badgeColor(secondsLeft) {
    if (secondsLeft <= 60) return "#c62828";
    if (secondsLeft <= 300) return "#ef6c00";
    return "#1565c0";
  }

  function resetBadgeAnchor(tabId, secondsLeft, source) {
    if (typeof tabId !== "number") return;
    badgeAnchorByTabId.set(tabId, {
      secondsLeft: Math.max(0, Math.floor(secondsLeft)),
      at: Date.now(),
      source: String(source || "unknown")
    });
  }

  function estimatedAnchorSeconds(anchor) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - anchor.at) / 1000));
    return Math.max(0, anchor.secondsLeft - elapsedSeconds);
  }

  function isSubframeSender(message, sender) {
    if (message && message.frame === "subframe") return true;
    return !!(sender && Number.isInteger(sender.frameId) && sender.frameId !== 0);
  }

  function shouldIgnoreSessionTimer(message, sender, tabId, secondsLeft) {
    const source = String(message && message.source || "");
    const isSubframe = isSubframeSender(message, sender);
    const isTrustedSubframeSessionPopup =
      isSubframe &&
      message &&
      message.sessionPopup === true &&
      (source === "prompt" || source === "page-direct-extend");
    if (isSubframe && !isTrustedSubframeSessionPopup) {
      log("subframe timer ignored", { source, secondsLeft });
      return true;
    }

    if (typeof tabId !== "number") return false;
    const anchor = badgeAnchorByTabId.get(tabId);
    if (!anchor) return false;
    const expectedSeconds = estimatedAnchorSeconds(anchor);
    const looksLikeStaleRegression =
      expectedSeconds > BADGE_STALE_REGRESSION_SECONDS &&
      secondsLeft + BADGE_STALE_REGRESSION_SECONDS < expectedSeconds;
    if (!looksLikeStaleRegression) return false;

    log("stale timer ignored", {
      source,
      secondsLeft,
      expectedSeconds,
      anchorSource: anchor.source
    });
    return true;
  }

  function setTimerBadge(tabId, secondsLeft) {
    const text = formatBadge(secondsLeft);
    const details = typeof tabId === "number" ? { tabId, text } : { text };
    const colorDetails = typeof tabId === "number" ? { tabId, color: badgeColor(secondsLeft) } : { color: badgeColor(secondsLeft) };
    return Promise.all([
      setBadgeText(details),
      setBadgeBackgroundColor(colorDetails)
    ]).catch((err) => log("badge update failed", err && err.message ? err.message : String(err)));
  }

  function clearTimerBadge(tabId) {
    const details = typeof tabId === "number" ? { tabId, text: "" } : { text: "" };
    return setBadgeText(details).catch((err) => log("badge clear failed", err && err.message ? err.message : String(err)));
  }

  function clearTabState(tabId) {
    if (typeof tabId !== "number") return;
    lastTimerAtByTabId.delete(tabId);
    badgeAnchorByTabId.delete(tabId);
    clearTimerBadge(tabId);
  }

  function handleSessionTimer(message, sender, sendResponse) {
    const secondsLeft = Number(message && message.secondsLeft);
    const tabId = sender && sender.tab && sender.tab.id;
    if (!Number.isFinite(secondsLeft) || secondsLeft < 0 || secondsLeft > 24 * 60 * 60) {
      if (sendResponse) sendResponse({ ok: false, error: "invalid secondsLeft" });
      return false;
    }
    if (shouldIgnoreSessionTimer(message, sender, tabId, secondsLeft)) {
      if (sendResponse) sendResponse({ ok: true, ignored: true, reason: "stale-or-subframe-timer" });
      return false;
    }
    if (typeof tabId === "number") lastTimerAtByTabId.set(tabId, Date.now());
    resetBadgeAnchor(tabId, secondsLeft, message && message.source);
    setTimerBadge(tabId, secondsLeft);
    if (sendResponse) sendResponse({ ok: true });
    return false;
  }

  async function openFallbackPopup(rawUrl, openerUrl, reason) {
    const url = normalizeAndValidateUrl(rawUrl, openerUrl);
    const now = Date.now();
    const last = lastOpenAtByUrl.get(url) || 0;
    if (now - last < OPEN_COOLDOWN_MS) {
      log("fallback popup skipped by cooldown", { reason: String(reason || "cooldown") });
      return { ok: true, skipped: true, reason: "cooldown" };
    }
    lastOpenAtByUrl.set(url, now);

    const created = await createWindow({ url, type: "popup", focused: false, width: 560, height: 420 });
    if (created && typeof created.id === "number") rememberFallbackWindow(created.id);
    log("fallback popup opened", { windowId: created && created.id, reason: String(reason || "") });
    return { ok: true, skipped: false, windowId: created && created.id };
  }

  function handleExtendClicked(message, sender, sendResponse) {
    const windowId = sender && sender.tab && sender.tab.windowId;
    const tabId = sender && sender.tab && sender.tab.id;
    const secondsLeft = Number(message && message.secondsLeft);
    const badgeSeconds = Number.isFinite(secondsLeft) && secondsLeft > 0 ? secondsLeft : 30 * 60;
    if (typeof tabId === "number") {
      lastTimerAtByTabId.set(tabId, Date.now());
      resetBadgeAnchor(tabId, badgeSeconds, "extend-clicked");
      setTimerBadge(tabId, badgeSeconds);
    }
    const shouldCloseKnownSessionPopup = senderLooksLikeKnownSessionPopup(sender);
    if (typeof windowId !== "number" || (!fallbackWindowIds.has(windowId) && !shouldCloseKnownSessionPopup)) {
      if (sendResponse) sendResponse({ ok: true, closed: false, reason: "not-fallback-window" });
      return false;
    }
    setTimeout(() => {
      removeWindow(windowId)
        .then(() => {
          fallbackWindowIds.delete(windowId);
          log("closed fallback popup after extend click", { windowId });
        })
        .catch((err) => log("fallback popup close failed", err && err.message ? err.message : String(err)));
    }, CLOSE_AFTER_CLICK_MS);
    if (sendResponse) sendResponse({ ok: true, closed: true, windowId });
    return false;
  }

  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return undefined;
      if (
        (
          message.type === MSG_OPEN_BLOCKED_POPUP ||
          message.type === MSG_EXTEND_CLICKED ||
          message.type === MSG_SESSION_TIMER ||
          message.type === MSG_CLEAR_SESSION_BADGE
        ) &&
        !senderLooksAllowed(sender)
      ) {
        if (sendResponse) sendResponse({ ok: false, error: "sender rejected" });
        return false;
      }
      if (message.type === MSG_OPEN_BLOCKED_POPUP) {
        openFallbackPopup(message.url, message.openerUrl, message.reason)
          .then((result) => sendResponse && sendResponse(result))
          .catch((err) => {
            const errorMessage = err && err.message ? err.message : String(err);
            log("fallback popup failed", errorMessage);
            if (sendResponse) sendResponse({ ok: false, error: errorMessage });
          });
        return true;
      }
      if (message.type === MSG_EXTEND_CLICKED) return handleExtendClicked(message, sender, sendResponse);
      if (message.type === MSG_SESSION_TIMER) return handleSessionTimer(message, sender, sendResponse);
      if (message.type === MSG_CLEAR_SESSION_BADGE) {
        clearTabState(sender && sender.tab && sender.tab.id);
        if (sendResponse) sendResponse({ ok: true });
        return false;
      }
      return undefined;
    });
  }

  if (api && api.tabs && api.tabs.onUpdated && api.tabs.onUpdated.addListener) {
    api.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo && (changeInfo.status === "loading" || changeInfo.url)) clearTabState(tabId);
    });
  }

  if (api && api.tabs && api.tabs.onRemoved && api.tabs.onRemoved.addListener) {
    api.tabs.onRemoved.addListener((tabId) => {
      lastTimerAtByTabId.delete(tabId);
      badgeAnchorByTabId.delete(tabId);
    });
  }

  if (api && api.windows && api.windows.onRemoved && api.windows.onRemoved.addListener) {
    api.windows.onRemoved.addListener((windowId) => fallbackWindowIds.delete(windowId));
  }

  setInterval(() => {
    const now = Date.now();
    for (const [tabId, at] of lastTimerAtByTabId) {
      if (now - at > BADGE_STALE_MS) {
        lastTimerAtByTabId.delete(tabId);
        badgeAnchorByTabId.delete(tabId);
        clearTimerBadge(tabId);
      }
    }
  }, BADGE_STALE_MS);

  log("background loaded");
})();
