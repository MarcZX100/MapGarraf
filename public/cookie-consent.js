(() => {
  const measurementId = "G-QGHZ9BZ1EF";
  const storageKey = "mapgarraf-analytics-consent-v1";
  const consentLifetimeMs = 180 * 24 * 60 * 60 * 1000;
  const disableKey = `ga-disable-${measurementId}`;
  let analyticsInitialized = false;
  let ownAnalyticsStarted = false;
  let heartbeatTimer = 0;
  let lastPageView = "";
  let lastPageViewAt = 0;
  let lastPageViewChoice = null;
  const visitorStorageKey = "mapgarraf-analytics-visitor-v1";
  const sessionStorageKey = "mapgarraf-analytics-session-v1";
  const cookieCopy = {
    es: {
      title: "Tu privacidad importa",
      body: "Si aceptas, usamos analítica detallada y Google Analytics. Si la rechazas, contamos páginas y transiciones entre ellas solo como totales anónimos, sin identificar visitantes ni guardar secuencias individuales. El mapa funciona igual.",
      cookies: "Política de cookies", privacy: "Privacidad", reject: "Solo conteo anónimo", accept: "Aceptar analíticas",
    },
    ca: {
      title: "La teva privacitat ens importa",
      body: "Si acceptes, fem servir analítica detallada i Google Analytics. Si la rebutges, comptem pàgines i transicions entre elles només com a totals anònims, sense identificar visitants ni desar seqüències individuals. El mapa funciona igual.",
      cookies: "Política de galetes", privacy: "Privacitat", reject: "Només recompte anònim", accept: "Accepta l’analítica",
    },
    en: {
      title: "Your privacy matters",
      body: "If you accept, we use detailed analytics and Google Analytics. If you reject them, we count pages and transitions only as anonymous totals, without identifying visitors or storing individual journeys. The map works either way.",
      cookies: "Cookie policy", privacy: "Privacy", reject: "Anonymous counts only", accept: "Accept analytics",
    },
  };

  function currentLanguage() {
    try {
      const selected = localStorage.getItem("mapgarraf-language-v1");
      return selected === "ca" || selected === "en" ? selected : "es";
    } catch { return "es"; }
  }

  window[disableKey] = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  function getChoice() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved || !["accepted", "rejected"].includes(saved.choice)) return null;
      if (Date.now() - saved.updatedAt > consentLifetimeMs) {
        localStorage.removeItem(storageKey);
        clearAnalyticsIdentity(true);
        return null;
      }
      return saved.choice;
    } catch {
      return null;
    }
  }

  function randomId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    if (!window.crypto?.getRandomValues) return "";
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getAnalyticsIds() {
    try {
      let visitor = JSON.parse(localStorage.getItem(visitorStorageKey) || "null");
      if (!visitor?.id || visitor.expiresAt <= Date.now()) {
        visitor = { id: randomId(), expiresAt: Date.now() + consentLifetimeMs };
        if (!visitor.id) return null;
        localStorage.setItem(visitorStorageKey, JSON.stringify(visitor));
      }
      let sessionId = sessionStorage.getItem(sessionStorageKey);
      if (!sessionId) {
        sessionId = randomId();
        if (!sessionId) return null;
        sessionStorage.setItem(sessionStorageKey, sessionId);
      }
      return { visitorId: visitor.id, sessionId };
    } catch { return null; }
  }

  function clearAnalyticsIdentity(anonymize) {
    let visitorId = "";
    try {
      visitorId = JSON.parse(localStorage.getItem(visitorStorageKey) || "null")?.id || "";
      localStorage.removeItem(visitorStorageKey);
      sessionStorage.removeItem(sessionStorageKey);
    } catch { /* Storage may be disabled. */ }
    if (anonymize && visitorId) fetch(`/api/analytics/anonymize/${encodeURIComponent(visitorId)}`, { method: "POST", keepalive: true }).catch(() => undefined);
  }

  function sendOwnEvent(type, path, fromPath = "") {
    if (getChoice() !== "accepted") return;
    if ((path || location.pathname).replace(/\/+$/, "") === "/admin") return;
    const ids = getAnalyticsIds();
    if (!ids) return;
    let referrer = "";
    try { referrer = document.referrer; } catch { /* No referrer. */ }
    const params = new URLSearchParams(location.search);
    const payload = {
      ...ids, type, path: path || location.pathname, fromPath, referrer,
      campaignSource: params.get("utm_source") || "",
      campaignMedium: params.get("utm_medium") || "",
      campaignName: params.get("utm_campaign") || "",
      language: currentLanguage(),
    };
    fetch("/api/analytics/events", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  function trackPageView(path) {
    const choice = getChoice();
    const safePath = String(path || location.pathname).split("?")[0];
    if (safePath.replace(/\/+$/, "") === "/admin") return;
    const now = Date.now();
    const fromPath = lastPageView;
    const duplicate = safePath === lastPageView && now - lastPageViewAt < 3_000 && choice === lastPageViewChoice;
    lastPageView = safePath;
    lastPageViewAt = now;
    lastPageViewChoice = choice;
    if (duplicate || (choice !== "accepted" && choice !== "rejected")) return;
    if (choice === "accepted") sendOwnEvent("pageview", safePath, fromPath);
    else fetch("/api/analytics/anonymous-pageview", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ path: safePath, fromPath }),
    }).catch(() => undefined);
  }

  function stopOwnAnalytics(revoke) {
    ownAnalyticsStarted = false;
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    clearAnalyticsIdentity(revoke);
  }

  function startOwnAnalytics() {
    if (ownAnalyticsStarted || getChoice() !== "accepted" || location.pathname.replace(/\/+$/, "") === "/admin") return;
    ownAnalyticsStarted = true;
    heartbeatTimer = window.setInterval(() => {
      if (getChoice() !== "accepted") {
        stopOwnAnalytics(false);
        return;
      }
      if (document.visibilityState === "visible") sendOwnEvent("heartbeat", location.pathname);
    }, 30_000);
  }

  function clearAnalyticsCookies() {
    const names = document.cookie.split(";").map((entry) => entry.trim().split("=")[0]).filter((name) => name === "_ga" || name.startsWith("_ga_"));
    const hostParts = location.hostname.split(".");
    const domains = [null, location.hostname, `.${location.hostname}`];
    if (hostParts.length > 2) domains.push(`.${hostParts.slice(-2).join(".")}`);
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain ? `; Domain=${domain}` : ""}`;
      }
    }
  }

  function loadAnalytics() {
    window[disableKey] = false;
    window.gtag("consent", "update", { analytics_storage: "granted" });
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: 15_552_000,
    });

    if (!analyticsInitialized) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      script.dataset.mapgarrafAnalytics = "true";
      document.head.appendChild(script);
      analyticsInitialized = true;
    }
  }

  function setChoice(choice) {
    const previousChoice = getChoice();
    try {
      localStorage.setItem(storageKey, JSON.stringify({ choice, updatedAt: Date.now() }));
    } catch {
      // Keep the choice for this page even if browser storage is unavailable.
    }
    if (choice === "accepted") {
      loadAnalytics();
      startOwnAnalytics();
      trackPageView(lastPageView || location.pathname);
    }
    else {
      stopOwnAnalytics(true);
      window[disableKey] = true;
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      clearAnalyticsCookies();
      if (previousChoice !== "accepted") trackPageView(lastPageView || location.pathname);
    }
    document.getElementById("mapgarraf-cookie-banner")?.remove();
    window.dispatchEvent(new CustomEvent("mapgarraf:cookie-consent", { detail: { choice } }));
  }

  function showBanner() {
    const existing = document.getElementById("mapgarraf-cookie-banner");
    if (existing) {
      existing.querySelector("button")?.focus();
      return;
    }

    const banner = document.createElement("section");
    banner.id = "mapgarraf-cookie-banner";
    banner.className = "cookie-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-labelledby", "mapgarraf-cookie-title");
    banner.setAttribute("aria-describedby", "mapgarraf-cookie-description");
    const copy = cookieCopy[currentLanguage()];
    banner.innerHTML = `
      <div class="cookie-consent__copy">
        <strong id="mapgarraf-cookie-title">${copy.title}</strong>
        <p id="mapgarraf-cookie-description">${copy.body}</p>
        <a href="/cookies.html">${copy.cookies}</a>
        <span aria-hidden="true"> · </span>
        <a href="/privacy.html">${copy.privacy}</a>
      </div>
      <div class="cookie-consent__actions">
        <button type="button" data-cookie-choice="rejected">${copy.reject}</button>
        <button type="button" data-cookie-choice="accepted">${copy.accept}</button>
      </div>`;
    banner.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cookie-choice]");
      if (button) setChoice(button.dataset.cookieChoice);
    });
    document.body.appendChild(banner);
    banner.querySelector("button")?.focus({ preventScroll: true });
  }

  window.MapGarrafCookieConsent = { getChoice, setChoice, open: showBanner };
  window.MapGarrafAnalytics = { pageView: trackPageView };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-cookie-settings]");
    if (!link) return;
    event.preventDefault();
    showBanner();
  });

  window.addEventListener("mapgarraf:language-change", () => {
    if (document.getElementById("mapgarraf-cookie-banner")) {
      document.getElementById("mapgarraf-cookie-banner")?.remove();
      showBanner();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ownAnalyticsStarted) sendOwnEvent("heartbeat", location.pathname);
  });
  window.addEventListener("pagehide", () => {
    if (!ownAnalyticsStarted || getChoice() !== "accepted") return;
    const ids = getAnalyticsIds();
    if (!ids || !navigator.sendBeacon) return;
    const payload = JSON.stringify({ ...ids, type: "heartbeat", path: location.pathname, language: currentLanguage() });
    navigator.sendBeacon("/api/analytics/events", new Blob([payload], { type: "application/json" }));
  });

  if (getChoice() === "accepted") {
    loadAnalytics();
    startOwnAnalytics();
  }
  if (!getChoice()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner, { once: true });
    else showBanner();
  }
})();
