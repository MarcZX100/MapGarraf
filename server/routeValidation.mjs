import { roadShapeByDirection } from "../shared/routeShapes.mjs";

const ROUTE_CORRIDOR_METERS = 1_500;
const MAX_PLAUSIBLE_SPEED_MPS = 45; // ~162 km/h, leaves room for GPS noise and fast sections.
const GPS_NOISE_ALLOWANCE_METERS = 250;

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

export function isPlausibleMovement(previous, next, elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > 20 * 60) return true;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(next.latitude - previous.latitude);
  const dLng = radians(next.longitude - previous.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(previous.latitude)) * Math.cos(radians(next.latitude)) * Math.sin(dLng / 2) ** 2;
  const distanceMeters = 12_742_000 * Math.asin(Math.sqrt(a));
  const reportedAccuracy = Math.min(next.accuracy ?? 0, 100) + Math.min(previous.accuracy ?? 0, 100);
  return distanceMeters <= MAX_PLAUSIBLE_SPEED_MPS * elapsedSeconds + GPS_NOISE_ALLOWANCE_METERS + reportedAccuracy;
}

export const routeValidationLimits = {
  corridorMeters: ROUTE_CORRIDOR_METERS,
  maxPlausibleSpeedMetersPerSecond: MAX_PLAUSIBLE_SPEED_MPS,
};
