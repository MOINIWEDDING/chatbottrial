const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const catalog = require('./catalog');
const repo = require('./tickets');
const auth = require('./auth');
const { verifySignature, parseWebhook } = require('./meta');
const { createBot } = require('./bot');

function createApp({ db, send, fetchProfile, config, logger = console }) {
  const app = express();
  const bot = createBot({ db, send, fetchProfile, windowMinutes: config.conversationWindowMinutes, logger });
  const secure = config.publicUrl.startsWith('https://');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  // ---------------------------------------------------------------- Webhook de Meta
  app.get('/webhook', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe' && config.meta.verifyToken
      && req.query['hub.verify_token'] === config.meta.verifyToken;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  });

  app.post('/webhook', async (req, res) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), [config.meta.appSecret, config.meta.instagramAppSecret])) {
      logger.warn('Webhook rechazado: firma inválida');
      return res.sendStatus(401);
    }
    // Meta exige responder rápido; los mensajes se procesan después de contestar 200.
    res.sendStatus(200);
    for (const msg of parseWebhook(req.body)) {
      try {
        await bot.handleIncoming(msg);
      } catch (err) {
        logger.error('Error procesando mensaje entrante', err);
      }
    }
  });

  // ---------------------------------------------------------------- Autenticación
  const loginAttempts = new Map();
  app.use('/api', (req, _res, next) => {
    req.user = auth.sessionUser(db, auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
    next();
  });
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Debe iniciar sesión' }));
  const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Sólo administradores' }));

  app.post('/api/login', (req, res) => {
    const key = req.ip;
    const attempts = loginAttempts.get(key) ?? { n: 0, until: 0 };
    if (attempts.until > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos.' });
    const { username = '', password = '' } = req.body ?? {};
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim().toLowerCase());
    if (!row || !auth.verifyPassword(password, row.password_hash)) {
      attempts.n += 1;
      if (attempts.n >= 5) Object.assign(attempts, { n: 0, until: Date.now() + 5 * 60_000 });
      loginAttempts.set(key, attempts);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    loginAttempts.delete(key);
    const token = auth.createSession(db, row.id, config.sessionDays);
    res.cookie(auth.COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure, maxAge: config.sessionDays * 86_400_000, path: '/',
    });
    res.json({ user: auth.publicUser(row) });
  });

  app.post('/api/logout', (req, res) => {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(auth.COOKIE, { path: '/' }).json({ ok: true });
  });

  app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user, simulator: config.enableSimulator }));

  app.get('/api/catalog', requireUser, (_req, res) => res.json({
    departments: catalog.DEPARTMENTS.map(({ id, name, description }) => ({ id, name, description })),
    sectors: [...catalog.SECTORS.map(({ id, name }) => ({ id, name })), { id: catalog.UNKNOWN_SECTOR, name: 'Sin sector identificado' }],
    statuses: catalog.STATUSES,
    channels: catalog.CHANNELS,
  }));

  // ---------------------------------------------------------------- Denuncias
  // Un usuario de equipo sólo ve las denuncias de su departamento.
  const scopedFilters = (user, query) => {
    const pick = (k) => (typeof query[k] === 'string' && query[k] ? query[k] : undefined);
    const filters = {
      department: pick('department'), sector: pick('sector'), status: pick('status'),
      channel: pick('channel'), q: pick('q'), from: pick('from'), to: pick('to'),
    };
    if (user.role !== 'admin') filters.department = user.department;
    return filters;
  };

  const loadTicket = (req, res, next) => {
    const ticket = repo.getTicket(db, Number(req.params.id));
    if (!ticket || (req.user.role !== 'admin' && ticket.department !== req.user.department)) {
      return res.status(404).json({ error: 'Denuncia no encontrada' });
    }
    req.ticket = ticket;
    next();
  };

  app.get('/api/tickets', requireUser, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(repo.listTickets(db, scopedFilters(req.user, req.query), { limit, offset }));
  });

  app.get('/api/stats', requireUser, (req, res) => {
    const filters = scopedFilters(req.user, req.query);
    delete filters.status;
    res.json(repo.stats(db, filters));
  });

  app.get('/api/tickets/:id', requireUser, loadTicket, (req, res) => {
    res.json({ ticket: req.ticket, messages: repo.listMessages(db, req.ticket.id) });
  });

  app.patch('/api/tickets/:id', requireUser, loadTicket, async (req, res) => {
    const { status, department, sector, address, notify = true, note } = req.body ?? {};
    const changes = {};
    const log = [];
    if (status !== undefined && status !== req.ticket.status) {
      if (!repo.STATUS_IDS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
      changes.status = status;
      log.push(`Estado: ${req.ticket.status} → ${status}`);
    }
    if (department !== undefined && department !== req.ticket.department) {
      if (!catalog.findDepartment(department)) return res.status(400).json({ error: 'Departamento inválido' });
      changes.department = department;
      log.push(`Derivada de ${catalog.findDepartment(req.ticket.department).name} a ${catalog.findDepartment(department).name}`);
    }
    if (sector !== undefined && sector !== req.ticket.sector) {
      if (sector !== catalog.UNKNOWN_SECTOR && !catalog.findSector(sector)) return res.status(400).json({ error: 'Sector inválido' });
      changes.sector = sector;
      log.push(`Sector: ${catalog.sectorName(sector)}`);
    }
    if (typeof address === 'string' && address !== (req.ticket.address ?? '')) {
      changes.address = address.trim() || null;
      log.push('Dirección actualizada');
    }
    if (!log.length) return res.json({ ticket: req.ticket });

    const ticket = repo.updateTicket(db, req.ticket.id, changes);
    repo.addMessage(db, {
      ticketId: ticket.id, channel: ticket.channel, contactId: ticket.contact_id, direction: 'system',
      body: log.join(' · '), authorUserId: req.user.id,
    });
    let notification = null;
    if (changes.status && notify) {
      notification = await bot.notifyCitizen(ticket, { note: typeof note === 'string' ? note.trim() : '', authorUserId: req.user.id });
    }
    res.json({ ticket, notification });
  });

  // Nota interna o mensaje al vecino.
  app.post('/api/tickets/:id/messages', requireUser, loadTicket, async (req, res) => {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'El mensaje está vacío' });
    if (req.body.toCitizen) {
      const result = await bot.notifyCitizen(req.ticket, { note: body, authorUserId: req.user.id, statusChanged: false });
      return res.json({ ok: !result.deliveryError, deliveryError: result.deliveryError });
    }
    repo.addMessage(db, {
      ticketId: req.ticket.id, channel: req.ticket.channel, contactId: req.ticket.contact_id,
      direction: 'note', body, authorUserId: req.user.id,
    });
    res.json({ ok: true });
  });

  app.get('/api/tickets.csv', requireUser, (req, res) => {
    const { items } = repo.listTickets(db, scopedFilters(req.user, req.query), { limit: 100_000 });
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['Folio', 'Fecha', 'Canal', 'Vecino', 'Departamento', 'Sector', 'Dirección', 'Descripción', 'Estado'];
    const lines = items.map((t) => [
      t.folio, t.created_at, t.channel, t.contact_name, catalog.findDepartment(t.department)?.name,
      catalog.sectorName(t.sector), t.address, t.description, t.status,
    ].map(cell).join(','));
    res.type('text/csv; charset=utf-8').attachment('denuncias.csv').send(`﻿${[header.join(','), ...lines].join('\r\n')}`);
  });

  // ---------------------------------------------------------------- Usuarios (admin)
  app.get('/api/users', requireUser, requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY role, department, name').all().map(auth.publicUser));
  });

  app.post('/api/users', requireUser, requireAdmin, (req, res) => {
    const { username, name, password, role = 'agent', department } = req.body ?? {};
    if (!username || !name || !password) return res.status(400).json({ error: 'Faltan datos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    if (!['admin', 'agent'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (role === 'agent' && !catalog.findDepartment(department)) return res.status(400).json({ error: 'Departamento inválido' });
    try {
      res.status(201).json(auth.createUser(db, { username, name, password, role, department }));
    } catch (err) {
      res.status(409).json({ error: /UNIQUE/.test(err.message) ? 'El usuario ya existe' : err.message });
    }
  });

  app.patch('/api/users/:id/password', requireUser, requireAdmin, (req, res) => {
    const password = String(req.body?.password ?? '');
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Usuario no encontrado' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', requireUser, requireAdmin, (req, res) => {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'No puede eliminar su propio usuario' });
    db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- Simulador
  // Permite probar el bot sin conectar Meta. Desactivar con ENABLE_SIMULATOR=false.
  app.post('/api/simulate', requireUser, async (req, res) => {
    if (!config.enableSimulator) return res.status(404).json({ error: 'Simulador desactivado' });
    const { contactId = 'vecino-demo', contactName = 'Vecino de prueba', text = '', location } = req.body ?? {};
    const result = await bot.handleIncoming({
      channel: 'simulador', contactId: String(contactId), contactName, externalId: `sim-${crypto.randomUUID()}`,
      text: String(text), attachments: [], location: location ?? null, replyTo: {},
    });
    res.json({ replies: result?.replies.map((r) => r.text) ?? [], ticket: result?.ticket ?? null });
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use((err, _req, res, _next) => {
    logger.error(err);
    res.status(err.status || 500).json({ error: err.status === 400 ? 'Solicitud inválida' : 'Error interno' });
  });

  return { app, bot };
}

module.exports = { createApp };
