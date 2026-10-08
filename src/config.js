const path = require('node:path');

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  database: {
    // Turso (producción / Vercel) o un archivo local en desarrollo.
    // Se aceptan los nombres que usan Turso y sus integraciones; DATABASE_URL sólo si es libSQL.
    url: env.TURSO_DATABASE_URL || env.TURSO_URL || env.LIBSQL_URL
      || (/^(libsql|wss?|https?):\/\//.test(env.DATABASE_URL ?? '') ? env.DATABASE_URL : '')
      || (env.DB_PATH ? `file:${env.DB_PATH}` : `file:${path.join(__dirname, '..', 'data', 'denuncias.db')}`),
    authToken: env.TURSO_AUTH_TOKEN || env.TURSO_TOKEN || env.LIBSQL_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || '',
  },
  adminPassword: env.ADMIN_PASSWORD || '',
  isVercel: !!env.VERCEL,
  isProduction: env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production',
  publicUrl: env.PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ''),
  enableSimulator: env.ENABLE_SIMULATOR !== 'false',
  // Minutos durante los cuales los mensajes siguientes de un vecino se agregan a la misma denuncia.
  conversationWindowMinutes: Number(env.CONVERSATION_WINDOW_MINUTES || 30),
  sessionDays: Number(env.SESSION_DAYS || 7),
  meta: {
    graphVersion: env.META_GRAPH_VERSION || 'v21.0',
    verifyToken: env.META_VERIFY_TOKEN || '',
    appSecret: env.META_APP_SECRET || '',
    whatsappToken: env.WHATSAPP_TOKEN || '',
    pageAccessToken: env.FB_PAGE_ACCESS_TOKEN || '',
    instagramAccessToken: env.INSTAGRAM_ACCESS_TOKEN || env.FB_PAGE_ACCESS_TOKEN || '',
    // 'instagram' (inicio de sesión de Instagram) o 'facebook' (vía página). Vacío = automático según el token.
    instagramApi: env.INSTAGRAM_API || '',
    instagramAppSecret: env.INSTAGRAM_APP_SECRET || '',
  },
};
