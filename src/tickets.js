// Acceso a datos de denuncias y mensajes.

const STATUS_IDS = ['nueva', 'en_proceso', 'resuelta', 'rechazada'];

function folioFor(id, date = new Date()) {
  return `SCL-${date.getFullYear()}-${String(id).padStart(6, '0')}`;
}

function rowToTicket(row) {
  if (!row) return null;
  return { ...row, reply_to: row.reply_to ? JSON.parse(row.reply_to) : {} };
}

async function createTicket(db, t) {
  // Inserción y folio en una sola transacción.
  const [inserted] = await db.batch([
    [`INSERT INTO tickets (channel, contact_id, contact_name, reply_to, department, sector, address,
                           latitude, longitude, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.channel, t.contactId, t.contactName ?? null, JSON.stringify(t.replyTo ?? {}),
    t.department, t.sector, t.address ?? null, t.latitude ?? null, t.longitude ?? null, t.description],
    ["UPDATE tickets SET folio = printf('SCL-%s-%06d', strftime('%Y', 'now'), id) WHERE id = last_insert_rowid()"],
  ]);
  return getTicket(db, inserted.lastInsertRowid);
}

async function getTicket(db, id) {
  return rowToTicket(await db.get('SELECT * FROM tickets WHERE id = ?', id));
}

const UPDATABLE = ['department', 'sector', 'address', 'latitude', 'longitude', 'description', 'status', 'contact_name', 'reply_to'];

async function updateTicket(db, id, fields) {
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
  await db.run(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
  return getTicket(db, id);
}

/**
 * Guarda un mensaje. Devuelve su id, o null si el external_id ya existía (webhook
 * repetido). Como la inserción es atómica, sirve para descartar duplicados aunque
 * lleguen al mismo tiempo a dos instancias del servidor.
 */
async function addMessage(db, m) {
  const res = await db.run(`
    INSERT OR IGNORE INTO messages (ticket_id, channel, contact_id, direction, external_id, body,
                                    attachments, author_user_id, delivery_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  m.ticketId ?? null, m.channel, m.contactId, m.direction, m.externalId ?? null, m.body ?? null,
  m.attachments?.length ? JSON.stringify(m.attachments) : null, m.authorUserId ?? null, m.deliveryError ?? null);
  if (!res.changes) return null;
  if (m.ticketId) await touchTicket(db, m.ticketId);
  return res.lastInsertRowid;
}

/** Asocia a una denuncia un mensaje guardado antes de crearla. */
async function attachMessage(db, messageId, ticketId) {
  if (!messageId || !ticketId) return;
  await db.run('UPDATE messages SET ticket_id = ? WHERE id = ?', ticketId, messageId);
  await touchTicket(db, ticketId);
}

const touchTicket = (db, id) => db.run("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?", id);

async function listMessages(db, ticketId) {
  return (await db.all(`
    SELECT m.*, u.name AS author_name FROM messages m
    LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.ticket_id = ? ORDER BY m.id`, ticketId))
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

async function listTickets(db, filters = {}, { limit = 50, offset = 0 } = {}) {
  const { sql, values } = buildWhere(filters);
  const [{ n: total }, rows] = await Promise.all([
    db.get(`SELECT COUNT(*) AS n FROM tickets ${sql}`, ...values),
    db.all(`SELECT * FROM tickets ${sql} ORDER BY
      CASE status WHEN 'nueva' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END, id DESC
      LIMIT ? OFFSET ?`, ...values, limit, offset),
  ]);
  return { total, items: rows.map(rowToTicket) };
}

async function stats(db, filters = {}) {
  const { sql, values } = buildWhere(filters);
  const group = async (col) => (await db.all(`SELECT ${col} AS key, COUNT(*) AS n FROM tickets ${sql} GROUP BY ${col}`, ...values))
    .reduce((acc, r) => ({ ...acc, [r.key]: r.n }), {});
  const [byStatus, bySector, byDepartment, byChannel] = await Promise.all(
    ['status', 'sector', 'department', 'channel'].map(group),
  );
  return { byStatus, bySector, byDepartment, byChannel };
}

async function recentTicketsForContact(db, channel, contactId, limit = 3) {
  return (await db.all('SELECT * FROM tickets WHERE channel = ? AND contact_id = ? ORDER BY id DESC LIMIT ?',
    channel, contactId, limit)).map(rowToTicket);
}

module.exports = {
  STATUS_IDS, folioFor, createTicket, getTicket, updateTicket, addMessage, attachMessage,
  listMessages, listTickets, stats, recentTicketsForContact,
};
