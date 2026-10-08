// Acceso a datos de denuncias y mensajes.
const { transaction } = require('./db');

const STATUS_IDS = ['nueva', 'en_proceso', 'resuelta', 'rechazada'];

function folioFor(id, date = new Date()) {
  return `SCL-${date.getFullYear()}-${String(id).padStart(6, '0')}`;
}

function rowToTicket(row) {
  if (!row) return null;
  return { ...row, reply_to: row.reply_to ? JSON.parse(row.reply_to) : {} };
}

function createTicket(db, t) {
  return transaction(db, () => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO tickets (channel, contact_id, contact_name, reply_to, department, sector, address,
                           latitude, longitude, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      t.channel, t.contactId, t.contactName ?? null, JSON.stringify(t.replyTo ?? {}),
      t.department, t.sector, t.address ?? null, t.latitude ?? null, t.longitude ?? null, t.description,
    );
    const id = Number(lastInsertRowid);
    db.prepare('UPDATE tickets SET folio = ? WHERE id = ?').run(folioFor(id), id);
    return getTicket(db, id);
  });
}

function getTicket(db, id) {
  return rowToTicket(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id));
}

const UPDATABLE = ['department', 'sector', 'address', 'latitude', 'longitude', 'description', 'status', 'contact_name', 'reply_to'];

function updateTicket(db, id, fields) {
  const sets = [];
  const values = [];
  for (const key of UPDATABLE) {
    if (fields[key] === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(key === 'reply_to' ? JSON.stringify(fields[key]) : fields[key]);
  }
  if (fields.status !== undefined) {
    sets.push(`resolved_at = ${['resuelta', 'rechazada'].includes(fields.status) ? "datetime('now')" : 'NULL'}`);
  }
  if (!sets.length) return getTicket(db, id);
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getTicket(db, id);
}

/** Guarda un mensaje. Devuelve false si el external_id ya existía (webhook repetido). */
function addMessage(db, m) {
  const res = db.prepare(`
    INSERT OR IGNORE INTO messages (ticket_id, channel, contact_id, direction, external_id, body,
                                    attachments, author_user_id, delivery_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    m.ticketId ?? null, m.channel, m.contactId, m.direction, m.externalId ?? null, m.body ?? null,
    m.attachments?.length ? JSON.stringify(m.attachments) : null, m.authorUserId ?? null, m.deliveryError ?? null,
  );
  if (res.changes && m.ticketId) {
    db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(m.ticketId);
  }
  return res.changes > 0;
}

function messageExists(db, externalId) {
  return !!externalId && !!db.prepare('SELECT 1 FROM messages WHERE external_id = ?').get(externalId);
}

function listMessages(db, ticketId) {
  return db.prepare(`
    SELECT m.*, u.name AS author_name FROM messages m
    LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.ticket_id = ? ORDER BY m.id`).all(ticketId)
    .map((m) => ({ ...m, attachments: m.attachments ? JSON.parse(m.attachments) : [] }));
}

function buildWhere(filters) {
  const where = [];
  const values = [];
  for (const key of ['department', 'sector', 'status', 'channel']) {
    if (filters[key]) { where.push(`${key} = ?`); values.push(filters[key]); }
  }
  if (filters.q) {
    where.push('(folio LIKE ? OR description LIKE ? OR address LIKE ? OR contact_name LIKE ?)');
    const like = `%${filters.q}%`;
    values.push(like, like, like, like);
  }
  if (filters.from) { where.push('created_at >= ?'); values.push(filters.from); }
  if (filters.to) { where.push("created_at < date(?, '+1 day')"); values.push(filters.to); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

function listTickets(db, filters = {}, { limit = 50, offset = 0 } = {}) {
  const { sql, values } = buildWhere(filters);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM tickets ${sql}`).get(...values).n;
  const rows = db.prepare(`SELECT * FROM tickets ${sql} ORDER BY
      CASE status WHEN 'nueva' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END, id DESC
      LIMIT ? OFFSET ?`).all(...values, limit, offset);
  return { total, items: rows.map(rowToTicket) };
}

function stats(db, filters = {}) {
  const { sql, values } = buildWhere(filters);
  const group = (col) => db.prepare(`SELECT ${col} AS key, COUNT(*) AS n FROM tickets ${sql} GROUP BY ${col}`)
    .all(...values).reduce((acc, r) => ({ ...acc, [r.key]: r.n }), {});
  return { byStatus: group('status'), bySector: group('sector'), byDepartment: group('department'), byChannel: group('channel') };
}

function recentTicketsForContact(db, channel, contactId, limit = 3) {
  return db.prepare('SELECT * FROM tickets WHERE channel = ? AND contact_id = ? ORDER BY id DESC LIMIT ?')
    .all(channel, contactId, limit).map(rowToTicket);
}

module.exports = {
  STATUS_IDS, folioFor, createTicket, getTicket, updateTicket, addMessage, messageExists,
  listMessages, listTickets, stats, recentTicketsForContact,
};
