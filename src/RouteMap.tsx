import type { GhostBus } from "./ghostBuses";
import { useEffect, useRef } from "react";
import L from "leaflet";
import { type Direction, type RouteStop } from "./data";
import { roadShapeByDirection } from "./routeShapes";
import { getReportStatus } from "./reportStatus";

export type BusReport = {
  id: string;
  direction: Direction;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  departureTime: string | null;
  occupancy: "low" | "medium" | "high" | null;
  delayMinutes: number | null;
  delayBasis?: "selected-departure" | "inferred-departure" | null;
  lastSeen: string;
  ageSeconds: number;
  supportCount?: number;
  /** Client-side: when the report was fetched, to keep its age current between refreshes. */
  receivedAt?: number;
  /** The position is a timetable-based estimate from an older real reading, not a live GPS fix. */
  estimated?: boolean;
  previousStop?: string;
  nextStop?: string;
  minutesToNextStop?: number | null;
};

type Props = {
  direction: Direction;
  stops: RouteStop[];
  reports: BusReport[];
  ghosts: GhostBus[];
  expanded: boolean;
  followBus: boolean;
  followReportId: string | null;
  onUserMove: () => void;
};

export default function RouteMap({ direction, stops, reports, ghosts, expanded, followBus, followReportId, onUserMove }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<L.LayerGroup | null>(null);
  const reportLayersRef = useRef<L.LayerGroup | null>(null);
  const ghostLayersRef = useRef<L.LayerGroup | null>(null);
  const ghostMarkersRef = useRef(new Map<string, L.Marker>());
  const reportMarkersRef = useRef(new Map<string, { marker: L.Marker; circle: L.Circle | null }>());
  const compactViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  const wasExpandedRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Rutas: <a href="https://project-osrm.org/">OSRM</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapRef.current = map;
    routeLayersRef.current = L.layerGroup().addTo(map);
    ghostLayersRef.current = L.layerGroup().addTo(map);
    reportLayersRef.current = L.layerGroup().addTo(map);
    map.setView([41.18, 1.48], 9);
    // Any drag, pinch, wheel or zoom-button move made by the user stops following the bus.
    // Moves the app makes itself are flagged so they are not mistaken for the user.
    map.on("dragstart", () => onUserMoveRef.current());
    map.on("zoomstart", () => { if (!programmaticMoveRef.current) onUserMoveRef.current(); });
    map.on("moveend", () => { programmaticMoveRef.current = false; });
    const frame = window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    return () => {
      window.cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
      routeLayersRef.current = null;
      reportLayersRef.current = null;
      ghostLayersRef.current = null;
      ghostMarkersRef.current.clear();
      reportMarkersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = routeLayersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    const orderedStops = direction === "to-tarragona" ? stops : [...stops].reverse();
    const roadPoints = roadShapeByDirection[direction].map(([lat, lng]) => L.latLng(lat, lng));
    L.polyline(roadPoints, { color: "#117d73", weight: 5, opacity: 0.84, lineCap: "round", lineJoin: "round" }).addTo(layers);
    for (const [index, stop] of orderedStops.entries()) {
      const point = stop.coordinates[direction];
      L.circleMarker([point.lat, point.lng], {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: "#117d73",
        fillOpacity: 1,
      }).bindPopup(`<strong>${index + 1}. ${escapeHtml(stop.name)}</strong><br>${escapeHtml(stop.town)}`).addTo(layers);
    }

    programmaticMoveRef.current = true;
    map.fitBounds(L.latLngBounds(roadPoints).pad(0.12), { animate: false, maxZoom: 12 });
    programmaticMoveRef.current = false;
  }, [direction, stops]);

  useEffect(() => {
    const layers = reportLayersRef.current;
    if (!layers) return;
    // Update in place (keyed by report id) so an open popup survives the periodic refresh.
    const markers = reportMarkersRef.current;
    const liveIds = new Set(reports.map((report) => report.id));
    for (const [id, entry] of markers) {
      if (!liveIds.has(id)) {
        layers.removeLayer(entry.marker);
        if (entry.circle) layers.removeLayer(entry.circle);
        markers.delete(id);
      }
    }
    for (const report of reports) {
      const point = L.latLng(report.latitude, report.longitude);
      const icon = reportIcon(report);
      const popup = reportPopupHtml(report);
      const showAccuracy = !report.estimated && report.accuracy !== null && report.accuracy > 0 && report.accuracy < 600;
      const existing = markers.get(report.id);
      if (existing) {
        existing.marker.setLatLng(point).setIcon(icon).setPopupContent(popup);
        if (existing.circle) {
          layers.removeLayer(existing.circle);
          existing.circle = null;
        }
        if (showAccuracy) existing.circle = accuracyCircle(point, report.accuracy as number).addTo(layers);
        continue;
      }
      const circle = showAccuracy ? accuracyCircle(point, report.accuracy as number).addTo(layers) : null;
      const marker = L.marker(point, { icon, zIndexOffset: 500 }).bindPopup(popup).addTo(layers);
      markers.set(report.id, { marker, circle });
    }
  }, [reports]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wasExpanded = wasExpandedRef.current;
    if (expanded && !wasExpanded) {
      compactViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
    }
    wasExpandedRef.current = expanded;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (!expanded && wasExpanded && compactViewRef.current) {
        programmaticMoveRef.current = true;
        map.setView(compactViewRef.current.center, compactViewRef.current.zoom, { animate: false });
        programmaticMoveRef.current = false;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  useEffect(() => {
    const layers = ghostLayersRef.current;
    if (!layers) return;
    // Update markers in place so an open popup survives the periodic position refresh.
    const markers = ghostMarkersRef.current;
    const liveIds = new Set(ghosts.map((ghost) => ghost.id));
    for (const [id, marker] of markers) {
      if (!liveIds.has(id)) {
        layers.removeLayer(marker);
        markers.delete(id);
      }
    }
    for (const ghost of ghosts) {
      const point = L.latLng(ghost.latitude, ghost.longitude);
      const existing = markers.get(ghost.id);
      if (existing) {
        existing.setLatLng(point);
        existing.setPopupContent(ghostPopupHtml(ghost));
        continue;
      }
      const marker = L.marker(point, { icon: ghostIcon(ghost), zIndexOffset: 100 }).bindPopup(ghostPopupHtml(ghost)).addTo(layers);
      markers.set(ghost.id, marker);
    }
  }, [ghosts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !expanded || !followBus || !followReportId) return;
    const target = reports.find((candidate) => candidate.id === followReportId) ?? ghosts.find((candidate) => candidate.id === followReportId);
    if (!target) return;
    const point = L.latLng(target.latitude, target.longitude);
    const zoom = Math.max(map.getZoom(), 15);
    if (map.getCenter().distanceTo(point) > 15 || map.getZoom() < zoom) {
      programmaticMoveRef.current = true;
      map.flyTo(point, zoom, { animate: true, duration: 0.55 });
    }
  }, [expanded, followBus, followReportId, reports, ghosts]);

  return <div className="route-map" ref={elementRef} role="img" aria-label="Mapa interactivo de la ruta y las posiciones compartidas entre Tarragona y Vilanova i la Geltrú" />;
}

function reportIcon(report: BusReport) {
  const baseTitle = "Bus compartido";
  const status = getReportStatus(report.delayMinutes, report.delayBasis);
  const markerLabel = escapeHtml(report.estimated ? `Estimado · ${status.markerLabel}` : status.markerLabel);
  const markerDescription = escapeHtml(`${baseTitle}${report.estimated ? " (posición estimada)" : ""}: ${status.label}`);
  return L.divIcon({
    className: "bus-map-icon-wrap",
    html: `<span class="bus-map-marker${report.estimated ? " is-estimated" : ""}" role="img" aria-label="${markerDescription}" title="${markerDescription}">
      <span class="bus-map-status bus-map-status--${status.kind}">${markerLabel}</span>
      <span class="bus-map-pin bus-map-pin--${status.kind}" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V16"/><path d="M5 11h14M8 16v2m8-2v2M7.5 18h9A2.5 2.5 0 0 0 19 15.5V13H5v2.5A2.5 2.5 0 0 0 7.5 18Z"/><path d="M8 8.5h.01M16 8.5h.01"/></svg>
      </span>
    </span>`,
    iconSize: [128, 74],
    iconAnchor: [64, 72],
  });
}

function reportPopupHtml(report: BusReport) {
  const baseTitle = "Bus compartido";
  const title = report.supportCount && report.supportCount > 1 ? `${baseTitle} · ${report.supportCount} avisos` : baseTitle;
  const status = getReportStatus(report.delayMinutes, report.delayBasis);
  const minutes = Math.floor(report.ageSeconds / 60);
  const departure = report.departureTime ? ` · salida ${escapeHtml(report.departureTime)}` : "";
  const nextStop = report.nextStop ? `<br>Próxima parada: ${escapeHtml(report.nextStop)}${report.minutesToNextStop !== null && report.minutesToNextStop !== undefined ? ` · ~${report.minutesToNextStop} min` : ""}.` : "";
  if (report.estimated) {
    const between = report.previousStop && report.nextStop ? `<br>Ahora estaría entre ${escapeHtml(report.previousStop)} y ${escapeHtml(report.nextStop)}.` : "";
    return `<strong>${title} · posición estimada</strong><br><span class="popup-status popup-status--${status.kind}">${escapeHtml(status.label)}</span>${between}${nextStop}<br>Última posición real hace ${minutes} min${departure}.<br><small>Posición y retraso estimados con horario publicado; no son datos oficiales.</small>`;
  }
  const age = report.ageSeconds < 60 ? "ahora" : `hace ${minutes} min`;
  return `<strong>${title}</strong><br><span class="popup-status popup-status--${status.kind}">${escapeHtml(status.label)}</span>${nextStop}<br>${age}${departure}<br><small>Retraso estimado comparando GPS y horario publicado; no es oficial.</small>`;
}

function accuracyCircle(point: L.LatLng, radius: number) {
  return L.circle(point, { radius, color: "#71817e", weight: 1, fillColor: "#71817e", fillOpacity: 0.07 });
}

function ghostIcon(ghost: GhostBus) {
  const waiting = ghost.departsInMinutes !== null;
  const description = escapeHtml(`Bus fantasma sin verificar, ${waiting ? `saldría a las ${ghost.departureTime}` : `salida ${ghost.departureTime}`}`);
  return L.divIcon({
    className: "bus-map-icon-wrap",
    html: `<span class="bus-map-marker" role="img" aria-label="${description}" title="${description}">
      <span class="bus-map-status bus-map-status--ghost">${waiting ? `Sin verificar · ${escapeHtml(ghost.departureTime)}` : "Sin verificar"}</span>
      <span class="bus-map-pin bus-map-pin--ghost" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>
      </span>
    </span>`,
    iconSize: [128, 74],
    iconAnchor: [64, 72],
  });
}

function ghostPopupHtml(ghost: GhostBus) {
  const where = ghost.departsInMinutes !== null
    ? `Según el horario, saldría de ${escapeHtml(ghost.previousStop)} a las ${escapeHtml(ghost.departureTime)} (en ${ghost.departsInMinutes} min).`
    : `Según el horario, ahora estaría entre ${escapeHtml(ghost.previousStop)} y ${escapeHtml(ghost.nextStop)}.`;
  return `<strong>Bus fantasma · salida ${escapeHtml(ghost.departureTime)}</strong><br><span class="popup-status popup-status--ghost">SIN VERIFICAR</span><br>${where}<br><small>Es solo una estimación del horario: nadie ha confirmado que este bus exista ni dónde está.</small>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
