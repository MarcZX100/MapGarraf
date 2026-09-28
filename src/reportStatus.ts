export type ReportStatusKind = "unknown" | "on-time" | "early" | "delayed" | "late";

export type ReportStatus = {
  kind: ReportStatusKind;
  label: string;
  markerLabel: string;
  explanation: string;
};

const ON_TIME_TOLERANCE_MINUTES = 5;

export function getReportStatus(delayMinutes: number | null, delayBasis?: "selected-departure" | "inferred-departure" | null): ReportStatus {
  if (delayMinutes === null) {
    return {
      kind: "unknown",
      label: "Sin base para calcular",
      markerLabel: "Sin dato",
      explanation: "No hay una posición GPS y una salida de horario compatibles para estimarlo.",
    };
  }

  const explanation = delayBasis === "inferred-departure"
    ? "Estimación automática con GPS y la salida más probable del horario; puede variar si se ha identificado otra salida. El estado «En hora» admite hasta 5 min de diferencia."
    : "Estimación automática comparando GPS con el horario de la salida indicada; no es un dato oficial y puede variar por tráfico. El estado «En hora» admite hasta 5 min de diferencia.";

  if (Math.abs(delayMinutes) <= ON_TIME_TOLERANCE_MINUTES) {
    return {
      kind: "on-time",
      label: "En hora · aprox.",
      markerLabel: "En hora ~",
      explanation,
    };
  }

  if (delayMinutes < 0) {
    const minutes = Math.abs(delayMinutes);
    return {
      kind: "early",
      label: `≈ ${minutes} min adelantado`,
      markerLabel: `≈ -${minutes} min`,
      explanation,
    };
  }

  const kind = delayMinutes >= 10 ? "late" : "delayed";
  return {
    kind,
    label: `≈ ${delayMinutes} min de retraso`,
    markerLabel: `≈ +${delayMinutes} min`,
    explanation,
  };
}
