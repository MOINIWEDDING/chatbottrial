const path = require('node:path');

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'denuncias.db'),
  publicUrl: env.PUBLIC_URL || '',
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
