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

Requiere **Node.js 22**. Para probar en su computador no necesita instalar una base de datos: si no hay `DATABASE_URL`, se usa un PostgreSQL local incluido (PGlite), que guarda los datos en la carpeta `data/`. En Vercel se usa Supabase (vea [Publicar en Vercel](#publicar-en-vercel)).

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

## Publicar en Vercel

El repositorio ya viene preparado para Vercel (`vercel.json` y `api/index.js`): el panel se sirve como sitio estático y la API y el webhook corren como una función.

**¿Por qué hace falta Supabase?** En Vercel el disco es temporal: una base guardada en archivos se borraría en cada despliegue o reinicio, y con ella las denuncias. Por eso en Vercel los datos se guardan en **Supabase**, una base PostgreSQL en la nube con plan gratuito. Si falta, el sistema no arranca y muestra el mensaje *"Falta DATABASE_URL"*, en vez de perder datos sin avisar.

1. **Cree el proyecto en Supabase.** En <https://supabase.com/dashboard>, elija *New project*. Use la región **South America (São Paulo)**, la más cercana a Chile, y guarde la contraseña de la base que le pide.
   - No hay que crear tablas a mano: el sistema las crea solo la primera vez que arranca. Además, les activa *Row Level Security*, para que no se puedan leer desde la API pública de Supabase.
2. **Copie la cadena de conexión.** En el proyecto de Supabase, presione **Connect** y elija **Transaction pooler** (puerto `6543`). Copie la URI y reemplace `[YOUR-PASSWORD]` por la contraseña de la base. Queda así:
   `postgresql://postgres.abcdefgh:SU-CONTRASEÑA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`
   - Use el *Transaction pooler*, no la *Direct connection*: Vercel crea muchas conexiones cortas, y la conexión directa usa IPv6, que Vercel no soporta.
   - Si la contraseña tiene símbolos como `@`, `#` o `/`, cámbiela por una sin símbolos, o escríbalos codificados (`@` → `%40`).
3. **Importe el proyecto en Vercel.** En <https://vercel.com/new>, elija *Import Git Repository* y seleccione `moiniwedding/chatbottrial`. No cambie la configuración de compilación (el *Framework Preset* queda en *Other*). Las funciones ya están configuradas para correr en São Paulo (`gru1`), junto a la base.
   - Vercel publica en producción la rama principal (`main`). Si el código todavía está en otra rama, únala a `main` (merge del pull request) o cambie la rama de producción en *Settings → Environments → Production*.
4. **Agregue las variables de entorno** en *Settings → Environment Variables* (ambiente *Production*):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La cadena de conexión del paso 2 |
   | `ADMIN_PASSWORD` | Contraseña del usuario `admin` (se crea la primera vez que alguien entra) |
   | `META_VERIFY_TOKEN` | Un texto que usted invente, el mismo que pondrá en Meta |
   | `META_APP_SECRET` | Clave secreta de la app de Meta (obligatoria en producción) |
   | `WHATSAPP_TOKEN`, `FB_PAGE_ACCESS_TOKEN` | Tokens de WhatsApp y de la página de Facebook |
   | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET` | Para Instagram (vea más abajo) |
   | `ENABLE_SIMULATOR` | `false` cuando ya esté en uso real |
   | `DATABASE_CA_CERT` | Opcional, recomendado: el contenido del certificado de Supabase (*Project Settings → Database → SSL Configuration → Download certificate*). Con él se verifica que la conexión sea realmente con Supabase. |

   Si prefiere conectar Supabase desde *Vercel → Storage* (integración de Supabase), no necesita `DATABASE_URL`: el sistema usa la variable `POSTGRES_URL` que crea esa integración.

5. **Despliegue** (*Deployments → Redeploy*, o haga un push a `main`). Abra `https://SU-PROYECTO.vercel.app` y entre como `admin` con la contraseña de `ADMIN_PASSWORD`.
6. **Configure Meta** con la URL del webhook `https://SU-PROYECTO.vercel.app/webhook`. Use siempre el dominio de **producción**: las URL de vista previa de Vercel están protegidas con inicio de sesión y Meta no puede llegar a ellas.
7. **Cree los usuarios de cada equipo** en la pestaña *Usuarios*. También puede hacerlo desde su computador: ponga `DATABASE_URL` en su `.env` y use `npm run crear-usuario`, que trabaja directo sobre la base de producción.

Al cambiar una variable de entorno en Vercel, hay que volver a desplegar para que tome efecto.

**Respaldo y consultas:** las denuncias quedan en las tablas `tickets` (denuncias), `messages` (conversación e historial), `users`, `sessions` y `conversations` de Supabase. Puede verlas en el *Table Editor* o consultarlas en el *SQL Editor*. Las contraseñas de los funcionarios se guardan cifradas (scrypt).

**Plan de Supabase:** el plan gratuito sirve para empezar, pero pausa los proyectos que pasan una semana sin actividad y sus respaldos son limitados. Para uso real con denuncias de vecinos, conviene el plan pagado (respaldos diarios y sin pausas), o al menos exportar las denuncias a CSV desde el panel con regularidad.

## Conectar WhatsApp, Instagram y Facebook

Los tres canales pasan por **Meta for Developers**, con una sola app y un solo webhook.

1. **Publique el servidor con HTTPS.** Meta sólo envía webhooks a direcciones `https://`. Lo más simple es [Vercel](#publicar-en-vercel). También sirve un servidor municipal detrás de un proxy con certificado (`npm start`). Para pruebas locales puede usar `ngrok http 3000`.
2. Copie `.env.example` como `.env` y complete `PUBLIC_URL`, `ADMIN_PASSWORD` y `META_VERIFY_TOKEN` (un texto que usted invente).
3. En <https://developers.facebook.com>, cree una app de tipo **Negocios** vinculada al Business Manager de la Municipalidad. Copie la **clave secreta de la app** (Configuración → Básica) en `META_APP_SECRET`.
4. **WhatsApp**: agregue el producto *WhatsApp*, registre el número municipal y cree un token permanente (usuario del sistema del Business Manager con el permiso `whatsapp_business_messaging`). Póngalo en `WHATSAPP_TOKEN`. En *Configuración → Webhook*, ingrese `https://SU-DOMINIO/webhook` y el `META_VERIFY_TOKEN`, y suscríbase al campo **messages**.
5. **Facebook Messenger**: agregue el producto *Messenger*, conecte la página de Facebook de la Municipalidad y genere el **token de la página**. Póngalo en `FB_PAGE_ACCESS_TOKEN`. Configure el mismo webhook y suscriba la página a **messages**.
6. **Instagram**: vea la sección [Conectar Instagram](#conectar-instagram-paso-a-paso) más abajo.
7. Solicite los permisos en **Revisión de la app** (`whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`) y pase la app a modo **Activo**. Mientras tanto, sólo los administradores y evaluadores de la app pueden escribirle al bot.
8. En producción: `NODE_ENV=production` (el servidor no arranca sin `META_APP_SECRET`) y `ENABLE_SIMULATOR=false`.

## Conectar Instagram paso a paso

Cuando alguien envía un MD a la cuenta de Instagram de la Municipalidad, el bot le responde automáticamente en el mismo chat de Instagram. La denuncia aparece en el panel con canal **Instagram**, con el nombre y @usuario de quien escribió, y llega al equipo que corresponde.

**Requisitos de la cuenta**
- La cuenta de Instagram debe ser **profesional** (Empresa o Creador): *Configuración → Tipo de cuenta y herramientas*.
- En la app de Instagram, active *Configuración → Mensajes y respuestas a historias → Herramientas conectadas → Permitir acceso a los mensajes*.

Hay dos formas de conectarla. Use **una** de las dos.

### Opción A (recomendada): API de Instagram con inicio de sesión de Instagram
No necesita una página de Facebook.

1. En su app de Meta for Developers, agregue el producto **Instagram** y elija *API con inicio de sesión de Instagram*.
2. En *Generar tokens de acceso*, agregue la cuenta de Instagram de la Municipalidad y genere el token (empieza con `IGAA…`). Póngalo en `INSTAGRAM_ACCESS_TOKEN`.
3. Copie la **clave secreta de la app de Instagram**, que aparece en la misma pantalla y es distinta de la clave de Meta, en `INSTAGRAM_APP_SECRET`.
4. En *Configurar webhooks*: URL `https://SU-DOMINIO/webhook`, el mismo `META_VERIFY_TOKEN`, y suscríbase a **messages** y **messaging_postbacks**.

### Opción B: a través de la página de Facebook
1. Vincule la cuenta de Instagram a la página de Facebook de la Municipalidad (desde *Meta Business Suite → Configuración → Cuentas de Instagram*).
2. Use el mismo `FB_PAGE_ACCESS_TOKEN` de Messenger y deje `INSTAGRAM_ACCESS_TOKEN` vacío. El token necesita los permisos `instagram_basic`, `instagram_manage_messages` y `pages_manage_metadata`.
3. En el producto *Webhooks*, elija el objeto **Instagram** y suscríbase a **messages** y **messaging_postbacks**.

### Terminar la conexión (ambas opciones)
```bash
npm run instagram -- verificar     # confirma el token y muestra la cuenta (@usuario)
npm run instagram -- suscribir     # suscribe la cuenta para recibir los MD en el webhook
npm run instagram -- rompehielos   # agrega los botones "Quiero hacer una denuncia" y "¿Cómo va mi denuncia?"
```
Al iniciar, el servidor muestra en la consola si Instagram quedó configurado.

**Prueba:** desde otra cuenta de Instagram (que sea administradora o evaluadora de la app mientras no esté aprobada), envíe un MD como *"Hay basura sin recoger en la plaza Yungay"*. Debe recibir el folio en segundos, y la denuncia debe aparecer en el panel con el canal Instagram.

**Antes de abrirlo al público:** solicite en *Revisión de la app* el permiso `instagram_business_manage_messages` (opción A) o `instagram_manage_messages` (opción B), y pase la app a modo **Activo**.

**Lo que también se registra:** fotos y videos, menciones de la cuenta en historias y respuestas a historias. Todo queda en la denuncia con su enlace.

> **Ventana de 24 horas de Meta:** el vecino recibe respuesta inmediata porque él escribió primero. Un aviso de cambio de estado enviado **más de 24 horas** después del último mensaje del vecino puede ser rechazado por Meta; en WhatsApp requeriría una *plantilla* aprobada. En ese caso el panel muestra "⚠ No entregado" en el mensaje y el equipo puede contactar al vecino por otra vía.

## Personalizar

- **Departamentos, palabras clave y sectores**: `src/catalog.js`. Agregue las palabras que usan los vecinos (por ejemplo, chilenismos) o cambie los barrios por la división territorial oficial de la Municipalidad.
- **Textos del bot**: `MESSAGES` en `src/bot.js`.
- **Cuánto tiempo queda abierta una conversación**: `CONVERSATION_WINDOW_MINUTES`.

## Estructura

```
api/index.js     función de Vercel (usa src/runtime.js)
vercel.json      configuración de Vercel: sitio estático + función para /api, /webhook y /health
src/
  server.js      punto de entrada para un servidor propio (npm start)
  runtime.js     arma la aplicación: revisa la configuración, abre la base y crea el admin
  app.js         API REST, webhook, sesiones y permisos por equipo
  bot.js         flujo de conversación y respuestas
  classifier.js  clasificación por departamento y detección de sector
  catalog.js     departamentos, palabras clave, sectores, estados
  meta.js        lectura de webhooks y envío por WhatsApp / Messenger / Instagram
  tickets.js     acceso a datos
  db.js          base de datos PostgreSQL: Supabase, o PGlite local para desarrollo
  auth.js        usuarios, contraseñas y sesiones
public/          panel web (HTML/CSS/JS sin dependencias)
scripts/         demo, creación de usuarios y configuración de Instagram
test/            pruebas (npm test)
```

## Próximos pasos posibles

- Descargar las fotos de WhatsApp al servidor (hoy se guarda el `id` del archivo) y mostrarlas en el panel.
- Usar un modelo de IA para clasificar las denuncias ambiguas, en vez de sólo palabras clave.
- Un mapa de denuncias por sector y un reporte del tiempo promedio de resolución por departamento.
- Alertas por correo a cada jefatura cuando llega una denuncia nueva.
- Inicio de sesión único con las cuentas de la Municipalidad (Microsoft 365 / Google Workspace).
