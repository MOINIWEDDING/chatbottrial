const { DEPARTMENTS, DEFAULT_DEPARTMENT, SECTORS, UNKNOWN_SECTOR } = require('./catalog');

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cada palabra clave reconoce la palabra exacta o con un sufijo corto
// (plurales, género): "bache" → "baches", "delincuen" → "delincuencia".
function compile(keyword) {
  const kw = normalize(keyword);
  const suffix = kw.length >= 7 ? '[a-zñ]{0,6}' : '[a-zñ]{0,4}';
  return { re: new RegExp(`(?:^|\\s)${escape(kw)}${suffix}(?=\\s|$)`), weight: kw.split(' ').length };
}

const deptMatchers = DEPARTMENTS.map((d) => ({ id: d.id, patterns: d.keywords.map(compile) }));
const sectorMatchers = SECTORS.map((s) => ({ id: s.id, patterns: s.keywords.map(compile) }));

function score(text, matchers) {
  const norm = normalize(text);
  let best = { id: null, score: 0 };
  for (const m of matchers) {
    const total = m.patterns.reduce((acc, p) => acc + (p.re.test(norm) ? p.weight : 0), 0);
    if (total > best.score) best = { id: m.id, score: total };
  }
  return best;
}

/** Devuelve el id del departamento más probable para el texto. */
function classifyDepartment(text) {
  return score(text, deptMatchers).id ?? DEFAULT_DEPARTMENT;
}

/** Devuelve el id del sector (barrio) mencionado en el texto, o UNKNOWN_SECTOR. */
function detectSector(text) {
  return score(text, sectorMatchers).id ?? UNKNOWN_SECTOR;
}

/** true si el mensaje parece sólo un saludo, sin contenido de denuncia. */
function isGreeting(text) {
  const norm = normalize(text);
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|alo|hey|hi|menu|ayuda|inicio)( [a-z]+){0,3}$/.test(norm)
    && score(text, deptMatchers).id === null;
}

module.exports = { normalize, classifyDepartment, detectSector, isGreeting };
