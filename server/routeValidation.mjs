import { roadShapeByDirection } from "../shared/routeShapes.mjs";

const ROUTE_CORRIDOR_METERS = 1_500;

function segmentDistanceMeters(lat, lng, a, b) {
  const scaleLat = 111_320;
  const scaleLng = scaleLat * Math.cos((lat * Math.PI) / 180);
  const px = lng * scaleLng;
  const py = lat * scaleLat;
  const ax = a[1] * scaleLng;
  const ay = a[0] * scaleLat;
  const bx = b[1] * scaleLng;
  const by = b[0] * scaleLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function isWithinRouteCorridor(lat, lng, direction, maxDistanceMeters = ROUTE_CORRIDOR_METERS) {
  const points = roadShapeByDirection[direction];
  if (!points) return false;
  for (let i = 1; i < points.length; i += 1) {
    if (segmentDistanceMeters(lat, lng, points[i - 1], points[i]) <= maxDistanceMeters) return true;
  }
  return false;
}
