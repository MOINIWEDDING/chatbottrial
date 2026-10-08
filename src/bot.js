// Lógica de conversación del bot: recibe un mensaje normalizado, crea o actualiza
// la denuncia, la deriva al departamento que corresponde y responde al vecino.
const { classifyDepartment, detectSector, isGreeting, normalize } = require('./classifier');
const { findDepartment, sectorName, STATUSES, DEFAULT_DEPARTMENT, UNKNOWN_SECTOR } = require('./catalog');
const repo = require('./tickets');

const MESSAGES = {
  welcome: () => [
    '👋 Hola, te saluda el asistente de denuncias de la Municipalidad de Santiago.',
    '',
    'Cuéntanos en un solo mensaje qué problema quieres denunciar y dónde ocurre. Por ejemplo:',
    '• "Basura sin recoger en Cumming con Agustinas"',
    '• "Bache grande en calle Lira 450"',
    '• "Juegos rotos en la plaza Yungay"',
    '',
    'También puedes enviar fotos y tu ubicación. Escribe ESTADO para consultar tus denuncias.',
  ].join('\n'),
  created: (t, askLocation) => [
    `✅ Recibimos tu denuncia. Tu número de folio es *${t.folio}*.`,
    `Fue derivada a: *${findDepartment(t.department).name}*.`,
    askLocation
      ? '📍 Para ayudarte más rápido, ¿nos indicas la dirección exacta (calle y número o intersección)? También puedes compartir tu ubicación.'
      : `📍 Sector: ${sectorName(t.sector)}.\nSi quieres, envía fotos o más detalles por este chat. Escribe ESTADO para consultar el avance.`,
  ].join('\n'),
  locationSaved: (t) => [
    `📍 Gracias, registramos la ubicación${t.sector !== UNKNOWN_SECTOR ? ` (${sectorName(t.sector)})` : ''} para el folio *${t.folio}*.`,
    'Puedes enviar fotos o más detalles por este chat. Escribe ESTADO para consultar el avance o NUEVA para hacer otra denuncia.',
  ].join('\n'),
  appended: (t) => `📝 Agregamos esta información a tu denuncia *${t.folio}*. Escribe NUEVA si se trata de otro problema.`,
  status: (tickets) => (tickets.length
    ? ['Estas son tus últimas denuncias:', ...tickets.map((t) => `• *${t.folio}* – ${findDepartment(t.department).name}: ${statusName(t.status)}`)].join('\n')
    : 'No encontramos denuncias asociadas a esta cuenta. Cuéntanos qué problema quieres denunciar.'),
  newReport: () => 'De acuerdo. Cuéntanos el nuevo problema que quieres denunciar y dónde ocurre.',
  statusChanged: (t, note) => [
    `🔔 Tu denuncia *${t.folio}* (${findDepartment(t.department).name}) cambió a estado: *${statusName(t.status)}*.`,
    note ? `Mensaje del equipo municipal: ${note}` : null,
  ].filter(Boolean).join('\n'),
};

const statusName = (id) => STATUSES.find((s) => s.id === id)?.name ?? id;

function describe(msg) {
  if (msg.text?.trim()) return msg.text.trim();
  if (msg.location) return `[Ubicación compartida] ${msg.location.address ?? ''}`.trim();
  if (msg.attachments?.length) return `[${msg.attachments.map((a) => a.type).join(', ')}]`;
  return '';
}

function createBot({ db, send, fetchProfile = async () => null, windowMinutes = 30, logger = console }) {
  const getConversation = (channel, contactId) => db.get(`
    SELECT *, (EXTRACT(EPOCH FROM now() - updated_at) / 60)::float8 AS age_minutes
    FROM conversations WHERE channel = ? AND contact_id = ?`, channel, contactId);

  const setConversation = (channel, contactId, state, ticketId = null) => db.run(`
    INSERT INTO conversations (channel, contact_id, state, ticket_id, updated_at)
    VALUES (?, ?, ?, ?, now())
    ON CONFLICT(channel, contact_id) DO UPDATE SET state = excluded.state, ticket_id = excluded.ticket_id,
      updated_at = excluded.updated_at`, channel, contactId, state, ticketId);

  /** Envía un texto al vecino y lo registra en la denuncia. */
  async function reply(target, text, { ticketId = null, authorUserId = null } = {}) {
    let deliveryError = null;
    try {
      await send(target, text);
    } catch (err) {
      deliveryError = err.message;
      logger.error(`No se pudo enviar mensaje por ${target.channel} a ${target.contactId}: ${err.message}`);
    }
    await repo.addMessage(db, {
      ticketId, channel: target.channel, contactId: target.contactId, direction: 'out', body: text,
      authorUserId, deliveryError,
    });
    return { text, deliveryError };
  }

  /**
   * Procesa un mensaje entrante. Devuelve { replies, ticket } o null si el mensaje ya
   * había sido procesado (Meta reintenta webhooks).
   */
  async function handleIncoming(msg) {
    const { channel, contactId } = msg;
    // Se guarda primero el mensaje: si ya existía, es un reintento de Meta y se ignora.
    const inboundId = await repo.addMessage(db, {
      channel, contactId, direction: 'in', externalId: msg.externalId, body: msg.text || null,
      attachments: [...msg.attachments ?? [], ...(msg.location ? [{ type: 'location', ...msg.location }] : [])],
    });
    if (!inboundId) return null;
    const attach = (ticketId) => repo.attachMessage(db, inboundId, ticketId);

    const target = { channel, contactId, replyTo: msg.replyTo };
    const text = describe(msg);
    const command = normalize(msg.text);
    const replies = [];

    let conv = await getConversation(channel, contactId);
    if (conv && conv.age_minutes > windowMinutes) conv = null;
    let ticket = conv?.ticket_id ? await repo.getTicket(db, conv.ticket_id) : null;
    if (ticket && ['resuelta', 'rechazada'].includes(ticket.status)) ticket = null;

    if (command === 'estado' || command === 'estado denuncia' || command === 'mis denuncias') {
      await attach(ticket?.id);
      const recent = await repo.recentTicketsForContact(db, channel, contactId);
      replies.push(await reply(target, MESSAGES.status(recent), { ticketId: ticket?.id }));
      if (conv) await setConversation(channel, contactId, conv.state, conv.ticket_id);
      return { replies, ticket };
    }

    if (command === 'nueva' || command === 'nueva denuncia' || command === 'otra denuncia') {
      await setConversation(channel, contactId, 'awaiting_report');
      replies.push(await reply(target, MESSAGES.newReport()));
      return { replies, ticket: null };
    }

    // Sin denuncia en curso: saludo → menú; cualquier otra cosa → nueva denuncia.
    if (!ticket) {
      const greeting = msg.postback || (msg.text && isGreeting(msg.text) && !msg.attachments?.length && !msg.location);
      if (!text || greeting) {
        await setConversation(channel, contactId, 'awaiting_report');
        replies.push(await reply(target, MESSAGES.welcome()));
        return { replies, ticket: null };
      }
      const sector = detectSector(`${text} ${msg.location?.address ?? ''}`);
      ticket = await repo.createTicket(db, {
        channel, contactId, contactName: msg.contactName, replyTo: msg.replyTo,
        department: classifyDepartment(text), sector,
        address: msg.location?.address ?? null,
        latitude: msg.location?.latitude, longitude: msg.location?.longitude,
        description: text,
      });
      await attach(ticket.id);
      const askLocation = sector === UNKNOWN_SECTOR && !msg.location;
      await setConversation(channel, contactId, askLocation ? 'awaiting_location' : 'open', ticket.id);
      replies.push(await reply(target, MESSAGES.created(ticket, askLocation), { ticketId: ticket.id }));
      // Instagram y Messenger no incluyen el nombre en el webhook: se consulta el perfil
      // después de responder, para no demorar la respuesta al vecino.
      if (!ticket.contact_name) {
        const contactName = await fetchProfile({ channel, contactId }).catch(() => null);
        if (contactName) ticket = await repo.updateTicket(db, ticket.id, { contact_name: contactName });
      }
      return { replies, ticket };
    }

    // Denuncia en curso esperando la ubicación.
    if (conv.state === 'awaiting_location') {
      const addressText = msg.location?.address ?? msg.text ?? '';
      const sector = detectSector(addressText);
      ticket = await repo.updateTicket(db, ticket.id, {
        address: [ticket.address, addressText].filter(Boolean).join(' / ') || null,
        latitude: msg.location?.latitude ?? ticket.latitude,
        longitude: msg.location?.longitude ?? ticket.longitude,
        sector: sector !== UNKNOWN_SECTOR ? sector : ticket.sector,
      });
      await attach(ticket.id);
      await setConversation(channel, contactId, 'open', ticket.id);
      replies.push(await reply(target, MESSAGES.locationSaved(ticket), { ticketId: ticket.id }));
      return { replies, ticket };
    }

    // Denuncia abierta: se agrega la información. Si aún no se había podido
    // clasificar o ubicar, se vuelve a intentar con todo el texto acumulado.
    const updates = {};
    if (ticket.status === 'nueva' && ticket.department === DEFAULT_DEPARTMENT) {
      const dept = classifyDepartment(`${ticket.description} ${text}`);
      if (dept !== DEFAULT_DEPARTMENT) updates.department = dept;
    }
    if (ticket.sector === UNKNOWN_SECTOR) {
      const sector = detectSector(`${text} ${msg.location?.address ?? ''}`);
      if (sector !== UNKNOWN_SECTOR) updates.sector = sector;
    }
    if (msg.location) Object.assign(updates, { latitude: msg.location.latitude, longitude: msg.location.longitude });
    if (Object.keys(updates).length) ticket = await repo.updateTicket(db, ticket.id, updates);
    await attach(ticket.id);
    await setConversation(channel, contactId, 'open', ticket.id);
    replies.push(await reply(target, MESSAGES.appended(ticket), { ticketId: ticket.id }));
    return { replies, ticket };
  }

  /** Avisa al vecino un cambio de estado (o envía un mensaje del funcionario). */
  async function notifyCitizen(ticket, { note, authorUserId, statusChanged = true }) {
    const text = statusChanged ? MESSAGES.statusChanged(ticket, note) : `💬 Equipo municipal (folio ${ticket.folio}): ${note}`;
    return reply({ channel: ticket.channel, contactId: ticket.contact_id, replyTo: ticket.reply_to }, text,
      { ticketId: ticket.id, authorUserId });
  }

  return { handleIncoming, notifyCitizen };
}

module.exports = { createBot, MESSAGES, statusName };
