import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  Bell,
  BusFront,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Download,
  Ghost,
  ExternalLink,
  ListOrdered,
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
  Send,
  Sun,
  Users,
  X,
} from "lucide-react";
import { applyTheme, currentTheme, hasSavedTheme, saveTheme, type Theme } from "./theme";
import BusGarrafIcon from "./BusGarrafIcon";
import RouteMap, { type BusReport } from "./RouteMap";
import { directionLabel, officialScheduleUrl, officialTariffUrl, publishedPdfUrl, stops, timetables, type Direction } from "./data";
import { getReportStatus } from "./reportStatus";
import { estimateCurrentPosition, estimateMinutesUntilArrival, estimateRouteStatus, getGhostBuses, ghostsApplyToday, unclaimedGhosts, type GhostBus } from "./ghostBuses";
import { getNextSharedArrival, getNextTheoreticalArrival } from "./stopArrivals";
import LegalPage, { legalKindFromPath } from "./LegalPage";
import { hasConflictingDepartures } from "../shared/reportIdentity.mjs";

type Occupancy = "low" | "medium" | "high" | null;
type ShareSession = { id: string; token: string; deleteToken: string };
type Draft = { departureTime: string; occupancy: Occupancy; reinforcement: boolean };
type MapReport = BusReport & { supportCount: number; containsOwn: boolean };
type DelayStage = "not-arrived" | "in-route";
type DelayReport = { id: string; direction: Direction; departureTime: string; delayMinutes: number | null; stage: DelayStage; createdAt: string };
type DelaySummary = { departureTime: string; stage: DelayStage; delayMinutes: number | null; count: number; createdAt: string };

// The server flags a position as live for 1 minute; older ones are only served so the map can estimate.
const LIVE_REPORT_SECONDS = 60;
const ESTIMATED_REPORT_MATCH_DISTANCE_M = 2_500;
const CURRENT_BUS_COOKIE = "mapgarraf-current-bus";
const PENDING_DELETES_KEY = "mapgarraf-pending-report-deletes-v1";
const SEEN_ANNOUNCEMENTS_KEY = "mapgarraf-seen-announcements-v1";
const SAVED_BUS_COOKIE_GRACE_MS = 24 * 60 * 60_000;
type PendingDelete = { id: string; token: string; expiresAt: number };
type SavedCurrentBus = { direction: Direction; departureTime: string; expiresAt: number; reinforcement: boolean; resumeSharing: boolean };
type ApiError = Error & { status?: number };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const initialDraft: Draft = { departureTime: "", occupancy: null, reinforcement: false };
const ANNOUNCEMENTS = [{
  id: "resume-shared-bus-2026-09-30",
  date: "30 de septiembre de 2026",
  dateTime: "2026-09-30",
  title: "Tu bus compartido se recupera al volver",
  body: "Si cierras o recargas MapGarraf mientras compartes un bus y el viaje sigue activo, al volver se abrirá directamente el mapa de ese mismo bus. La app también intentará reanudar el envío de tu ubicación si el navegador conserva el permiso. Puedes detenerlo cuando quieras con «Dejar de compartir».",
}] as const;

function seenAnnouncementIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_ANNOUNCEMENTS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

function markAnnouncementSeen(id: string) {
  const seen = seenAnnouncementIds();
  if (seen.includes(id)) return;
  try { localStorage.setItem(SEEN_ANNOUNCEMENTS_KEY, JSON.stringify([...seen, id])); } catch { /* The announcement remains available from its link. */ }
}

type Page = 0 | 1 | 2;
const SCHEDULE_PAGE = 0, MAP_PAGE = 1, STOPS_PAGE = 2, PAGE_COUNT = 3;
const DEFAULT_PAGE: Page = SCHEDULE_PAGE;
const PAGE_PATHS: Record<Page, string> = {
  [SCHEDULE_PAGE]: "/horarios",
  [MAP_PAGE]: "/mapa",
  [STOPS_PAGE]: "/paradas",
};

function pageFromPath(pathname: string): Page | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === PAGE_PATHS[SCHEDULE_PAGE]) return SCHEDULE_PAGE;
  if (path === PAGE_PATHS[MAP_PAGE]) return MAP_PAGE;
  if (path === PAGE_PATHS[STOPS_PAGE]) return STOPS_PAGE;
  return null;
}

const NAV_ITEMS = [
  { page: SCHEDULE_PAGE, label: "Horarios", Icon: Clock3 },
  { page: MAP_PAGE, label: "Mapa", Icon: MapPinned },
  { page: STOPS_PAGE, label: "Paradas", Icon: ListOrdered },
] as const satisfies ReadonlyArray<{ page: Page; label: string; Icon: typeof Clock3 }>;
const PAGE_SEO = {
  schedule: { title: "Horarios de BusGarraf Tarragona–Vilanova | MapGarraf", description: "Consulta los horarios publicados del BusGarraf entre Tarragona y Vilanova i la Geltrú, con las salidas por parada." },
  map: { title: "Mapa del BusGarraf Tarragona–Vilanova | MapGarraf", description: "Consulta posiciones compartidas por viajeros, próximas paradas y estimaciones orientativas de llegada del BusGarraf." },
  stops: { title: "Paradas del BusGarraf Tarragona–Vilanova | MapGarraf", description: "Explora las 16 paradas del recorrido BusGarraf entre Tarragona, El Vendrell, Calafell, Cubelles y Vilanova i la Geltrú." },
} as const;
const LEGAL_SEO = {
  terms: { title: "Condiciones de uso | MapGarraf", description: "Condiciones de uso de MapGarraf, herramienta comunitaria independiente para viajeros del BusGarraf." },
  privacy: { title: "Política de privacidad | MapGarraf", description: "Información sobre los datos de ubicación y los avisos comunitarios tratados por MapGarraf." },
  cookies: { title: "Política de cookies | MapGarraf", description: "Información sobre las cookies necesarias y las cookies analíticas opcionales de MapGarraf." },
} as const;

function clearCurrentBusCookie() {
  document.cookie = `${CURRENT_BUS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function readCurrentBusCookie(): SavedCurrentBus | null {
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CURRENT_BUS_COOKIE}=`))?.slice(CURRENT_BUS_COOKIE.length + 1);
  if (!value) return null;
  try {
    const saved = JSON.parse(decodeURIComponent(value)) as Partial<SavedCurrentBus>;
    if ((saved.direction !== "to-tarragona" && saved.direction !== "to-vilanova")
      || typeof saved.departureTime !== "string"
      || !timetables[saved.direction].departures.includes(saved.departureTime)
      || typeof saved.expiresAt !== "number"
      || !Number.isFinite(saved.expiresAt)
      || saved.expiresAt <= Date.now()) {
      clearCurrentBusCookie();
      return null;
    }
    // A selected timetable is only a draft. Restore automatically only after
    // this device has successfully published a live location report.
    if (saved.resumeSharing !== true) {
      clearCurrentBusCookie();
      return null;
    }
    return {
      direction: saved.direction,
      departureTime: saved.departureTime,
      expiresAt: saved.expiresAt,
      reinforcement: saved.reinforcement === true,
      resumeSharing: saved.resumeSharing === true,
    };
  } catch {
    clearCurrentBusCookie();
    return null;
  }
}

function saveCurrentBusCookie(direction: Direction, departureTime: string, reinforcement: boolean, resumeSharing = false): SavedCurrentBus | null {
  const timetable = timetables[direction];
  if (!timetable.departures.includes(departureTime)) return null;
  const [hours, minutes] = departureTime.split(":").map(Number);
  const todayDeparture = new Date();
  todayDeparture.setHours(hours, minutes, 0, 0);
  // Keep the cookie beyond the timetable arrival. A delayed vehicle may still
  // be on the route, which is decided from its last shared position on return.
  const expiresAt = todayDeparture.getTime() + (timetable.stopOffsets.at(-1) ?? 75) * 60_000 + SAVED_BUS_COOKIE_GRACE_MS;
  const maxAge = Math.floor((expiresAt - Date.now()) / 1_000);
  if (maxAge <= 0) {
    clearCurrentBusCookie();
    return null;
  }
  const saved = { direction, departureTime, expiresAt, reinforcement, resumeSharing };
  document.cookie = `${CURRENT_BUS_COOKIE}=${encodeURIComponent(JSON.stringify(saved))}; Max-Age=${maxAge}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return saved;
}

function savedBusHasArrived(saved: SavedCurrentBus, reports: BusReport[], now: Date) {
  const timetable = timetables[saved.direction];
  const [hours, minutes] = saved.departureTime.split(":").map(Number);
  const departure = new Date(now);
  departure.setHours(hours, minutes, 0, 0);
  const scheduledArrival = departure.getTime() + (timetable.stopOffsets.at(-1) ?? 75) * 60_000;
  const report = reports
    .filter((item) => item.direction === saved.direction && item.departureTime === saved.departureTime)
    .sort((a, b) => a.ageSeconds - b.ageSeconds)[0];
  if (report) {
    const ageSeconds = report.ageSeconds + Math.max(0, (now.getTime() - (report.receivedAt ?? now.getTime())) / 1000);
    const remainingMinutes = estimateMinutesUntilArrival(saved.direction, { ...report, ageSeconds });
    if (remainingMinutes !== null) return remainingMinutes <= 0;
  }
  return now.getTime() >= scheduledArrival;
}

function rememberPendingDelete(session: ShareSession) {
  try {
    const current = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || "[]") as PendingDelete[];
    const pending = current.filter((item) => item.id !== session.id);
    pending.push({ id: session.id, token: session.deleteToken, expiresAt: Date.now() + 24 * 60 * 60_000 });
    localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(pending));
  } catch { /* If browser storage is unavailable, server expiry remains the fallback. */ }
}

async function retryPendingDeletes() {
  let pending: PendingDelete[];
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || "[]") as PendingDelete[];
    if (!Array.isArray(pending) || !pending.length) return;
  } catch { return; }
  const remaining: PendingDelete[] = [];
  for (const item of pending) {
    if (!item || typeof item.id !== "string" || typeof item.token !== "string"
      || typeof item.expiresAt !== "number" || item.expiresAt <= Date.now()) continue;
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { "x-delete-token": item.token },
      });
      if (!response.ok && response.status !== 404) remaining.push(item);
    } catch { remaining.push(item); }
  }
  try { localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(remaining)); } catch { /* best effort */ }
}

export default function App() {
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
  const [savedCurrentBus, setSavedCurrentBus] = useState<SavedCurrentBus | null>(() => readCurrentBusCookie());
  const [direction, setDirection] = useState<Direction>(() => savedCurrentBus?.direction ?? "to-tarragona");
  const [reports, setReports] = useState<BusReport[]>([]);
  const [delayReports, setDelayReports] = useState<DelayReport[]>([]);
  const [delayMinutes, setDelayMinutes] = useState<number | null>(10);
  const [delayOpen, setDelayOpen] = useState(false);
  const [delaySubmitting, setDelaySubmitting] = useState(false);
  const [delayNotice, setDelayNotice] = useState("");
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsFetchSucceeded, setReportsFetchSucceeded] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "requesting" | "sharing">("idle");
  const [myReportId, setMyReportId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => savedCurrentBus
    ? { ...initialDraft, departureTime: savedCurrentBus.departureTime, reinforcement: savedCurrentBus.reinforcement }
    : initialDraft);
  const [notice, setNotice] = useState("");
  const [loadingReports, setLoadingReports] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [scheduleStopIndex, setScheduleStopIndex] = useState(0);
  const [expandedStopIndex, setExpandedStopIndex] = useState<number | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [followMapBus, setFollowMapBus] = useState(true);
  const [trackedMapBusId, setTrackedMapBusId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [page, setPage] = useState<Page>(() => {
    const initialRoutePage = pageFromPath(window.location.pathname);
    if (window.location.pathname === "/" && savedCurrentBus?.resumeSharing) return MAP_PAGE;
    return initialRoutePage ?? (savedCurrentBus?.resumeSharing ? MAP_PAGE : DEFAULT_PAGE);
  });
  const pagerRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [showGhosts, setShowGhosts] = useState(loadShowGhosts);

  const mapExpandButtonRef = useRef<HTMLButtonElement>(null);
  const mapCloseButtonRef = useRef<HTMLButtonElement>(null);
  const restoredCurrentBusRef = useRef<string | null>(null);
  const autoShareAttemptedRef = useRef<string | null>(null);
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
  const pageRef = useRef(page);
  const scrollHistoryTimerRef = useRef<number | null>(null);
  pageRef.current = page;
  draftRef.current = draft;
  directionRef.current = direction;

  const fetchReports = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingReports(true);
    try {
      const query = new URLSearchParams({ direction: directionRef.current });
      const response = await fetch(`/api/vehicles?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { reports: BusReport[] };
      const receivedAt = Date.now();
      setReports(data.reports.map((report) => ({ ...report, receivedAt })));
      setReportsFetchSucceeded(true);
    } catch {
      if (!quiet) setNotice("No se pudo actualizar el mapa. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setReportsLoaded(true);
      if (!quiet) setLoadingReports(false);
    }
  }, []);

  const fetchDelayReports = useCallback(async () => {
    try {
      const query = new URLSearchParams({ direction: directionRef.current });
      const response = await fetch(`/api/delays?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("No se pudieron cargar los avisos.");
      const data = (await response.json()) as { reports: DelayReport[] };
      setDelayReports(data.reports);
    } catch { /* The live bus map remains available if delay reports cannot load. */ }
  }, []);

  useEffect(() => {
    void fetchReports();
    const timer = window.setInterval(() => void fetchReports(true), 15_000);
    return () => window.clearInterval(timer);
  }, [direction, fetchReports]);

  useEffect(() => {
    void fetchDelayReports();
    const timer = window.setInterval(() => void fetchDelayReports(), 30_000);
    return () => window.clearInterval(timer);
  }, [direction, fetchDelayReports]);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  useEffect(() => {
    const latest = ANNOUNCEMENTS[0];
    if (seenAnnouncementIds().includes(latest.id)) return;
    markAnnouncementSeen(latest.id);
    setAnnouncementOpen(true);
  }, []);

  useEffect(() => {
    if (!announcementOpen) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementOpen(false);
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [announcementOpen]);

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

  useLayoutEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const snapToPage = () => pager.scrollTo({ left: pager.clientWidth * pageRef.current, behavior: "instant" });
    snapToPage();
    window.addEventListener("resize", snapToPage);
    return () => window.removeEventListener("resize", snapToPage);
  }, []);

  useEffect(() => {
    const restoreLocation = () => {
      const nextPath = window.location.pathname;
      setRoutePath(nextPath);
      const targetPage = pageFromPath(nextPath);
      if (targetPage === null) {
        setMapExpanded(false);
        return;
      }
      setPage(targetPage);
      if (targetPage !== MAP_PAGE) setMapExpanded(false);
      window.requestAnimationFrame(() => {
        const pager = pagerRef.current;
        if (pager) pager.scrollTo({ left: pager.clientWidth * targetPage, behavior: "instant" });
      });
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  function onPagerScroll(event: React.UIEvent<HTMLElement>) {
    const { scrollLeft, clientWidth } = event.currentTarget;
    if (!clientWidth) return;
    const nextPage = Math.min(PAGE_COUNT - 1, Math.max(0, Math.round(scrollLeft / clientWidth))) as Page;
    setPage(nextPage);
    if (scrollHistoryTimerRef.current !== null) window.clearTimeout(scrollHistoryTimerRef.current);
    scrollHistoryTimerRef.current = window.setTimeout(() => {
      const pager = pagerRef.current;
      if (!pager || !pager.clientWidth) return;
      const settledPage = Math.min(PAGE_COUNT - 1, Math.max(0, Math.round(pager.scrollLeft / pager.clientWidth))) as Page;
      const settledPath = PAGE_PATHS[settledPage];
      if (window.location.pathname !== settledPath || window.location.search) {
        window.history.pushState(null, "", settledPath);
        setRoutePath(settledPath);
      }
    }, 180);
  }

  function goToPage(target: Page, historyMode: "push" | "replace" = "push") {
    const nextPath = PAGE_PATHS[target];
    if (window.location.pathname !== nextPath || window.location.search) {
      window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", nextPath);
      setRoutePath(nextPath);
    }
    setPage(target);
    if (target !== MAP_PAGE) setMapExpanded(false);
    const pager = pagerRef.current;
    if (!pager) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pager.scrollTo({ left: pager.clientWidth * target, behavior: reduceMotion ? "instant" : "smooth" });
  }

  const setDraftValue = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  function rememberCurrentBus(departureTime: string, reinforcement = draftRef.current.reinforcement) {
    const sameActiveBus = savedCurrentBus?.resumeSharing === true
      && savedCurrentBus.direction === directionRef.current
      && savedCurrentBus.departureTime === departureTime;
    setSavedCurrentBus(saveCurrentBusCookie(directionRef.current, departureTime, reinforcement, sameActiveBus));
  }

  function setCurrentBusResumeSharing(resumeSharing: boolean) {
    if (!savedCurrentBus) return;
    setSavedCurrentBus(saveCurrentBusCookie(
      savedCurrentBus.direction,
      savedCurrentBus.departureTime,
      savedCurrentBus.reinforcement,
      resumeSharing,
    ));
  }

  const activeReports = useMemo(() => {
    const nowMs = now.getTime();
    const current = reports
      .filter((report) => report.direction === direction)
      .map((report) => ({ ...report, ageSeconds: report.ageSeconds + Math.max(0, (nowMs - (report.receivedAt ?? nowMs)) / 1000) }));
    const tripByReportId = new Map(current.map((report) => [report.id, estimateRouteStatus(direction, report, now).tripDepartureTime]));
    const freshReports = current.filter((report) => report.ageSeconds < LIVE_REPORT_SECONDS);
    const currentWithoutReplacedEstimates = current.filter((report) =>
      report.ageSeconds < LIVE_REPORT_SECONDS || !isReplacedByFreshReport(report, freshReports, direction, tripByReportId),
    );
    return aggregateReports(currentWithoutReplacedEstimates, myReportId, direction, tripByReportId).flatMap((report): MapReport[] => {
      let displayedPosition = { latitude: report.latitude, longitude: report.longitude };
      let estimatedPosition: ReturnType<typeof estimateCurrentPosition> = null;
      if (report.ageSeconds >= LIVE_REPORT_SECONDS) {
        // No fresh GPS: advance the last real position along the timetable instead of leaving a stale dot.
        estimatedPosition = estimateCurrentPosition(direction, report);
        if (!estimatedPosition) return [];
        displayedPosition = { latitude: estimatedPosition.latitude, longitude: estimatedPosition.longitude };
      }
      const timing = estimateRouteStatus(direction, report, now, displayedPosition);
      return [{
        ...report,
        ...(estimatedPosition ? { ...estimatedPosition, accuracy: null, estimated: true } : {}),
        delayMinutes: timing.delayMinutes,
        delayBasis: timing.delayBasis,
        tripDepartureTime: timing.tripDepartureTime,
        nextStop: timing.nextStop ?? estimatedPosition?.nextStop,
        minutesToNextStop: timing.minutesToNextStop,
      }];
    });
  }, [reports, direction, myReportId, now]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const retry = () => { void retryPendingDeletes(); };
    retry();
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, []);

  const ghostsToday = ghostsApplyToday(now);
  const ghosts = useMemo(
    () => (showGhosts ? unclaimedGhosts(
      getGhostBuses(direction, now),
      // An estimate is where the bus is right now, so it counts as a zero-age position.
      activeReports.map((report) => ({ latitude: report.latitude, longitude: report.longitude, departureTime: report.tripDepartureTime ?? report.departureTime, delayMinutes: report.delayMinutes, ageSeconds: report.estimated ? 0 : report.ageSeconds })),
      direction,
      now,
    ) : []),
    [showGhosts, direction, now, activeReports],
  );

  useEffect(() => {
    if (!savedCurrentBus?.resumeSharing || !reportsLoaded) return;
    if (reportsFetchSucceeded && savedBusHasArrived(savedCurrentBus, reports, now)) return;
    const key = `${savedCurrentBus.direction}:${savedCurrentBus.departureTime}:${savedCurrentBus.expiresAt}`;
    if (restoredCurrentBusRef.current === key) return;
    restoredCurrentBusRef.current = key;
    const report = activeReports.find((item) => (item.tripDepartureTime ?? item.departureTime) === savedCurrentBus.departureTime);
    const ghost = ghosts.find((item) => item.departureTime === savedCurrentBus.departureTime);
    const busId = report?.id ?? ghost?.id ?? null;
    setTrackedMapBusId(busId);
    setFollowMapBus(busId !== null);
    setMapExpanded(true);
    goToPage(MAP_PAGE, "replace");
    if (savedCurrentBus.resumeSharing && autoShareAttemptedRef.current !== key) {
      autoShareAttemptedRef.current = key;
      startSharing();
    }
  }, [savedCurrentBus, reportsLoaded, reportsFetchSucceeded, reports, now, activeReports, ghosts]);

  useEffect(() => {
    if (!savedCurrentBus?.resumeSharing) return;
    const hardExpired = now.getTime() >= savedCurrentBus.expiresAt;
    const arrived = reportsFetchSucceeded && savedBusHasArrived(savedCurrentBus, reports, now);
    if (!hardExpired && !arrived) return;
    clearCurrentBusCookie();
    setSavedCurrentBus(null);
    restoredCurrentBusRef.current = null;
    setDraft((current) => current.departureTime === savedCurrentBus.departureTime
      ? { ...current, departureTime: "", reinforcement: false }
      : current);
    setTrackedMapBusId(null);
    setMapExpanded(false);
    setNotice(hardExpired && !arrived
      ? "El trayecto guardado ha caducado y se ha cancelado."
      : "El bus guardado ya ha llegado, según el horario o la estimación de su última posición compartida.");
    if (sessionRef.current) void stopSharing(true);
  }, [savedCurrentBus, reports, reportsFetchSucceeded, now]);

  function toggleGhosts() {
    const next = !showGhosts;
    setShowGhosts(next);
    try { localStorage.setItem(SHOW_GHOSTS_KEY, next ? "1" : "0"); } catch { /* preference lasts only for this visit */ }
  }

  function claimGhostTrip(ghost: GhostBus) {
    setDraftValue("departureTime", ghost.departureTime);
    rememberCurrentBus(ghost.departureTime);
    setShowOptions(true);
    window.setTimeout(() => document.querySelector(".share-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  const trackedGhost = ghosts.find((ghost) => ghost.id === trackedMapBusId) ?? null;
  const trackedMapReport = trackedGhost ? null : (activeReports.find((report) => report.id === trackedMapBusId) ?? activeReports[0] ?? null);
  const currentDirection = timetables[direction];
  const delaySummaries = useMemo(() => {
    const groups = new Map<string, DelayReport[]>();
    const cutoff = Date.now() - 120 * 60_000;
    for (const report of delayReports) {
      const created = Date.parse(report.createdAt);
      if (report.direction !== direction || !Number.isFinite(created) || created < cutoff) continue;
      const key = `${report.departureTime}:${report.stage}`;
      groups.set(key, [...(groups.get(key) ?? []), report]);
    }
    return [...groups.values()].map((items): DelaySummary => {
      const sorted = items.map((item) => item.delayMinutes).filter((minutes): minutes is number => minutes !== null).sort((a, b) => a - b);
      return { departureTime: items[0].departureTime, stage: items[0].stage, delayMinutes: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, count: items.length, createdAt: items.map((item) => item.createdAt).sort().at(-1)! };
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6);
  }, [delayReports, direction, now]);

  async function submitDelayReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentDirection.departures.includes(draft.departureTime)) {
      setDelayNotice("Primero elige una salida en Horarios para poder avisar del retraso.");
      return;
    }
    setDelaySubmitting(true);
    setDelayNotice("");
    try {
      const response = await fetch("/api/delays", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ direction, departureTime: draft.departureTime, delayMinutes, stage: shareState === "sharing" ? "in-route" : "not-arrived" }),
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { report: DelayReport };
      setDelayReports((current) => [data.report, ...current.filter((item) => item.id !== data.report.id)]);
      setDelayNotice("Aviso enviado. Gracias por ayudar a los demás viajeros.");
      setDelayOpen(false);
    } catch (error) {
      setDelayNotice(error instanceof Error ? error.message : "No se pudo enviar el aviso. Revisa la conexión.");
    } finally { setDelaySubmitting(false); }
  }
  const selectedStopTimes = currentDirection.departures.map((time) => shiftClock(time, currentDirection.stopOffsets[scheduleStopIndex] || 0));
  const stopArrivals = useMemo(() => currentDirection.stops.map((_, index) => ({
    theoretical: getNextTheoreticalArrival(currentDirection, index, now),
    shared: getNextSharedArrival(currentDirection, index, activeReports, now),
  })), [currentDirection, activeReports, now]);

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
      occupancy: currentDraft.occupancy,
      reinforcement: currentDraft.reinforcement,
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
        const data = (await response.json()) as { report: BusReport; shareToken: string; deleteToken: string };
        const session = { id: data.report.id, token: data.shareToken, deleteToken: data.deleteToken };
        sessionRef.current = session;
        setMyReportId(session.id);
        setShareState("sharing");
        setCurrentBusResumeSharing(true);
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
    if (!draftRef.current.departureTime) {
      setNotice("Selecciona la hora de salida del bus antes de compartir ubicación.");
      document.getElementById("required-departure-time")?.focus();
      return;
    }
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
          ? "No se pudo acceder a tu ubicación. Revisa el permiso del navegador y pulsa «Compartir este bus» para volver a intentarlo."
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

  async function stopSharing(expiredTrip = false) {
    setCurrentBusResumeSharing(false);
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
          headers: { "x-delete-token": session.deleteToken },
        });
        if (!response.ok && response.status !== 404) rememberPendingDelete(session);
        setNotice(expiredTrip
          ? "El trayecto ha llegado a su hora prevista y se ha dejado de compartir."
          : response.ok || response.status === 404
            ? "Has dejado de compartir y la señal se ha retirado del mapa."
            : "Has dejado de compartir. Reintentaré borrar la señal cuando vuelva la conexión; mientras tanto dejará de ser GPS reciente y se estimará hasta la llegada prevista.");
      } catch {
        rememberPendingDelete(session);
        setNotice(expiredTrip
          ? "El trayecto ha llegado a su hora prevista. Reintentaré borrar la señal cuando vuelva la conexión."
          : "Has dejado de compartir. Reintentaré borrar la señal cuando vuelva la conexión; mientras tanto dejará de ser GPS reciente y se estimará hasta la llegada prevista.");
      }
    } else {
      setNotice(expiredTrip ? "El trayecto ha llegado a su hora prevista y se ha cancelado." : "Has dejado de compartir.");
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
          ...(fields.departureTime !== undefined ? { departureTime: fields.departureTime || null } : {}),
          ...(fields.occupancy !== undefined ? { occupancy: fields.occupancy } : {}),
          ...(fields.reinforcement !== undefined ? { reinforcement: fields.reinforcement } : {}),
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
    clearCurrentBusCookie();
    setSavedCurrentBus(null);
    restoredCurrentBusRef.current = null;
    setScheduleStopIndex(0);
    setExpandedStopIndex(null);
    setDraftValue("departureTime", "");
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

  const directionCard = (
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
  );

  const legalKind = legalKindFromPath(routePath);
  useEffect(() => {
    const seo = legalKind ? LEGAL_SEO[legalKind] : PAGE_SEO[page === SCHEDULE_PAGE ? "schedule" : page === MAP_PAGE ? "map" : "stops"];
    const canonicalPath = legalKind ? `/${legalKind}.html` : PAGE_PATHS[page];
    document.title = seo.title;
    const update = (selector: string, value: string, attribute = "content") => {
      const element = document.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (element) element.setAttribute(attribute, value);
    };
    update('meta[name="description"]', seo.description);
    update('meta[property="og:title"]', seo.title);
    update('meta[property="og:description"]', seo.description);
    update('meta[name="twitter:title"]', seo.title);
    update('meta[name="twitter:description"]', seo.description);
    update('link[rel="canonical"]', `https://bus.nekokoneko.org${canonicalPath}`, "href");
    update('meta[property="og:url"]', `https://bus.nekokoneko.org${canonicalPath}`);
  }, [legalKind, page]);
  if (legalKind) return <div className="app-shell legal-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="MapGarraf, inicio"><span className="brand-mark"><BusGarrafIcon size={40} /></span><span><strong>MapGarraf</strong><small>BUSGARRAF · COMUNIDAD</small></span></a>
      <div className="topbar-actions">
        <button className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
        <a className="icon-button legal-home-button" href="/" aria-label="Volver al mapa"><MapPinned size={18} /></a>
      </div>
    </header>
    <LegalPage kind={legalKind} onShowAnnouncements={() => setAnnouncementOpen(true)} />
    {announcementOpen && <AnnouncementDialog onClose={() => setAnnouncementOpen(false)} />}
  </div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={PAGE_PATHS[DEFAULT_PAGE]} aria-label="MapGarraf, inicio" onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          goToPage(DEFAULT_PAGE);
        }}>
          <span className="brand-mark"><BusGarrafIcon size={40} /></span>
          <span><strong>MapGarraf</strong><small>BUSGARRAF · COMUNIDAD</small></span>
        </a>
        <div className="topbar-actions">
          <button className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="icon-button install-button" onClick={() => void installApp()} aria-label="Instalar aplicación"><Download size={19} /></button>
          <button className="icon-button" onClick={() => void fetchReports()} aria-label="Actualizar buses"><RefreshCw size={18} className={loadingReports ? "spin" : ""} /></button>
        </div>
      </header>

      <main id="inicio" className="pager" ref={pagerRef} onScroll={onPagerScroll}>
        <section className="page" id="page-schedule" aria-label="Horarios" inert={page !== SCHEDULE_PAGE}>
          <div className="main-content">
            <div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" />LUNES A VIERNES · DÍAS LABORABLES</div>{page === SCHEDULE_PAGE ? <h1>Horarios del BusGarraf</h1> : <h2>Horarios del BusGarraf</h2>}</div>
            {directionCard}
            <section className="detail-panel">
              <div className="detail-title"><div><h3>{currentDirection.start} → {currentDirection.end}</h3></div><Clock3 size={19} /></div>
              <p className="schedule-caption">Salidas del PDF del operador para días laborables, consultado el 25 de septiembre de 2026. Hay cambios por temporada, festivos e incidencias; verifica antes de salir.</p>
              <label className="schedule-stop-select">Ver salidas en
                <select value={scheduleStopIndex} onChange={(event) => setScheduleStopIndex(Number(event.target.value))}>
                  {currentDirection.stops.map((stop, index) => <option key={`${stop}-${index}`} value={index}>{townForStop(stop)} — {stop}</option>)}
                </select>
              </label>
              <div className="departure-list">{selectedStopTimes.map((time, index) => <button key={`${time}-${index}`} className="departure-chip" onClick={() => {
                // The selected chip shows this service at the chosen stop; the
                // timing model needs its departure from the route's first stop.
                setDraftValue("departureTime", currentDirection.departures[index]);
                rememberCurrentBus(currentDirection.departures[index]);
                if (sessionRef.current) void updateReport({ departureTime: currentDirection.departures[index] });
                setShowOptions(true);
                goToPage(MAP_PAGE);
                window.setTimeout(() => document.querySelector(".share-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
              }}>{time}</button>)}</div>
              <p className="last-service">En este documento, la última llegada al destino figura a las {currentDirection.arrivalAtOtherEnd}.</p>
              <div className="source-links"><a href={officialScheduleUrl} target="_blank" rel="noreferrer">Horario actualizado del operador <ExternalLink size={14} /></a><a href={publishedPdfUrl} target="_blank" rel="noreferrer">PDF consultado <ExternalLink size={14} /></a><a href={officialTariffUrl} target="_blank" rel="noreferrer">Tarifas oficiales <ExternalLink size={14} /></a></div>
            </section>
          </div>
        </section>

        <section className="page" id="page-map" aria-label="Mapa" inert={page !== MAP_PAGE}>
        <div className="main-content">
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-dot" />TARRAGONA ↔ VILANOVA I LA GELTRÚ</div>
          {page === MAP_PAGE ? <h1>BusGarraf<br /><span>Tarragona ↔ Vilanova</span></h1> : <h2 className="intro-title">BusGarraf<br /><span>Tarragona ↔ Vilanova</span></h2>}
          <p>Horarios, paradas y mapa comunitario de la ruta entre Tarragona y Vilanova i la Geltrú. Las posiciones y llegadas son compartidas o estimadas, no datos oficiales. Puedes explorar el mapa sin elegir una salida.</p>
        </section>

        {directionCard}

        <section className={`share-card ${shareState === "sharing" ? "is-sharing" : ""}`}>
          <div className="share-copy">
            <span className="share-icon"><LocateFixed size={19} /></span>
            <div>
              <strong>{shareState === "sharing" ? "Estás compartiendo" : shareState === "requesting" ? "Buscando tu ubicación…" : "¿Ya vas en el bus?"}</strong>
              <span>{shareState === "sharing" ? "Solo mientras mantengas la pantalla abierta." : "Con un toque, avisa al resto de viajeros."}</span>
            </div>
          </div>
          <label className="required-departure" htmlFor="required-departure-time">
            <span>Hora de salida desde {currentDirection.start}<strong aria-hidden="true"> *</strong></span>
            <select
              id="required-departure-time"
              value={draft.departureTime}
              required
              aria-required="true"
              onChange={(event) => {
                const value = event.target.value;
                setDraftValue("departureTime", value);
                if (value) rememberCurrentBus(value);
                else {
                  clearCurrentBusCookie();
                  setSavedCurrentBus(null);
                  restoredCurrentBusRef.current = null;
                }
                if (sessionRef.current) void updateReport({ departureTime: value });
              }}
            >
              <option value="">Selecciona la salida del horario…</option>
              {currentDirection.departures.map((departure) => <option key={departure} value={departure}>{departure}</option>)}
            </select>
            {!draft.departureTime && <small>La necesitamos para calcular si el bus va adelantado o con retraso.</small>}
          </label>
          <p className="location-privacy"><strong>Ten en cuenta:</strong> el GPS exacto es público mientras se actualiza. Tras 1 minuto sin GPS deja de mostrarse como posición real y pasa a estimarse con el horario, hasta la llegada prevista (máximo 105 min desde la última lectura). Se borra del servidor en 24 h. «Dejar de compartir» solicita el borrado inmediato.</p>
          {shareState === "sharing" ? (
            <button className="share-button stop-button" onClick={() => void stopSharing()}><X size={18} /> Dejar de compartir</button>
          ) : (
            <button className="share-button" onClick={startSharing} disabled={shareState === "requesting" || !draft.departureTime}>
              {shareState === "requesting" ? <><span className="button-spinner" /> Esperando GPS</> : <><Navigation size={17} fill="currentColor" /> Compartir este bus</>}
            </button>
          )}
          <div className="delay-report-inline">
            {!delayOpen ? <button type="button" className="delay-report-toggle" aria-expanded="false" disabled={!draft.departureTime || shareState === "requesting"} onClick={() => { setDelayOpen(true); setDelayNotice(""); }}>
              <Clock3 size={16} /><span><strong>¿Va con retraso?</strong><small>{draft.departureTime ? `Salida ${draft.departureTime} · ${shareState === "sharing" ? "bus en ruta" : "aún no ha llegado a la primera parada"}` : "Elige una salida en Horarios"}</small></span><b>Reportar</b>
            </button> : <>
              <div className="delay-inline-heading"><Clock3 size={16} /><strong>Reportar retraso · salida {draft.departureTime}</strong></div>
              <form className="delay-form" onSubmit={submitDelayReport}>
                <label>Retraso aproximado
                  <select value={delayMinutes ?? "indefinite"} onChange={(event) => setDelayMinutes(event.target.value === "indefinite" ? null : Number(event.target.value))}>
                    {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>≈ {minutes} min</option>)}
                    <option value="indefinite">Indefinido · no se sabe</option>
                  </select>
                </label>
                <div className="delay-form-actions"><button className="delay-submit" type="submit" disabled={delaySubmitting}>{delaySubmitting ? "Enviando…" : <><Send size={16} /> Enviar aviso</>}</button><button className="delay-cancel" type="button" onClick={() => setDelayOpen(false)}>Cancelar</button></div>
              </form>
              <p className="delay-disclaimer">Se marcará como {shareState === "sharing" ? "bus en ruta" : "bus aún no llegado a la primera parada"}. No comparte GPS.</p>
            </>}
            {delayNotice && <p className="delay-feedback" role="status">{delayNotice}</p>}
            {delaySummaries.filter((item) => item.departureTime === draft.departureTime).length > 0 && <div className="delay-feed" aria-label="Avisos recientes de retraso para esta salida">
              <strong className="delay-feed-title">Avisos recientes · últimas 2 h</strong>
              {delaySummaries.filter((item) => item.departureTime === draft.departureTime).map((item) => <div className="delay-feed-item" key={`${item.departureTime}:${item.stage}`}>
                <span><small>{item.stage === "not-arrived" ? "Aún no había llegado a la primera parada" : "Reportado en ruta"} · hace {Math.max(0, Math.floor((now.getTime() - Date.parse(item.createdAt)) / 60_000))} min</small></span>
                <strong>{item.delayMinutes === null ? "Indefinido" : `≈ ${item.delayMinutes} min`}{item.count > 1 ? ` · ${item.count} avisos` : ""}</strong>
              </div>)}
            </div>}
          </div>
          <details className="privacy-details">
            <summary>Privacidad y seguridad</summary>
            <p>Solo enviamos ubicación tras pulsar compartir y aceptar el permiso del navegador. El GPS exacto es público mientras se actualiza y durante un minuto desde la última lectura; después, deja de considerarse una posición real y se estima con el horario, con coordenadas redondeadas a unos 100 m, hasta la llegada prevista (máximo 105 min desde la última lectura). Si vuelves a abrir la web durante ese trayecto, intentará reanudar la ubicación si ya habías iniciado la compartición y el navegador conserva el permiso. La señal se borra del servidor en un máximo de 24 h; pulsar «Dejar de compartir» solicita su borrado inmediato y, si no hay conexión, se volverá a intentar al recuperarla mientras esta pestaña siga abierta. No se crea una cuenta ni guardamos un historial de trayectos. El mapa solicita imágenes de OpenStreetMap, pero no le enviamos tu GPS. Úsalo como pasajero, nunca mientras conduces.</p>
          </details>
          <button className="options-toggle" aria-expanded={showOptions} onClick={() => setShowOptions((value) => !value)}>
            {showOptions ? "Ocultar opciones" : "Añadir detalles útiles (opcional)"}<ChevronDown size={15} className={showOptions ? "rotate" : ""} />
          </button>
          {showOptions && (
            <div className="extra-options">
              <fieldset>
                <legend>¿Cuánta gente lleva?</legend>
                <div className="choice-row">
                  <Choice selected={draft.occupancy === "low"} onClick={() => void updateReport({ occupancy: draft.occupancy === "low" ? null : "low" })}>Hay sitio</Choice>
                  <Choice selected={draft.occupancy === "medium"} onClick={() => void updateReport({ occupancy: draft.occupancy === "medium" ? null : "medium" })}>Normal</Choice>
                  <Choice selected={draft.occupancy === "high"} onClick={() => void updateReport({ occupancy: draft.occupancy === "high" ? null : "high" })}>Lleno</Choice>
                </div>
              </fieldset>
              <button
                type="button"
                className={`reinforcement-toggle${draft.reinforcement ? " is-selected" : ""}`}
                aria-pressed={draft.reinforcement}
                onClick={() => {
                  const reinforcement = !draft.reinforcement;
                  void updateReport({ reinforcement });
                  if (draft.departureTime) rememberCurrentBus(draft.departureTime, reinforcement);
                }}
              >
                <span className="reinforcement-toggle-icon"><BusFront size={19} /></span>
                <span className="reinforcement-toggle-copy"><strong>Bus de refuerzo</strong><small>{draft.reinforcement ? "Marcado para este bus" : "Marca si es un servicio adicional"}</small></span>
                <span className="reinforcement-toggle-state">{draft.reinforcement ? "Sí" : "No"}</span>
              </button>
              <p className="privacy-note"><Signal size={14} /> El retraso se estima automáticamente con el GPS y el horario. Indicar la salida mejora el cálculo; la ocupación es voluntaria.</p>
            </div>
          )}
        </section>

        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}

        <section className="map-section" aria-labelledby="map-title">
          <div className="section-heading">
            <div><div className="section-kicker"><MapPinned size={15} /> MAPA DEL RECORRIDO</div><h2 id="map-title">{directionLabel[direction]}</h2></div>
            <span className="distance-badge">≈ 50 km · 1 h 15</span>
          </div>
          <div className={`ghost-notice${showGhosts ? "" : " ghost-notice--off"}`} role="note">
            <span className="ghost-notice-icon"><Ghost size={18} /></span>
            <div>
              <strong>{showGhosts ? "Buses fantasma · sin verificar" : "Buses fantasma ocultos"}</strong>
              {showGhosts && <p>{ghostsToday
                ? "Los fantasmas (violeta, línea discontinua) marcan dónde DEBERÍA estar cada bus según el horario publicado, o de dónde debería salir en los próximos minutos. Nadie ha confirmado que existan ni que circulen. Se sustituyen por la posición real cuando un viajero comparte ese bus."
                : "El horario incorporado es de lunes a viernes, así que hoy no se muestran buses fantasma. Solo verás buses compartidos por viajeros."}</p>}
            </div>
            <button className="ghost-toggle" aria-pressed={showGhosts} onClick={toggleGhosts}>{showGhosts ? "Ocultar" : "Mostrar"}</button>
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
                <div className={`map-live-summary${trackedMapReport ? " has-live-report" : ""}${trackedGhost ? " is-ghost" : ""}`} aria-live="polite">
                  <span className="map-live-indicator" />
                  <span>
                    <strong id="map-expanded-title">{trackedGhost ? `Bus fantasma · salida ${trackedGhost.departureTime}` : trackedMapReport ? (trackedMapReport.reinforcement ? "Bus de refuerzo" : "Bus compartido") : "Recorrido completo"}</strong>
                    <small>{trackedGhost ? `SIN VERIFICAR · estimado por horario${followMapBus ? " · siguiéndolo" : ""}` : trackedMapReport ? `${trackedMapReport.estimated ? "estimado · última señal real hace " + Math.floor(trackedMapReport.ageSeconds / 60) + " min" : trackedMapReport.ageSeconds < 60 ? "ahora" : `hace ${Math.floor(trackedMapReport.ageSeconds / 60)} min`} · ${getReportStatus(trackedMapReport.delayMinutes, trackedMapReport.delayBasis).label}${followMapBus ? " · siguiéndolo" : ""}` : "Sin buses activos; se muestra toda la ruta."}</small>
                  </span>
                </div>
                <div className="map-expanded-actions">
                  {(activeReports.length > 1 || ghosts.length > 0) && (
                    <select
                      className="map-bus-select"
                      value={trackedGhost?.id ?? trackedMapReport?.id ?? ""}
                      aria-label="Elige el autobús que quieres seguir"
                      onChange={(event) => {
                        setTrackedMapBusId(event.target.value);
                        setFollowMapBus(true);
                      }}
                    >
                      {!trackedGhost && !trackedMapReport && <option value="" disabled>Elige un bus…</option>}
                      {activeReports.map((report) => <option key={report.id} value={report.id}>{report.reinforcement ? "Refuerzo · " : ""}{report.departureTime ? `Salida ${report.departureTime}` : report.nextStop ? `Próxima: ${report.nextStop}` : "Señal compartida"}</option>)}
                      {ghosts.map((ghost) => <option key={ghost.id} value={ghost.id}>{`Fantasma ${ghost.departureTime} · sin verificar`}</option>)}
                    </select>
                  )}
                  {(trackedMapReport || trackedGhost) && (
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
              timetable={currentDirection}
              reports={activeReports}
              ghosts={ghosts}
              expanded={mapExpanded}
              followBus={followMapBus}
              onUserMove={() => setFollowMapBus(false)}
              followReportId={trackedGhost?.id ?? trackedMapReport?.id ?? null}
            />
            <div className="map-legend"><span className="legend-bus"><BusGarrafIcon size={20} /></span><span>Posición compartida</span><span className="legend-status legend-status--on-time" /><span>En hora</span><span className="legend-status legend-status--late" /><span>Retraso</span><span className="legend-status legend-status--unknown" /><span>Sin dato</span><span className="legend-stop" /><span>Parada</span>{activeReports.some((report) => report.reinforcement) && <><span className="legend-reinforcement">✚</span><span>Servicio de refuerzo</span></>}{activeReports.some((report) => report.estimated) && <><span className="legend-estimated" /><span>Estimado (sin señal reciente)</span></>}{showGhosts && <><span className="legend-ghost"><Ghost size={11} /></span><span>Fantasma · sin verificar</span></>}</div>
          </div>
          <p className="map-footnote">El retraso y la próxima parada se estiman comparando el GPS con el horario publicado; si no se identifica una salida compatible, aparecerá «Sin dato». No son datos oficiales y pueden variar por tráfico o paradas. Las 16 paradas usan ubicaciones de datos públicos; el trazado sigue las calles entre paradas. Los buses fantasma son solo una estimación del horario y no están verificados.</p>
        </section>

        <section className="reports-section">
          <div className="section-heading report-heading">
            <div><div className="section-kicker"><Radio size={15} /> AHORA EN LA RUTA</div><h2>{activeReports.length ? `${activeReports.length} ${activeReports.length === 1 ? "señal activa" : "señales activas"}` : "Aún no hay buses verificados"}</h2></div>
            <span className={`live-pill ${activeReports.length ? "live" : ""}`}><i />{activeReports.some((report) => !report.estimated) ? "EN VIVO" : activeReports.length ? "ESTIMADO" : "COMUNIDAD"}</span>
          </div>
          {activeReports.length ? (
            <div className="report-list">
              {activeReports.map((report) => <ReportCard key={report.id} report={report} own={report.containsOwn} />)}
            </div>
          ) : (
            <div className="empty-state"><span className="empty-icon"><BusGarrafIcon size={39} /></span><div><strong>Sé la primera señal</strong><p>Si ya estás a bordo, comparte la ubicación del bus para ayudar a quienes esperan.</p></div></div>
          )}
          {ghosts.length > 0 && (
            <div className="ghost-block">
              <div className="ghost-block-title"><Ghost size={15} /> BUSES FANTASMA · SIN VERIFICAR</div>
              <p>Calculados solo con el horario publicado. No hay ningún aviso de viajeros que los confirme, así que pueden no existir.</p>
              <div className="report-list">
                {ghosts.map((ghost) => <GhostCard key={ghost.id} ghost={ghost} onClaim={() => claimGhostTrip(ghost)} />)}
              </div>
            </div>
          )}
        </section>

        <section className="trust-card"><div className="trust-icon"><Compass size={19} /></div><div><strong>Una herramienta independiente</strong><p>No está afiliada a BusGarraf ni recibe datos del operador. Las posiciones son aportaciones voluntarias y no oficiales.</p></div></section>
        <footer className="page-footer">
          <span>Hecho para viajar mejor por el Garraf.</span>
          <nav aria-label="Información legal" className="page-footer-links">
            <button type="button" className="announcement-link" aria-haspopup="dialog" onClick={() => setAnnouncementOpen(true)}><Bell size={12} />Novedades</button>
            <a href="/terms.html">Condiciones</a>
            <a href="/privacy.html">Privacidad</a>
            <a href="/cookies.html">Cookies</a>
            <button type="button" data-cookie-settings>Configurar cookies</button>
            <a href="https://busgarraf.cat/es/" target="_blank" rel="noreferrer">Web oficial <ExternalLink size={13} /></a>
          </nav>
        </footer>
        </div>
        </section>

        <section className="page" id="page-stops" aria-label="Paradas" inert={page !== STOPS_PAGE}>
          <div className="main-content">
            <div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" />RECORRIDO COMPLETO</div>{page === STOPS_PAGE ? <h1>Paradas del BusGarraf</h1> : <h2>Paradas del BusGarraf</h2>}</div>
            {directionCard}
            <section className="detail-panel stops-panel">
              <div className="detail-title"><div><h3>16 paradas</h3></div><MapPin size={19} /></div>
              <p className="schedule-caption stops-caption">Toca una parada para ver todos sus pasos teóricos y la próxima llegada calculada.</p>
              <ol className="stops-list">{currentDirection.stops.map((stop, index) => {
                const isExpanded = expandedStopIndex === index;
                const arrival = stopArrivals[index];
                const preview = arrival.shared && arrival.theoretical
                  ? arrival.shared.minutesUntil <= arrival.theoretical.minutesUntil ? arrival.shared : arrival.theoretical
                  : arrival.shared ?? arrival.theoretical;
                const passageTimes = currentDirection.departures.map((departure) => shiftClock(departure, currentDirection.stopOffsets[index]));
                return <li key={`${stop}-${index}`} className={isExpanded ? "is-expanded" : ""}>
                  <button
                    className="stop-row"
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedStopIndex((current) => current === index ? null : index)}
                  >
                    <span className="stop-index">{index + 1}</span>
                    <span className="stop-row-copy"><strong>{stop}</strong><small>{townForStop(stop)}</small></span>
                    <span className="stop-row-next"><small>{preview && preview === arrival.shared ? "GPS" : "Horario"}</small><strong>{preview?.time ?? "—"}</strong></span>
                    <ChevronDown size={17} className={`stop-row-chevron${isExpanded ? " rotate" : ""}`} />
                  </button>
                  {isExpanded && <div className="stop-arrivals">
                    <div className="stop-estimate-row">
                      <span>Próximo paso por horario</span>
                      {arrival.theoretical
                        ? <strong>{arrival.theoretical.time}<small>en ~{arrival.theoretical.minutesUntil} min · días laborables</small></strong>
                        : <strong>{ghostsToday ? "Sin más pasos hoy" : "Sin horario hoy"}<small>El horario publicado es de lunes a viernes</small></strong>}
                    </div>
                    <div className="stop-estimate-row">
                      <span>Llegada calculada</span>
                      {arrival.shared
                        ? <strong>~{arrival.shared.time}<small>en ~{arrival.shared.minutesUntil} min · GPS y horario{arrival.shared.estimated ? " · posición proyectada" : ""}</small></strong>
                        : <strong>Sin bus compartido próximo<small>Se calcula cuando hay una posición compartida en ruta</small></strong>}
                    </div>
                    <div className="stop-passage-list">
                      <div><strong>Pasos teóricos</strong><small>Horario de lunes a viernes</small></div>
                      <div className="passage-times">{passageTimes.map((time, timeIndex) => <span className="passage-time" key={`${time}-${timeIndex}`}>{time}</span>)}</div>
                    </div>
                  </div>}
                </li>;
              })}</ol>
              <p className="map-footnote">Las ubicaciones exactas pueden variar; consulta la web de BusGarraf para confirmar la parada.</p>
            </section>
          </div>
        </section>
      </main>

      <nav className="bottom-nav" aria-label="Secciones">
        {NAV_ITEMS.map(({ page: target, label, Icon }) => (
          <a key={target} href={PAGE_PATHS[target]} className={`bottom-link ${page === target ? "active" : ""}`} aria-current={page === target ? "page" : undefined} onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            goToPage(target);
          }}>
            <Icon size={18} /><span>{label}</span>
          </a>
        ))}
      </nav>

      {announcementOpen && <AnnouncementDialog onClose={() => setAnnouncementOpen(false)} />}

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

function AnnouncementDialog({ onClose }: { onClose: () => void }) {
  const announcement = ANNOUNCEMENTS[0];
  return <div className="dialog-backdrop" role="presentation" onClick={onClose}>
    <section className="install-dialog announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-title" aria-describedby="announcement-body" onClick={(event) => event.stopPropagation()}>
      <button className="dialog-close" onClick={onClose} aria-label="Cerrar anuncio"><X size={18} /></button>
      <span className="install-dialog-icon"><Bell size={22} /></span>
      <p className="announcement-kicker">NOVEDADES · <time dateTime={announcement.dateTime}>{announcement.date}</time></p>
      <h2 id="announcement-title">{announcement.title}</h2>
      <p id="announcement-body">{announcement.body}</p>
      <button className="share-button dialog-action" onClick={onClose}>Entendido</button>
    </section>
  </div>;
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`choice ${selected ? "chosen" : ""}`} aria-pressed={selected} onClick={onClick}>{selected && <Check size={13} />}{children}</button>;
}

const SHOW_GHOSTS_KEY = "showGhosts";

function loadShowGhosts() {
  try {
    return localStorage.getItem(SHOW_GHOSTS_KEY) !== "0";
  } catch {
    return true;
  }
}

function GhostCard({ ghost, onClaim }: { ghost: GhostBus; onClaim: () => void }) {
  return <article className="report-card ghost-card">
    <span className="report-bus ghost-bus"><Ghost size={19} /></span>
    <div className="report-main">
      <div className="report-title"><strong>Bus fantasma · salida {ghost.departureTime}</strong><span className="ghost-pill">SIN VERIFICAR</span></div>
      <div className="report-meta"><span>Llegada prevista {ghost.arrivalTime}</span></div>
      <p className="ghost-where">{ghost.departsInMinutes !== null
        ? <>Según el horario, saldría de <strong>{ghost.previousStop}</strong> a las <strong>{ghost.departureTime}</strong> (en {ghost.departsInMinutes} min).</>
        : <>Según el horario, ahora estaría entre <strong>{ghost.previousStop}</strong> y <strong>{ghost.nextStop}</strong>.</>}</p>
      <p className="ghost-warning">Solo es una estimación: nadie ha confirmado que este bus circule ni dónde está. Puede no existir, ir con retraso o no haber salido.</p>
      <button className="ghost-claim" onClick={onClaim}>Voy en este bus</button>
    </div>
  </article>;
}

function ReportCard({ report, own }: { report: MapReport; own: boolean }) {
  const crowd = report.occupancy === "low" ? "Hay sitio" : report.occupancy === "medium" ? "Ocupación normal" : report.occupancy === "high" ? "Lleno" : null;
  const status = getReportStatus(report.delayMinutes, report.delayBasis);
  const minutes = Math.floor(report.ageSeconds / 60);
  const age = report.ageSeconds < 60 ? "ahora" : `hace ${minutes} min`;
  return <article className={`report-card${report.estimated ? " report-card--estimated" : ""}`}>
    <span className="report-bus"><BusGarrafIcon size={37} /></span>
    <div className="report-main"><div className="report-title"><strong>{report.reinforcement ? "Bus de refuerzo" : "Bus en ruta"}{report.supportCount > 1 ? ` · ${report.supportCount} avisos` : ""}</strong>{own && <span className="mine-pill">TU SEÑAL</span>}{report.estimated && <span className="estimate-pill">POSICIÓN ESTIMADA</span>}</div>
      {report.estimated && <p className="estimate-note">Última posición real hace {minutes} min{report.previousStop && report.nextStop ? <>; según el horario, ahora estaría entre <strong>{report.previousStop}</strong> y <strong>{report.nextStop}</strong></> : ""}. Es una estimación: puede no ser exacta.</p>}
      <div className="report-meta">{report.estimated ? null : <span><span className="fresh-dot" />{age}</span>}{report.departureTime && <span>Salida {report.departureTime}</span>}{report.accuracy !== null && <span>GPS ±{Math.round(report.accuracy)} m</span>}</div>
      {report.nextStop && <div className="report-next-stop"><Navigation size={13} /><span>Próxima: <strong>{report.nextStop}</strong></span>{report.minutesToNextStop !== null && report.minutesToNextStop !== undefined && <span className="report-eta">~{report.minutesToNextStop} min</span>}</div>}
      <div className={`report-timing report-timing--${status.kind}`}><span className="report-timing-dot" /><strong>{status.label}</strong><span className="report-timing-explanation">{status.explanation}</span></div>
      {(crowd || report.reinforcement) && <div className="report-tags">{report.reinforcement && <span className="report-tag--reinforcement"><BusFront size={12} />Bus de refuerzo</span>}{crowd && <span><Users size={12} />{crowd}</span>}</div>}
    </div>
  </article>;
}

function aggregateReports(reports: BusReport[], ownId: string | null, direction: Direction, tripByReportId: Map<string, string | null>): MapReport[] {
  const groups: BusReport[][] = [];
  for (const report of [...reports].sort((a, b) => a.ageSeconds - b.ageSeconds)) {
    const group = groups.find((candidate) => {
      if (hasConflictingDepartures(candidate, report.departureTime)) return false;
      return candidate.some((first) => {
        const firstTrip = tripByReportId.get(first.id);
        const reportTrip = tripByReportId.get(report.id);
        if (firstTrip && reportTrip && firstTrip === reportTrip) return true;
        if (first.departureTime && report.departureTime && first.departureTime === report.departureTime) return true;

        if (Math.abs(first.ageSeconds - report.ageSeconds) <= 45
          && distanceMeters(first.latitude, first.longitude, report.latitude, report.longitude) < 200) return true;

        if (Math.max(first.ageSeconds, report.ageSeconds) < LIVE_REPORT_SECONDS) return false;
        // A stopped or badly delayed bus can be far behind its timetable projection.
        // Compare the last observed GPS fixes as well, with a distance allowance based
        // on the time between them, so a newer real fix can absorb its stale estimate.
        if (isPlausibleSameBusByObservedPositions(first, report)) return true;
        const firstPosition = estimateCurrentPosition(direction, first) ?? first;
        const reportPosition = estimateCurrentPosition(direction, report) ?? report;
        return distanceMeters(firstPosition.latitude, firstPosition.longitude, reportPosition.latitude, reportPosition.longitude)
          <= ESTIMATED_REPORT_MATCH_DISTANCE_M;
      });
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
      // A grouped bus should sit at its freshest report, never between two GPS fixes.
      latitude: freshest.latitude,
      longitude: freshest.longitude,
      accuracy: freshest.accuracy ?? (accuracies.length ? Math.round(accuracies.reduce((total, value) => total + value, 0) / accuracies.length) : null),
      departureTime: freshest.departureTime,
      occupancy: freshest.occupancy ?? counts(group.map((report) => report.occupancy)),
      reinforcement: group.some((report) => report.reinforcement),
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

function isPlausibleSameBusByObservedPositions(a: BusReport, b: BusReport) {
  const ageGapSeconds = Math.abs(a.ageSeconds - b.ageSeconds);
  const maximumSeparationMeters = Math.min(8_000, 500 + ageGapSeconds * 12);
  return distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= maximumSeparationMeters;
}

function isReplacedByFreshReport(stale: BusReport, freshReports: BusReport[], direction: Direction, tripByReportId: Map<string, string | null>) {
  const stalePosition = estimateCurrentPosition(direction, stale);
  if (!stalePosition) return false;
  const staleTrip = tripByReportId.get(stale.id);

  return freshReports.some((fresh) => {
    if (fresh.ageSeconds >= stale.ageSeconds) return false;
    if (hasConflictingDepartures([stale], fresh.departureTime)) return false;
    if (stale.departureTime && fresh.departureTime && stale.departureTime === fresh.departureTime) return true;
    const freshTrip = tripByReportId.get(fresh.id);
    if (staleTrip && freshTrip && staleTrip === freshTrip) return true;
    if (isPlausibleSameBusByObservedPositions(stale, fresh)) return true;

    // A fresh GPS report can use a different departure label and still be the same
    // trip. Compare both signals projected to now, then prefer the fresh location.
    const freshPosition = estimateCurrentPosition(direction, fresh) ?? fresh;
    return distanceMeters(stalePosition.latitude, stalePosition.longitude, freshPosition.latitude, freshPosition.longitude)
      <= ESTIMATED_REPORT_MATCH_DISTANCE_M;
  });
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
