# MapGarraf · BusGarraf Tarragona ↔ Vilanova

PWA mobile-first e instalable desde el navegador para viajeros de la línea Vilanova i la Geltrú–Tarragona. Permite compartir voluntariamente el GPS del móvil, el sentido del viaje y datos opcionales del servicio (salida, número de bus, retraso y ocupación); el resto de viajeros ve señales recientes sobre un mapa.

Es un proyecto comunitario independiente, no un producto de BusGarraf. No recibe telemetría del operador: cada marcador significa que un viajero ha compartido el GPS de su dispositivo, no que BusGarraf haya confirmado la posición o la hora de llegada. La app no solicita la ubicación hasta pulsar **Compartir este bus**.

## Incluye

- Interfaz React/Vite adaptada a móvil, manifiesto PWA, iconos y caché del shell de la app.
- Mapa Leaflet con las 16 paradas mostradas individualmente, coordenadas por sentido y un trazado por calles calculado sobre OpenStreetMap con OSRM.
- Selector de sentido, señales comunitarias recientes, compartir/detener con un toque, y opciones de bus, salida, ocupación y retraso.
- API Express con validación Zod, cabeceras Helmet, límites de uso, token aleatorio por señal, SQLite persistente y caducidad automática.
- Las señales dejan de aparecer tras 3 minutos sin una lectura GPS reciente y se borran de la base de datos en 24 horas. Mientras están activas, las coordenadas exactas son públicas. No se pide cuenta, nombre ni identificador del dispositivo.
- Buses fantasma: de lunes a viernes, cada servicio del horario en curso se dibuja donde debería estar según el horario publicado, con aviso «sin verificar». No son datos reales ni tienen por qué existir. Un fantasma se sustituye por la posición real cuando un viajero comparte ese bus (se asocia por la hora de salida indicada o, si no la hay, por posición y retraso). Se calculan en el navegador con `src/ghostBuses.ts`; el servidor no interviene. Se pueden ocultar desde el aviso sobre el mapa.
- Imagen Docker y volumen SQLite persistente para desplegar una sola instancia.

## Horarios y fuentes

Los horarios incorporados en la app se transcribieron del PDF del operador publicado en julio de 2025 y corresponden a la tabla de días laborables de ese documento. La app calcula la hora de paso en cada parada a partir de las columnas del PDF; incluye ambos sentidos y advierte que el tráfico afecta a la puntualidad. No debe considerarse un horario en tiempo real: puede cambiar por temporada, festivos, huelgas o incidencias. La app enlaza la página del operador para que el viajero lo confirme antes de salir.

BusGarraf describe el viaje como unos 50 km y alrededor de 1 h 15 min. La web oficial enumera las paradas desde Plaça Eduard Maristany, en Vilanova, pasando por Cubelles, Cunit, Segur y Calafell hasta la estación de autobuses de Tarragona. El mapa dibuja una ruta de calles de OpenStreetMap calculada con OSRM pasando por las paradas publicadas en orden; es una referencia vial, no el recorrido GPS oficial del operador. Los nombres y el orden proceden de BusGarraf. Las coordenadas de parada se contrastaron con el GTFS de la Generalitat y el inventario municipal de Vilanova; hay diferencias entre ese GTFS y la lista pública del operador, por lo que algunos postes se contrastaron por su nombre.

Fuentes consultadas el 25 de septiembre de 2026:

- [BusGarraf — líneas y paradas](https://busgarraf.cat/es/lineas/)
- [BusGarraf — consulta de horarios](https://busgarraf.cat/es/busgarraf-consulta-los-horarios-de-todas-nuestras-lineas/)
- [BusGarraf — tarifas oficiales](https://busgarraf.cat/es/tarifas/)
- [BusGarraf — PDF de días laborables, publicado en julio de 2025](https://busgarraf.cat/wp-content/uploads/2025/07/Vilanova-i-la-Geltru-Cubelles-Cunit-Segur-de-Calafell-Calafell-Tarragona.pdf)
- [Generalitat de Catalunya — GTFS de líneas, horarios y paradas](https://territori.gencat.cat/ca/serveis/visors-cartografia/bases-cartografiques/infraestructures-mobilitat/autobusos-interurbans/)
- [Ajuntament de Vilanova i la Geltrú — información del bus interurbano](https://www.vilanova.cat/mobilitat/bus_interurba)
- [OSRM — documentación de la API de rutas](https://project-osrm.org/docs/v5.6.4/api/)
- [Política de uso de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)

Durante esta investigación no encontré un feed/API público del operador con posiciones en vivo. Por eso las señales de la app son comunitarias y deben etiquetarse como no oficiales.

## Desarrollo local

Requiere Node.js 20.19 o posterior y npm.

```sh
npm ci
npm run dev
```

Abre la URL de Vite que se muestra en el terminal. El servidor de desarrollo reenvía `/api` al servidor Express en el puerto 4174. La geolocalización requiere un contexto seguro: normalmente el navegador permite `localhost`; una web desplegada necesita HTTPS.

Compilación de producción y servidor local:

```sh
npm ci
npm run build
npm start
```

La API y los archivos compilados se sirven juntos en el puerto 4174 por defecto. El puerto, la ruta de la base de datos y el número de proxies de confianza se configuran con `PORT`, `DATABASE_PATH` y `TRUST_PROXY`; consulta `.env.example`.

## Despliegue con Docker

```sh
docker compose up -d --build
```

El servicio queda en `127.0.0.1:${HOST_PORT:-4175}` del host y guarda SQLite en el volumen `mapgarraf-data`. Antes de exponerlo a viajeros, colócalo detrás de un proxy con TLS: HTTPS es necesario para geolocalización e instalación PWA. Si hay exactamente un proxy de confianza delante de Express, configura `TRUST_PROXY=1`. No escales esta configuración SQLite a varias instancias; antes migra a una base de datos transaccional compartida y a infraestructura compartida para sesiones/límites.

Antes de un lanzamiento público, añade un contacto visible, configura copias de seguridad y monitorización, revisa el aviso de privacidad de ubicación con quien opere el servicio y confirma el plazo de conservación. Las teselas públicas de OpenStreetMap son comunitarias, de mejor esfuerzo y sin SLA; la app respeta la caché del navegador y no descarga teselas por adelantado ni las guarda offline. Cambia `VITE_TILE_URL` durante la compilación para usar un proveedor contratado o teselas propias. Si el proveedor requiere otro origen o protocolo, revisa la CSP.

## API

- `GET /health` — disponibilidad del proceso y la base de datos.
- `GET /api/vehicles?direction=to-tarragona|to-vilanova` — señales comunitarias activas.
- `POST /api/vehicles` — crea una señal y devuelve un `shareToken` de un solo uso.
- `PATCH /api/vehicles/:id` — actualiza una señal mediante `x-share-token`.
- `DELETE /api/vehicles/:id` — deja de compartir mediante `x-share-token`.

Los endpoints de lectura nunca devuelven el token. El cliente lo conserva solo en memoria y SQLite guarda su hash. Si se cierra o recarga la app, ya no se puede detener manualmente esa sesión; la señal deja de mostrarse tras 3 minutos sin GPS y se elimina del servidor en un máximo de 24 horas. Desde la pantalla activa se puede retirar inmediatamente.
