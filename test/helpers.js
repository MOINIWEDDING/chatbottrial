// Levanta un Postgres de prueba (PGlite) que acepta conexiones por red, para probar el
// mismo código que se usa con Supabase (driver "pg").
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

async function startPostgres() {
  const lite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: lite, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  const { port } = server.server.address();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => { await server.stop(); await lite.close(); },
  };
}

module.exports = { startPostgres };
