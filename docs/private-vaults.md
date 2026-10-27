# Bóvedas privadas

`POST /api/clients` admite `is_private:true`. Es una política de creación que no puede cambiarse con PATCH. Fuerza `preserve_format:1`; se puede combinar con `is_ephemeral:true` para conservar la caducidad de 24 horas. Sin esa bandera, la aplicación controla su retención mediante DELETE.

Las bóvedas existentes siguen siendo públicas. No se convierten archivos antiguos ni se altera su URL. Los archivos privados se guardan en `MEDIA_PATH/private-files` (directorio0700, archivos0600), fuera de `MEDIA_PATH/files`, que sirve Caddy. Nunca pasan por Sharp/ffmpeg ni generan variantes públicas.

Los clientes privados pueden guardar cualquier adjunto. El MIME se detecta por los bytes. HTML/SVG/PDF/archivos no reconocidos se descargan como adjuntos con `nosniff` y CSP sandbox; no se ejecutan en el origen de Luna. El mismo contenido sigue rechazándose en una bóveda pública cuando no cumple su lista de formatos.

`cdn_url` de una carga privada identifica `LUNA_BASE_URL/api/files/UUID/content`, una URL estable que exige autorización. GET/HEAD admiten Range. La llave del cliente se envía en X-API-Key desde el backend, nunca desde el JavaScript del navegador. La sesión del dueño y un socio con alcance también pueden leerla; una llave admin puede gestionar metadatos y emitir llaves de cliente, pero no leer bytes directamente. Una llave ajena/revocada recibe403/401. Respuestas `private,no-store`, sin caché compartida.

Cada aplicación mantiene la autorización de su conversación/usuario antes de pedir el contenido a Luna. Su ruta autenticada puede transmitir la respuesta y los rangos desde Luna en Selene, sin almacenar multimedia ni transportarla por Vercel. No hay enlaces públicos ni tokens en el query string. Las API keys siguen fuera del frontend.

Mover/copiar entre políticas pública y privada devuelve409 en ambas direcciones, incluso al dueño: no se puede publicar un adjunto por accidente ni fingir que un archivo previamente público se volvió privado. Copiar/mover dentro de bóvedas privadas conserva el aislamiento de permisos. DELETE y caducidad eliminan los bytes privados; replace conserva UUID y no reinicia created_at.

La operación requiere configurar `LUNA_BASE_URL` en el servidor. Sin ese origen, crear una bóveda privada falla con503 en lugar de producir una URL pública equivocada.

Pruebas aisladas: autenticación/alcance/socios/admin/revocación; Range y HEAD; bytes y permisos; descarga segura frente a MIME falso; fronteras públicas/privadas; replace/copy/delete; rollback ante fallos SQLite; caducidad. Nunca usan conversaciones reales.

Las bóvedas privadas tienen un tope predeterminado de30GiB cada una; `LUNA_PRIVATE_MAX_BYTES` permite ajustarlo desde el entorno. Se reserva1GiB libre de disco (`LUNA_PRIVATE_DISK_RESERVE_BYTES`) antes de crear/copiar/reemplazar bytes. La comprobación de cuota y el INSERT son síncronos después de detectar el tipo: las subidas concurrentes no eluden el tope. La aplicación conserva además sus límites y cupos de usuario.
