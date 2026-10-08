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

function createUser(db, { username, name, password, role = 'agent', department = null }) {
  if (role === 'agent' && !department) throw new Error('Los usuarios de equipo deben tener un departamento');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (username, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)`)
    .run(username.trim().toLowerCase(), name, hashPassword(password), role, role === 'admin' ? null : department);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid)));
}

const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department });

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function createSession(db, userId, days) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(token, userId, `+${days} days`);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return token;
}

function sessionUser(db, token) {
  if (!token) return null;
  return publicUser(db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token));
}

module.exports = { COOKIE, hashPassword, verifyPassword, createUser, publicUser, parseCookies, createSession, sessionUser };
