import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const schedule = JSON.parse(fs.readFileSync(path.join(root, "shared/timetables.json"), "utf8"));
const canonical = "https://bus.nekokoneko.org/busgarraf-vilanova-tarragona.html";
const contentReviewed = "2026-09-29";
const stopTowns = {
  "Plaça Eduard Maristany": "Vilanova i la Geltrú",
  "C/ Pare Garí": "Vilanova i la Geltrú",
  "C/ Aigua – C/ Bruc": "Vilanova i la Geltrú",
  "C/ Zamenhof": "Vilanova i la Geltrú",
  Ibersol: "Vilanova i la Geltrú",
  "Pobles d’Espanya": "Vilanova i la Geltrú",
  "Cubelles Centre": "Cubelles",
  Tèrmica: "Cubelles",
  "Cunit Centre": "Cunit",
  Benzinera: "Cunit",
  "La Ponderosa": "Cunit",
  "Segur Centre": "Segur de Calafell",
  "Calafell Estació": "Calafell",
  "Calafell Poble": "Calafell",
  "Zona Universitària": "Tarragona",
  "Hospital Joan XXIII": "Tarragona",
  "Estació autobusos": "Tarragona",
};

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function shiftClock(clock, offset) {
  const [hours, minutes] = clock.split(":").map(Number);
  const total = (hours * 60 + minutes + offset) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function renderStopSchedule(direction) {
  const items = direction.stops.map((stop, index) => {
    const town = stopTowns[stop] ?? "Recorrido BusGarraf";
    const times = direction.departures.map((departure) => shiftClock(departure, direction.stopOffsets[index]));
    return `<details class="stop-times"><summary><span>${escapeHtml(stop)}</span><small>${escapeHtml(town)} · ${times.length} pasos programados</small></summary><p>${times.map(escapeHtml).join(" · ")}</p></details>`;
  }).join("\n");
  return `<section class="timetable-section"><h3>${escapeHtml(direction.start)} → ${escapeHtml(direction.end)}</h3><p>Salidas desde ${escapeHtml(direction.start)}: <strong>${direction.departures.map(escapeHtml).join(" · ")}</strong></p><p class="hint">Abre una parada para consultar las horas de paso aproximadas de lunes a viernes laborables.</p>${items}</section>`;
}

const description = "Consulta los horarios del BusGarraf entre Vilanova i la Geltrú y Tarragona, las horas de paso por sus paradas y el recorrido por Cubelles, Cunit, Segur y Calafell.";
const allStops = [...new Set([...schedule["to-tarragona"].stops, ...schedule["to-vilanova"].stops])];
const stopList = allStops.map((stop) => `<li><strong>${escapeHtml(stop)}</strong><span>${escapeHtml(stopTowns[stop] ?? "")}</span></li>`).join("\n");
const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="MapGarraf">
  <meta property="og:locale" content="es_ES">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="Autobús Vilanova–Tarragona: horarios y paradas | MapGarraf">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="https://bus.nekokoneko.org/icon-512.png?v=2">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Autobús Vilanova–Tarragona: horarios y paradas | MapGarraf">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="https://bus.nekokoneko.org/icon-512.png?v=2">
  <title>Autobús Vilanova–Tarragona: horarios y paradas | MapGarraf</title>
  <script src="/theme-init.js"></script>
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Autobús Vilanova–Tarragona: horarios y paradas",
    description,
    url: canonical,
    inLanguage: "es-ES",
    dateModified: contentReviewed,
    isPartOf: { "@type": "WebSite", name: "MapGarraf", url: "https://bus.nekokoneko.org/" },
    about: { "@type": "Thing", name: "BusGarraf Vilanova i la Geltrú–Tarragona", sameAs: "https://busgarraf.cat/es/lineas/" },
  })}</script>
  <!-- MAPGARRAF-STYLES -->
  <style>
    .route-guide-content article { padding-bottom: 24px; }
    .route-guide-content .lead { max-width: 650px; color: var(--muted); font-size: 16px; }
    .route-guide-content .cta { display: inline-flex; margin: 5px 0 12px; padding: 10px 14px; border-radius: 10px; background: var(--teal); color: white; font-weight: 700; text-decoration: none; }
    .route-guide-content .notice { padding: 13px 15px; border-left: 3px solid var(--amber); border-radius: 8px; background: var(--teal-pale); color: var(--ink); }
    .route-guide-content .updated, .route-guide-content .hint, .route-guide-content .stop-times small { color: var(--muted); font-size: 12px; }
    .route-guide-content h3 { margin: 20px 0 8px; font-size: 16px; }
    .route-guide-content .stop-times { padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--paper); }
    .route-guide-content .stop-times:first-of-type { border-radius: 10px 10px 0 0; }
    .route-guide-content .stop-times:last-of-type { border-radius: 0 0 10px 10px; }
    .route-guide-content .stop-times summary { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; cursor: pointer; }
    .route-guide-content .stop-times summary span { font-weight: 700; }
    .route-guide-content .stop-times p { margin: 9px 0 2px; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .route-guide-content .stop-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 18px; padding-left: 22px; }
    .route-guide-content .stop-list li { padding: 4px 0; }
    .route-guide-content .stop-list li span { display: block; color: var(--muted); font-size: 12px; }
    .route-guide-content .faq { padding: 12px 0; border-bottom: 1px solid var(--line); }
    .route-guide-content .faq h3 { margin: 0 0 4px; font-size: 15px; }
    .route-guide-content .faq p { margin: 0; }
    .route-guide-content .source { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
    .route-guide-content .source p:last-child { margin-bottom: 0; }
    .route-guide-content .guide-footer { margin: 20px 0 0; padding: 16px 0 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    @media (max-width: 560px) { .route-guide-content .stop-times summary { display: grid; gap: 2px; } }
  </style>
</head>
<body>
  <div class="app-shell legal-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="MapGarraf, inicio"><span class="brand-mark"><img src="/icon-192.png" width="40" height="40" alt=""></span><span><strong>MapGarraf</strong><small>BUSGARRAF · COMUNIDAD</small></span></a>
    <div class="topbar-actions"><a class="icon-button legal-home-button" href="/" aria-label="Volver al mapa" title="Volver al mapa">⌖</a></div>
  </header>
  <main class="legal-content route-guide-content">
    <article>
      <div class="page-heading"><div class="eyebrow"><span class="eyebrow-dot"></span>BUSGARRAF · VILANOVA ↔ TARRAGONA</div><h1>Autobús Vilanova–Tarragona: horarios y paradas</h1></div>
      <p class="lead">Consulta las salidas entre Vilanova i la Geltrú y Tarragona y las horas de paso previstas por Cubelles, Cunit, Segur de Calafell y Calafell.</p>
      <p class="updated">Horario de días laborables transcrito del documento del operador consultado el 25 de septiembre de 2026. Guía revisada el 29 de septiembre de 2026.</p>
      <a class="cta" href="/">Abrir horarios y mapa de MapGarraf</a>
      <div class="notice"><strong>Información orientativa:</strong> MapGarraf es un proyecto comunitario independiente, no el operador. Los horarios pueden cambiar por festivos, temporada e incidencias, y las horas de paso dependen del tráfico. Confirma tu viaje en la <a href="https://busgarraf.cat/es/lineas/" rel="external">web oficial de BusGarraf</a>.</div>

      <h2>Horarios del autobús Vilanova–Tarragona</h2>
      <p>El PDF consultado presenta servicios de lunes a viernes laborables en ambos sentidos. Las salidas principales y las horas de paso aproximadas por parada están calculadas desde esas salidas según la tabla publicada. Abre cada parada para ver sus horas.</p>
      <p>Si el documento repite filas con las mismas horas, esta guía muestra la combinación horaria una sola vez: el PDF no identifica si son vehículos distintos.</p>
      ${renderStopSchedule(schedule["to-tarragona"])}
      ${renderStopSchedule(schedule["to-vilanova"])}

      <h2>Paradas del recorrido BusGarraf</h2>
      <p>La línea conecta Vilanova i la Geltrú con Tarragona y pasa por Cubelles, Cunit, Segur de Calafell y Calafell.</p>
      <ul class="stop-list">${stopList}</ul>

      <h2>Preguntas frecuentes</h2>
      <section class="faq"><h3>¿El horario sirve también en festivos y fines de semana?</h3><p>Esta tabla corresponde a días laborables («feiners»). Consulta al operador para festivos, fines de semana, verano y servicios especiales.</p></section>
      <section class="faq"><h3>¿Las horas de llegada son en tiempo real?</h3><p>No. Las horas de paso de esta guía son las del horario publicado. En el mapa, las posiciones compartidas proceden de viajeros y las posiciones estimadas son orientativas; BusGarraf no confirma esos datos.</p></section>
      <section class="faq"><h3>¿Cómo puedo ver la posición de un bus?</h3><p><a href="/">Abre el mapa de MapGarraf</a>. Si un viajero comparte la ubicación, aparecerá en el recorrido; si deja de actualizarse, la web puede estimar el avance usando el horario.</p></section>

      <h2>Fuentes y revisión</h2>
      <div class="source"><p>Esta guía se basa en el horario público del operador y distingue las salidas programadas de las posiciones comunitarias. La fecha de consulta se muestra para que puedas valorar si necesitas verificar posibles cambios.</p><p><a href="https://busgarraf.cat/es/lineas/" rel="external">BusGarraf: líneas, paradas y horarios</a> · <a href="https://busgarraf.cat/es/busgarraf-consulta-los-horarios-de-todas-nuestras-lineas/" rel="external">BusGarraf: consulta de horarios</a></p><p>Contenido y herramienta elaborados por Marc Jaen Garrido, responsable particular de MapGarraf. <a href="/privacy.html">Privacidad</a> · <a href="/terms.html">Condiciones de uso</a>.</p></div>
    </article>
  </main>
    <p class="guide-footer">MapGarraf es independiente de BusGarraf y no recibe datos oficiales de posición. <a href="/">Volver a MapGarraf</a>.</p>
  </main>
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(publicDir, "busgarraf-vilanova-tarragona.html"), html);
