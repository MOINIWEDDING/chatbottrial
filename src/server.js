// Servidor local / servidor propio: npm start
const { createRuntime } = require('./runtime');
const { instagramApi } = require('./meta');

createRuntime().then(({ app, config }) => {
  app.listen(config.port, () => {
    console.log(`Panel de denuncias en http://localhost:${config.port}`);
    console.log(`Webhook de Meta en ${config.publicUrl || `http://localhost:${config.port}`}/webhook`);
    console.log(`Base de datos: ${config.database.url.startsWith('file:') ? config.database.url : 'Turso (remota)'}`);
    if (!config.meta.appSecret && !config.meta.instagramAppSecret) {
      console.warn('ADVERTENCIA: META_APP_SECRET no configurado; no se verifican las firmas del webhook.');
    }
    const m = config.meta;
    const status = (ok) => (ok ? 'configurado' : 'sin token (las respuestas sólo se registran en la consola)');
    console.log(`Canales → WhatsApp: ${status(m.whatsappToken)} · Messenger: ${status(m.pageAccessToken)} · `
      + `Instagram: ${status(m.instagramAccessToken)}${m.instagramAccessToken ? ` (API ${instagramApi(m) === 'instagram' ? 'de Instagram' : 'vía página de Facebook'})` : ''}`);
  });
}).catch((err) => {
  console.error(`No se pudo iniciar: ${err.message}`);
  process.exit(1);
});
