# MapGarraf · BusGarraf Tarragona ↔ Vilanova

PWA mobile-first e instalable desde el navegador para viajeros de la línea Vilanova i la Geltrú–Tarragona. Permite compartir voluntariamente el GPS del móvil, el sentido del viaje y datos opcionales útiles (salida y ocupación); el resto de viajeros ve señales recientes sobre un mapa, la próxima parada y una estimación automática de puntualidad.

Es un proyecto comunitario independiente, no un producto de BusGarraf. No recibe telemetría del operador: cada marcador significa que un viajero ha compartido el GPS de su dispositivo, no que BusGarraf haya confirmado la posición o la hora de llegada. La app no solicita la ubicación hasta pulsar **Compartir este bus**.

## Incluye

- Interfaz React/Vite adaptada a móvil, manifiesto PWA, iconos y caché del shell de la app.
- Mapa Leaflet con las 16 paradas mostradas individualmente, coordenadas por sentido y un trazado por calles calculado sobre OpenStreetMap con OSRM.
- Selector de sentido, señales comunitarias recientes, compartir/detener con un toque y opciones de salida y ocupación. La app estima el retraso comparando el GPS con el horario; se puede indicar la salida para mejorar la estimación, o se infiere la más probable. El resultado no es oficial y puede ser incierto si no se conoce el servicio exacto.
- API Express con validación Zod, cabeceras Helmet, límites de uso, token aleatorio por señal, SQLite persistente y caducidad automática.
- Una señal se considera en vivo durante 3 minutos tras su última lectura GPS. Pasado ese tiempo, el mapa deja de mostrar el punto exacto y lo sustituye por una posición estimada: la última lectura real avanzada a lo largo del horario, conservando el retraso que llevaba (hasta 20 minutos; después el bus vuelve a ser un fantasma sin verificar). Para que el cliente pueda estimar, el servidor sigue sirviendo la última posición exacta hasta 20 minutos, así que **las coordenadas exactas son públicas hasta 20 minutos tras la última lectura**, salvo que el viajero pulse «Dejar de compartir», que la borra al instante. Todo se borra de la base de datos en 24 horas. No se pide cuenta, nombre ni identificador del dispositivo.
- Buses fantasma: de lunes a viernes, cada servicio del horario en curso se dibuja donde debería estar según el horario publicado, con aviso «sin verificar». No son datos reales ni tienen por qué existir. Un fantasma se sustituye por la posición real cuando un viajero comparte ese bus (se asocia por la hora de salida indicada o, si no la hay, por posición y retraso). Se calculan en el navegador con `src/ghostBuses.ts`; el servidor no interviene. Se pueden ocultar desde el aviso sobre el mapa.
- Imagen Docker y volumen SQLite persistente para desplegar una sola instancia.

## Horarios y fuentes

Los horarios incorporados en la app se transcribieron del PDF vigente del operador (consultado el 25 de septiembre de 2026; el archivo se modificó el 22 de septiembre de 2026) y corresponden a su tabla normal de días laborables, con 18 salidas en cada sentido. Ese PDF incluye además una tabla aparte del 3 al 31 de agosto de 2026 que no se usa. En la tabla normal algunas filas aparecen repetidas (ida 08:15, 11:30 y 17:15; vuelta 09:30, 12:45 y 18:30); se cuentan como un solo servicio porque el documento no aclara si son dos vehículos. La app calcula la hora de paso en cada parada a partir de las columnas del PDF; incluye ambos sentidos y advierte que el tráfico afecta a la puntualidad. No debe considerarse un horario en tiempo real: puede cambiar por temporada, festivos, huelgas o incidencias. La app enlaza la página del operador para que el viajero lo confirme antes de salir.

BusGarraf describe el viaje como unos 50 km y alrededor de 1 h 15 min. La web oficial enumera las paradas desde Plaça Eduard Maristany, en Vilanova, pasando por Cubelles, Cunit, Segur y Calafell hasta la estación de autobuses de Tarragona. El mapa dibuja una ruta de calles de OpenStreetMap calculada con OSRM pasando por las paradas publicadas en orden; es una referencia vial, no el recorrido GPS oficial del operador. Los nombres y el orden proceden de BusGarraf. Las coordenadas de parada se contrastaron con el GTFS de la Generalitat y el inventario municipal de Vilanova; hay diferencias entre ese GTFS y la lista pública del operador, por lo que algunos postes se contrastaron por su nombre.

Fuentes consultadas el 25 de septiembre de 2026:

- [BusGarraf — líneas y paradas](https://busgarraf.cat/es/lineas/)
- [BusGarraf — consulta de horarios](https://busgarraf.cat/es/busgarraf-consulta-los-horarios-de-todas-nuestras-lineas/)
- [BusGarraf — tarifas oficiales](https://busgarraf.cat/es/tarifas/)
- [BusGarraf — PDF de días laborables (versión vigente)](https://busgarraf.cat/wp-content/uploads/2025/09/Vilanova-Tarragona.pdf)
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
- `GET /api/vehicles?direction=to-tarragona|to-vilanova` — señales comunitarias de los últimos 20 minutos (`ageSeconds` indica su antigüedad; las de más de 3 minutos son solo para estimar).
- `POST /api/vehicles` — crea una señal y devuelve un `shareToken` de un solo uso.
- `PATCH /api/vehicles/:id` — actualiza una señal mediante `x-share-token`.
- `DELETE /api/vehicles/:id` — deja de compartir mediante `x-share-token`.

Los endpoints de lectura nunca devuelven el token. El cliente lo conserva solo en memoria y SQLite guarda su hash. Si se cierra o recarga la app, ya no se puede detener manualmente esa sesión; la señal pasa a mostrarse como estimación a los 3 minutos sin GPS, su última posición exacta sigue disponible por la API hasta 20 minutos y se elimina del servidor en un máximo de 24 horas. Desde la pantalla activa se puede retirar inmediatamente.
