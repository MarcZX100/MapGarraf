import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminPage from "./AdminPage";
import { LanguageProvider } from "./i18n";
import "leaflet/dist/leaflet.css";
import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>{window.location.pathname.replace(/\/+$/, "") === "/admin" ? <AdminPage /> : <App />}</LanguageProvider>
  </React.StrictMode>,
);
