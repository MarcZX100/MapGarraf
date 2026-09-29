export function hasConflictingDepartures(
  reports: ReadonlyArray<{ departureTime: string | null | undefined }>,
  candidateDepartureTime: string | null | undefined,
): boolean;
