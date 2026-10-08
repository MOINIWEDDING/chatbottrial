const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Ejecuta fn dentro de una transacción. */
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
