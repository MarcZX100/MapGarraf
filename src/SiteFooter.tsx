import { Bell, ExternalLink } from "lucide-react";
import { useLanguage } from "./i18n";

export default function SiteFooter({ onShowAnnouncements }: { onShowAnnouncements: () => void }) {
  const { t } = useLanguage();
  return <footer className="page-footer">
    <span>{t("Hecho para viajar mejor por el Garraf.")}</span>
    <nav aria-label={t("Información legal")} className="page-footer-links">
      <button type="button" className="announcement-link" aria-haspopup="dialog" onClick={onShowAnnouncements}><Bell size={12} />{t("Novedades")}</button>
      <a href="/terms.html">{t("Condiciones")}</a>
      <a href="/privacy.html">{t("Privacidad")}</a>
      <a href="/cookies.html">{t("Cookies")}</a>
      <a href="https://busgarraf.cat/es/" target="_blank" rel="noreferrer">{t("Web oficial")} <ExternalLink size={13} /></a>
    </nav>
  </footer>;
}
