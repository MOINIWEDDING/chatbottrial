const crypto = require('node:crypto');

const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

async function createUser(db, { username, name, password, role = 'agent', department = null }) {
  if (role === 'agent' && !department) throw new Error('Los usuarios de equipo deben tener un departamento');
  const { lastInsertRowid } = await db.run(
    'INSERT INTO users (username, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
    username.trim().toLowerCase(), name, hashPassword(password), role, role === 'admin' ? null : department,
  );
  return publicUser(await db.get('SELECT * FROM users WHERE id = ?', lastInsertRowid));
}

/** Elimina un usuario y sus sesiones (sin depender de las claves foráneas de la base). */
async function deleteUser(db, id) {
  await db.batch([
    ['DELETE FROM sessions WHERE user_id = ?', id],
    ['UPDATE messages SET author_user_id = NULL WHERE author_user_id = ?', id],
    ['DELETE FROM users WHERE id = ?', id],
  ]);
}

const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department });

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

async function createSession(db, userId, days) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.batch([
    ["INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))", token, userId, `+${days} days`],
    ["DELETE FROM sessions WHERE expires_at < datetime('now')"],
  ]);
  return token;
}

async function sessionUser(db, token) {
  if (!token) return null;
  return publicUser(await db.get(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`, token));
}

/**
 * Primer arranque: si no hay usuarios, crea el administrador con ADMIN_PASSWORD (o
 * una contraseña aleatoria que se muestra en el registro del servidor).
 */
async function ensureAdmin(db, adminPassword, logger = console) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n) return;
  const password = adminPassword || crypto.randomBytes(9).toString('base64url');
  try {
    await createUser(db, { username: 'admin', name: 'Administrador', password, role: 'admin' });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return; // otra instancia lo creó al mismo tiempo
    throw err;
  }
  logger.log(`Usuario administrador creado → usuario: admin  contraseña: ${adminPassword ? '(la de ADMIN_PASSWORD)' : password}`);
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, createUser, deleteUser, publicUser, parseCookies, createSession, sessionUser, ensureAdmin,
};
