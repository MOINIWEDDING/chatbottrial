// Función de Vercel: atiende /api/*, /webhook y /health (ver vercel.json).
// Los archivos de public/ los sirve directamente la CDN de Vercel.
const { createRuntime } = require('../src/runtime');

let ready = null;

module.exports = async (req, res) => {
  // La aplicación se arma una vez por instancia y se reutiliza entre invocaciones.
  ready ??= createRuntime().catch((err) => {
    ready = null; // reintentar en la próxima solicitud
    throw err;
  });
  let app;
  try {
    ({ app } = await ready);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `Configuración incompleta: ${err.message}` }));
  }
  return app(req, res);
};
