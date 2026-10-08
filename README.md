# Denuncias Ciudadanas – Municipalidad de Santiago

Chatbot que responde los mensajes privados (MD) que los vecinos envían por **WhatsApp, Instagram y Facebook Messenger**. Registra cada denuncia, la deriva automáticamente al departamento que corresponde y la muestra en un **panel web** donde cada equipo ve sólo sus denuncias, divididas por **sector (barrio)**.

```
Vecino (WhatsApp / Instagram / Facebook)
        │  "Hay un bache enorme en calle Lira 450"
        ▼
  Webhook de Meta ──► Bot ──► clasifica: Obras Públicas · sector San Borja
        │                     crea folio SCL-2026-000123
        ▼                     responde al vecino al instante
  Panel web ──► el equipo de Obras Públicas ve la denuncia, la gestiona y
               el vecino recibe un aviso cuando cambia de estado
```

## Qué hace

**Bot**
- Responde en segundos con un **número de folio** y el departamento al que se derivó la denuncia.
- Clasifica la denuncia por palabras clave en: Aseo y Ornato (basura, microbasurales), Obras Públicas (baches, veredas), Plazas y Parques, Alumbrado Público, Tránsito, Seguridad Municipal, Medio Ambiente y OIRS (lo que no calza con ningún otro; OIRS lo revisa a mano).
- Detecta el **sector/barrio** a partir de la dirección (Yungay, Brasil, Lastarria, Matta Sur, Franklin, etc.). Si el mensaje no trae dirección, el bot la pide.
- Agrega a la misma denuncia las fotos, la ubicación y los mensajes adicionales (durante 30 minutos desde el último mensaje).
- Comandos para el vecino: `ESTADO` (consultar sus denuncias) y `NUEVA` (hacer otra denuncia).
- Ignora los webhooks duplicados (Meta los reenvía) y verifica la firma de Meta.

**Panel web**
- **Usuario de equipo**: sólo ve las denuncias de su departamento. Esto lo controla el servidor, así que un usuario de equipo no puede saltárselo.
- **Administrador**: ve todas las denuncias, con conteos por departamento y por sector. Administra los usuarios.
- Filtros por sector, estado, canal, fechas y texto. Exportación a CSV (Excel).
- Detalle de cada denuncia: la conversación completa, cambio de estado (*Nueva → En proceso → Resuelta / Rechazada*) que **avisa automáticamente al vecino**, derivación a otro departamento si el bot se equivocó, notas internas y mensajes directos al vecino.
- **Simulador de chat** para probar el bot sin conectar Meta.

## Instalar y probar (5 minutos)

Requiere **Node.js 22.13 o superior**. No necesita una base de datos externa: usa el SQLite que viene incluido en Node.

```bash
npm install
npm run demo     # opcional: denuncias de ejemplo + un usuario por departamento (contraseña demo1234)
npm start        # http://localhost:3000
```

- Ingrese como `admin` / `demo1234` para ver todo, o como `obras`, `aseo`, `parques`, `alumbrado`, `transito`, `seguridad`, `medioambiente` u `oirs` para ver la vista de un equipo.
- Sin `npm run demo`, el primer arranque crea el usuario `admin`. Su contraseña es la de `ADMIN_PASSWORD` (`.env`) o, si está vacía, una aleatoria que se imprime en la consola.
- Use la pestaña **Simulador** para conversar con el bot como si fuera un vecino.

Puede crear usuarios reales desde la pestaña **Usuarios** (administrador) o desde la consola:

```bash
npm run crear-usuario -- jperez ClaveSegura123 obras "Juan Pérez"
npm run crear-usuario -- mgonzalez OtraClave456 admin "María González"
```

## Conectar WhatsApp, Instagram y Facebook

Los tres canales pasan por **Meta for Developers**, con una sola app y un solo webhook.

1. **Publique el servidor con HTTPS.** Meta sólo envía webhooks a direcciones `https://`. Puede ser un servidor municipal detrás de un proxy con certificado, o un servicio como Render, Railway o Fly.io. Para pruebas puede usar `ngrok http 3000`.
2. Copie `.env.example` como `.env` y complete `PUBLIC_URL`, `ADMIN_PASSWORD` y `META_VERIFY_TOKEN` (un texto que usted invente).
3. En <https://developers.facebook.com>, cree una app de tipo **Negocios** vinculada al Business Manager de la Municipalidad. Copie la **clave secreta de la app** (Configuración → Básica) en `META_APP_SECRET`.
4. **WhatsApp**: agregue el producto *WhatsApp*, registre el número municipal y cree un token permanente (usuario del sistema del Business Manager con el permiso `whatsapp_business_messaging`). Póngalo en `WHATSAPP_TOKEN`. En *Configuración → Webhook*, ingrese `https://SU-DOMINIO/webhook` y el `META_VERIFY_TOKEN`, y suscríbase al campo **messages**.
5. **Facebook Messenger**: agregue el producto *Messenger*, conecte la página de Facebook de la Municipalidad y genere el **token de la página**. Póngalo en `FB_PAGE_ACCESS_TOKEN`. Configure el mismo webhook y suscriba la página a **messages**.
6. **Instagram**: la cuenta de Instagram debe ser **profesional** y estar vinculada a la página de Facebook. Agregue *Instagram* (mensajería) y suscríbase a **messages** con el mismo webhook. Por defecto se usa el token de la página; si Meta le entrega uno distinto, use `INSTAGRAM_ACCESS_TOKEN`. En la app de Instagram, active *Configuración → Mensajes → Permitir acceso a los mensajes*.
7. Solicite los permisos en **Revisión de la app** (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`) y pase la app a modo **Activo**. Mientras tanto, sólo los administradores y evaluadores de la app pueden escribirle al bot.
8. En producción: `NODE_ENV=production` (el servidor no arranca sin `META_APP_SECRET`) y `ENABLE_SIMULATOR=false`.

> **Ventana de 24 horas de Meta:** el vecino recibe respuesta inmediata porque él escribió primero. Un aviso de cambio de estado enviado **más de 24 horas** después del último mensaje del vecino puede ser rechazado por Meta; en WhatsApp requeriría una *plantilla* aprobada. En ese caso el panel muestra "⚠ No entregado" en el mensaje y el equipo puede contactar al vecino por otra vía.

## Personalizar

- **Departamentos, palabras clave y sectores**: `src/catalog.js`. Agregue las palabras que usan los vecinos (por ejemplo, chilenismos) o cambie los barrios por la división territorial oficial de la Municipalidad.
- **Textos del bot**: `MESSAGES` en `src/bot.js`.
- **Cuánto tiempo queda abierta una conversación**: `CONVERSATION_WINDOW_MINUTES`.

## Estructura

```
src/
  server.js      punto de entrada
  app.js         API REST, webhook, sesiones y permisos por equipo
  bot.js         flujo de conversación y respuestas
  classifier.js  clasificación por departamento y detección de sector
  catalog.js     departamentos, palabras clave, sectores, estados
  meta.js        lectura de webhooks y envío por WhatsApp / Messenger / Instagram
  tickets.js     acceso a datos
  db.js, auth.js
public/          panel web (HTML/CSS/JS sin dependencias)
scripts/         demo y creación de usuarios
test/            pruebas (npm test)
```

## Próximos pasos posibles

- Descargar las fotos de WhatsApp al servidor (hoy se guarda el `id` del archivo) y mostrarlas en el panel.
- Usar un modelo de IA para clasificar las denuncias ambiguas, en vez de sólo palabras clave.
- Un mapa de denuncias por sector y un reporte del tiempo promedio de resolución por departamento.
- Alertas por correo a cada jefatura cuando llega una denuncia nueva.
- Inicio de sesión único con las cuentas de la Municipalidad (Microsoft 365 / Google Workspace).
