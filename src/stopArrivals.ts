import type { Timetable } from "./data";
import { madridClock } from "./ghostBuses";

export type StopArrivalEstimate = {
  time: string;
  minutesUntil: number;
  estimated: boolean;
};

type ReportForStop = {
  nextStop?: string;
  minutesToNextStop?: number | null;
  estimated?: boolean;
};

function clockMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(minutes: number) {
  const total = Math.floor(minutes);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Next weekday timetable passage at a stop, if there is one left today. */
export function getNextTheoreticalArrival(timetable: Timetable, stopIndex: number, now: Date): StopArrivalEstimate | null {
  const clock = madridClock(now);
  const offset = timetable.stopOffsets[stopIndex];
  if (!clock.isWeekday || offset === undefined) return null;

  const next = timetable.departures
    .map((departure) => ({ time: formatClock(clockMinutes(departure) + offset), minute: clockMinutes(departure) + offset }))
    .filter((arrival) => arrival.minute >= clock.minutes)
    .sort((a, b) => a.minute - b.minute)[0];
  if (!next) return null;

  return {
    time: next.time,
    minutesUntil: Math.max(0, Math.ceil(next.minute - clock.minutes)),
    estimated: false,
  };
}

/** Earliest ETA from a shared bus whose next stop is at or before this stop. */
export function getNextSharedArrival(timetable: Timetable, stopIndex: number, reports: ReportForStop[], now: Date): StopArrivalEstimate | null {
  const targetOffset = timetable.stopOffsets[stopIndex];
  if (targetOffset === undefined) return null;

  const candidates = reports.flatMap((report) => {
    if (!report.nextStop || report.minutesToNextStop == null) return [];
    const nextStopIndex = timetable.stops.indexOf(report.nextStop);
    if (nextStopIndex < 0 || stopIndex < nextStopIndex) return [];
    const nextStopOffset = timetable.stopOffsets[nextStopIndex];
    if (nextStopOffset === undefined) return [];
    const minutesUntil = report.minutesToNextStop + targetOffset - nextStopOffset;
    if (minutesUntil < 0 || minutesUntil > 90) return [];
    return [{ minutesUntil, estimated: report.estimated === true }];
  }).sort((a, b) => a.minutesUntil - b.minutesUntil);

  const next = candidates[0];
  if (!next) return null;
  const nowMinutes = madridClock(now).minutes;
  const roundedMinutes = Math.max(0, Math.ceil(next.minutesUntil));
  return {
    time: formatClock(Math.ceil(nowMinutes + roundedMinutes)),
    minutesUntil: roundedMinutes,
    estimated: next.estimated,
  };
}
