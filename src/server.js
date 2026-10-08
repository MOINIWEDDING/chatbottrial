const crypto = require('node:crypto');
const config = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { createSender, createProfileFetcher, instagramApi } = require('./meta');
const { createUser } = require('./auth');

if (process.env.NODE_ENV === 'production' && !config.meta.appSecret && !config.meta.instagramAppSecret) {
  console.error('META_APP_SECRET (o INSTAGRAM_APP_SECRET) es obligatorio en producción para verificar los webhooks de Meta.');
  process.exit(1);
}

const db = openDatabase(config.dbPath);

// Primer arranque: crea el administrador inicial.
if (!db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  createUser(db, { username: 'admin', name: 'Administrador', password, role: 'admin' });
  console.log(`Usuario administrador creado → usuario: admin  contraseña: ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : password}`);
}

const { app } = createApp({ db, send: createSender(config.meta), fetchProfile: createProfileFetcher(config.meta), config });

app.listen(config.port, () => {
  console.log(`Panel de denuncias en http://localhost:${config.port}`);
  console.log(`Webhook de Meta en ${config.publicUrl || `http://localhost:${config.port}`}/webhook`);
  if (!config.meta.appSecret && !config.meta.instagramAppSecret) {
    console.warn('ADVERTENCIA: META_APP_SECRET no configurado; no se verifican las firmas del webhook.');
  }
  const m = config.meta;
  const status = (ok) => (ok ? 'configurado' : 'sin token (las respuestas sólo se registran en la consola)');
  console.log(`Canales → WhatsApp: ${status(m.whatsappToken)} · Messenger: ${status(m.pageAccessToken)} · `
    + `Instagram: ${status(m.instagramAccessToken)}${m.instagramAccessToken ? ` (API ${instagramApi(m) === 'instagram' ? 'de Instagram' : 'vía página de Facebook'})` : ''}`);
});
