// Carga datos de demostración: un usuario por departamento y denuncias de ejemplo.
// Uso: npm run demo
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { createUser } = require('../src/auth');
const { createBot } = require('../src/bot');
const { DEPARTMENTS } = require('../src/catalog');

const PASSWORD = 'demo1234';

const SAMPLES = [
  ['whatsapp', 'Hay basura sin recoger hace una semana en Cumming con Agustinas, barrio Yungay'],
  ['instagram', 'Un bache enorme en calle Lira 450, casi me caigo con la bici'],
  ['messenger', 'Los juegos infantiles de la plaza Brasil están rotos y peligrosos'],
  ['whatsapp', 'La luminaria de la esquina de San Diego con Santa Isabel lleva días apagada, está muy oscuro'],
  ['instagram', 'Semáforo sin funcionar en avenida Matta con Santa Rosa'],
  ['whatsapp', 'Música fuerte todas las noches en un departamento de Lastarria'],
  ['messenger', 'Microbasural con escombros y colchones en Franklin con Nuble'],
  ['whatsapp', 'Árbol a punto de caerse en el Parque Almagro, tiene ramas quebradas'],
  ['instagram', 'Vereda rota y hundida frente al Mercado Central'],
  ['whatsapp', 'Comercio ambulante bloqueando el paso en paseo Ahumada'],
  ['messenger', 'Necesito información sobre la patente de mi negocio'],
];

(async () => {
  if (!config.database.url.startsWith('file:') && !process.argv.includes('--forzar')) {
    console.error('La base configurada es remota (Turso). Los datos de demostración crean usuarios con la contraseña');
    console.error(`"${PASSWORD}" y denuncias falsas. Si de verdad quiere cargarlos ahí: npm run demo -- --forzar`);
    process.exit(1);
  }
  const db = await openDatabase(config.database);
  for (const d of DEPARTMENTS) {
    if (await db.get('SELECT 1 FROM users WHERE username = ?', d.id)) continue;
    await createUser(db, { username: d.id, password: PASSWORD, name: `Equipo ${d.name}`, role: 'agent', department: d.id });
  }
  if (!await db.get("SELECT 1 FROM users WHERE username = 'admin'")) {
    await createUser(db, { username: 'admin', password: PASSWORD, name: 'Administrador', role: 'admin' });
  }

  const bot = createBot({ db, send: async () => ({}), logger: { error() {}, info() {} } });
  let i = 0;
  for (const [channel, text] of SAMPLES) {
    i += 1;
    await bot.handleIncoming({
      channel, contactId: `demo-${channel}-${i}`, contactName: `Vecino ${i}`, externalId: `demo-${Date.now()}-${i}`,
      text, attachments: [], location: null, replyTo: {},
    });
  }
  console.log(`Datos de demostración cargados (${SAMPLES.length} denuncias).`);
  console.log(`Usuarios: admin y ${DEPARTMENTS.map((d) => d.id).join(', ')} — contraseña: ${PASSWORD}`);
  console.log('(Si el usuario admin ya existía, conserva su contraseña.)');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
