// Arma la aplicación completa (base de datos + bot + API). La usan el servidor local
// (src/server.js) y la función de Vercel (api/index.js).
const config = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { createSender, createProfileFetcher } = require('./meta');
const { ensureAdmin } = require('./auth');

/** Revisa la configuración y devuelve la lista de problemas que impiden arrancar. */
function configErrors(cfg = config) {
  const errors = [];
  if (cfg.isVercel && cfg.database.url.startsWith('file:')) {
    errors.push('Falta TURSO_DATABASE_URL: en Vercel el disco es temporal y las denuncias se perderían. '
      + 'Conecte una base Turso desde Vercel → Storage, o agregue TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.');
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
