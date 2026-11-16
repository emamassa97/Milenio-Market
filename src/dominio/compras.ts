import { normalizarTexto } from './entrada';
import { margen, precioParaMargen, type Redondeo } from './precios';
import type { Compra, PagoProveedor, Pesos, Producto } from './tipos';

// Compras a proveedores: lo que no toca la base (cuentas, precios sugeridos y reconocer los renglones de una factura).

/** El mismo proveedor aunque se escriba distinto ("Distribuidora  ARCOR " = "distribuidora arcor"). */
export function claveProveedor(nombre: string): string {
  return normalizarTexto(nombre.trim().replace(/\s+/g, ' '));
}

export function limpiarProveedor(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

export interface CuentaProveedor {
  clave: string;
  /** Cómo se escribió la última vez. */
  nombre: string;
  compras: Compra[];
  pagos: PagoProveedor[];
  comprado: Pesos;
  pagado: Pesos;
  /** Lo que se le debe (negativo: saldo a favor del kiosco). */
  saldo: Pesos;
  ultima: number | null;
}

/** Una cuenta por proveedor, con lo comprado, lo pagado y lo que se le debe. Primero a quien más se le debe. */
export function cuentasDeProveedores(compras: Compra[], pagos: PagoProveedor[], otros: string[] = []): CuentaProveedor[] {
  const cuentas = new Map<string, CuentaProveedor>();
  const cuenta = (nombre: string, fecha: number) => {
    const clave = claveProveedor(nombre);
    let c = cuentas.get(clave);
    if (!c) {
      c = { clave, nombre: limpiarProveedor(nombre), compras: [], pagos: [], comprado: 0, pagado: 0, saldo: 0, ultima: null };
      cuentas.set(clave, c);
    }
    if (c.ultima === null || fecha >= c.ultima) {
      c.ultima = fecha;
      c.nombre = limpiarProveedor(nombre);
    }
    return c;
  };
  for (const compra of compras) {
    if (!compra.proveedor.trim()) continue;
    const c = cuenta(compra.proveedor, compra.fecha);
    c.compras.push(compra);
    if (!compra.anulada) c.comprado += compra.total;
  }
  for (const pago of pagos) {
    if (!pago.proveedor.trim()) continue;
    const c = cuenta(pago.proveedor, pago.fecha);
    c.pagos.push(pago);
    if (!pago.anulado) c.pagado += pago.monto;
  }
  // Los proveedores que sólo están en los productos también se listan (sin movimientos todavía).
  for (const nombre of otros) {
    const clave = claveProveedor(nombre);
    if (clave && !cuentas.has(clave)) cuentas.set(clave, { clave, nombre: limpiarProveedor(nombre), compras: [], pagos: [], comprado: 0, pagado: 0, saldo: 0, ultima: null });
  }
  for (const c of cuentas.values()) {
    c.saldo = c.comprado - c.pagado;
    c.compras.sort((a, b) => b.fecha - a.fecha || b.creada - a.creada);
    c.pagos.sort((a, b) => b.fecha - a.fecha);
  }
  return [...cuentas.values()].sort((a, b) => b.saldo - a.saldo || (b.ultima ?? 0) - (a.ultima ?? 0) || a.nombre.localeCompare(b.nombre));
}

/** Lo pagado de una compra (sin los pagos anulados). */
export function pagadoDeCompra(compra: Compra, pagos: PagoProveedor[]): Pesos {
  return pagos.filter((p) => !p.anulado && p.compraId === compra.id).reduce((s, p) => s + p.monto, 0);
}

/**
 * Estado de cada compra con lo que se pagó a cuenta repartido de la más vieja a la más nueva: así "debe la
 * factura 0001-123" se lee igual que en el papel aunque se haya pagado "a cuenta".
 */
export function estadoDeCompras(cuenta: Pick<CuentaProveedor, 'compras' | 'pagos'>): Map<number, { pagado: Pesos; debe: Pesos }> {
  const salida = new Map<number, { pagado: Pesos; debe: Pesos }>();
  const vigentes = cuenta.compras.filter((c) => !c.anulada).sort((a, b) => a.fecha - b.fecha || a.creada - b.creada);
  let aCuenta = cuenta.pagos.filter((p) => !p.anulado && (p.compraId === null || !vigentes.some((c) => c.id === p.compraId))).reduce((s, p) => s + p.monto, 0);
  for (const c of vigentes) {
    let pagado = pagadoDeCompra(c, cuenta.pagos);
    const falta = Math.max(0, c.total - pagado);
    const usa = Math.min(falta, aCuenta);
    aCuenta -= usa;
    pagado += usa;
    salida.set(c.id!, { pagado, debe: Math.max(0, c.total - pagado) });
  }
  return salida;
}

// ---------- Precios ----------

export interface CambioDePrecio {
  /** Margen que tenía el producto (null: no tenía costo o precio). */
  margenAntes: number | null;
  /** Margen con el costo nuevo si no se toca el precio. */
  margenSinTocar: number | null;
  /** Precio que mantiene el margen de antes (o el general, si no tenía). null: no hace falta cambiarlo. */
  sugerido: Pesos | null;
  /** 'sube' el costo, 'baja', o 'igual'. */
  costo: 'sube' | 'baja' | 'igual';
}

/**
 * Qué precio conviene con el costo nuevo: el que mantiene el margen que tenía el producto, redondeado hacia arriba
 * (a $50 un kiosco cobra $1.600, no $1.570). Si no tenía costo, se usa el margen general. Si el costo bajó, se
 * sugiere bajar sólo si con el margen de antes el precio queda más barato redondeado.
 */
export function cambioDePrecio(p: Pick<Producto, 'precio' | 'costo'>, costoNuevo: Pesos, margenGeneral: number, redondeo: Redondeo): CambioDePrecio {
  const margenAntes = margen(p.precio, p.costo);
  const costo = costoNuevo > p.costo ? 'sube' : costoNuevo < p.costo ? 'baja' : 'igual';
  const margenSinTocar = costoNuevo > 0 ? margen(p.precio, costoNuevo) : null;
  if (!(costoNuevo > 0)) return { margenAntes, margenSinTocar, sugerido: null, costo };
  const base = margenAntes ?? (p.precio > 0 && p.costo <= 0 ? null : margenGeneral);
  // Producto con precio y sin costo: el precio lo eligió el dueño; sólo se avisa si vender así da pérdida.
  if (base === null) {
    if (p.precio > costoNuevo) return { margenAntes, margenSinTocar, sugerido: null, costo };
    return { margenAntes, margenSinTocar, sugerido: precioParaMargen(costoNuevo, margenGeneral, redondeo), costo };
  }
  const sugerido = precioParaMargen(costoNuevo, base, redondeo);
  if (sugerido <= 0 || sugerido === p.precio) return { margenAntes, margenSinTocar, sugerido: null, costo };
  if (costo === 'igual') return { margenAntes, margenSinTocar, sugerido: null, costo };
  // Si el costo subió, no se propone bajar el precio por el redondeo; si bajó, no se propone subirlo.
  if (costo === 'sube' && sugerido < p.precio) return { margenAntes, margenSinTocar, sugerido: null, costo };
  if (costo === 'baja' && sugerido > p.precio) return { margenAntes, margenSinTocar, sugerido: null, costo };
  return { margenAntes, margenSinTocar, sugerido, costo };
}

/** Porcentaje que cambió algo ("+12 %"), redondeado. */
export function variacion(antes: number, despues: number): number | null {
  if (!(antes > 0)) return null;
  return Math.round(((despues - antes) / antes) * 100);
}

// ---------- Cantidades ----------

/** "24", "2x12" o "2 x 12" (bultos por unidades) → 24. null si no se entiende. */
export function cantidadDeCompra(texto: string, porPeso: boolean): number | null {
  const t = texto.trim().replace(/\s+/g, '');
  if (!t) return null;
  const bultos = /^(\d{1,4})[x×*](\d{1,4})$/i.exec(t);
  if (bultos) return Number(bultos[1]) * Number(bultos[2]);
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return porPeso ? Math.round(n * 1000) / 1000 : Math.floor(n);
}

// ---------- Leer la factura ----------

/** Lo que devuelve la lectura de una foto. */
export interface FacturaLeida {
  proveedor: string;
  /** 'AAAA-MM-DD' o ''. */
  fecha: string;
  comprobante: string;
  numero: string;
  total: Pesos | null;
  renglones: RenglonLeido[];
}

export interface RenglonLeido {
  codigo: string;
  descripcion: string;
  cantidad: number;
  /** Costo final por unidad (con impuestos y descuentos). */
  costo: Pesos;
}

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  // "1.234,50" (Argentina) o "1234.50".
  const t = v.replace(/[^\d,.-]/g, '');
  return Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
};

/** Lo que vino de la lectura, controlado: nada raro pasa a la pantalla. */
export function limpiarFacturaLeida(crudo: unknown): FacturaLeida {
  const o = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const fecha = texto(o.fecha, 10);
  const renglones: RenglonLeido[] = [];
  for (const r of Array.isArray(o.renglones) ? o.renglones.slice(0, 150) : []) {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const descripcion = texto(x.descripcion, 120);
    const cantidad = num(x.cantidad);
    let costo = num(x.costoUnitario ?? x.costo);
    const importe = num(x.importe);
    if (!(costo > 0) && importe > 0 && cantidad > 0) costo = importe / cantidad;
    if (!descripcion || !(cantidad > 0) || cantidad > 99_999) continue;
    renglones.push({
      codigo: texto(x.codigo, 20).replace(/\D/g, ''),
      descripcion,
      cantidad: Math.round(cantidad * 1000) / 1000,
      costo: costo > 0 && costo < 5_000_000 ? Math.round(costo) : 0,
    });
  }
  const total = num(o.total);
  return {
    proveedor: texto(o.proveedor, 80),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : '',
    comprobante: texto(o.comprobante, 30),
    numero: texto(o.numero, 30),
    total: total > 0 && total < 1e9 ? Math.round(total) : null,
    renglones,
  };
}

/** Palabras que no ayudan a reconocer un producto. */
const VACIAS = new Set(['de', 'la', 'el', 'x', 'con', 'sin', 'y', 'en', 'por', 'un', 'u', 'unid', 'unidad', 'unidades', 'uni', 'pack', 'caja', 'bulto', 'display']);

/** "COCA COLA 2,25LT X6" → ['coca', 'cola', '2.25', 'lt'] (los números con coma o punto se unifican). */
export function palabras(texto: string): string[] {
  return normalizarTexto(texto)
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .map((w) => (/^\d+\.0+$/.test(w) ? w.replace(/\.0+$/, '') : w))
    .filter((w) => w && !VACIAS.has(w));
}

/** Qué tanto se parecen una descripción de factura y el nombre de un producto (0 a 1). */
export function parecido(descripcion: string, nombre: string): number {
  const a = palabras(descripcion);
  const b = palabras(nombre);
  if (a.length === 0 || b.length === 0) return 0;
  const peso = (w: string) => (/\d/.test(w) ? 1.5 : w.length <= 2 ? 0.5 : 1);
  const coincide = (w: string, lista: string[]) => lista.some((x) => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w) || w.startsWith(x))));
  const deB = b.reduce((s, w) => s + (coincide(w, a) ? peso(w) : 0), 0) / b.reduce((s, w) => s + peso(w), 0);
  const deA = a.reduce((s, w) => s + (coincide(w, b) ? peso(w) : 0), 0) / a.reduce((s, w) => s + peso(w), 0);
  // Un tamaño distinto (500 vs 1500) es otro producto aunque el resto coincida.
  const numerosA = a.filter((w) => /^\d/.test(w));
  const numerosB = b.filter((w) => /^\d/.test(w));
  const choca = numerosA.length > 0 && numerosB.length > 0 && !numerosB.some((n) => numerosA.includes(n));
  const puntaje = 0.65 * deB + 0.35 * deA;
  return choca ? puntaje * 0.5 : puntaje;
}

export type Certeza = 'codigo' | 'aprendido' | 'seguro' | 'dudoso' | 'ninguno';

export interface Reconocido {
  producto: Producto | null;
  certeza: Certeza;
  /** Otros parecidos, para elegir rápido si no era ése. */
  opciones: Producto[];
}

export function claveAlias(proveedor: string, descripcion: string): string {
  return `${claveProveedor(proveedor)}|${palabras(descripcion).join(' ')}`;
}

/**
 * A qué producto corresponde un renglón de la factura: por código de barras, por lo aprendido de compras
 * anteriores del mismo proveedor, o por el nombre más parecido.
 */
export function reconocer(
  renglon: Pick<RenglonLeido, 'codigo' | 'descripcion'>,
  proveedor: string,
  productos: Producto[],
  porCodigo: Map<string, Producto>,
  alias: Record<string, number>,
): Reconocido {
  const porId = (id: number) => productos.find((p) => p.id === id) ?? null;
  if (renglon.codigo.length >= 8) {
    const p = porCodigo.get(renglon.codigo);
    if (p) return { producto: p, certeza: 'codigo', opciones: [] };
  }
  const aprendido = alias[claveAlias(proveedor, renglon.descripcion)] ?? alias[claveAlias('', renglon.descripcion)];
  if (aprendido !== undefined) {
    const p = porId(aprendido);
    if (p) return { producto: p, certeza: 'aprendido', opciones: [] };
  }
  const puntajes = productos
    .map((p) => ({ p, s: parecido(renglon.descripcion, p.nombre) }))
    .filter((x) => x.s >= 0.3)
    .sort((x, y) => y.s - x.s)
    .slice(0, 4);
  const mejor = puntajes[0];
  if (!mejor) return { producto: null, certeza: 'ninguno', opciones: [] };
  const segundo = puntajes[1]?.s ?? 0;
  // Seguro: muy parecido y sin otro que le pise los talones.
  const certeza: Certeza = mejor.s >= 0.75 && mejor.s - segundo >= 0.12 ? 'seguro' : mejor.s >= 0.45 ? 'dudoso' : 'ninguno';
  return {
    producto: certeza === 'ninguno' ? null : mejor.p,
    certeza,
    opciones: puntajes.filter((x) => x.p !== (certeza === 'ninguno' ? null : mejor.p)).map((x) => x.p),
  };
}

/** 'AAAA-MM-DD' al mediodía de ese día (así ningún huso horario lo pasa al día anterior). */
export function fechaDeTexto(texto: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d.getTime();
}

export function textoDeFecha(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
