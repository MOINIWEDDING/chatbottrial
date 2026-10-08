// Arma la aplicación completa (base de datos + bot + API). La usan el servidor local
// (src/server.js) y la función de Vercel (api/index.js).
const config = require('./config');
const { openDatabase, isPostgresUrl } = require('./db');
const { createApp } = require('./app');
const { createSender, createProfileFetcher } = require('./meta');
const { ensureAdmin } = require('./auth');

/** Revisa la configuración y devuelve la lista de problemas que impiden arrancar. */
function configErrors(cfg = config) {
  const errors = [];
  if (cfg.isVercel && !isPostgresUrl(cfg.database.url)) {
    errors.push('Falta DATABASE_URL: en Vercel el disco es temporal y las denuncias se perderían. '
      + 'Agregue la cadena de conexión de Supabase (Connect → Transaction pooler) como DATABASE_URL, '
      + 'o conecte Supabase desde Vercel → Storage.');
  }
  if (cfg.isProduction && !cfg.meta.appSecret && !cfg.meta.instagramAppSecret) {
    errors.push('Falta META_APP_SECRET (o INSTAGRAM_APP_SECRET): es obligatorio en producción para verificar los webhooks de Meta.');
  }
  return errors;
}

async function createRuntime({ logger = console } = {}) {
  const errors = configErrors();
  if (errors.length) throw new Error(errors.join(' '));
  const db = await openDatabase(config.database);
  await ensureAdmin(db, config.adminPassword, logger);
  const { app } = createApp({
    db, send: createSender(config.meta), fetchProfile: createProfileFetcher(config.meta), config, logger,
  });
  return { app, db, config };
}

module.exports = { createRuntime, configErrors };
