import type { Direction } from "./data";
import { roadShapeByDirection } from "./routeShapes";

function distanceToSegmentMeters(lat: number, lng: number, a: [number, number], b: [number, number]) {
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

/** Closest point on the published route, used as a safe destination for a return route. */
export function nearestRoutePoint(lat: number, lng: number, direction: Direction) {
  const points = roadShapeByDirection[direction];
  if (!points?.length) return null;
  const scaleLat = 111_320;
  const scaleLng = scaleLat * Math.cos((lat * Math.PI) / 180);
  const px = lng * scaleLng;
  const py = lat * scaleLat;
  let bestDistance = Infinity;
  let nearest: { latitude: number; longitude: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const ax = a[1] * scaleLng;
    const ay = a[0] * scaleLat;
    const bx = b[1] * scaleLng;
    const by = b[0] * scaleLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const projectedX = ax + t * dx;
    const projectedY = ay + t * dy;
    const distance = Math.hypot(px - projectedX, py - projectedY);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = { latitude: projectedY / scaleLat, longitude: projectedX / scaleLng };
    }
  }
  return nearest;
}

export function distanceFromRouteMeters(lat: number, lng: number, direction: Direction) {
  const points = roadShapeByDirection[direction];
  if (!points?.length) return null;
  let minimum = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegmentMeters(lat, lng, points[index - 1], points[index]));
    if (minimum < 30) break;
  }
  return Number.isFinite(minimum) ? minimum : null;
}

export function isPossibleRouteDeviation(distanceMeters: number | null, accuracyMeters: number | null) {
  if (distanceMeters === null) return false;
  // Leave room for normal GPS drift and scale the threshold for less accurate fixes.
  const threshold = Math.max(450, Math.min(1_000, (accuracyMeters ?? 300) * 1.5));
  return distanceMeters > threshold;
}
