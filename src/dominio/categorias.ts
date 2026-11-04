import { normalizarTexto } from './entrada';

/**
 * Categoría sugerida por el nombre del producto, para los que quedaron "Sin categoría".
 * Las reglas van en orden: la primera que coincide gana ("Chocolate con leche" es golosina,
 * no lácteo; "Agua lavandina" es limpieza, no bebida). Cada palabra se busca entera.
 */
interface Regla {
  /** Nombre que se usa si el kiosco no tiene ya una categoría parecida. */
  categoria: string;
  /** Otras formas de llamar a la misma categoría, para usar la que ya existe. */
  parecidas: string[];
  palabras: string[];
}

const REGLAS: Regla[] = [
  {
    categoria: 'Productos de limpieza',
    parecidas: ['limpieza', 'articulos de limpieza', 'limpieza y hogar'],
    palabras: [
      'lavandina', 'detergente', 'desengrasante', 'limpiador', 'limpiavidrios', 'cif', 'mr musculo', 'procenex', 'poett', 'ayudin',
      'magistral', 'ala', 'skip', 'ariel', 'drive', 'zorro', 'suavizante', 'vivere', 'comfort', 'jabon en polvo', 'jabon para ropa',
      'jabon liquido para ropa', 'esponja', 'virulana', 'trapo', 'rejilla', 'franela', 'escoba', 'secador', 'balde', 'lampazo',
      'bolsas de residuo', 'bolsa de residuo', 'bolsas de consorcio', 'bolsa consorcio', 'insecticida', 'raid', 'fuyi', 'off',
      'espiral', 'espirales', 'desodorante de ambiente', 'aromatizante', 'glade', 'lysoform', 'sanitizante', 'alcohol en gel',
      'alcohol', 'cera', 'blem', 'quitamanchas', 'vanish', 'harpic', 'pastilla para inodoro', 'guantes', 'fosforos',
    ],
  },
  {
    categoria: 'Higiene personal',
    parecidas: ['higiene', 'perfumeria', 'cuidado personal', 'higiene y perfumeria', 'farmacia'],
    palabras: [
      'shampoo', 'champu', 'acondicionador', 'jabon', 'jabon de tocador', 'dove', 'rexona', 'axe', 'desodorante', 'antitranspirante',
      'pasta dental', 'crema dental', 'colgate', 'kolynos', 'cepillo de dientes', 'cepillo dental', 'hilo dental', 'enjuague bucal',
      'papel higienico', 'higienol', 'elite', 'pañuelos', 'pañuelitos', 'carilinas', 'toallitas', 'toallas femeninas', 'toallitas humedas',
      'protectores diarios', 'tampones', 'always', 'kotex', 'ladysoft', 'pañales', 'pampers', 'huggies', 'babysec', 'afeitadora',
      'maquinita', 'prestobarba', 'gillette', 'espuma de afeitar', 'preservativos', 'prime', 'algodon', 'hisopos', 'curitas', 'apositos',
      'protector solar', 'repelente', 'crema de manos', 'crema corporal', 'gel', 'preservativo', 'ibuprofeno', 'paracetamol', 'aspirina', 'actron', 'tafirol', 'buscapina',
      'sertal', 'alikal', 'uvasal', 'geniol', 'mejoral',
    ],
  },
  {
    categoria: 'Cigarrillos',
    parecidas: ['cigarrillos y tabaco', 'tabaco', 'tabaqueria', 'cigarrillo'],
    palabras: [
      'cigarrillo', 'cigarrillos', 'marlboro', 'philip morris', 'philip', 'lucky strike', 'lucky', 'camel', 'chesterfield',
      'parliament', 'jockey', 'derby', 'rothmans', 'red point', 'kiel', 'boxer', 'pall mall',
      'tabaco', 'papelillo', 'papelillos', 'filtros', 'encendedor', 'encendedores', 'bic', 'habano', 'cigarros', 'vaper',
    ],
  },
  {
    categoria: 'Golosinas',
    parecidas: ['golosina', 'kiosco', 'confiteria', 'dulces', 'chocolates', 'caramelos'],
    palabras: [
      'alfajor', 'alfajores', 'chocolate', 'chocolates', 'chocolatin', 'bombon', 'bombones', 'caramelo', 'caramelos', 'chicle', 'chicles',
      'beldent', 'topline', 'bazooka', 'turron', 'gomitas', 'mogul', 'pastillas', 'tic tac', 'tictac', 'halls', 'menthoplus', 'sugus',
      'fizz', 'flynn paff', 'butter toffees', 'toffee', 'chupetin', 'chupetines', 'pico dulce', 'rocklets', 'mantecol', 'bon o bon',
      'bonobon', 'cofler', 'milka', 'aguila', 'kinder', 'block', 'shot', 'tita', 'rhodesia', 'havanna', 'jorgito', 'jorgelin',
      'guaymallen', 'capitan del espacio', 'fantoche', 'tatin', 'cabsha', 'marroc', 'nucrem', 'oreo', 'pepitos', 'merengue',
      'garrapiñada', 'garrapiñadas', 'confites', 'huevo kinder', 'barrita', 'barra de cereal', 'cereal mix', 'gomita', 'mentitas',
      'obleas', 'oblea', 'bananita',
    ],
  },
  {
    categoria: 'Snacks',
    parecidas: ['snack', 'copetin', 'salados', 'papas', 'picada'],
    palabras: [
      'papas fritas', 'papas', 'lays', 'pringles', 'doritos', 'cheetos', 'chizitos', 'palitos', 'palitos salados', 'mani', 'mani salado',
      'mani japones', 'saladix', 'pehuamar', 'krachitos', 'twistos', 'nachos', 'pochoclo', 'pochoclos', 'popcorn', 'tutuca', 'conitos',
      '3d', 'tostaditas', 'mix de frutos secos', 'frutos secos', 'almendras', 'nueces', 'pistachos', 'snack', 'snacks', 'quesitos',
      'hamlet', 'macucas',
    ],
  },
  {
    categoria: 'Bebidas con alcohol',
    parecidas: ['alcohol', 'bebidas alcoholicas', 'cervezas', 'vinos', 'licores'],
    palabras: [
      'cerveza', 'cervezas', 'quilmes', 'brahma', 'stella artois', 'stella', 'heineken', 'corona', 'budweiser', 'andes', 'patagonia',
      'schneider', 'imperial', 'isenbeck', 'amstel', 'miller', 'warsteiner', 'vino', 'vinos', 'malbec', 'cabernet', 'toro', 'termidor',
      'uvita', 'fernet', 'branca', 'gancia', 'campari', 'aperol', 'cinzano', 'vodka', 'smirnoff', 'whisky', 'whiskey', 'ron', 'gin',
      'tequila', 'sidra', 'champagne', 'espumante', 'licor', 'baileys', 'dr lemon', 'speed vodka', 'cynar', 'malibu',
    ],
  },
  {
    categoria: 'Fiambrería',
    parecidas: ['fiambres', 'fiambre', 'fiambreria y quesos'],
    palabras: ['fiambre', 'jamon', 'jamon cocido', 'jamon crudo', 'salame', 'salamin', 'mortadela', 'paleta', 'bondiola', 'lomito', 'queso de maquina'],
  },
  {
    categoria: 'Lácteos',
    parecidas: ['lacteos', 'lacteos y fiambres', 'heladera', 'frescos'],
    palabras: [
      'leche', 'yogur', 'yogurt', 'yogurisimo', 'ser', 'actimel', 'serenisima', 'sancor', 'manteca', 'queso', 'quesos', 'casancrem',
      'crema de leche', 'postre', 'postres', 'flan', 'danette', 'serenito', 'cindor', 'chocolatada', 'ricota', 'mozzarella',
      'muzzarella', 'salchichas', 'vienissima', 'paty', 'hamburguesas', 'huevos', 'huevo', 'tapas de empanada', 'tapas', 'tapa de tarta', 'pascualina', 'tapas para empanadas',
    ],
  },
  {
    categoria: 'Bebidas',
    parecidas: ['bebida', 'bebidas sin alcohol', 'gaseosas', 'aguas', 'jugos'],
    palabras: [
      'coca', 'coca cola', 'cocacola', 'pepsi', 'sprite', 'fanta', '7up', 'seven up', 'mirinda', 'schweppes', 'paso de los toros',
      'manaos', 'cunnington', 'gaseosa', 'gaseosas', 'agua', 'aguas', 'soda', 'villavicencio', 'villa del sur', 'glaciar', 'kin',
      'eco de los andes', 'bonaqua', 'levite', 'aquarius', 'h2oh', 'jugo', 'jugos', 'cepita', 'baggio', 'ades', 'tang', 'clight',
      'arcor jugo', 'speed', 'red bull', 'monster', 'energizante', 'powerade', 'gatorade', 'isotonica', 'tonica', 'pomelo', 'pritty',
      'secco', 'torasso', 'bidon',
    ],
  },
  {
    categoria: 'Almacén',
    parecidas: ['almacen', 'comestibles', 'despensa', 'alimentos', 'galletitas', 'panaderia'],
    palabras: [
      'galletitas', 'galletita', 'galletas', 'bizcochos', 'bizcochitos', 'criollitas', 'express', 'cerealitas', 'traviata', 'merba',
      'opera', 'chocolinas', 'surtido', 'bagley', 'terrabusi', 'tostadas', 'grisines', 'pan', 'pan lactal', 'bimbo', 'fargo', 'lactal',
      'budin', 'madalenas', 'magdalenas', 'vainillas', 'facturas', 'medialunas', 'yerba', 'mate cocido', 'te', 'cafe', 'nescafe',
      'cabrales', 'azucar', 'edulcorante', 'sal', 'aceite', 'vinagre', 'mayonesa', 'hellmanns', 'ketchup', 'mostaza', 'arroz',
      'fideos', 'tallarines', 'harina', 'polenta', 'pure', 'puré', 'salsa', 'tomate', 'pure de tomate', 'arvejas', 'choclo',
      'lentejas', 'atun', 'caballa', 'sardinas', 'lata', 'enlatado', 'mermelada', 'cacao', 'nesquik', 'cereales', 'copos', 'avena',
      'caldo', 'knorr', 'sopa', 'sopa instantanea', 'condimento', 'oregano', 'pimienta', 'gelatina', 'bizcochuelo', 'premezcla',
      'levadura', 'polvo de hornear', 'saladas', 'pan rallado', 'rebozador', 'aceitunas', 'palmitos', 'duraznos en almibar',
      'hielo', 'carbon',
    ],
  },
  {
    categoria: 'Varios',
    parecidas: ['otros', 'bazar', 'libreria', 'varios', 'regaleria'],
    palabras: [
      'pilas', 'pila', 'duracell', 'eveready', 'energizer', 'cargador', 'cable', 'auriculares', 'lapicera', 'birome', 'lapiz',
      'cuaderno', 'hojas', 'repuesto', 'cinta', 'adhesivo', 'plasticola', 'sobres', 'globos', 'velas', 'vela', 'bolsa',
      'bolsas', 'termo', 'vasos', 'platos', 'servilletas', 'sorbetes', 'carga sube', 'sube', 'tarjeta', 'recarga', 'mascara',
    ],
  },
];

/** Palabras enteras: "ala" no tiene que coincidir con "salame" ni "ser" con "serenito". */
function contiene(texto: string, palabra: string): boolean {
  const i = texto.indexOf(palabra);
  if (i < 0) return false;
  const libre = (c: string | undefined) => c === undefined || !/[a-z0-9ñ]/.test(c);
  let desde = i;
  while (desde >= 0) {
    if (libre(texto[desde - 1]) && libre(texto[desde + palabra.length])) return true;
    desde = texto.indexOf(palabra, desde + 1);
  }
  return false;
}

/** Sin acentos ni signos, con los guiones y puntos como espacios ("Coca-Cola" → "coca cola"). */
function limpiar(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

const PALABRAS = REGLAS.map((r) => ({ ...r, palabras: r.palabras.map(limpiar), clave: [r.categoria, ...r.parecidas].map(limpiar) }));

/**
 * La categoría que le corresponde a un producto por su nombre (y su proveedor, si el nombre no alcanza),
 * usando la del kiosco si ya hay una parecida. null: no hay forma de saberlo.
 */
export function sugerirCategoria(nombre: string, existentes: string[], proveedor = ''): string | null {
  const texto = limpiar(nombre);
  const regla = PALABRAS.find((r) => r.palabras.some((w) => contiene(texto, w))) ?? (proveedor ? PALABRAS.find((r) => r.palabras.some((w) => contiene(limpiar(proveedor), w))) : undefined);
  if (!regla) return null;
  // La que ya usa el kiosco gana, aunque esté escrita distinto ("Golosina", "LIMPIEZA").
  // Se prueba primero el nombre principal y después los parecidos, en orden.
  const sinPlural = (t: string) => t.replace(/s$/, '');
  for (const k of regla.clave) {
    const propia = existentes.find((c) => sinPlural(limpiar(c)) === sinPlural(k));
    if (propia) return propia;
  }
  return regla.categoria;
}
