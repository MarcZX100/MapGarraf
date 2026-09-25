export type ReportStatusKind = "unknown" | "on-time" | "early" | "delayed" | "late";

export type ReportStatus = {
  kind: ReportStatusKind;
  label: string;
  markerLabel: string;
  explanation: string;
};

export function getReportStatus(delayMinutes: number | null): ReportStatus {
  if (delayMinutes === null) {
    return {
      kind: "unknown",
      label: "Sin dato de puntualidad",
      markerLabel: "Sin dato",
      explanation: "Ningún viajero ha indicado si va en hora o con retraso.",
    };
  }

  if (delayMinutes === 0) {
    return {
      kind: "on-time",
      label: "En hora",
      markerLabel: "En hora",
      explanation: "Según el aviso de un viajero; no es un dato oficial.",
    };
  }

  if (delayMinutes < 0) {
    const minutes = Math.abs(delayMinutes);
    return {
      kind: "early",
      label: `Adelantado ${minutes} min`,
      markerLabel: `Adelantado ${minutes}`,
      explanation: "Según el aviso de un viajero; no es un dato oficial.",
    };
  }

  const kind = delayMinutes >= 10 ? "late" : "delayed";
  return {
    kind,
    label: `Retraso de ${delayMinutes} min`,
    markerLabel: `Retraso +${delayMinutes}`,
    explanation: "Según el aviso de un viajero; no es un dato oficial.",
  };
}
