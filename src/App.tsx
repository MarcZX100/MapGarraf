import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  BusFront,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  LocateFixed,
  Maximize2,
  Moon,
  MapPinned,
  MapPin,
  Minimize2,
  Navigation,
  Radio,
  RefreshCw,
  Signal,
  Sun,
  Users,
  X,
} from "lucide-react";
import { applyTheme, currentTheme, hasSavedTheme, saveTheme, type Theme } from "./theme";
import RouteMap, { type BusReport } from "./RouteMap";
import { directionLabel, officialScheduleUrl, officialTariffUrl, publishedPdfUrl, stops, timetables, type Direction } from "./data";
import { getReportStatus } from "./reportStatus";

type Occupancy = "low" | "medium" | "high" | null;
type ShareSession = { id: string; token: string };
type Draft = { departureTime: string; vehicleLabel: string; occupancy: Occupancy; delayMinutes: number | null };
type MapReport = BusReport & { supportCount: number; containsOwn: boolean };
type ApiError = Error & { status?: number };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const initialDraft: Draft = { departureTime: "", vehicleLabel: "", occupancy: null, delayMinutes: null };

export default function App() {
  const [direction, setDirection] = useState<Direction>("to-tarragona");
  const [reports, setReports] = useState<BusReport[]>([]);
  const [shareState, setShareState] = useState<"idle" | "requesting" | "sharing">("idle");
  const [myReportId, setMyReportId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [notice, setNotice] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleStopIndex, setScheduleStopIndex] = useState(0);
  const [showStops, setShowStops] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [followMapBus, setFollowMapBus] = useState(true);
  const [trackedMapBusId, setTrackedMapBusId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const mapExpandButtonRef = useRef<HTMLButtonElement>(null);
  const mapCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<ShareSession | null>(null);
  const watchRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const latestPositionRef = useRef<GeolocationPosition | null>(null);
  const creatingRef = useRef(false);
  const updatingLocationRef = useRef(false);
  const queuedPositionRef = useRef<GeolocationPosition | null>(null);
  const lastSentAtRef = useRef(0);
  const lastSentPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const draftRef = useRef(draft);
  const directionRef = useRef(direction);
  draftRef.current = draft;
  directionRef.current = direction;

  const fetchReports = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingReports(true);
    try {
      const query = new URLSearchParams({ direction: directionRef.current });
      const response = await fetch(`/api/vehicles?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { reports: BusReport[] };
      setReports(data.reports);
    } catch {
      if (!quiet) setNotice("No se pudo actualizar el mapa. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      if (!quiet) setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    void fetchReports();
    const timer = window.setInterval(() => void fetchReports(true), 15_000);
    return () => window.clearInterval(timer);
  }, [direction, fetchReports]);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (hasSavedTheme()) return;
      const next = event.matches ? "dark" : "light";
      applyTheme(next);
      setTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }

  const setDraftValue = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const activeReports = useMemo(
    () => aggregateReports(reports.filter((report) => report.direction === direction), myReportId),
    [reports, direction, myReportId],
  );
  const trackedMapReport = activeReports.find((report) => report.id === trackedMapBusId) ?? activeReports[0] ?? null;
  const currentDirection = timetables[direction];
  const selectedStopTimes = currentDirection.departures.map((time) => shiftClock(time, currentDirection.stopOffsets[scheduleStopIndex] || 0));

  useEffect(() => {
    if (!mapExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => mapCloseButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => mapExpandButtonRef.current?.focus());
    };
  }, [mapExpanded]);

  useEffect(() => {
    if (mapExpanded && !trackedMapBusId && activeReports.length) {
      setTrackedMapBusId(activeReports[0].id);
      setFollowMapBus(true);
    }
  }, [activeReports, mapExpanded, trackedMapBusId]);

  async function sendPosition(position: GeolocationPosition, force = false) {
    latestPositionRef.current = position;
    if (creatingRef.current || updatingLocationRef.current) {
      queuedPositionRef.current = position;
      return;
    }
    const now = Date.now();
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const previous = lastSentPointRef.current;
    if (!force && now - lastSentAtRef.current < 15_000 && previous && distanceMeters(previous.lat, previous.lng, lat, lng) < 35) return;

    const currentDraft = draftRef.current;
    const payload = {
      latitude: lat,
      longitude: lng,
      accuracy: Math.round(position.coords.accuracy),
      departureTime: currentDraft.departureTime || null,
      vehicleLabel: currentDraft.vehicleLabel.trim() || null,
      occupancy: currentDraft.occupancy,
      delayMinutes: currentDraft.delayMinutes,
    };

    if (!sessionRef.current) {
      creatingRef.current = true;
      try {
        const response = await fetch("/api/vehicles", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...payload, direction: directionRef.current }),
        });
        if (!response.ok) throw await responseError(response);
        const data = (await response.json()) as { report: BusReport; shareToken: string };
        const session = { id: data.report.id, token: data.shareToken };
        sessionRef.current = session;
        setMyReportId(session.id);
        setShareState("sharing");
        setNotice("Ubicación compartida. Deja esta pantalla abierta mientras viajas.");
        lastSentAtRef.current = Date.now();
        lastSentPointRef.current = { lat, lng };
        setReports((current) => [data.report, ...current.filter((item) => item.id !== data.report.id)]);
      } catch (error) {
        setShareState("idle");
        if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
        if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        setNotice(errorMessage(error, "No se pudo publicar la ubicación. Se volverá a intentar."));
      } finally {
        creatingRef.current = false;
        const queued = queuedPositionRef.current;
        queuedPositionRef.current = null;
        if (queued && sessionRef.current) void sendPosition(queued, true);
      }
      return;
    }

    updatingLocationRef.current = true;
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(sessionRef.current.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-share-token": sessionRef.current.token,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { report: BusReport };
      lastSentAtRef.current = Date.now();
      lastSentPointRef.current = { lat, lng };
      setReports((current) => [data.report, ...current.filter((item) => item.id !== data.report.id)]);
      setShareState("sharing");
      setNotice("");
    } catch (error) {
      if ((error as ApiError).status === 404) {
        sessionRef.current = null;
        setMyReportId(null);
      }
      setNotice(errorMessage(error, "No se pudo actualizar la posición. Comprueba la conexión."));
    } finally {
      updatingLocationRef.current = false;
      const queued = queuedPositionRef.current;
      queuedPositionRef.current = null;
      if (queued) void sendPosition(queued, true);
    }
  }

  function startSharing() {
    setNotice("");
    if (!("geolocation" in navigator)) {
      setNotice("Este navegador no ofrece geolocalización. Abre la web en Safari o Chrome con conexión segura.");
      return;
    }
    if (watchRef.current !== null) return;
    latestPositionRef.current = null;
    lastSentAtRef.current = 0;
    lastSentPointRef.current = null;
    setShareState("requesting");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setShareState(sessionRef.current ? "sharing" : "requesting");
        void sendPosition(position);
      },
      (error) => {
        watchRef.current = null;
        if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        latestPositionRef.current = null;
        setShareState("idle");
        const message = error.code === error.PERMISSION_DENIED
          ? "Has bloqueado la ubicación. Actívala en los ajustes del navegador si quieres compartir el bus."
          : error.code === error.TIMEOUT
            ? "El GPS está tardando. Sal al exterior e inténtalo de nuevo."
            : "No se pudo obtener la ubicación. Comprueba los permisos y vuelve a intentarlo.";
        setNotice(message);
      },
      { enableHighAccuracy: true, maximumAge: 8_000, timeout: 20_000 },
    );
    heartbeatRef.current = window.setInterval(() => {
      const latest = latestPositionRef.current;
      if (latest && Date.now() - latest.timestamp < 45_000) void sendPosition(latest, true);
    }, 30_000);
  }

  async function stopSharing() {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    latestPositionRef.current = null;
    lastSentAtRef.current = 0;
    lastSentPointRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    setShareState("idle");
    setMyReportId(null);
    setReports((current) => current.filter((report) => report.id !== session?.id));
    if (session) {
      try {
        const response = await fetch(`/api/vehicles/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
          headers: { "x-share-token": session.token },
        });
        setNotice(response.ok || response.status === 404
          ? "Has dejado de compartir y la señal se ha retirado del mapa."
          : "Has dejado de enviar ubicación. La última señal desaparecerá del mapa en un máximo de 3 min.");
      } catch {
        setNotice("Has dejado de enviar ubicación. Sin conexión, la última señal desaparecerá del mapa en un máximo de 3 min.");
      }
    } else {
      setNotice("Has dejado de compartir.");
    }
  }

  async function updateReport(fields: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...fields }));
    const session = sessionRef.current;
    if (!session) return;
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-share-token": session.token },
        body: JSON.stringify({
          departureTime: fields.departureTime,
          vehicleLabel: fields.vehicleLabel?.trim() || fields.vehicleLabel,
          occupancy: fields.occupancy,
          delayMinutes: fields.delayMinutes,
        }),
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { report: BusReport };
      setReports((current) => [data.report, ...current.filter((report) => report.id !== data.report.id)]);
    } catch (error) {
      setNotice(errorMessage(error, "No se pudo actualizar este dato; la ubicación sigue compartiéndose."));
    }
  }

  async function chooseDirection(next: Direction) {
    if (shareState !== "idle" || next === direction) return;
    setDirection(next);
    setScheduleStopIndex(0);
    setNotice("");
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    setShowInstallHelp(true);
  }

  function openExpandedMap() {
    setTrackedMapBusId(activeReports[0]?.id ?? null);
    setFollowMapBus(activeReports.length > 0);
    setMapExpanded(true);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="MapGarraf, inicio">
          <span className="brand-mark"><BusFront size={19} strokeWidth={2.4} /></span>
          <span><strong>MapGarraf</strong><small>BUSGARRAF · COMUNIDAD</small></span>
        </a>
        <div className="topbar-actions">
          <button className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="icon-button install-button" onClick={() => void installApp()} aria-label="Instalar aplicación"><Download size={19} /></button>
          <button className="icon-button" onClick={() => void fetchReports()} aria-label="Actualizar buses"><RefreshCw size={18} className={loadingReports ? "spin" : ""} /></button>
        </div>
      </header>

      <main id="inicio" className="main-content">
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-dot" />TARRAGONA ↔ VILANOVA I LA GELTRÚ</div>
          <h1>El bus, un poco<br /><span>más cerca.</span></h1>
          <p>Ubicaciones compartidas por viajeros. Mira el recorrido y ayuda a la siguiente persona.</p>
        </section>

        <section className="direction-card" aria-label="Selecciona el sentido del viaje">
          <div className="section-kicker"><ArrowDownUp size={15} /> ¿Hacia dónde vas?</div>
          <div className="direction-switch">
            <button className={direction === "to-tarragona" ? "selected" : ""} aria-pressed={direction === "to-tarragona"} disabled={shareState !== "idle"} onClick={() => void chooseDirection("to-tarragona")}>
              <span>Vilanova</span><span className="direction-arrow">→</span><span>Tarragona</span>
            </button>
            <button className={direction === "to-vilanova" ? "selected" : ""} aria-pressed={direction === "to-vilanova"} disabled={shareState !== "idle"} onClick={() => void chooseDirection("to-vilanova")}>
              <span>Tarragona</span><span className="direction-arrow">→</span><span>Vilanova</span>
            </button>
          </div>
        </section>

        <section className={`share-card ${shareState === "sharing" ? "is-sharing" : ""}`}>
          <div className="share-copy">
            <span className="share-icon"><LocateFixed size={19} /></span>
            <div>
              <strong>{shareState === "sharing" ? "Estás compartiendo" : shareState === "requesting" ? "Buscando tu ubicación…" : "¿Ya vas en el bus?"}</strong>
              <span>{shareState === "sharing" ? "Solo mientras mantengas la pantalla abierta." : "Con un toque, avisa al resto de viajeros."}</span>
            </div>
          </div>
          <p className="location-privacy">Al compartir, tu GPS exacto se muestra públicamente como posición del bus. Las señales desaparecen del mapa tras 3 min sin actualización y se borran del servidor en 24 h.</p>
          {shareState === "sharing" ? (
            <button className="share-button stop-button" onClick={() => void stopSharing()}><X size={18} /> Dejar de compartir</button>
          ) : (
            <button className="share-button" onClick={startSharing} disabled={shareState === "requesting"}>
              {shareState === "requesting" ? <><span className="button-spinner" /> Esperando GPS</> : <><Navigation size={17} fill="currentColor" /> Compartir este bus</>}
            </button>
          )}
          <details className="privacy-details">
            <summary>Privacidad y seguridad</summary>
            <p>Solo enviamos ubicación tras pulsar compartir y aceptar el permiso del navegador. El punto y los detalles opcionales son visibles para quien abra el mapa; no se crea una cuenta ni guardamos un historial de trayectos. Si cierras la app sin detenerlo, el punto deja de mostrarse al cabo de 3 min y se borra del servidor en un máximo de 24 h. El mapa solicita imágenes de OpenStreetMap, pero no le enviamos tu GPS. Úsalo como pasajero, nunca mientras conduces.</p>
          </details>
          <button className="options-toggle" aria-expanded={showOptions} onClick={() => setShowOptions((value) => !value)}>
            {showOptions ? "Ocultar opciones" : "Identificar el bus o añadir detalles"}<ChevronDown size={15} className={showOptions ? "rotate" : ""} />
          </button>
          {showOptions && (
            <div className="extra-options">
              <label>Salida aproximada<input type="time" value={draft.departureTime} onChange={(event) => {
                const value = event.target.value;
                setDraftValue("departureTime", value);
                if (sessionRef.current) void updateReport({ departureTime: value });
              }} /></label>
              <label>N.º del bus (opcional)<input type="text" inputMode="numeric" maxLength={30} placeholder="Ej. 204" value={draft.vehicleLabel} onChange={(event) => setDraftValue("vehicleLabel", event.target.value)} onBlur={() => {
                if (sessionRef.current) void updateReport({ vehicleLabel: draftRef.current.vehicleLabel });
              }} /></label>
              <fieldset>
                <legend>¿Cuánta gente lleva?</legend>
                <div className="choice-row">
                  <Choice selected={draft.occupancy === "low"} onClick={() => void updateReport({ occupancy: draft.occupancy === "low" ? null : "low" })}>Hay sitio</Choice>
                  <Choice selected={draft.occupancy === "medium"} onClick={() => void updateReport({ occupancy: draft.occupancy === "medium" ? null : "medium" })}>Normal</Choice>
                  <Choice selected={draft.occupancy === "high"} onClick={() => void updateReport({ occupancy: draft.occupancy === "high" ? null : "high" })}>Lleno</Choice>
                </div>
              </fieldset>
              <label>Retraso aproximado<select value={draft.delayMinutes ?? ""} onChange={(event) => {
                const value = event.target.value === "" ? null : Number(event.target.value);
                void updateReport({ delayMinutes: value });
              }}>
                <option value="">Sin dato</option><option value="0">Va en hora</option><option value="5">+5 min</option><option value="10">+10 min</option><option value="15">+15 min</option><option value="20">+20 min o más</option>
              </select></label>
              <p className="privacy-note"><Signal size={14} /> Estos datos son voluntarios; no pedimos cuenta ni guardamos tu nombre.</p>
            </div>
          )}
        </section>

        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}

        <section className="map-section" aria-labelledby="map-title">
          <div className="section-heading">
            <div><div className="section-kicker"><MapPinned size={15} /> MAPA DEL RECORRIDO</div><h2 id="map-title">{directionLabel[direction]}</h2></div>
            <span className="distance-badge">≈ 50 km · 1 h 15</span>
          </div>
          {mapExpanded && <div className="map-scrim" aria-hidden="true" onClick={() => setMapExpanded(false)} />}
          <div
            className={`map-card${mapExpanded ? " map-card--expanded" : ""}`}
            role={mapExpanded ? "dialog" : undefined}
            aria-modal={mapExpanded || undefined}
            aria-labelledby={mapExpanded ? "map-expanded-title" : undefined}
            tabIndex={mapExpanded ? -1 : undefined}
          >
            {!mapExpanded ? (
              <button ref={mapExpandButtonRef} className="map-expand-button" onClick={openExpandedMap} aria-expanded={false}>
                <Maximize2 size={16} /><span>Ampliar mapa</span>
              </button>
            ) : (
              <div className="map-expanded-toolbar">
                <div className={`map-live-summary${trackedMapReport ? " has-live-report" : ""}`} aria-live="polite">
                  <span className="map-live-indicator" />
                  <span>
                    <strong id="map-expanded-title">{trackedMapReport ? (trackedMapReport.vehicleLabel ? `Bus ${trackedMapReport.vehicleLabel}` : "Bus compartido") : "Recorrido completo"}</strong>
                    <small>{trackedMapReport ? `${trackedMapReport.ageSeconds < 60 ? "ahora" : `hace ${Math.floor(trackedMapReport.ageSeconds / 60)} min`} · ${getReportStatus(trackedMapReport.delayMinutes).label}${followMapBus ? " · siguiéndolo" : ""}` : "Sin buses activos; se muestra toda la ruta."}</small>
                  </span>
                </div>
                <div className="map-expanded-actions">
                  {activeReports.length > 1 && (
                    <select
                      className="map-bus-select"
                      value={trackedMapReport?.id ?? ""}
                      aria-label="Elige el autobús que quieres seguir"
                      onChange={(event) => {
                        setTrackedMapBusId(event.target.value);
                        setFollowMapBus(true);
                      }}
                    >
                      {activeReports.map((report, index) => <option key={report.id} value={report.id}>{report.vehicleLabel ? `Bus ${report.vehicleLabel}` : `Bus compartido ${index + 1}`}</option>)}
                    </select>
                  )}
                  {trackedMapReport && (
                    <button className={`map-follow-toggle${followMapBus ? " is-following" : ""}`} aria-pressed={followMapBus} onClick={() => setFollowMapBus((value) => !value)}>
                      <LocateFixed size={15} />{followMapBus ? "Siguiendo" : "Seguir bus"}
                    </button>
                  )}
                  <button ref={mapCloseButtonRef} className="map-close-button" aria-label="Cerrar mapa ampliado" onClick={() => setMapExpanded(false)}><Minimize2 size={18} /></button>
                </div>
              </div>
            )}
            <RouteMap
              direction={direction}
              stops={stops}
              reports={activeReports}
              expanded={mapExpanded}
              followBus={followMapBus}
              followReportId={trackedMapReport?.id ?? null}
            />
            <div className="map-legend"><span className="legend-bus"><BusFront size={13} /></span><span>Posición compartida</span><span className="legend-status legend-status--on-time" /><span>En hora</span><span className="legend-status legend-status--late" /><span>Retraso</span><span className="legend-status legend-status--unknown" /><span>Sin dato</span><span className="legend-stop" /><span>Parada</span></div>
          </div>
          <p className="map-footnote">El color resume el retraso comunicado por viajeros; «Sin dato» no significa que vaya tarde. Las 16 paradas usan ubicaciones de datos públicos; toca un punto para ver su nombre. El trazado sigue las calles entre paradas; no es una posición GPS oficial.</p>
        </section>

        <section className="reports-section">
          <div className="section-heading report-heading">
            <div><div className="section-kicker"><Radio size={15} /> AHORA EN LA RUTA</div><h2>{activeReports.length ? `${activeReports.length} ${activeReports.length === 1 ? "señal activa" : "señales activas"}` : "Aún no hay buses"}</h2></div>
            <span className={`live-pill ${activeReports.length ? "live" : ""}`}><i />{activeReports.length ? "EN VIVO" : "COMUNIDAD"}</span>
          </div>
          {activeReports.length ? (
            <div className="report-list">
              {activeReports.map((report) => <ReportCard key={report.id} report={report} own={report.containsOwn} />)}
            </div>
          ) : (
            <div className="empty-state"><span className="empty-icon"><BusFront size={21} /></span><div><strong>Sé la primera señal</strong><p>Si ya estás a bordo, comparte la ubicación del bus para ayudar a quienes esperan.</p></div></div>
          )}
        </section>

        <section className="info-grid">
          <button className={`info-tile ${showSchedule ? "tile-open" : ""}`} onClick={() => setShowSchedule((value) => !value)} aria-expanded={showSchedule}>
            <span className="tile-icon"><Clock3 size={19} /></span><span><strong>Horarios</strong><small>Laborables · consulta orientativa</small></span><ChevronDown size={17} className={showSchedule ? "rotate" : ""} />
          </button>
          <button className={`info-tile ${showStops ? "tile-open" : ""}`} onClick={() => setShowStops((value) => !value)} aria-expanded={showStops}>
            <span className="tile-icon"><MapPin size={19} /></span><span><strong>Paradas</strong><small>16 paradas en el recorrido</small></span><ChevronDown size={17} className={showStops ? "rotate" : ""} />
          </button>
        </section>

        {showSchedule && <section className="detail-panel">
          <div className="detail-title"><div><span className="section-kicker">LUNES A VIERNES · DÍAS LABORABLES</span><h3>{currentDirection.start} → {currentDirection.end}</h3></div><Clock3 size={19} /></div>
          <p className="schedule-caption">Salidas publicadas en el PDF del operador (julio de 2025). Hay cambios por temporada, festivos e incidencias; verifica antes de salir.</p>
          <label className="schedule-stop-select">Ver salidas en
            <select value={scheduleStopIndex} onChange={(event) => setScheduleStopIndex(Number(event.target.value))}>
              {currentDirection.stops.map((stop, index) => <option key={`${stop}-${index}`} value={index}>{stop}</option>)}
            </select>
          </label>
          <div className="departure-list">{selectedStopTimes.map((time) => <button key={time} className="departure-chip" onClick={() => {
            setDraftValue("departureTime", time);
            setShowOptions(true);
            document.querySelector(".share-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}>{time}</button>)}</div>
          <p className="last-service">En este documento, la última llegada al destino figura a las {currentDirection.arrivalAtOtherEnd}.</p>
          <div className="source-links"><a href={officialScheduleUrl} target="_blank" rel="noreferrer">Horario actualizado del operador <ExternalLink size={14} /></a><a href={publishedPdfUrl} target="_blank" rel="noreferrer">PDF consultado <ExternalLink size={14} /></a><a href={officialTariffUrl} target="_blank" rel="noreferrer">Tarifas oficiales <ExternalLink size={14} /></a></div>
        </section>}

        {showStops && <section className="detail-panel stops-panel">
          <div className="detail-title"><div><span className="section-kicker">RECORRIDO COMPLETO</span><h3>16 paradas</h3></div><MapPin size={19} /></div>
          <ol className="stops-list">{currentDirection.stops.map((stop, index) => <li key={`${stop}-${index}`}><span className="stop-index">{index + 1}</span><span><strong>{stop}</strong><small>{townForStop(stop)}</small></span></li>)}</ol>
          <p className="map-footnote">Las ubicaciones exactas pueden variar; consulta la web de BusGarraf para confirmar la parada.</p>
        </section>}

        <section className="trust-card"><div className="trust-icon"><Compass size={19} /></div><div><strong>Una herramienta independiente</strong><p>No está afiliada a BusGarraf ni recibe datos del operador. Las posiciones son aportaciones voluntarias y no oficiales.</p></div></section>
        <footer className="page-footer"><span>Hecho para viajar mejor por el Garraf.</span><a href="https://busgarraf.cat/es/" target="_blank" rel="noreferrer">Web oficial <ExternalLink size={13} /></a></footer>
      </main>

      <nav className="bottom-nav" aria-label="Navegación rápida">
        <a className="bottom-link active" href="#map-title"><MapPinned size={18} /><span>Mapa</span></a>
        <button className="bottom-link" onClick={() => {
          setShowSchedule(true);
          window.setTimeout(() => document.querySelector(".detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        }}><Clock3 size={18} /><span>Horarios</span></button>
        <button className="bottom-link" onClick={() => {
          setShowStops(true);
          window.setTimeout(() => document.querySelector(".stops-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
        }}><Users size={18} /><span>Paradas</span></button>
      </nav>

      {showInstallHelp && <div className="dialog-backdrop" role="presentation" onClick={() => setShowInstallHelp(false)}>
        <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
          <button className="dialog-close" onClick={() => setShowInstallHelp(false)} aria-label="Cerrar"><X size={18} /></button>
          <span className="install-dialog-icon"><Download size={22} /></span>
          <h2 id="install-title">Lleva MapGarraf en el móvil</h2>
          {/iphone|ipad|ipod/i.test(navigator.userAgent) ? (
            <p>En Safari, toca <strong>Compartir</strong> y después <strong>Añadir a pantalla de inicio</strong>. Se abrirá como una app.</p>
          ) : (
            <p>En Chrome, abre el menú <strong>⋮</strong> y elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</p>
          )}
          <button className="share-button dialog-action" onClick={() => setShowInstallHelp(false)}>Entendido</button>
        </section>
      </div>}
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`choice ${selected ? "chosen" : ""}`} aria-pressed={selected} onClick={onClick}>{selected && <Check size={13} />}{children}</button>;
}

function ReportCard({ report, own }: { report: MapReport; own: boolean }) {
  const crowd = report.occupancy === "low" ? "Hay sitio" : report.occupancy === "medium" ? "Ocupación normal" : report.occupancy === "high" ? "Lleno" : null;
  const status = getReportStatus(report.delayMinutes);
  const age = report.ageSeconds < 60 ? "ahora" : `hace ${Math.floor(report.ageSeconds / 60)} min`;
  return <article className="report-card">
    <span className="report-bus"><BusFront size={19} /></span>
    <div className="report-main"><div className="report-title"><strong>{report.vehicleLabel ? `Bus ${report.vehicleLabel}` : "Bus en ruta"}{report.supportCount > 1 ? ` · ${report.supportCount} avisos` : ""}</strong>{own && <span className="mine-pill">TU SEÑAL</span>}</div>
      <div className="report-meta"><span><span className="fresh-dot" />{age}</span>{report.departureTime && <span>Salida {report.departureTime}</span>}{report.accuracy !== null && <span>±{Math.round(report.accuracy)} m</span>}</div>
      <div className={`report-timing report-timing--${status.kind}`}><span className="report-timing-dot" /><strong>{status.label}</strong><span className="report-timing-explanation">{status.explanation}</span></div>
      {crowd && <div className="report-tags"><span><Users size={12} />{crowd}</span></div>}
    </div>
  </article>;
}

function aggregateReports(reports: BusReport[], ownId: string | null): MapReport[] {
  const groups: BusReport[][] = [];
  for (const report of [...reports].sort((a, b) => a.ageSeconds - b.ageSeconds)) {
    const group = groups.find((candidate) => {
      const first = candidate[0];
      if (Math.abs(first.ageSeconds - report.ageSeconds) > 45) return false;
      if (first.departureTime && report.departureTime && first.departureTime !== report.departureTime) return false;
      if (first.vehicleLabel && report.vehicleLabel && first.vehicleLabel !== report.vehicleLabel) return false;
      return distanceMeters(first.latitude, first.longitude, report.latitude, report.longitude) < 200;
    });
    if (group) group.push(report);
    else groups.push([report]);
  }
  return groups.map((group) => {
    const freshest = group[0];
    const accuracies = group.map((report) => report.accuracy).filter((value): value is number => value !== null);
    const counts = <T extends string | number>(values: Array<T | null>) => {
      const valid = values.filter((value): value is T => value !== null);
      const tally = new Map<T, number>();
      for (const value of valid) tally.set(value, (tally.get(value) || 0) + 1);
      return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    return {
      ...freshest,
      latitude: group.reduce((total, report) => total + report.latitude, 0) / group.length,
      longitude: group.reduce((total, report) => total + report.longitude, 0) / group.length,
      accuracy: accuracies.length ? Math.round(accuracies.reduce((total, value) => total + value, 0) / accuracies.length) : null,
      vehicleLabel: counts(group.map((report) => report.vehicleLabel)),
      departureTime: counts(group.map((report) => report.departureTime)),
      occupancy: counts(group.map((report) => report.occupancy)),
      delayMinutes: counts(group.map((report) => report.delayMinutes)),
      supportCount: group.length,
      containsOwn: group.some((report) => report.id === ownId),
    };
  });
}

async function responseError(response: Response): Promise<ApiError> {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  const error = new Error(result?.error || `Error de conexión (${response.status}).`) as ApiError;
  error.status = response.status;
  return error;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(a));
}

function shiftClock(time: string, offsetMinutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + offsetMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function townForStop(name: string) {
  const exact = stops.find((stop) => stop.name === name);
  if (exact) return exact.town;
  if (name === "Pobles d’Espanya" || name === "Plaça Eduard Maristany") return "Vilanova i la Geltrú";
  return "";
}
