/** A group may contain missing departure labels, but never two different known departures. */
export function hasConflictingDepartures(reports, candidateDepartureTime) {
  const departures = new Set(reports.map((report) => report.departureTime).filter(Boolean));
  if (candidateDepartureTime) departures.add(candidateDepartureTime);
  return departures.size > 1;
}
