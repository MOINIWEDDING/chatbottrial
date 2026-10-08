const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDepartment, detectSector, isGreeting } = require('../src/classifier');

test('clasifica denuncias por departamento', () => {
  const cases = {
    'Hay basura sin recoger hace días en mi calle': 'aseo',
    'No pasó el camión de la basura': 'aseo',
    'Un bache gigante en la calzada': 'obras',
    'Hay baches en toda la cuadra': 'obras',
    'La vereda está rota': 'obras',
    'Los juegos de la plaza están en mal estado': 'parques',
    'Necesitamos poda de árboles en el pasaje': 'parques',
    'La luminaria está apagada y la calle muy oscura': 'alumbrado',
    'El semáforo no funciona': 'transito',
    'Hay un auto abandonado hace meses': 'transito',
    'Asaltaron a una vecina en la esquina': 'seguridad',
    'Música fuerte toda la noche del vecino': 'medioambiente',
    'Hay ratas en el pasaje': 'medioambiente',
    'Quiero información de mi patente': 'oirs',
  };
  for (const [text, dept] of Object.entries(cases)) {
    assert.equal(classifyDepartment(text), dept, text);
  }
});

test('las frases específicas pesan más que palabras sueltas', () => {
  assert.equal(classifyDepartment('auto abandonado con un perro adentro'), 'transito');
});

test('no confunde "mal estado" con la calle Estado ni "tomar" con "toma"', () => {
  assert.equal(detectSector('la plaza está en mal estado'), 'sin-sector');
  assert.equal(classifyDepartment('quiero tomar un trámite'), 'oirs');
});

test('detecta el sector a partir del texto', () => {
  assert.equal(detectSector('basura en Cumming con Agustinas, barrio Yungay'), 'yungay');
  assert.equal(detectSector('bache en calle Lira 450'), 'san-borja');
  assert.equal(detectSector('en el Parque O\'Higgins'), 'parque-ohiggins');
  assert.equal(detectSector('frente al Mercado Central'), 'mapocho');
  assert.equal(detectSector('en mi casa'), 'sin-sector');
});

test('reconoce saludos', () => {
  assert.ok(isGreeting('Hola'));
  assert.ok(isGreeting('buenas tardes'));
  assert.ok(!isGreeting('hola, hay basura en la esquina'));
});
