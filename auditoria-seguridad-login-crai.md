# Encargo para Codex: auditoría del inicio de sesión de CRAI Sniper

## Objetivo

Realiza una auditoría de seguridad autorizada del inicio de sesión y del almacenamiento de credenciales de:

- Sitio: https://crai.nekokoneko.org/
- Página: https://crai.nekokoneko.org/login?next=%23%2Fbook
- API de interés: `/api/login`, `/api/session` y las rutas administrativas expuestas por el JavaScript público.

El administrador declara que el sitio y sus datos son de prueba. Comprueba si existe una vía para acceder sin autorización a cuentas o credenciales y determina, revisando el backend cuando esté disponible, cómo se almacenan las credenciales.

## Límites de alcance

- Limita el trabajo a `crai.nekokoneko.org` y al código o entorno de pruebas que el usuario proporcione.
- No pruebes ni ataques el proveedor de identidad URV ni otros dominios.
- No uses credenciales reales. Para pruebas de flujo, utiliza una cuenta sintética y un backend/IdP de pruebas aislado.
- No hagas fuerza bruta, credential stuffing, denegación de servicio, cambios de reservas, borrados ni escrituras innecesarias.
- No extraigas, imprimas ni guardes contraseñas o listas completas de usuarios. Si una petición llega a devolver registros, detén esa rama y documenta solo el código HTTP, el tipo de respuesta y campos redactados.
- No ejecutes escáneres automáticos de alta intensidad. Mantén las peticiones de red limitadas y de lectura siempre que sea posible.
- Si no se puede confirmar que el entorno o el IdP son de prueba, limita la revisión a código y peticiones anónimas de lectura.

## Evidencia ya observada

Usa estos datos como contexto, no como sustituto de una nueva verificación:

- `GET /api/session` sin sesión devolvió `200` y `{"authenticated":false}`.
- Las peticiones anónimas a `/api/admin/users`, `/api/admin/accounts`, `/api/admin/reservations`, `/api/admin/activity` y `/api/admin/queue` devolvieron `401`.
- Variantes de ruta con barras codificadas, doble barra, segmento `.` y barra final también devolvieron `401` en `/api/admin/users`.
- Las cabeceras `X-Original-URL`, `X-Rewrite-URL`, `X-Forwarded-For`, `X-Remote-User`, `X-Authenticated-User` y `X-Forwarded-User` no cambiaron ese resultado.
- `HEAD` y `OPTIONS` sobre `/api/admin/users` devolvieron `401`.
- `/login.js.map` devolvió `404`.
- El JavaScript público envía el formulario como JSON a `/api/login`. El texto de la página afirma que las credenciales se guardan cifradas para reutilizarlas; ese almacenamiento no se ha verificado.
- Las respuestas observadas no incluían `Content-Security-Policy` con `frame-ancestors`, `X-Frame-Options` ni `Strict-Transport-Security`. HTTP redirigía a HTTPS.

## Trabajo solicitado

1. **Localiza el backend.** Revisa el repositorio o los archivos de proyecto disponibles y las instrucciones `AGENTS.md`. Identifica el manejador de `/api/login`, el middleware de autenticación/autorización, el almacenamiento de sesión/credenciales y el sistema de logs. Si el backend no está disponible, dilo claramente y no infieras detalles internos a partir del frontend.

2. **Comprueba el control de acceso.** Repite de forma acotada las comprobaciones anónimas de las rutas administrativas que aparezcan en el código. Examina autorización por ruta y método, variantes de normalización, CORS y cabeceras de proxy confiables. Registra estados y evidencia mínima, evitando cuerpos que puedan contener datos personales.

3. **Revisa el flujo de credenciales.** Sigue username/password desde el formulario hasta el backend y cualquier integración externa. Confirma si las contraseñas:
   - se registran en logs, trazas, analítica o mensajes de error;
   - se devuelven en alguna respuesta de API;
   - se almacenan en texto claro, con hash o cifradas;
   - se cifran con un esquema autenticado y claves protegidas fuera de la base de datos;
   - aparecen en backups o exportaciones según la configuración disponible.

4. **Prueba almacenamiento solo con datos sintéticos.** Hazlo únicamente en entorno aislado y con una cuenta creada para la prueba. No envíes credenciales a URV real. No muestres el valor de la contraseña: informa si el valor coincide con el marcador de prueba, si es recuperable, o si se observó como cifrado/hash, junto con la evidencia técnica necesaria y redactada.

5. **Revisa controles del navegador y sesión.** Comprueba cookies tras una autenticación sintética autorizada (flags `Secure`, `HttpOnly`, `SameSite`), protección CSRF, expiración/revocación de sesión, política de `next`, limitación de intentos mediante revisión de configuración y políticas, y cabeceras anti-frame/HSTS. No hagas múltiples intentos de contraseña contra un IdP externo.

6. **Valida hallazgos de forma segura.** Para cualquier posible bypass, limita la prueba a una petición de lectura. Si una ruta devuelve contenido que parece incluir usuarios, sesiones o secretos, para inmediatamente; no copies ni enumeres esos datos.

## Entrega

Devuelve un informe en Markdown que incluya:

- resumen ejecutivo;
- alcance exacto y límites aplicados;
- hallazgos con severidad, evidencia reproducible y mitigación;
- resultados negativos relevantes;
- qué no pudo verificarse y qué acceso o artefacto hace falta.

Distingue entre vulnerabilidad confirmada, riesgo de diseño y recomendación de hardening. No afirmes que las credenciales están en texto claro ni que el sistema es seguro sin evidencia del backend. Nunca incluyas contraseñas, tokens, cookies de sesión ni datos personales en el informe.
