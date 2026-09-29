(() => {
  const measurementId = "G-QGHZ9BZ1EF";
  const storageKey = "mapgarraf-analytics-consent-v1";
  const consentLifetimeMs = 180 * 24 * 60 * 60 * 1000;
  const disableKey = `ga-disable-${measurementId}`;
  let analyticsInitialized = false;

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
        return null;
      }
      return saved.choice;
    } catch {
      return null;
    }
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
    try {
      localStorage.setItem(storageKey, JSON.stringify({ choice, updatedAt: Date.now() }));
    } catch {
      // Keep the choice for this page even if browser storage is unavailable.
    }
    if (choice === "accepted") loadAnalytics();
    else {
      window[disableKey] = true;
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      clearAnalyticsCookies();
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
    banner.innerHTML = `
      <div class="cookie-consent__copy">
        <strong id="mapgarraf-cookie-title">Tu privacidad importa</strong>
        <p id="mapgarraf-cookie-description">MapGarraf solo carga Google Analytics si aceptas las cookies analíticas. Nos ayuda a saber cómo se usa la web y mejorarla. El mapa y la ubicación compartida funcionan también si las rechazas.</p>
        <a href="/cookies.html">Política de cookies</a>
        <span aria-hidden="true"> · </span>
        <a href="/privacy.html">Privacidad</a>
      </div>
      <div class="cookie-consent__actions">
        <button type="button" data-cookie-choice="rejected">Rechazar analíticas</button>
        <button type="button" data-cookie-choice="accepted">Aceptar analíticas</button>
      </div>`;
    banner.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cookie-choice]");
      if (button) setChoice(button.dataset.cookieChoice);
    });
    document.body.appendChild(banner);
    banner.querySelector("button")?.focus({ preventScroll: true });
  }

  window.MapGarrafCookieConsent = { getChoice, setChoice, open: showBanner };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-cookie-settings]");
    if (!link) return;
    event.preventDefault();
    showBanner();
  });

  if (getChoice() === "accepted") loadAnalytics();
  if (!getChoice()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner, { once: true });
    else showBanner();
  }
})();
