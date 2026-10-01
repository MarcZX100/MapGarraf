import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, BarChart3, Check, Clock3, Copy, Flag, KeyRound, LayoutDashboard, LogOut, RefreshCw, Search, Shield, Trash2, Users } from "lucide-react";
import BusGarrafIcon from "./BusGarrafIcon";
import { useLanguage } from "./i18n";

type AdminUser = { id: string; username: string; role: "admin" | "moderator" | "analyst"; createdAt?: string };
type CreatedCredential = { username: string; role: AdminUser["role"]; password: string };
type AdminStats = {
  activeVehicles: number;
  liveVehicles: number;
  delayAlerts: number;
  busShares24h: number;
  delayReports24h: number;
  locationPoints24h: number;
  openFlagGroups: number;
};
type AnalyticsBreakdown = { name: string; sessions?: number; visitors?: number; views?: number };
type AudienceAnalytics = {
  retentionDays: number;
  online: { visitors: number; sessions: number; activeWindowSeconds: number };
  visitors: { h24: number; d7: number; d30: number };
  sessions: { h24: number; d7: number; d30: number };
  pageviews: { h24: number; d7: number; d30: number };
  averages: { pagesPerSession: number; avgSessionSeconds: number; onePageSessions: number };
  daily: Array<{ day: string; pageviews: number; visitors: number }>;
  topPages: Array<{ path: string; views: number; visitors: number }>;
  transitions: Array<{ fromPath: string; toPath: string; count: number }>;
  sources: Array<{ source: string; medium: string; sessions: number; visitors: number }>;
  devices: AnalyticsBreakdown[];
  browsers: AnalyticsBreakdown[];
  operatingSystems: AnalyticsBreakdown[];
  languages: AnalyticsBreakdown[];
  hours: Array<{ hour: number; views: number }>;
};
type FlagTargetData = {
  direction?: string;
  departureTime?: string | null;
  delayMinutes?: number | null;
  stage?: "not-arrived" | "in-route";
  latitude?: number;
  longitude?: number;
  ageSeconds?: number;
  lastSeen?: string;
  recordedAt?: number;
} | null;
type AdminFlag = {
  targetType: "vehicle" | "delay";
  targetId: string;
  flagCount: number;
  reasons: string[];
  lastFlagAt: number;
  target: FlagTargetData;
};
type AuditEntry = { action: string; targetType: string; targetId: string; createdAt: string };
type AdminSection = "overview" | "audience" | "moderation" | "team" | "account";

async function readError(response: Response) {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return data?.error || `Error de conexión (${response.status}).`;
}

export default function AdminPage() {
  const { t } = useLanguage();
  const [loginUnlocked, setLoginUnlocked] = useState(false);
  useEffect(() => {
    try {
      const unlocked = window.sessionStorage.getItem("mapgarraf-admin-login-open") === "1";
      window.sessionStorage.removeItem("mapgarraf-admin-login-open");
      setLoginUnlocked(unlocked);
    } catch { setLoginUnlocked(false); }
  }, []);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [analytics, setAnalytics] = useState<AudienceAnalytics | null>(null);
  const [flags, setFlags] = useState<AdminFlag[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [updatedPassword, setUpdatedPassword] = useState("");
  const [confirmUpdatedPassword, setConfirmUpdatedPassword] = useState("");
  const [newRole, setNewRole] = useState<AdminUser["role"]>("moderator");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [flagSearch, setFlagSearch] = useState("");
  const [flagTypeFilter, setFlagTypeFilter] = useState<"all" | "vehicle" | "delay">("all");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/admin/session", { credentials: "same-origin" });
      if (!sessionResponse.ok) {
        setUser(null);
        setLoading(false);
        return;
      }
      const session = await sessionResponse.json() as { user: AdminUser };
      setUser(session.user);
      const [dashboardResponse, flagsResponse, usersResponse, analyticsResponse] = await Promise.all([
        fetch("/api/admin/dashboard", { credentials: "same-origin" }),
        session.user.role !== "analyst" ? fetch("/api/admin/flags", { credentials: "same-origin" }) : Promise.resolve(null),
        session.user.role === "admin" ? fetch("/api/admin/users", { credentials: "same-origin" }) : Promise.resolve(null),
        session.user.role !== "moderator" ? fetch("/api/admin/analytics", { credentials: "same-origin" }) : Promise.resolve(null),
      ]);
      if (!dashboardResponse.ok) throw new Error(await readError(dashboardResponse));
      if (flagsResponse && !flagsResponse.ok) throw new Error(await readError(flagsResponse));
      if (analyticsResponse && !analyticsResponse.ok) throw new Error(await readError(analyticsResponse));
      const dashboard = await dashboardResponse.json() as { stats: AdminStats; audit: AuditEntry[] };
      const moderation = flagsResponse ? await flagsResponse.json() as { flags: AdminFlag[] } : { flags: [] };
      setStats(dashboard.stats);
      setAnalytics(analyticsResponse ? await analyticsResponse.json() as AudienceAnalytics : null);
      setAudit(dashboard.audit);
      setFlags(moderation.flags);
      if (usersResponse?.ok) setAdminUsers((await usersResponse.json() as { users: AdminUser[] }).users);
      setLastUpdatedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("No se pudo cargar el panel."));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void loadDashboard(), 60_000);
    return () => window.clearInterval(timer);
  }, [user, loadDashboard]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { user: AdminUser };
      setUser(data.user);
      setActiveSection(data.user.role === "moderator" ? "moderation" : "overview");
      setPassword("");
      await loadDashboard();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t("No se pudo iniciar sesión."));
    } finally { setSubmitting(false); }
  }

  async function resolveFlag(flag: AdminFlag, action: "dismiss" | "remove") {
    const description = flag.targetType === "vehicle" ? t("ubicación compartida") : t("aviso de retraso");
    const question = action === "remove"
      ? `${t("¿Retirar definitivamente este contenido?")} (${description})`
      : t("¿Marcar este reporte como revisado y quitar la advertencia?");
    if (!window.confirm(question)) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/flags/resolve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ targetType: flag.targetType, targetId: flag.targetId, action }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setMessage(action === "remove" ? t("Contenido retirado.") : t("Reporte revisado."));
      await loadDashboard();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : t("No se pudo resolver el reporte."));
    } finally { setSubmitting(false); }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    setUser(null);
    setStats(null);
    setAnalytics(null);
    setFlags([]);
    setAudit([]);
    setAdminUsers([]);
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: newUsername, role: newRole }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const created = await response.json() as { user: AdminUser; initialPassword: string };
      setNewUsername("");
      setCreatedCredential({ username: created.user.username, role: created.user.role, password: created.initialPassword });
      setMessage(t("Cuenta creada."));
      await loadDashboard();
    } catch (createError) { setError(createError instanceof Error ? createError.message : t("No se pudo crear la cuenta.")); }
    finally { setSubmitting(false); }
  }

  async function copyCreatedCredentials() {
    if (!createdCredential) return;
    const text = `${t("Usuario")}: ${createdCredential.username}\n${t("Rol")}: ${createdCredential.role}\n${t("Contraseña temporal")}: ${createdCredential.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setMessage(t("Credenciales copiadas al portapapeles."));
    } catch {
      setError(t("No se pudo copiar. Selecciona y copia la contraseña manualmente."));
    }
  }

  async function changeOwnPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: updatedPassword, confirmPassword: confirmUpdatedPassword }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setCurrentPassword("");
      setUpdatedPassword("");
      setConfirmUpdatedPassword("");
      setMessage(t("Contraseña actualizada. Se cerraron las demás sesiones de esta cuenta."));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : t("No se pudo cambiar la contraseña."));
    } finally { setSubmitting(false); }
  }

  async function changeUserRole(target: AdminUser, role: AdminUser["role"]) {
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error(await readError(response));
      await loadDashboard();
    } catch (roleError) { setError(roleError instanceof Error ? roleError.message : t("No se pudo cambiar el rol.")); }
  }

  async function removeUser(target: AdminUser) {
    if (!window.confirm(`${t("¿Eliminar la cuenta?")} ${target.username}`)) return;
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(await readError(response));
      await loadDashboard();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : t("No se pudo eliminar la cuenta.")); }
  }

  const metricItems = stats ? [
    [t("Buses en servicio estimado"), stats.activeVehicles],
    [t("Buses con señal reciente"), stats.liveVehicles],
    [t("Avisos de retraso activos"), stats.delayAlerts],
    [t("Comparticiones iniciadas · 24 h"), stats.busShares24h],
    [t("Avisos enviados · 24 h"), stats.delayReports24h],
    [t("Puntos aproximados guardados · 24 h"), stats.locationPoints24h],
    [t("Reportes pendientes"), stats.openFlagGroups],
  ] : [];
  const maxDailyViews = Math.max(1, ...(analytics?.daily.map((day) => day.pageviews) ?? []));
  const maxHourViews = Math.max(1, ...(analytics?.hours.map((hour) => hour.views) ?? []));
  const sections = user ? [
    { id: "overview" as const, label: t("Resumen"), icon: LayoutDashboard },
    ...(user.role !== "moderator" ? [{ id: "audience" as const, label: t("Audiencia"), icon: BarChart3 }] : []),
    ...(user.role !== "analyst" ? [{ id: "moderation" as const, label: t("Moderación"), icon: Flag, count: flags.length }] : []),
    ...(user.role === "admin" ? [{ id: "team" as const, label: t("Equipo"), icon: Users }] : []),
    { id: "account" as const, label: t("Mi cuenta"), icon: KeyRound },
  ] : [];
  const filteredFlags = useMemo(() => {
    const query = flagSearch.trim().toLocaleLowerCase();
    return flags.filter((flag) => {
      if (flagTypeFilter !== "all" && flag.targetType !== flagTypeFilter) return false;
      if (!query) return true;
      const searchable = [flag.targetType, flag.targetId, ...flag.reasons.map((reason) => t(reason)), flag.target?.direction, flag.target?.departureTime]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [flags, flagSearch, flagTypeFilter, t]);

  return <div className="app-shell admin-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("Volver a MapGarraf")}><span className="brand-mark"><BusGarrafIcon size={40} /></span><span><strong>MapGarraf</strong><small>{t("ÁREA ADMINISTRATIVA")}</small></span></a>
      <div className="topbar-actions">{user && <button className="icon-button" type="button" aria-label={t("Cerrar sesión")} title={t("Cerrar sesión")} onClick={() => void logout()}><LogOut size={18} /></button>}<a className="icon-button" href="/" aria-label={t("Volver al sitio")}><ArrowLeft size={18} /></a></div>
    </header>
    <main className="admin-content">
      {!user && loginUnlocked ? <section className="admin-login-card">
        <span className="admin-shield"><Shield size={23} /></span><p className="section-kicker">MAPGARRAF · ADMIN</p><h1>{t("Acceso de administración")}</h1>
        <p>{t("Esta área es privada. Inicia sesión con la cuenta administrativa autorizada.")}</p>
        <form onSubmit={login} className="admin-login-form">
          <label>{t("Usuario")}<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>{t("Contraseña")}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="share-button" type="submit" disabled={submitting}>{submitting ? t("Comprobando…") : t("Entrar")}</button>
        </form>
        {error && <p className="admin-error" role="alert">{error}</p>}
      </section> : user ? <>
        <div className="admin-heading"><div><p className="section-kicker"><Shield size={14} />{t("PANEL PRIVADO")}</p><h1>{t("Administración")}</h1><p>{t("Sesión de")} <strong>{user.username}</strong> · {user.role}</p></div><div className="admin-refresh"><span><i className={loading ? "is-loading" : ""} />{lastUpdatedAt ? `${t("Actualizado")} ${new Date(lastUpdatedAt).toLocaleTimeString()}` : t("Cargando datos")}</span><button className="flag-button" type="button" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw size={15} />{loading ? t("Actualizando…") : t("Actualizar")}</button></div></div>
        <nav className="admin-nav" aria-label={t("Secciones de administración")}>{sections.map(({ id, label, icon: Icon, ...item }) => <button key={id} type="button" className={activeSection === id ? "is-active" : ""} aria-current={activeSection === id ? "page" : undefined} onClick={() => setActiveSection(id)}><Icon size={17} /><span>{label}</span>{"count" in item && item.count != null && item.count > 0 && <b>{item.count}</b>}</button>)}</nav>
        {error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-success" role="status">{message}</p>}
        {activeSection === "overview" && <section className="admin-overview-banner"><div><p className="section-kicker"><Activity size={14} />{t("PULSO DEL SERVICIO")}</p><h2>{t("Actividad de MapGarraf")}</h2><p>{t("Resumen operativo y avisos que requieren atención.")}</p></div><div className="admin-overview-pulse"><span>{t("Buses con señal reciente")}</span><strong>{stats?.liveVehicles ?? "—"}</strong><small><i />{t("actualización automática cada minuto")}</small></div></section>}
        {activeSection === "overview" && <section className="admin-section"><div className="admin-section-title"><div><p className="section-kicker">{t("ACTIVIDAD")}</p><h2>{t("Estadísticas de uso")}</h2></div></div>
          <div className="admin-metrics">{metricItems.map(([label, value]) => <article className="admin-metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
          <p className="admin-note">{t("Son contadores agregados de señales y actividad de la app; no identifican visitantes ni equivalen a visitas únicas.")}</p>
          {user.role !== "analyst" && <div className={`admin-attention ${flags.length ? "has-flags" : "is-clear"}`}><span className="admin-attention-icon">{flags.length ? <AlertTriangle size={19} /> : <Check size={19} />}</span><div><strong>{flags.length ? t("Hay avisos que revisar") : t("No hay avisos pendientes")}</strong><p>{flags.length ? `${flags.length} ${t("reportes comunitarios esperan revisión")}` : t("La cola de moderación está al día.")}</p></div><button className="admin-text-action" type="button" onClick={() => setActiveSection("moderation")}>{t("Abrir moderación")}<ArrowLeft size={14} /></button></div>}
        </section>}
        {activeSection === "audience" && analytics && <section className="admin-section admin-audience"><div className="admin-section-title"><div><p className="section-kicker">{t("AUDIENCIA · ANALÍTICA CON CONSENTIMIENTO")}</p><h2>{t("Visitas y audiencia")}</h2></div><span className="admin-live-count"><i />{analytics.online.visitors} {t("navegadores activos")}</span></div>
          <p className="admin-note">{t("Las sesiones, los navegadores únicos y los activos solo reflejan a quienes aceptan la analítica opcional. Las páginas vistas y las visitas diarias también incluyen el conteo anónimo: totales agregados por página y día, sin identificar visitantes ni guardar secuencias individuales. El panel muestra transiciones agregadas entre pares de rutas. Los registros se borran a los 30 días. Activo significa que una página recibió actividad en los últimos 2 minutos.")}</p>
          <div className="admin-audience-periods">{([
            ["24 h", "h24"], ["7 días", "d7"], ["30 días", "d30"],
          ] as const).map(([label, key]) => <article className="admin-period-card" key={key}><h3>{label}</h3><div><span>{t("Navegadores únicos")}</span><strong>{analytics.visitors[key]}</strong></div><div><span>{t("Sesiones")}</span><strong>{analytics.sessions[key]}</strong></div><div><span>{t("Páginas vistas")}</span><strong>{analytics.pageviews[key]}</strong></div></article>)}</div>
          <div className="admin-audience-summary"><span>{t("Media de páginas por sesión")} <strong>{analytics.averages.pagesPerSession}</strong></span><span>{t("Duración estimada media")} <strong>{Math.floor(analytics.averages.avgSessionSeconds / 60)} min</strong></span><span>{t("Sesiones de una página")} <strong>{analytics.averages.onePageSessions}%</strong></span><span>{t("Sesiones activas")}: <strong>{analytics.online.sessions}</strong></span></div>
          <div className="admin-audience-grid">
            <article className="admin-audience-panel admin-chart-panel"><h3>{t("Visitas diarias · 30 días")}</h3><div className="admin-daily-chart" role="img" aria-label={t("Gráfico de páginas vistas por día")}>{analytics.daily.map((day) => <div className="admin-daily-bar" key={day.day} title={`${day.day}: ${day.pageviews} · ${day.visitors} ${t("navegadores")}`}><i style={{ height: `${Math.max(3, day.pageviews / maxDailyViews * 100)}%` }} /><small>{day.day.slice(8)}</small></div>)}</div><div className="admin-chart-legend"><span>{t("Páginas vistas")}</span><span>{t("Número del día")}</span></div></article>
            <article className="admin-audience-panel"><h3>{t("Páginas más vistas · 30 días")}</h3>{analytics.topPages.length ? <ol className="admin-audience-list">{analytics.topPages.map((pageItem) => <li key={pageItem.path}><span>{t(pageItem.path)}</span><strong>{pageItem.views}</strong><small>{pageItem.visitors} {t("navegadores")}</small></li>)}</ol> : <p className="admin-empty">{t("Aún no hay datos analíticos con consentimiento.")}</p>}</article>
            <article className="admin-audience-panel"><h3>{t("Recorridos entre páginas · 30 días")}</h3>{analytics.transitions.length ? <ol className="admin-audience-list">{analytics.transitions.map((transition) => <li key={`${transition.fromPath}:${transition.toPath}`}><span>{t(transition.fromPath)} → {t(transition.toPath)}</span><strong>{transition.count}</strong><small>{t("transiciones anónimas")}</small></li>)}</ol> : <p className="admin-empty">{t("Aún no hay datos analíticos con consentimiento.")}</p>}</article>
            <article className="admin-audience-panel"><h3>{t("Procedencia de las sesiones")}</h3>{analytics.sources.length ? <ol className="admin-audience-list">{analytics.sources.map((source) => <li key={`${source.source}:${source.medium}`}><span>{source.source} / {source.medium}</span><strong>{source.sessions}</strong><small>{source.visitors} {t("navegadores")}</small></li>)}</ol> : <p className="admin-empty">{t("Aún no hay datos analíticos con consentimiento.")}</p>}</article>
            {([[t("Dispositivos"), analytics.devices], [t("Navegadores"), analytics.browsers], [t("Sistemas operativos"), analytics.operatingSystems], [t("Idiomas"), analytics.languages]] as Array<[string, AnalyticsBreakdown[]]>).map(([title, rows]) => <article className="admin-audience-panel" key={title}><h3>{title}</h3><ol className="admin-audience-list">{rows.map((row) => <li key={row.name}><span>{row.name}</span><strong>{row.sessions}</strong><small>{row.visitors} {t("navegadores")}</small></li>)}</ol></article>)}
            <article className="admin-audience-panel admin-hour-panel"><h3>{t("Horas de mayor actividad · UTC")}</h3><div className="admin-hour-chart">{Array.from({ length: 24 }, (_, hour) => { const item = analytics.hours.find((entry) => entry.hour === hour); return <div key={hour} title={`${String(hour).padStart(2, "0")}:00 · ${item?.views ?? 0}`}><i style={{ height: `${Math.max(3, (item?.views ?? 0) / maxHourViews * 100)}%` }} /><small>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</small></div>; })}</div></article>
          </div>
        </section>}
        {activeSection === "account" && <section className="admin-section"><div className="admin-section-title"><div><p className="section-kicker"><KeyRound size={14} />{t("SEGURIDAD DE LA CUENTA")}</p><h2>{t("Cambiar mi contraseña")}</h2></div></div>
          <form className="admin-password-form" onSubmit={(event) => void changeOwnPassword(event)}>
            <label>{t("Contraseña actual")}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label>{t("Nueva contraseña")}<input type="password" minLength={12} autoComplete="new-password" value={updatedPassword} onChange={(event) => setUpdatedPassword(event.target.value)} required /></label>
            <label>{t("Repite la nueva contraseña")}<input type="password" minLength={12} autoComplete="new-password" value={confirmUpdatedPassword} onChange={(event) => setConfirmUpdatedPassword(event.target.value)} required /></label>
            <button className="share-button" type="submit" disabled={submitting}>{submitting ? t("Guardando…") : t("Actualizar contraseña")}</button>
          </form>
          <p className="admin-note">{t("Usa al menos 12 caracteres. Al cambiarla se cerrarán las demás sesiones de esta cuenta.")}</p>
        </section>}
        {activeSection === "team" && user.role === "admin" && <section className="admin-section"><div className="admin-section-title"><div><p className="section-kicker">{t("ACCESO PRIVADO")}</p><h2>{t("Usuarios y roles")}</h2><p>{t("Admin gestiona cuentas; moderator revisa avisos; analyst consulta estadísticas.")}</p></div></div>
          <form className="admin-user-form" onSubmit={createUser}><label>{t("Usuario")}<input minLength={3} maxLength={40} autoComplete="off" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} required /></label><label>{t("Rol")}<select value={newRole} onChange={(event) => setNewRole(event.target.value as AdminUser["role"])}><option value="admin">admin</option><option value="moderator">moderator</option><option value="analyst">analyst</option></select></label><button className="share-button" type="submit" disabled={submitting}>{t("Crear cuenta")}</button></form>
          {createdCredential && <aside className="admin-credential-card" role="status"><div><strong>{t("Contraseña temporal · solo se muestra una vez")}</strong><p>{t("Comparte estas credenciales con la persona titular ahora; no se guardan en el panel.")}</p></div><span>{t("Usuario")}: <strong>{createdCredential.username}</strong> · {t("Rol")}: <strong>{createdCredential.role}</strong></span><label>{t("Contraseña temporal")}<input readOnly value={createdCredential.password} onFocus={(event) => event.currentTarget.select()} /></label><div><button className="flag-button" type="button" onClick={() => void copyCreatedCredentials()}><Copy size={14} />{t("Copiar credenciales")}</button><button className="flag-button" type="button" onClick={() => setCreatedCredential(null)}>{t("Ocultar")}</button></div></aside>}
          <div className="admin-user-list">{adminUsers.map((item) => <article key={item.id}><div><strong>{item.username}</strong><small>{t("Cuenta administrativa")}</small></div><select aria-label={`${t("Rol de")} ${item.username}`} value={item.role} disabled={item.id === user.id} onChange={(event) => void changeUserRole(item, event.target.value as AdminUser["role"])}><option value="admin">admin</option><option value="moderator">moderator</option><option value="analyst">analyst</option></select><button className="admin-remove-button" type="button" aria-label={`${t("Eliminar")} ${item.username}`} disabled={item.id === user.id} onClick={() => void removeUser(item)}><Trash2 size={14} /></button></article>)}</div>
          <p className="admin-note">{t("Los usuarios no tienen registro público. Solo una cuenta admin puede crear cuentas e indicar su rol.")}</p>
        </section>}
        {activeSection === "moderation" && user.role !== "analyst" && <section className="admin-section"><div className="admin-section-title"><div><p className="section-kicker"><AlertTriangle size={14} />{t("REVISIÓN COMUNITARIA")}</p><h2>{t("Avisos reportados")}</h2><p>{t("Revisa señales dudosas y retira contenido cuando corresponda.")}</p></div><span className="admin-count">{flags.length}</span></div>
          <div className="admin-moderation-tools"><label className="admin-search"><Search size={16} /><input type="search" value={flagSearch} onChange={(event) => setFlagSearch(event.target.value)} placeholder={t("Buscar por salida, sentido, ID o motivo")} aria-label={t("Buscar reportes")} /></label><label className="admin-filter"><span>{t("Tipo")}</span><select value={flagTypeFilter} onChange={(event) => setFlagTypeFilter(event.target.value as typeof flagTypeFilter)}><option value="all">{t("Todos los tipos")}</option><option value="vehicle">{t("Ubicaciones de bus")}</option><option value="delay">{t("Avisos de retraso")}</option></select></label><span className="admin-filter-count">{filteredFlags.length} / {flags.length} {t("avisos")}</span></div>
          {loading ? <p className="admin-note">{t("Cargando…")}</p> : filteredFlags.length ? <div className="admin-flag-list">{filteredFlags.map((flag) => <article className="admin-flag-card" key={`${flag.targetType}:${flag.targetId}`}>
            <div className="admin-flag-heading"><div><strong>{t(flag.targetType === "vehicle" ? "Ubicación de bus" : "Aviso de retraso")}</strong><span>{flag.flagCount} {t("reportes comunitarios")}</span></div><time>{new Date(flag.lastFlagAt).toLocaleString()}</time></div>
            {flag.target ? <div className="admin-flag-details"><span>{t("Sentido")}: {t(flag.target.direction === "to-tarragona" ? "Hacia Tarragona" : "Hacia Vilanova")}</span>{flag.target.departureTime && <span>{t("Salida")} {flag.target.departureTime}</span>}{flag.target.delayMinutes !== undefined && <span>{flag.target.delayMinutes === null ? t("Indefinido") : `≈ ${flag.target.delayMinutes} min`}</span>}{flag.target.latitude !== undefined && flag.target.longitude !== undefined && <span>{flag.target.latitude.toFixed(3)}, {flag.target.longitude.toFixed(3)}</span>}</div> : <p className="admin-note">{t("El contenido original ya no está disponible.")}</p>}
            <p className="admin-reasons">{t("Motivos")} · {flag.reasons.map((reason) => t(reason)).join(", ")}</p>
            <div className="admin-flag-actions"><button className="flag-button" type="button" disabled={submitting} onClick={() => void resolveFlag(flag, "dismiss")}><Check size={14} />{t("Revisado")}</button><button className="admin-remove-button" type="button" disabled={submitting} onClick={() => void resolveFlag(flag, "remove")}><Trash2 size={14} />{t("Retirar contenido")}</button></div>
          </article>)}</div> : flags.length ? <p className="admin-empty">{t("Ningún aviso coincide con la búsqueda.")}</p> : <p className="admin-empty">{t("No hay reportes pendientes de revisión.")}</p>}
        </section>}
        {activeSection === "overview" && <section className="admin-section"><div className="admin-section-title"><div><p className="section-kicker"><Clock3 size={14} />{t("TRAZABILIDAD")}</p><h2>{t("Acciones recientes")}</h2></div><button className="admin-text-action" type="button" onClick={() => setActiveSection("moderation")}>{t("Abrir moderación")}<ArrowLeft size={14} /></button></div>{audit.length ? <ol className="admin-audit-list">{audit.slice(0, 8).map((item, index) => <li key={`${item.createdAt}-${index}`}><time>{new Date(item.createdAt).toLocaleString()}</time><span>{t(item.action)} · {t(item.targetType)} · {item.targetId.slice(0, 8)}</span></li>)}</ol> : <p className="admin-empty">{t("Aún no hay acciones administrativas.")}</p>}</section>}
      </> : !loading ? <section className="admin-login-card admin-private-empty"><span className="admin-shield"><Shield size={23} /></span><h1>{t("Área privada")}</h1><p>{t("Esta sección no está disponible.")}</p><a className="flag-button" href="/">{t("Volver a MapGarraf")}</a></section> : <p className="admin-loading">{t("Comprobando sesión…")}</p>}
    </main>
  </div>;
}
