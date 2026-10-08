// Base de datos libSQL (SQLite). En desarrollo usa un archivo local; en Vercel u otro
// servidor sin disco permanente se conecta a una base Turso (TURSO_DATABASE_URL).
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  department TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT UNIQUE,
  channel TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  contact_name TEXT,
  reply_to TEXT,
  department TEXT NOT NULL,
  sector TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nueva',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_department ON tickets(department, status);
CREATE INDEX IF NOT EXISTS idx_tickets_sector ON tickets(sector);
CREATE INDEX IF NOT EXISTS idx_tickets_contact ON tickets(channel, contact_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'note', 'system')),
  external_id TEXT UNIQUE,
  body TEXT,
  attachments TEXT,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delivery_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);

CREATE TABLE IF NOT EXISTS conversations (
  channel TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  state TEXT NOT NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, contact_id)
);
`;

const toObject = (row) => (row ? { ...row } : undefined);

/**
 * Abre la base de datos y crea las tablas si no existen.
 * url: "file:ruta.db", ":memory:" o "libsql://….turso.io" (con authToken).
 */
async function openDatabase({ url, authToken } = {}) {
  if (url.startsWith('file:')) {
    fs.mkdirSync(path.dirname(path.resolve(url.slice('file:'.length))), { recursive: true });
  }
  const client = createClient({ url, authToken: authToken || undefined });
  await client.executeMultiple(SCHEMA);
  const exec = (sql, args) => client.execute({ sql, args });

  return {
    client,
    /** Primera fila del resultado (o undefined). */
    get: async (sql, ...args) => toObject((await exec(sql, args)).rows[0]),
    /** Todas las filas del resultado. */
    all: async (sql, ...args) => (await exec(sql, args)).rows.map(toObject),
    /** Ejecuta una instrucción; devuelve { changes, lastInsertRowid }. */
    run: async (sql, ...args) => {
      const rs = await exec(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? null : Number(rs.lastInsertRowid) };
    },
    /** Varias instrucciones en una transacción; recibe [[sql, ...args], …]. */
    batch: async (statements) => (await client.batch(statements.map(([sql, ...args]) => ({ sql, args })), 'write'))
      .map((rs) => ({ changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? null : Number(rs.lastInsertRowid) })),
    close: () => client.close(),
  };
}

module.exports = { openDatabase };
