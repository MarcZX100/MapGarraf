import { ExternalLink } from "lucide-react";

type LegalKind = "terms" | "privacy" | "cookies";

const titles: Record<LegalKind, string> = {
  terms: "Condiciones de uso",
  privacy: "Política de privacidad",
  cookies: "Política de cookies",
};

export function legalKindFromPath(path: string): LegalKind | null {
  if (/\/terms(?:\.html)?\/?$/.test(path)) return "terms";
  if (/\/privacy(?:\.html)?\/?$/.test(path)) return "privacy";
  if (/\/cookies(?:\.html)?\/?$/.test(path)) return "cookies";
  return null;
}

export default function LegalPage({ kind }: { kind: LegalKind }) {
  return <main className="legal-content">
    <div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" />MAPGARRAF · INFORMACIÓN</div><h1>{titles[kind]}</h1><p className="legal-updated">Última actualización: 28 de septiembre de 2026</p></div>
    {kind === "terms" && <>
      <p>Al utilizar MapGarraf aceptas estas condiciones. Si no estás de acuerdo, deja de usar la web.</p>
      <h2>Proyecto independiente e información orientativa</h2>
      <p>MapGarraf es una herramienta comunitaria particular, independiente y no oficial; no está afiliada a BusGarraf ni recibe datos del operador. Horarios, posiciones, ocupación y retrasos pueden ser incompletos, imprecisos o cambiar por tráfico, incidencias o cambios de servicio. Los avisos manuales de retraso son aportaciones de viajeros y no se verifican con el operador. Las posiciones estimadas y los «buses fantasma» se calculan a partir del horario y no confirman que el bus exista o se encuentre allí. Comprueba la información con el operador antes de viajar; no dependas de esta web para tomar decisiones urgentes o de seguridad.</p>
      <h2>Compartir ubicación</h2><p>La geolocalización solo se solicita cuando pulsas «Compartir este bus» y aceptas el permiso del navegador. Al compartir, autorizas que la posición y los datos opcionales que añadas sean visibles para otros visitantes. El GPS exacto es público mientras se actualiza y durante un minuto desde la última lectura; después deja de considerarse una posición real y se estima con el horario, usando coordenadas redondeadas a unos 100 m, hasta la llegada prevista (máximo 105 minutos desde la última lectura). La señal se elimina del servidor en un máximo de 24 horas; «Dejar de compartir» solicita su borrado inmediato. Encontrarás más detalles en la <a href="/privacy.html">Política de privacidad</a>.</p>
      <h2>Uso responsable</h2><ul><li>Usa la función de ubicación como pasajero y nunca mientras conduces.</li><li>Comparte solo datos del trayecto que quieras hacer visibles a otros viajeros.</li><li>No introduzcas datos personales de otras personas ni uses el servicio para acosar, vigilar o interferir con otros usuarios.</li><li>No intentes perjudicar la disponibilidad o seguridad de la web ni automatizar envíos que degraden el servicio.</li></ul>
      <h2>Disponibilidad y responsabilidad</h2><p>La web se ofrece gratuitamente y puede cambiar, interrumpirse o dejar de estar disponible. En la medida permitida por la ley, el responsable no garantiza que los horarios, estimaciones o posiciones sean exactos ni responde por decisiones tomadas exclusivamente a partir de ellos. Esto no limita derechos o responsabilidades que legalmente no puedan excluirse.</p>
      <h2>Responsable y contacto</h2><p>El responsable de MapGarraf es Marc Jaen Garrido, como particular. Contacto: <a href="mailto:nekokonekowebsite@gmail.com">nekokonekowebsite@gmail.com</a>.</p><p>La información identificativa exigible depende de que la actividad esté incluida en la <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758">Ley 34/2002 (LSSI)</a>, cuyo artículo 10 contempla, entre otros datos, nombre, domicilio o residencia y un medio de contacto directo.</p>
    </>}
    {kind === "privacy" && <>
      <p className="legal-notice">MapGarraf es un proyecto particular e independiente. Para cualquier consulta sobre privacidad, puedes contactar con el responsable por correo electrónico.</p>
      <h2>Responsable</h2><p>El responsable del tratamiento es <strong>Marc Jaen Garrido</strong>, como particular. Correo electrónico: <a href="mailto:nekokonekowebsite@gmail.com">nekokonekowebsite@gmail.com</a>.</p>
      <h2>Qué datos se tratan y para qué</h2><ul><li><strong>Ubicación del bus:</strong> solo se solicita al pulsar «Compartir este bus» y conceder permiso. Se muestra en el mapa y se usa para estimar el avance.</li><li><strong>Datos opcionales:</strong> sentido, hora de salida, ocupación y servicio de refuerzo, si se indican.</li><li><strong>Avisos de retraso:</strong> sentido, salida programada, minutos aproximados o retraso indefinido, estado del trayecto deducido de si se ha iniciado la compartición de ubicación, y hora del aviso. El aviso no requiere GPS ni cuenta y se muestra a otros visitantes como información comunitaria. Se conserva hasta 24 horas.</li><li><strong>Datos técnicos:</strong> el servidor puede procesar datos de conexión para prestar y proteger la web. No se crean cuentas.</li><li><strong>Analítica:</strong> Google Analytics 4 (G-QGHZ9BZ1EF) solo se carga si aceptas cookies analíticas.</li></ul>
      <h2>Ubicación y conservación</h2><p>La ubicación es voluntaria. El GPS exacto se publica mientras hay actualizaciones y durante un minuto desde la última lectura; después deja de considerarse una posición real. La API devuelve coordenadas redondeadas a unos 100 m y el mapa estima la posición con el horario hasta la llegada prevista, con un máximo de 105 minutos desde la última lectura. Si se cierra y reabre la web durante una compartición iniciada, intentará reanudarla si el navegador conserva el permiso. Las señales se eliminan de la base de datos en un máximo de 24 horas. «Dejar de compartir» solicita su borrado inmediato; si no hay conexión, el navegador conserva una solicitud de borrado y la reintenta al recuperar la conexión.</p>
      <h2>Base jurídica</h2><p>La ubicación y datos opcionales se publican cuando la persona activa voluntariamente esa función. La analítica se basa en consentimiento previo y revocable. Las operaciones técnicas imprescindibles mantienen y protegen el servicio.</p>
      <h2>Destinatarios y servicios externos</h2><p>Las señales compartidas y los avisos de retraso son accesibles para los visitantes mediante el mapa y la API pública durante los plazos indicados. Se usan recursos cartográficos de OpenStreetMap y, según la configuración, OSRM para el trazado. Si aceptas Analytics, Google recibe datos de uso conforme a su <a href="https://policies.google.com/privacy?hl=es">política de privacidad</a>.</p>
      <h2>Derechos y contacto</h2><p>Para ejercer tus derechos o retirar el consentimiento analítico, escribe a <a href="mailto:nekokonekowebsite@gmail.com">nekokonekowebsite@gmail.com</a>. También puedes reclamar ante la <a href="https://www.aepd.es/">Agencia Española de Protección de Datos</a>.</p>
      <h2>Menores y uso responsable</h2><p>No compartas información personal en campos opcionales. Activa la ubicación solo cuando quieras compartir el trayecto y utiliza el servicio como pasajero, nunca mientras conduces.</p>
    </>}
    {kind === "cookies" && <>
      <p>Esta web utiliza almacenamiento local necesario para recordar algunas preferencias y, solo si lo autorizas, cookies analíticas de Google Analytics.</p>
      <h2>Almacenamiento necesario</h2><p>MapGarraf guarda preferencias funcionales en tu navegador: el tema visual, si se muestran buses fantasma y tu elección sobre cookies analíticas. La cookie <code>mapgarraf-current-bus</code> recuerda el sentido, la hora de salida, si marcaste el servicio como refuerzo y si habías iniciado la compartición, para restaurar el trayecto y reanudar la ubicación al volver. Caduca a la hora de llegada prevista. Si solicitas borrar una señal sin conexión, se guarda temporalmente en el almacenamiento local un token que solo permite borrarla; se elimina cuando el servidor confirma la baja o tras 24 horas. Ni la cookie del trayecto ni el token de borrado contienen GPS o se envían a Analytics. El mapa funciona aunque rechaces la analítica.</p>
      <h2>Cookies analíticas opcionales</h2><p>Si eliges «Aceptar analíticas», se carga Google Analytics 4 (G-QGHZ9BZ1EF). Google puede escribir cookies como <code>_ga</code> y <code>_ga_*</code>. Consulta su <a href="https://policies.google.com/technologies/cookies?hl=es">información sobre cookies</a> y su <a href="https://policies.google.com/privacy?hl=es">política de privacidad</a>.</p><p>El script no se carga ni crea cookies de Google antes del consentimiento. La retención dentro de la propiedad GA4 se configura por separado en Google Analytics.</p>
      <h2>Cambiar tu elección</h2><p>Usa <button className="legal-inline-button" type="button" data-cookie-settings>Configurar cookies</button> para aceptar o rechazar la analítica. Retirar el consentimiento la desactiva en este navegador y elimina las cookies analíticas accesibles para el sitio. La elección se recuerda durante 180 días.</p>
      <h2>Responsable</h2><p>El responsable es Marc Jaen Garrido, como particular. Contacto: <a href="mailto:nekokonekowebsite@gmail.com">nekokonekowebsite@gmail.com</a>. Consulta también la <a href="/privacy.html">Política de privacidad</a>.</p>
    </>}
    <nav className="legal-nav" aria-label="Información legal"><a href="/">Volver al mapa</a><a href="/terms.html">Condiciones</a><a href="/privacy.html">Privacidad</a><a href="/cookies.html">Cookies</a><button type="button" data-cookie-settings>Configurar cookies</button><a href="https://busgarraf.cat/es/" target="_blank" rel="noreferrer">Web oficial <ExternalLink size={13} /></a></nav>
  </main>;
}
