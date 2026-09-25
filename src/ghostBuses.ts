import { stops, timetables, type Direction } from "./data";
import { roadShapeByDirection } from "./routeShapes";

// "Ghost" buses: where each scheduled trip SHOULD be right now, computed only
// from the published timetable. Nobody has confirmed that these buses exist, so
// they must always be presented as unverified. A ghost disappears as soon as a
// real, shared position is matched to its trip (see unclaimedGhosts).

export type GhostBus = {
  id: string;
  direction: Direction;
  departureTime: string;
  arrivalTime: string;
  latitude: number;
  longitude: number;
  previousStop: string;
  nextStop: string;
};

type RealPosition = {
  latitude: number;
  longitude: number;
  departureTime: string | null;
  delayMinutes: number | null;
};

type RouteModel = {
  points: [number, number][];
  cumulative: number[];
  stopAlong: number[];
  offsets: number[];
  stopNames: string[];
  departures: { label: string; minutes: number }[];
};

const TIME_ZONE = "Europe/Madrid";
const MAX_ROUTE_DISTANCE_M = 1500;
const MAX_DELAY_MISMATCH_MIN = 15;
const STOP_SNAP_M = 60;

const models = new Map<Direction, RouteModel>();

function metersBetween(a: [number, number], b: [number, number]) {
  const dLat = (b[0] - a[0]) * 111_320;
  const dLng = (b[1] - a[1]) * 111_320 * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

function toMinutes(clock: string) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function toClock(minutes: number) {
  const total = Math.round(minutes);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function buildModel(direction: Direction): RouteModel {
  const cached = models.get(direction);
  if (cached) return cached;
  const points = roadShapeByDirection[direction];
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + metersBetween(points[i - 1], points[i]));

  const timetable = timetables[direction];
  let searchFrom = 0;
  // Match by position, not name: the operator PDF calls the second-to-last stop of the
  // Tarragona → Vilanova run "Pobles d’Espanya", which the map list names "C/ Pare Garí".
  const orderedStops = direction === "to-tarragona" ? stops : [...stops].reverse();
  if (orderedStops.length !== timetable.stops.length) throw new Error("Timetable and stop list differ in length");
  const stopAlong = orderedStops.map((stop) => {
    const target: [number, number] = [stop.coordinates[direction].lat, stop.coordinates[direction].lng];
    // Stops are visited in order: take the first vertex that is close enough,
    // otherwise the nearest one after the previous stop.
    let best = searchFrom;
    let bestDistance = Infinity;
    for (let i = searchFrom; i < points.length; i += 1) {
      const distance = metersBetween(points[i], target);
      if (distance <= STOP_SNAP_M) {
        best = i;
        bestDistance = distance;
        break;
      }
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    // Walk on while we are still getting closer, so we land on the closest vertex.
    while (best + 1 < points.length && metersBetween(points[best + 1], target) < bestDistance) {
      best += 1;
      bestDistance = metersBetween(points[best], target);
    }
    searchFrom = best;
    return cumulative[best];
  });

  const model: RouteModel = {
    points,
    cumulative,
    stopAlong,
    offsets: timetable.stopOffsets,
    stopNames: timetable.stops,
    departures: timetable.departures.map((label) => ({ label, minutes: toMinutes(label) })),
  };
  models.set(direction, model);
  return model;
}

function pointAtDistance(model: RouteModel, along: number): [number, number] {
  const { points, cumulative } = model;
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= along) low = mid;
    else high = mid;
  }
  const span = cumulative[high] - cumulative[low] || 1;
  const t = Math.min(1, Math.max(0, (along - cumulative[low]) / span));
  return [points[low][0] + (points[high][0] - points[low][0]) * t, points[low][1] + (points[high][1] - points[low][1]) * t];
}

function segmentAt(model: RouteModel, minutesSinceDeparture: number) {
  const { offsets } = model;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (minutesSinceDeparture >= offsets[i] && minutesSinceDeparture <= offsets[i + 1]) {
      const span = offsets[i + 1] - offsets[i] || 1;
      return { index: i, fraction: (minutesSinceDeparture - offsets[i]) / span };
    }
  }
  return null;
}

/** Local Madrid time as a weekday flag and minutes since midnight (with seconds). */
export function madridClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    isWeekday: !["Sat", "Sun"].includes(value("weekday")),
    minutes: Number(value("hour")) * 60 + Number(value("minute")) + Number(value("second")) / 60,
  };
}

/** The timetable in the app only covers Monday–Friday, so no ghosts at weekends. */
export function ghostsApplyToday(now: Date) {
  return madridClock(now).isWeekday;
}

export function getGhostBuses(direction: Direction, now: Date): GhostBus[] {
  const clock = madridClock(now);
  if (!clock.isWeekday) return [];
  const model = buildModel(direction);
  const lastOffset = model.offsets[model.offsets.length - 1];
  const ghosts: GhostBus[] = [];
  for (const departure of model.departures) {
    const elapsed = clock.minutes - departure.minutes;
    if (elapsed < 0 || elapsed > lastOffset) continue;
    const segment = segmentAt(model, elapsed);
    if (!segment) continue;
    const along = model.stopAlong[segment.index] + (model.stopAlong[segment.index + 1] - model.stopAlong[segment.index]) * segment.fraction;
    const [latitude, longitude] = pointAtDistance(model, along);
    ghosts.push({
      id: `ghost-${direction}-${departure.label}`,
      direction,
      departureTime: departure.label,
      arrivalTime: toClock(departure.minutes + lastOffset),
      latitude,
      longitude,
      previousStop: model.stopNames[segment.index],
      nextStop: model.stopNames[segment.index + 1],
    });
  }
  return ghosts;
}

/** Schedule minute (since departure) at which a bus would be at this position, or null if it is off the route. */
function scheduledMinuteAt(model: RouteModel, latitude: number, longitude: number) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < model.points.length; i += 1) {
    const distance = metersBetween(model.points[i], [latitude, longitude]);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  if (bestDistance > MAX_ROUTE_DISTANCE_M) return null;
  const along = model.cumulative[best];
  for (let i = 0; i < model.stopAlong.length - 1; i += 1) {
    if (along >= model.stopAlong[i] && along <= model.stopAlong[i + 1]) {
      const span = model.stopAlong[i + 1] - model.stopAlong[i] || 1;
      return model.offsets[i] + ((along - model.stopAlong[i]) / span) * (model.offsets[i + 1] - model.offsets[i]);
    }
  }
  return along < model.stopAlong[0] ? model.offsets[0] : model.offsets[model.offsets.length - 1];
}

/**
 * Drops every ghost whose trip is already covered by a real shared position.
 * A real report claims a trip by its declared departure time; without one, by
 * the trip whose schedule best explains where the bus is (taking a reported
 * delay into account). Each trip can be claimed only once.
 */
export function unclaimedGhosts(ghosts: GhostBus[], reports: RealPosition[], direction: Direction, now: Date): GhostBus[] {
  if (!ghosts.length || !reports.length) return ghosts;
  const model = buildModel(direction);
  const clock = madridClock(now);
  const claimed = new Set<string>();
  const remaining: RealPosition[] = [];

  for (const report of reports) {
    const exact = report.departureTime ? model.departures.find((departure) => departure.label === report.departureTime) : undefined;
    if (exact && !claimed.has(exact.label)) claimed.add(exact.label);
    else remaining.push(report);
  }

  for (const report of remaining) {
    const scheduled = scheduledMinuteAt(model, report.latitude, report.longitude);
    if (scheduled === null) continue;
    const expectedDelay = report.delayMinutes ?? 0;
    let best: { label: string; mismatch: number } | null = null;
    for (const departure of model.departures) {
      if (claimed.has(departure.label)) continue;
      const delay = clock.minutes - departure.minutes - scheduled;
      const mismatch = Math.abs(delay - expectedDelay);
      if (mismatch <= MAX_DELAY_MISMATCH_MIN && (!best || mismatch < best.mismatch)) best = { label: departure.label, mismatch };
    }
    if (best) claimed.add(best.label);
  }

  return ghosts.filter((ghost) => !claimed.has(ghost.departureTime));
}
