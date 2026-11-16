import { COMPRA_MAXIMA, RENGLON_MAXIMO } from '../dominio/carrito';
import { claveAlias, claveProveedor, limpiarProveedor } from '../dominio/compras';
import { esCombo } from '../dominio/combos';
import type { Compra, MedioPagoProveedor, PagoProveedor, Pesos, Producto, RenglonCompraGuardado } from '../dominio/tipos';
import { MEDIOS_PROVEEDOR } from '../dominio/tipos';
import type { BaseKiosco } from './db';
import { ErrorKiosco, guardarAjuste, leerAjuste, turnoAbierto } from './operaciones';
import { resumenDeTurno } from './operaciones';

// Compras a proveedores: la factura o remito que suma stock, actualiza costos y precios, y la cuenta con cada proveedor.

/** Una compra grande de un mayorista puede pasar el tope de un renglón de la caja; ésta no. */
export const COMPRA_TOTAL_MAXIMA = 100_000_000;
const ahora = () => Date.now();
const redondearStock = (n: number) => Math.round(n * 1000) / 1000;

export interface RenglonNuevaCompra {
  /** Producto que ya existe; o `nuevo` para darlo de alta con esta compra. */
  productoId?: number;
  nuevo?: { nombre: string; codigo: string; categoria: string; porPeso?: boolean };
  cantidad: number;
  /** Costo por unidad (o por kilo). 0: el producto no tenía y no se sabe. */
  costo: Pesos;
  /** Precio de venta desde ahora. Nada o 0: no cambia (en uno nuevo es obligatorio). */
  precio?: Pesos;
  /** Lo que decía la factura (si se leyó de una foto): se aprende para la próxima. */
  descripcion?: string;
}

export interface PagoAlCargar {
  monto: Pesos;
  medio: MedioPagoProveedor;
}

export interface DatosCompra {
  proveedor: string;
  /** Fecha del comprobante (ms). */
  fecha: number;
  comprobante?: string;
  numero?: string;
  renglones: RenglonNuevaCompra[];
  /** Lo que hay que pagar; si no se pone, la suma de los renglones. Puede diferir (un descuento al pie, un flete). */
  total?: Pesos;
  /** Lo que se pagó al recibirla (nada: queda debiendo todo). */
  pago?: PagoAlCargar | null;
  nota?: string;
  conFoto?: boolean;
  /** Lo que el usuario ya confirmó: pagar de la caja más de lo que hay. */
  pasarCaja?: boolean;
}

/** El precio de la promo escalado con el precio suelto, redondeado a $10 y nunca más caro que comprar suelto. */
function promoProporcional(promo: Pesos, precioViejo: Pesos, precioNuevo: Pesos, cantidad: number): Pesos {
  const escalado = precioViejo > 0 ? Math.round((promo * precioNuevo) / precioViejo / 10) * 10 : promo;
  return Math.max(1, Math.min(escalado, precioNuevo * cantidad - 1));
}

function quien<K extends string>(campo: K, usuario: string | undefined): Partial<Record<K, string>> {
  const limpio = usuario?.trim();
  return limpio ? ({ [campo]: limpio } as Partial<Record<K, string>>) : {};
}

function validarMedio(medio: unknown): asserts medio is MedioPagoProveedor {
  if (!MEDIOS_PROVEEDOR.some((m) => m.id === medio)) throw new ErrorKiosco('Elegí cómo se pagó.');
}

/** Si el pago de la caja deja la caja en negativo (casi siempre es un cero de más). null: alcanza o no se sabe. */
export async function faltaEnCaja(db: BaseKiosco, monto: Pesos): Promise<Pesos | null> {
  const turno = await turnoAbierto(db);
  if (!turno) return null;
  const hay = (await resumenDeTurno(db, turno)).resumen.efectivoEsperado;
  return monto > hay ? Math.max(0, hay) : null;
}

/** Anota la salida de la caja de un pago a proveedor y devuelve el pago con sus referencias. */
async function salidaDeCaja(db: BaseKiosco, pago: Omit<PagoProveedor, 'id'>, usuario?: string): Promise<Omit<PagoProveedor, 'id'>> {
  if (pago.medio !== 'caja') return pago;
  const turno = await turnoAbierto(db);
  if (!turno) throw new ErrorKiosco('Para pagar con plata de la caja, primero abrí la caja.');
  if (pago.monto > RENGLON_MAXIMO) throw new ErrorKiosco(`De la caja se puede sacar hasta ${RENGLON_MAXIMO.toLocaleString('es-AR')} por vez.`);
  const movimientoCajaId = await db.movimientosCaja.add({
    turnoId: turno.id!,
    fecha: pago.fecha,
    tipo: 'gasto',
    monto: pago.monto,
    motivo: `Mercadería: ${pago.proveedor}`,
    mercaderia: true,
    ...quien('usuario', usuario),
  });
  return { ...pago, turnoId: turno.id!, movimientoCajaId };
}

/**
 * Carga la factura o remito de un proveedor, todo junto o nada: suma el stock, deja el costo nuevo, cambia los
 * precios elegidos (la promo sube en proporción), da de alta los productos nuevos, recuerda el proveedor de cada
 * producto y lo que decía la factura, y anota lo pagado (de la caja, como gasto de mercadería). Devuelve la compra.
 */
export async function registrarCompra(db: BaseKiosco, datos: DatosCompra, usuario?: string): Promise<Compra> {
  const proveedor = limpiarProveedor(datos.proveedor);
  if (!proveedor) throw new ErrorKiosco('Poné a qué proveedor le compraste.');
  if (proveedor.length > 80) throw new ErrorKiosco('El nombre del proveedor es demasiado largo.');
  if (!Number.isFinite(datos.fecha) || datos.fecha > ahora() + 2 * 86_400_000) throw new ErrorKiosco('La fecha de la factura no es válida.');
  const validos = datos.renglones.filter((r) => r.cantidad > 0);
  if (validos.length === 0) throw new ErrorKiosco('Poné al menos un producto con su cantidad.');
  for (const r of validos) {
    if (!(r.cantidad <= COMPRA_MAXIMA)) throw new ErrorKiosco(`Una cantidad es demasiado grande (máximo ${COMPRA_MAXIMA}): ¿se escaneó un código ahí?`);
    if (!Number.isInteger(r.costo) || r.costo < 0 || r.costo > RENGLON_MAXIMO) throw new ErrorKiosco('Un costo no es válido (pesos enteros, sin centavos).');
    if (r.precio !== undefined && (!Number.isInteger(r.precio) || r.precio < 0 || r.precio > RENGLON_MAXIMO)) throw new ErrorKiosco('Un precio nuevo no es válido.');
    if (r.productoId === undefined && !r.nuevo) throw new ErrorKiosco('Hay un renglón sin producto: elegilo o sacalo.');
    if (r.nuevo && !r.nuevo.nombre.trim()) throw new ErrorKiosco('Poné el nombre del producto nuevo.');
    if (r.nuevo && !(r.precio && r.precio > 0)) throw new ErrorKiosco(`Poné a cuánto vas a vender "${r.nuevo.nombre.trim()}".`);
  }
  const pago = datos.pago && datos.pago.monto > 0 ? datos.pago : null;
  if (pago) {
    validarMedio(pago.medio);
    if (!Number.isInteger(pago.monto) || pago.monto > COMPRA_TOTAL_MAXIMA) throw new ErrorKiosco('El monto pagado no es válido.');
  }
  if (datos.total !== undefined && (!Number.isInteger(datos.total) || datos.total < 0 || datos.total > COMPRA_TOTAL_MAXIMA)) throw new ErrorKiosco('El total de la factura no es válido.');

  return db.transaction('rw', [db.productos, db.compras, db.pagosProveedor, db.turnos, db.movimientosCaja, db.ajustes, db.ventas, db.movimientosFiado], async () => {
    const renglones: RenglonCompraGuardado[] = [];
    const vistos = new Set<number>();
    for (const r of validos) {
      let p: Producto | undefined;
      if (r.nuevo) {
        const codigo = r.nuevo.codigo.trim();
        if (codigo && !/^[0-9A-Za-z-]{1,30}$/.test(codigo)) throw new ErrorKiosco(`El código de "${r.nuevo.nombre}" sólo puede tener números y letras.`);
        if (codigo) {
          const otro = (await db.productos.where('codigo').equals(codigo).first()) ?? (await db.productos.where('codigosAlt').equals(codigo).first());
          if (otro) throw new ErrorKiosco(`El código ${codigo} ya es de "${otro.nombre}": elegí ese producto en vez de crear uno nuevo.`);
        }
        const nombre = r.nuevo.nombre.trim().replace(/\s+/g, ' ');
        const nuevo: Producto = {
          codigo,
          nombre,
          precio: 0,
          costo: 0,
          stock: 0,
          stockMinimo: 0,
          categoria: r.nuevo.categoria.trim(),
          rapido: false,
          ...(r.nuevo.porPeso ? { porPeso: true } : {}),
          proveedor,
          creado: ahora(),
          actualizado: ahora(),
        };
        nuevo.id = await db.productos.add(nuevo);
        p = nuevo;
      } else {
        p = await db.productos.get(r.productoId!);
        if (!p) throw new ErrorKiosco('Uno de los productos ya no existe: sacalo de la lista.');
        if (esCombo(p)) throw new ErrorKiosco(`"${p.nombre}" es un combo: cargá los productos que lo forman.`);
      }
      const cant = p.porPeso ? redondearStock(r.cantidad) : Math.floor(r.cantidad);
      if (!(cant > 0)) continue;
      // El mismo producto dos veces en la factura (dos renglones con distinto precio): se suma igual.
      const yaEstaba = vistos.has(p.id!);
      vistos.add(p.id!);
      const costo = r.costo > 0 ? r.costo : p.costo;
      const precio = r.precio && r.precio > 0 ? r.precio : p.precio;
      const actual = (await db.productos.get(p.id!))!;
      await db.productos.update(p.id!, {
        stock: p.porPeso ? redondearStock(actual.stock + cant) : actual.stock + cant,
        costo,
        precio,
        // El proveedor se recuerda para armar el próximo pedido (sólo si no tenía otro).
        ...(!actual.proveedor?.trim() ? { proveedor } : {}),
        ...(actual.promo && precio !== actual.precio ? { promo: { ...actual.promo, precio: promoProporcional(actual.promo.precio, actual.precio, precio, actual.promo.cantidad) } } : {}),
        actualizado: ahora(),
      });
      renglones.push({
        productoId: p.id!,
        nombre: p.nombre,
        cantidad: cant,
        costo,
        // Si el producto se repite, lo "anterior" es lo de antes de la compra (el primer renglón).
        costoAnterior: yaEstaba ? (renglones.find((x) => x.productoId === p!.id)?.costoAnterior ?? p.costo) : p.costo,
        precioAnterior: yaEstaba ? (renglones.find((x) => x.productoId === p!.id)?.precioAnterior ?? p.precio) : p.precio,
        precio,
        ...(r.descripcion ? { descripcion: r.descripcion.slice(0, 120) } : {}),
        ...(r.nuevo ? { nuevo: true as const } : {}),
      });
    }
    if (renglones.length === 0) throw new ErrorKiosco('Poné al menos un producto con su cantidad.');
    const suma = renglones.reduce((s, r) => s + Math.round(r.costo * r.cantidad), 0);
    const total = datos.total ?? suma;
    const compra: Compra = {
      fecha: datos.fecha,
      creada: ahora(),
      proveedor,
      ...(datos.comprobante?.trim() ? { comprobante: datos.comprobante.trim().slice(0, 30) } : {}),
      ...(datos.numero?.trim() ? { numero: datos.numero.trim().slice(0, 30) } : {}),
      renglones,
      total,
      ...(datos.nota?.trim() ? { nota: datos.nota.trim().slice(0, 300) } : {}),
      ...(datos.conFoto ? { conFoto: true } : {}),
      ...quien('usuario', usuario),
    };
    compra.id = await db.compras.add(compra);
    if (pago) {
      const fila = await salidaDeCaja(db, { fecha: ahora(), proveedor, monto: pago.monto, medio: pago.medio, compraId: compra.id, nota: '', anulado: false, ...quien('usuario', usuario) }, usuario);
      await db.pagosProveedor.add(fila);
    }
    // Lo que decía la factura queda asociado al producto elegido: la próxima foto lo reconoce sola.
    const conDescripcion = validos.map((r, i) => ({ r, g: renglones[i] })).filter((x) => x.r.descripcion && x.g);
    if (conDescripcion.length > 0) {
      const alias = await leerAjuste<Record<string, number>>(db, 'compras.alias', {});
      for (const { r, g } of conDescripcion) alias[claveAlias(proveedor, r.descripcion!)] = g!.productoId;
      // Para que no crezca sin fin: se quedan los últimos 2000.
      const entradas = Object.entries(alias);
      await guardarAjuste(db, 'compras.alias', Object.fromEntries(entradas.slice(Math.max(0, entradas.length - 2000))));
    }
    return compra;
  });
}

/** Le pagás a un proveedor (todo lo que se le debe, una parte, o una compra puntual). */
export async function registrarPagoProveedor(
  db: BaseKiosco,
  datos: { proveedor: string; monto: Pesos; medio: MedioPagoProveedor; compraId?: number | null; nota?: string },
  usuario?: string,
): Promise<number> {
  const proveedor = limpiarProveedor(datos.proveedor);
  if (!proveedor) throw new ErrorKiosco('Falta el proveedor.');
  if (!Number.isInteger(datos.monto) || !(datos.monto > 0)) throw new ErrorKiosco('Poné cuánto le pagaste.');
  if (datos.monto > COMPRA_TOTAL_MAXIMA) throw new ErrorKiosco('Ese monto es demasiado alto.');
  validarMedio(datos.medio);
  return db.transaction('rw', [db.pagosProveedor, db.turnos, db.movimientosCaja, db.ventas, db.movimientosFiado, db.compras], async () => {
    if (datos.compraId) {
      const c = await db.compras.get(datos.compraId);
      if (!c || c.anulada) throw new ErrorKiosco('Esa compra ya no está.');
    }
    const fila = await salidaDeCaja(
      db,
      { fecha: ahora(), proveedor, monto: datos.monto, medio: datos.medio, compraId: datos.compraId ?? null, nota: (datos.nota ?? '').trim().slice(0, 200), anulado: false, ...quien('usuario', usuario) },
      usuario,
    );
    return db.pagosProveedor.add(fila);
  });
}

/**
 * Anula un pago a proveedor. Si salió de la caja y esa caja sigue abierta, la plata vuelve a la caja (se borra
 * el gasto); si la caja ya se cerró, el gasto queda en ese cierre (la plata salió) y se avisa.
 */
export async function anularPagoProveedor(db: BaseKiosco, id: number, usuario?: string): Promise<'volvio-a-la-caja' | 'caja-cerrada' | 'ok'> {
  return db.transaction('rw', [db.pagosProveedor, db.turnos, db.movimientosCaja, db.ventas, db.movimientosFiado, db.borrados], async () => {
    const p = await db.pagosProveedor.get(id);
    if (!p || p.anulado) throw new ErrorKiosco('Ese pago ya estaba anulado.');
    let resultado: 'volvio-a-la-caja' | 'caja-cerrada' | 'ok' = 'ok';
    if (p.medio === 'caja' && p.movimientoCajaId !== undefined) {
      const abierto = await turnoAbierto(db);
      if (abierto && abierto.id === p.turnoId) {
        await db.movimientosCaja.delete(p.movimientoCajaId);
        await db.borrados.add({ tabla: 'movimientosCaja', id: String(p.movimientoCajaId), fecha: ahora() });
        resultado = 'volvio-a-la-caja';
      } else resultado = 'caja-cerrada';
    }
    await db.pagosProveedor.update(id, { anulado: true, ...quien('anuladoPor', usuario) });
    return resultado;
  });
}

/**
 * Anula una compra cargada por error: resta el stock que había sumado y, en los productos que nadie tocó
 * después, vuelve el costo y el precio de antes. Lo pagado queda a favor con ese proveedor (la plata salió).
 */
export async function anularCompra(db: BaseKiosco, id: number, usuario?: string): Promise<{ preciosVueltos: number; pagado: Pesos }> {
  return db.transaction('rw', [db.compras, db.productos, db.pagosProveedor], async () => {
    const c = await db.compras.get(id);
    if (!c || c.anulada) throw new ErrorKiosco('Esa compra ya estaba anulada.');
    let preciosVueltos = 0;
    // Un producto repetido en la factura: el costo y el precio de antes son los del primer renglón.
    const primeros = new Map<number, RenglonCompraGuardado>();
    for (const r of c.renglones) if (!primeros.has(r.productoId)) primeros.set(r.productoId, r);
    const ultimos = new Map<number, RenglonCompraGuardado>();
    for (const r of c.renglones) ultimos.set(r.productoId, r);
    const cantidades = new Map<number, number>();
    for (const r of c.renglones) cantidades.set(r.productoId, (cantidades.get(r.productoId) ?? 0) + r.cantidad);
    for (const [productoId, cantidad] of cantidades) {
      const p = await db.productos.get(productoId);
      if (!p) continue;
      const primero = primeros.get(productoId)!;
      const ultimo = ultimos.get(productoId)!;
      // Un producto que se dio de alta con esta compra no tenía precio de antes: queda como está (sin stock).
      const vuelve =
        !primero.nuevo && primero.precioAnterior > 0 && p.costo === ultimo.costo && p.precio === ultimo.precio && (primero.costoAnterior !== ultimo.costo || primero.precioAnterior !== ultimo.precio);
      if (vuelve && primero.precioAnterior !== p.precio) preciosVueltos++;
      await db.productos.update(productoId, {
        stock: p.porPeso ? redondearStock(p.stock - cantidad) : p.stock - cantidad,
        ...(vuelve ? { costo: primero.costoAnterior, precio: primero.precioAnterior } : {}),
        ...(vuelve && p.promo && primero.precioAnterior !== p.precio && primero.precioAnterior > 0
          ? { promo: { ...p.promo, precio: promoProporcional(p.promo.precio, p.precio, primero.precioAnterior, p.promo.cantidad) } }
          : {}),
        actualizado: ahora(),
      });
    }
    await db.compras.update(id, { anulada: true, anuladaFecha: ahora(), ...quien('anuladaPor', usuario) });
    const pagado = (await db.pagosProveedor.where('compraId').equals(id).toArray()).filter((p) => !p.anulado).reduce((s, p) => s + p.monto, 0);
    return { preciosVueltos, pagado };
  });
}

/** Lo aprendido de facturas anteriores: descripción del proveedor → producto. */
export function aliasDeCompras(db: BaseKiosco): Promise<Record<string, number>> {
  return leerAjuste<Record<string, number>>(db, 'compras.alias', {});
}

/** Proveedores conocidos: los de las compras y los de los productos, sin repetir. */
export async function nombresDeProveedores(db: BaseKiosco): Promise<string[]> {
  const nombres = new Map<string, string>();
  for (const p of await db.productos.toArray()) if (p.proveedor?.trim()) nombres.set(claveProveedor(p.proveedor), limpiarProveedor(p.proveedor));
  for (const c of await db.compras.orderBy('fecha').toArray()) nombres.set(claveProveedor(c.proveedor), c.proveedor);
  return [...nombres.values()].sort((a, b) => a.localeCompare(b));
}
