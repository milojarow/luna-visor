# Iconos ICO de aplicaciones

Luna admite ICO únicamente en bóvedas públicas que conservan el formato (raw o efímeras). Se guardan los bytes y extensión originales, sin convertirlos ni generar miniaturas. Las bóvedas normales de imágenes los rechazan.

El validador comprueba cabecera ICO, número y límites de entradas, y que cada imagen contenga PNG o DIB. Sólo lee la cabecera/directorio y ocho bytes por entrada, sin cargar archivos grandes en memoria. El MIME se fija como image/vnd.microsoft.icon aunque el multipart declare otro.

Esto permite que instaladores nativos descarguen el icono original desde Luna por URL y SHA256, sin llevar el binario en GitHub ni Vercel. No se cambia la lista de documentos permitidos en bóvedas públicas.
