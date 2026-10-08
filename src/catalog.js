// Catálogo de departamentos, sectores y estados.
// Para agregar un departamento o ajustar las palabras clave, edite este archivo.
// Las palabras clave se comparan sin tildes ni mayúsculas y funcionan como
// prefijo: "bache" también reconoce "baches".

const DEPARTMENTS = [
  {
    id: 'aseo',
    name: 'Aseo y Ornato',
    description: 'Basura sin recoger, microbasurales, escombros, contenedores, barrido de calles',
    keywords: [
      'basura', 'basural', 'microbasural', 'residuo', 'desecho', 'escombro', 'cachureo',
      'contenedor', 'recoleccion', 'recolector', 'camion de la basura', 'no pasa el camion',
      'barrido', 'bolsas', 'desperdicio', 'mugre', 'suciedad', 'sucio', 'colchon', 'voluminoso',
      'grafiti', 'graffiti', 'rayado',
    ],
  },
  {
    id: 'obras',
    name: 'Obras Públicas',
    description: 'Baches, veredas y calzadas en mal estado, socavones, alcantarillado, soleras',
    keywords: [
      'bache', 'hoyo', 'hoyos', 'socavon', 'hundimiento', 'pavimento', 'calzada', 'asfalto',
      'vereda', 'acera', 'solera', 'alcantarill', 'sumidero', 'tapa de camara', 'camara abierta',
      'grieta', 'calle rota', 'calle en mal estado', 'reparar la calle', 'rampa', 'obra abandonada',
      'pasarela', 'inundacion', 'anegad',
    ],
  },
  {
    id: 'parques',
    name: 'Plazas y Parques',
    description: 'Plazas, parques y áreas verdes en mal estado, árboles, poda, riego, juegos infantiles',
    keywords: [
      'plaza', 'parque', 'area verde', 'areas verdes', 'arbol', 'poda', 'podar', 'rama',
      'pasto', 'cesped', 'jardin', 'riego', 'regadio', 'juegos infantiles', 'juego infantil',
      'columpio', 'resbalin', 'banca', 'escano', 'maquinas de ejercicio', 'bandejon', 'platabanda',
    ],
  },
  {
    id: 'alumbrado',
    name: 'Alumbrado Público',
    description: 'Luminarias apagadas o dañadas, postes, sectores sin iluminación',
    keywords: [
      'luminaria', 'alumbrado', 'foco', 'ampolleta', 'poste', 'luz apagada', 'luces apagadas',
      'sin luz', 'sin iluminacion', 'iluminacion', 'oscuro', 'oscuridad', 'farol', 'cable cortado',
    ],
  },
  {
    id: 'transito',
    name: 'Tránsito y Transporte',
    description: 'Semáforos, señalética, demarcación, vehículos abandonados, estacionamiento',
    keywords: [
      'semaforo', 'senaletica', 'senal de transito', 'letrero', 'demarcacion', 'paso de cebra',
      'paso peatonal', 'lomo de toro', 'reductor de velocidad', 'auto abandonado',
      'vehiculo abandonado', 'estacionado', 'estacionamiento', 'mal estacionad', 'taco',
      'ciclovia', 'paradero',
    ],
  },
  {
    id: 'seguridad',
    name: 'Seguridad Municipal',
    description: 'Delitos, incivilidades, comercio ambulante, consumo en la vía pública',
    keywords: [
      'robo', 'robaron', 'robar', 'asalt', 'portonazo', 'delincuen', 'droga', 'trafico', 'balacera', 'disparo',
      'pelea', 'violencia', 'comercio ambulante', 'comercio ilegal', 'ambulante', 'toldo',
      'toma de terreno', 'carpa', 'situacion de calle', 'consumo de alcohol', 'inseguridad', 'peligroso',
      'vandalismo', 'sospechoso',
    ],
  },
  {
    id: 'medioambiente',
    name: 'Medio Ambiente y Tenencia Responsable',
    description: 'Ruidos molestos, plagas, malos olores, animales abandonados o heridos',
    keywords: [
      'ruido', 'musica fuerte', 'fiesta', 'bulla', 'olor', 'mal olor', 'plaga', 'rata',
      'raton', 'roedor', 'paloma', 'cucaracha', 'zancudo', 'perro', 'gato', 'animal',
      'mascota', 'animal abandonado', 'herido', 'muerto', 'humo', 'quema', 'contaminacion',
    ],
  },
  {
    id: 'oirs',
    name: 'Atención Ciudadana (OIRS)',
    description: 'Denuncias que no calzan con otro departamento; se revisan y derivan manualmente',
    keywords: [],
  },
];

const DEFAULT_DEPARTMENT = 'oirs';

// Barrios de la comuna de Santiago. Se usan para detectar el sector a partir
// del texto o la dirección que entrega el vecino.
const SECTORS = [
  { id: 'centro-historico', name: 'Centro Histórico', keywords: ['centro historico', 'plaza de armas', 'paseo ahumada', 'paseo huerfanos', 'calle estado', 'catedral', 'la moneda', 'centro de santiago'] },
  { id: 'lastarria', name: 'Lastarria – Bellas Artes', keywords: ['lastarria', 'bellas artes', 'cerro santa lucia', 'santa lucia', 'forestal', 'jose miguel de la barra', 'merced'] },
  { id: 'mapocho', name: 'Mapocho – Mercado Central', keywords: ['mapocho', 'mercado central', 'cal y canto', 'san pablo'] },
  { id: 'yungay', name: 'Barrio Yungay', keywords: ['yungay', 'plaza yungay', 'matucana', 'cumming', 'agustinas poniente', 'quinta normal'] },
  { id: 'brasil', name: 'Barrio Brasil – Concha y Toro', keywords: ['barrio brasil', 'plaza brasil', 'avenida brasil', 'concha y toro', 'huerfanos poniente', 'compania', 'ricardo cumming'] },
  { id: 'republica', name: 'República – Ejército', keywords: ['republica', 'ejercito', 'dieciocho', 'toesca', 'blanco encalada', 'barrio universitario', 'los heroes'] },
  { id: 'san-borja', name: 'San Borja – Parque Forestal Sur', keywords: ['san borja', 'remodelacion san borja', 'portugal', 'marcoleta', 'diagonal paraguay', 'lira'] },
  { id: 'almagro', name: 'Parque Almagro – Santa Isabel', keywords: ['almagro', 'parque almagro', 'santa isabel', 'san diego', 'arturo prat', 'serrano', 'tarapaca'] },
  { id: 'meiggs', name: 'Barrio Meiggs – Estación', keywords: ['meiggs', 'estacion central', 'exposicion', 'san alfonso', 'alameda poniente'] },
  { id: 'parque-ohiggins', name: "Parque O'Higgins", keywords: ["o'higgins", 'ohiggins', 'parque ohiggins', 'beaucheff', 'viel', 'rondizzoni', 'club hipico'] },
  { id: 'matta', name: 'Matta Sur – Matta Oriente', keywords: ['matta', 'avenida matta', 'matta sur', 'matta oriente', 'santa rosa', 'carmen', 'lord cochrane'] },
  { id: 'franklin', name: 'Franklin – Biobío', keywords: ['franklin', 'biobio', 'bio bio', 'persa', 'nuble', 'placer', 'sierra bella'] },
  { id: 'huemul', name: 'Barrio Huemul – San Eugenio', keywords: ['huemul', 'san eugenio', 'el llano', 'pedro montt', 'carlos valdovinos'] },
];

const UNKNOWN_SECTOR = 'sin-sector';

const STATUSES = [
  { id: 'nueva', name: 'Nueva' },
  { id: 'en_proceso', name: 'En proceso' },
  { id: 'resuelta', name: 'Resuelta' },
  { id: 'rechazada', name: 'Rechazada / no corresponde' },
];

const CHANNELS = [
  { id: 'whatsapp', name: 'WhatsApp' },
  { id: 'instagram', name: 'Instagram' },
  { id: 'messenger', name: 'Facebook Messenger' },
  { id: 'simulador', name: 'Simulador' },
];

const findDepartment = (id) => DEPARTMENTS.find((d) => d.id === id);
const findSector = (id) => SECTORS.find((s) => s.id === id);
const sectorName = (id) => findSector(id)?.name ?? 'Sin sector identificado';

module.exports = {
  DEPARTMENTS, DEFAULT_DEPARTMENT, SECTORS, UNKNOWN_SECTOR, STATUSES, CHANNELS,
  findDepartment, findSector, sectorName,
};
