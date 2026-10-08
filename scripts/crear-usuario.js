// Uso: npm run crear-usuario -- <usuario> <contraseña> <departamento|admin> "Nombre Apellido"
// Crea el usuario en la base configurada en .env (local, o Turso si TURSO_DATABASE_URL está definido).
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { createUser } = require('../src/auth');
const { DEPARTMENTS } = require('../src/catalog');

const [username, password, team, ...nameParts] = process.argv.slice(2);
if (!username || !password || !team) {
  console.log('Uso: npm run crear-usuario -- <usuario> <contraseña> <departamento|admin> "Nombre"');
  console.log(`Departamentos: ${DEPARTMENTS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}
if (team !== 'admin' && !DEPARTMENTS.some((d) => d.id === team)) {
  console.error(`Departamento desconocido: ${team}`);
  process.exit(1);
}

(async () => {
  const db = await openDatabase(config.database);
  const user = await createUser(db, {
    username, password, name: nameParts.join(' ') || username,
    role: team === 'admin' ? 'admin' : 'agent', department: team === 'admin' ? null : team,
  });
  console.log('Usuario creado:', user);
})().catch((err) => {
  console.error(/UNIQUE/.test(err.message) ? `El usuario "${username}" ya existe` : err.message);
  process.exit(1);
});
