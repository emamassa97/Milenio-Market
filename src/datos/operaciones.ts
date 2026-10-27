import { resumirTurno, totalConteo } from '../dominio/caja';
import { CANTIDAD_MAXIMA, COMPRA_MAXIMA, RENGLON_MAXIMO, stockQueUsa, subtotal, VUELTO_MAXIMO } from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import type { FilaImportada } from '../dominio/csv';
import { cantidadDevuelta, describirItems, detalleDevolucion, fiadoDisponible, montoDevolucion, stockQueVuelve, type RenglonDevuelto } from '../dominio/devoluciones';
import { saldoCliente, superaLimite } from '../dominio/fiado';
import { aplicarAumento, type Redondeo } from '../dominio/precios';
import { MEDIOS } from '../dominio/tipos';
import type {
  Cliente,
  Devolucion,
  ItemVenta,
  MedioPago,
  MovimientoCaja,
  Pago,
  Pesos,
  Producto,
  TipoMovimientoCaja,
  Turno,
  Venta,
} from '../dominio/tipos';
import type { BaseKiosco } from './db';

/** Error con un mensaje pensado para mostrarle a quien atiende. */
export class ErrorKiosco extends Error {}

const ahora = () => Date.now();

/** El stock por peso va en kilos con hasta 3 decimales (gramos). */
const redondearStock = (n: number) => Math.round(n * 1000) / 1000;

/** `{ [campo]: usuario }` si hay usuario; si no, nada (para no guardar campos vacíos). */
function quien<K extends string>(campo: K, usuario: string | undefined): Partial<Record<K, string>> {
  const limpio = usuario?.trim();
  return limpio ? ({ [campo]: limpio } as Record<K, string>) : {};
}

// ---------- Turnos ----------

export async function turnoAbierto(db: BaseKiosco): Promise<Turno | undefined> {
  const abiertos = await db.turnos.filter((t) => t.cierre === null).toArray();
  return abiertos.sort((a, b) => b.apertura - a.apertura)[0];
}

/** `usuario`: quién inició sesión y abre la caja (opcional). */
export async function abrirTurno(db: BaseKiosco, cajero: string, fondoInicial: Pesos, usuario?: string): Promise<number> {
  if (fondoInicial < 0) throw new ErrorKiosco('El fondo inicial no puede ser negativo.');
  if (fondoInicial > RENGLON_MAXIMO) throw new ErrorKiosco('Ese cambio es demasiado alto: parece un código de barras.');
  return db.transaction('rw', db.turnos, async () => {
    if (await turnoAbierto(db)) throw new ErrorKiosco('Ya hay una caja abierta.');
    return db.turnos.add({
      apertura: ahora(),
      cierre: null,
      cajero: cajero.trim() || 'Sin nombre',
      fondoInicial,
      conteo: null,
      contado: null,
      esperado: null,
      nota: '',
      ...quien('usuario', usuario),
    });
  });
}

export async function resumenDeTurno(db: BaseKiosco, turno: Turno) {
  const id = turno.id!;
  const [ventas, movimientos, pagos] = await Promise.all([
    db.ventas.where('turnoId').equals(id).toArray(),
    db.movimientosCaja.where('turnoId').equals(id).toArray(),
    db.movimientosFiado.where('turnoId').equals(id).toArray(),
  ]);
  return { ventas, movimientos, resumen: resumirTurno(turno.fondoInicial, ventas, movimientos, pagos) };
}

/** `usuario`: quién cierra la caja (opcional). */
export async function cerrarTurno(
  db: BaseKiosco,
  conteo: Record<string, number>,
  nota: string,
  usuario?: string,
): Promise<Turno> {
  const limpio = Object.fromEntries(Object.entries(conteo).map(([k, v]) => [k, Math.max(0, Math.floor(v) || 0)]));
  // Si no se contó nada, queda "sin contar": no es lo mismo que contar y que falte todo.
  const contoAlgo = Object.values(limpio).some((v) => v > 0);
  const cerrado = await db.transaction('rw', [db.turnos, db.ventas, db.movimientosCaja, db.movimientosFiado], async () => {
    const turno = await turnoAbierto(db);
    if (!turno) throw new ErrorKiosco('No hay ninguna caja abierta.');
    const { resumen } = await resumenDeTurno(db, turno);
    const cambios = {
      cierre: ahora(),
      conteo: contoAlgo ? limpio : null,
      contado: contoAlgo ? totalConteo(limpio) : null,
      esperado: resumen.efectivoEsperado,
      nota: nota.trim(),
      ...quien('usuarioCierre', usuario),
    };
    await db.turnos.update(turno.id!, cambios);
    return { ...turno, ...cambios };
  });
  // Al cerrar la primera caja el sistema deja de estar "en prueba":
  // desde ahí ya no se ofrece borrar todo.
  await guardarAjuste(db, 'modoPrueba', false);
  return cerrado;
}

/**
 * Cambio de turno en un paso: se cierra la caja abierta y se abre la siguiente en la misma transacción,
 * así nunca queda cerrada sin la apertura que le sigue (si algo falla, no pasa nada).
 */
export async function pasarTurno(
  db: BaseKiosco,
  conteo: Record<string, number>,
  nota: string,
  usuarioCierra: string | undefined,
  siguiente: { nombre: string; usuario?: string },
  fondo: Pesos,
): Promise<Turno> {
  return db.transaction('rw', [db.turnos, db.ventas, db.movimientosCaja, db.movimientosFiado, db.ajustes], async () => {
    const cerrado = await cerrarTurno(db, conteo, nota, usuarioCierra);
    await abrirTurno(db, siguiente.nombre, fondo, siguiente.usuario);
    return cerrado;
  });
}

/** Lo que se anota a mano desde el cierre; las devoluciones las anota `devolverProductos`. */
export type MovimientoManual = Exclude<TipoMovimientoCaja, 'devolucion'>;

export async function registrarMovimientoCaja(
  db: BaseKiosco,
  tipo: MovimientoManual,
  monto: Pesos,
  motivo: string,
  usuario?: string,
  mercaderia = false,
): Promise<number> {
  if (!(monto > 0)) throw new ErrorKiosco('Poné un monto mayor a cero.');
  return db.transaction('rw', db.turnos, db.movimientosCaja, async () => {
    const turno = await turnoAbierto(db);
    if (!turno) throw new ErrorKiosco('Primero abrí la caja.');
    const mov: MovimientoCaja = {
      turnoId: turno.id!,
      fecha: ahora(),
      tipo,
      monto,
      motivo: motivo.trim(),
      ...(tipo === 'gasto' && mercaderia ? { mercaderia: true } : {}),
      ...quien('usuario', usuario),
    };
    return db.movimientosCaja.add(mov);
  });
}

// ---------- Ventas ----------

export interface DatosVenta {
  items: ItemVenta[];
  medio: MedioPago;
  /** Con cuánto efectivo pagó (en el pago dividido, cuánto puso en efectivo). null = justo. */
  pagaCon: Pesos | null;
  /** A quién se le anota lo fiado (todo, o la parte fiada del pago dividido). */
  clienteId: number | null;
  /** Pago dividido: la suma tiene que dar el total. Puede incluir una parte fiada. */
  pagos?: Pago[];
  /** Descuento sobre toda la venta: se resta de la suma de los renglones. */
  descuento?: Pesos;
}

/**
 * Guarda la venta y descuenta el stock en un solo paso: o se hace todo o
 * no se hace nada. El stock puede quedar negativo (pasa cuando el conteo
 * estaba mal); se avisa en Productos para corregirlo.
 */
export async function registrarVenta(db: BaseKiosco, datos: DatosVenta, usuario?: string): Promise<Venta> {
  const items = datos.items.filter((i) => i.cantidad > 0);
  if (items.length === 0) throw new ErrorKiosco('No hay nada para cobrar.');
  for (const i of items) {
    if (!Number.isInteger(i.cantidad) || i.cantidad > CANTIDAD_MAXIMA) {
      throw new ErrorKiosco(`La cantidad de "${i.nombre}" no es válida (máximo ${CANTIDAD_MAXIMA}).`);
    }
    if (!Number.isFinite(i.precioUnitario) || i.precioUnitario < 0) throw new ErrorKiosco(`El precio de "${i.nombre}" no es válido.`);
    // Un código de barras que cayó en un campo de plata llegaría acá como un precio de miles de millones.
    if (i.precioUnitario * i.cantidad > RENGLON_MAXIMO) throw new ErrorKiosco(`El importe de "${i.nombre}" es demasiado alto: revisalo.`);
    if (i.gramos !== undefined && !(Number.isInteger(i.gramos) && i.gramos > 0)) throw new ErrorKiosco(`El peso de "${i.nombre}" no es válido.`);
  }
  const suma = items.reduce((s, i) => s + subtotal(i), 0);
  const descuento = datos.descuento ?? 0;
  if (!Number.isInteger(descuento) || descuento < 0) throw new ErrorKiosco('El descuento no es válido.');
  if (descuento > 0 && descuento >= suma) throw new ErrorKiosco('El descuento no puede ser igual o mayor que la venta.');
  const total = suma - descuento;
  if (total <= 0) throw new ErrorKiosco('El total tiene que ser mayor a cero.');
  let pagos: Pago[] | undefined;
  if (datos.pagos && datos.pagos.filter((p) => p.monto > 0).length > 1) {
    pagos = datos.pagos.filter((p) => p.monto > 0);
    if (pagos.some((p) => !Number.isInteger(p.monto))) throw new ErrorKiosco('Los montos del pago tienen que ser enteros.');
    if (pagos.some((p) => !MEDIOS.some((m) => m.id === p.medio))) throw new ErrorKiosco('Hay un medio de pago que no existe.');
    if (new Set(pagos.map((p) => p.medio)).size !== pagos.length) throw new ErrorKiosco('Hay un medio de pago repetido.');
    const suma = pagos.reduce((s, p) => s + p.monto, 0);
    if (suma !== total) throw new ErrorKiosco(`Los pagos suman ${formatPesos(suma)} y el total es ${formatPesos(total)}.`);
  }
  // Cuánto hay que cubrir en efectivo: todo, o sólo esa parte del pago dividido.
  const enEfectivo = pagos ? (pagos.find((p) => p.medio === 'efectivo')?.monto ?? 0) : datos.medio === 'efectivo' ? total : 0;
  let pagaCon: Pesos | null = null;
  let vuelto = 0;
  if (enEfectivo > 0 && datos.pagaCon !== null) {
    if (datos.pagaCon < enEfectivo) throw new ErrorKiosco('Con eso no alcanza para pagar.');
    if (datos.pagaCon > enEfectivo + VUELTO_MAXIMO) throw new ErrorKiosco('El "paga con" es demasiado alto: parece un código de barras.');
    pagaCon = datos.pagaCon;
    vuelto = datos.pagaCon - enEfectivo;
  }
  const fiado = pagos ? (pagos.find((p) => p.medio === 'fiado')?.monto ?? 0) : datos.medio === 'fiado' ? total : 0;
  if (fiado > 0 && datos.clienteId === null) throw new ErrorKiosco('Elegí a quién se le anota el fiado.');
  const clienteId = fiado > 0 ? datos.clienteId : null;

  return db.transaction(
    'rw',
    [db.turnos, db.ventas, db.productos, db.clientes, db.movimientosFiado],
    async () => {
      const turno = await turnoAbierto(db);
      if (!turno) throw new ErrorKiosco('Primero abrí la caja.');
      if (clienteId !== null && !(await db.clientes.get(clienteId))) {
        throw new ErrorKiosco('Ese cliente ya no existe.');
      }
      const venta: Venta = {
        fecha: ahora(),
        turnoId: turno.id!,
        cajero: turno.cajero,
        items,
        total,
        ...(descuento > 0 ? { descuento } : {}),
        medio: datos.medio,
        pagaCon,
        vuelto,
        clienteId,
        anulada: false,
        ...(pagos ? { pagos } : {}),
        ...quien('usuario', usuario),
      };
      venta.id = await db.ventas.add(venta);
      for (const it of items) {
        if (it.productoId === null) continue;
        await db.productos
          .where('id')
          .equals(it.productoId)
          .modify((p) => {
            p.stock = redondearStock(p.stock - stockQueUsa(it));
          });
      }
      if (clienteId !== null) {
        await db.movimientosFiado.add({
          clienteId,
          fecha: venta.fecha,
          tipo: 'compra',
          monto: fiado,
          ventaId: venta.id,
          turnoId: turno.id!,
          medio: null,
          nota: '',
          anulado: false,
        });
      }
      return venta;
    },
  );
}

/**
 * Anula una venta del turno abierto: devuelve el stock y saca el fiado.
 * La venta no se borra; queda marcada como anulada.
 */
export async function anularVenta(db: BaseKiosco, ventaId: number, usuario?: string): Promise<void> {
  await db.transaction('rw', [db.turnos, db.ventas, db.productos, db.movimientosFiado], async () => {
    const venta = await db.ventas.get(ventaId);
    if (!venta) throw new ErrorKiosco('No se encontró la venta.');
    if (venta.anulada) throw new ErrorKiosco('Esa venta ya estaba anulada.');
    if (venta.devoluciones?.length) throw new ErrorKiosco('Esa venta ya tiene una devolución: devolvé lo que falta en vez de anularla.');
    const turno = await turnoAbierto(db);
    if (!turno || turno.id !== venta.turnoId) {
      throw new ErrorKiosco('Sólo se pueden anular ventas de la caja abierta. Para una venta de otro día, usá "Devolver".');
    }
    await db.ventas.update(ventaId, { anulada: true, anuladaFecha: ahora(), ...quien('anuladaPor', usuario) });
    for (const it of venta.items) {
      if (it.productoId === null) continue;
      await db.productos
        .where('id')
        .equals(it.productoId)
        .modify((p) => {
          p.stock = redondearStock(p.stock + stockQueUsa(it));
        });
    }
    await db.movimientosFiado
      .where('ventaId')
      .equals(ventaId)
      .modify((m) => {
        m.anulado = true;
      });
  });
}

/**
 * El cliente devuelve o cambia algo ya cobrado, aunque sea de otro día: vuelve
 * el stock y la plata sale de la caja abierta (en efectivo), se descuenta de
 * la cuenta (fiado) o sólo queda anotada (Mercado Pago, tarjeta,
 * transferencia: el reverso se hace afuera). La venta queda con lo que no volvió.
 */
export async function devolverProductos(
  db: BaseKiosco,
  ventaId: number,
  renglones: RenglonDevuelto[],
  medio: MedioPago,
  motivo = '',
  usuario?: string,
): Promise<Devolucion> {
  const pedidos = renglones.filter((r) => r.cantidad > 0);
  if (pedidos.length === 0) throw new ErrorKiosco('Marcá qué se devuelve.');
  if (pedidos.some((r) => !Number.isInteger(r.cantidad) || !Number.isInteger(r.indice))) throw new ErrorKiosco('La cantidad a devolver no es válida.');
  if (new Set(pedidos.map((r) => r.indice)).size !== pedidos.length) throw new ErrorKiosco('Hay un renglón repetido.');
  if (!MEDIOS.some((m) => m.id === medio)) throw new ErrorKiosco('Ese medio de pago no existe.');
  return db.transaction('rw', [db.turnos, db.ventas, db.productos, db.clientes, db.movimientosCaja, db.movimientosFiado, db.eventos], async () => {
    const venta = await db.ventas.get(ventaId);
    if (!venta) throw new ErrorKiosco('No se encontró la venta.');
    if (venta.anulada) throw new ErrorKiosco('Esa venta está anulada: no hay nada para devolver.');
    const turno = await turnoAbierto(db);
    if (!turno) throw new ErrorKiosco('Primero abrí la caja: la devolución se anota en el turno.');
    for (const r of pedidos) {
      const it = venta.items[r.indice];
      if (!it) throw new ErrorKiosco('Hay un renglón que no está en la venta.');
      const quedan = it.cantidad - cantidadDevuelta(venta, r.indice);
      if (r.cantidad > quedan) {
        throw new ErrorKiosco(quedan <= 0 ? `"${it.nombre}" ya se devolvió entero.` : `De "${it.nombre}" ${quedan === 1 ? 'queda 1' : `quedan ${quedan}`} por devolver.`);
      }
    }
    const monto = montoDevolucion(venta, pedidos);
    if (medio === 'fiado') {
      if (venta.clienteId === null) throw new ErrorKiosco('Esa venta no fue al fiado: devolvé la plata por otro medio.');
      if (!(await db.clientes.get(venta.clienteId))) throw new ErrorKiosco('Ese cliente ya no existe.');
      // De la cuenta sólo se descuenta lo que se fió: lo que se pagó con otro medio se devuelve por ese medio.
      const disponible = fiadoDisponible(venta);
      if (monto > disponible) {
        throw new ErrorKiosco(
          disponible <= 0 ? 'De esta venta no queda nada anotado en la cuenta: devolvé la plata por otro medio.' : `En la cuenta sólo quedan ${formatPesos(disponible)} de esta venta: el resto devolvelo por otro medio.`,
        );
      }
    }
    const detalle = detalleDevolucion(venta, pedidos);
    const devolucion: Devolucion = {
      fecha: ahora(),
      turnoId: turno.id!,
      items: pedidos.map((r) => ({ indice: r.indice, cantidad: r.cantidad })),
      monto,
      medio,
      motivo: motivo.trim(),
      ...quien('usuario', usuario),
    };
    await db.ventas.update(ventaId, { devoluciones: [...(venta.devoluciones ?? []), devolucion] });
    // Para el panel del día: las devoluciones se cuentan por el día en que se hicieron, aunque la venta sea vieja.
    await db.eventos.add({ fecha: devolucion.fecha, tipo: 'devolucion', turnoId: turno.id!, monto, detalle, ...quien('usuario', usuario) });
    for (const s of stockQueVuelve(venta, pedidos)) {
      await db.productos
        .where('id')
        .equals(s.productoId)
        .modify((p) => {
          p.stock = redondearStock(p.stock + s.cantidad);
        });
    }
    if (monto > 0 && medio === 'efectivo') {
      await db.movimientosCaja.add({
        turnoId: turno.id!,
        fecha: devolucion.fecha,
        tipo: 'devolucion',
        monto,
        motivo: `Devolución: ${detalle}`,
        ventaId,
        ...quien('usuario', usuario),
      });
    }
    if (monto > 0 && medio === 'fiado') {
      await db.movimientosFiado.add({
        clienteId: venta.clienteId!,
        fecha: devolucion.fecha,
        tipo: 'pago',
        monto,
        ventaId,
        turnoId: turno.id!,
        medio: null,
        nota: `Devolución: ${detalle}`,
        anulado: false,
      });
    }
    return devolucion;
  });
}

/** Una venta que se armó y se canceló antes de cobrar: queda anotada para que el dueño la vea. */
export async function registrarCancelacion(db: BaseKiosco, items: ItemVenta[], usuario?: string): Promise<void> {
  const monto = items.reduce((s, i) => s + subtotal(i), 0);
  if (items.length === 0 || monto <= 0) return;
  const turno = await turnoAbierto(db);
  await db.eventos.add({
    fecha: ahora(),
    tipo: 'cancelacion',
    turnoId: turno?.id ?? null,
    monto,
    detalle: describirItems(items),
    ...quien('usuario', usuario),
  });
}

/** Con cuánto cambio conviene abrir: lo que se contó al cerrar la última caja. */
export async function fondoSugerido(db: BaseKiosco): Promise<{ monto: Pesos; fecha: number } | null> {
  const ultimo = (await db.turnos.orderBy('apertura').reverse().limit(5).toArray()).find((t) => t.cierre !== null);
  if (!ultimo) return null;
  const monto = ultimo.contado ?? ultimo.esperado;
  return monto === null || monto < 0 ? null : { monto, fecha: ultimo.cierre! };
}

// ---------- Productos ----------

export type DatosProducto = Omit<Producto, 'id' | 'creado' | 'actualizado'>;

function validarProducto(p: DatosProducto) {
  if (!p.nombre.trim()) throw new ErrorKiosco('Poné el nombre del producto.');
  if (!(p.precio >= 0)) throw new ErrorKiosco('El precio no puede ser negativo.');
  if (!(p.costo >= 0)) throw new ErrorKiosco('El costo no puede ser negativo.');
  if (p.codigo && !/^[0-9A-Za-z-]{1,30}$/.test(p.codigo)) {
    throw new ErrorKiosco('El código sólo puede tener números y letras.');
  }
  const pr = p.promo;
  if (pr && (!Number.isInteger(pr.cantidad) || pr.cantidad < 2 || !Number.isInteger(pr.precio) || pr.precio <= 0 || pr.precio >= p.precio * pr.cantidad)) {
    throw new ErrorKiosco('La promo tiene que ser de 2 o más unidades y más barata que comprarlas sueltas.');
  }
  if (p.vence && !/^\d{4}-\d{2}-\d{2}$/.test(p.vence)) throw new ErrorKiosco('La fecha de vencimiento no es válida.');
}

export async function buscarPorCodigo(db: BaseKiosco, codigo: string): Promise<Producto | undefined> {
  if (!codigo) return undefined;
  return db.productos.where('codigo').equals(codigo).first();
}

/**
 * Crea (sin id) o actualiza (con id). No toca campos que no conoce.
 * Al editar, `stockOriginal` es el stock que se vio al abrir el formulario:
 * se aplica sólo la diferencia, para no pisar ventas hechas mientras tanto.
 */
export async function guardarProducto(
  db: BaseKiosco,
  datos: DatosProducto,
  id?: number,
  stockOriginal?: number,
): Promise<number> {
  const limpio: DatosProducto = {
    ...datos,
    codigo: datos.codigo.trim(),
    nombre: datos.nombre.trim().replace(/\s+/g, ' '),
    categoria: datos.categoria.trim(),
    ...(datos.proveedor !== undefined ? { proveedor: datos.proveedor.trim().replace(/\s+/g, ' ') } : {}),
    stock: datos.porPeso ? redondearStock(datos.stock) : Math.floor(datos.stock),
    stockMinimo: Math.max(0, Math.floor(datos.stockMinimo)),
  };
  validarProducto(limpio);
  return db.transaction('rw', db.productos, async () => {
    if (limpio.codigo) {
      const otro = await buscarPorCodigo(db, limpio.codigo);
      if (otro && otro.id !== id) throw new ErrorKiosco(`El código ${limpio.codigo} ya es de "${otro.nombre}".`);
    }
    if (id === undefined) return db.productos.add({ ...limpio, creado: ahora(), actualizado: ahora() });
    const existe = await db.productos.get(id);
    if (!existe) throw new ErrorKiosco('Ese producto ya no existe.');
    const stock = stockOriginal === undefined ? limpio.stock : redondearStock(existe.stock + (limpio.stock - stockOriginal));
    await db.productos.update(id, { ...limpio, stock, actualizado: ahora() });
    return id;
  });
}

export async function borrarProducto(db: BaseKiosco, id: number): Promise<void> {
  // Las ventas viejas guardan nombre y precio propios, así que no se pierden.
  await db.transaction('rw', db.productos, db.borrados, async () => {
    await db.productos.delete(id);
    await db.borrados.add({ tabla: 'productos', id: String(id), fecha: Date.now() });
  });
}

export async function aumentoMasivo(
  db: BaseKiosco,
  ids: number[],
  porcentaje: number,
  redondeo: Redondeo,
  tocarCosto: boolean,
): Promise<number> {
  if (!Number.isFinite(porcentaje) || porcentaje <= -100) throw new ErrorKiosco('El porcentaje no es válido.');
  const conjunto = new Set(ids);
  return db.transaction('rw', db.productos, async () => {
    return db.productos
      .filter((p) => p.id !== undefined && conjunto.has(p.id))
      .modify((p) => {
        p.precio = aplicarAumento(p.precio, porcentaje, redondeo);
        // La promo sube igual: si no, el descuento crece solo con cada aumento.
        if (p.promo) p.promo = { ...p.promo, precio: Math.min(aplicarAumento(p.promo.precio, porcentaje, redondeo), p.precio * p.promo.cantidad - 1) };
        if (tocarCosto && p.costo > 0) p.costo = aplicarAumento(p.costo, porcentaje, 1);
        p.actualizado = ahora();
      });
  });
}

function mismoNombre(a: string, b: string): boolean {
  const n = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  return n(a) === n(b);
}

export interface ResultadoCarga {
  nuevos: number;
  actualizados: number;
}

/**
 * Carga una planilla. Si el código ya existe, actualiza nombre, precio,
 * costo y categoría, pero NO el stock (para no pisar lo contado).
 * Si no tiene código o no existe, crea el producto con su stock.
 */
export async function cargarPlanilla(db: BaseKiosco, filas: FilaImportada[]): Promise<ResultadoCarga> {
  for (const f of filas) {
    if (!f.nombre.trim() || !(f.precio >= 0) || !(f.costo >= 0) || !Number.isFinite(f.stock)) {
      throw new ErrorKiosco(`La fila de "${f.nombre}" tiene datos no válidos.`);
    }
  }
  return db.transaction('rw', db.productos, async () => {
    let nuevos = 0;
    let actualizados = 0;
    for (const f of filas) {
      // Sin código, se busca un producto sin código con el mismo nombre,
      // para que bajar la planilla y volver a cargarla no duplique nada.
      const existente = f.codigo
        ? await buscarPorCodigo(db, f.codigo)
        : await db.productos.filter((p) => !p.codigo && mismoNombre(p.nombre, f.nombre)).first();
      if (existente) {
        await db.productos.update(existente.id!, {
          nombre: f.nombre,
          precio: f.precio,
          ...(f.costo > 0 ? { costo: f.costo } : {}),
          ...(f.categoria ? { categoria: f.categoria } : {}),
          ...(f.proveedor ? { proveedor: f.proveedor.trim() } : {}),
          actualizado: ahora(),
        });
        actualizados++;
      } else {
        await db.productos.add({
          codigo: f.codigo,
          nombre: f.nombre,
          precio: f.precio,
          costo: f.costo,
          stock: f.stock,
          stockMinimo: 0,
          categoria: f.categoria,
          ...(f.proveedor ? { proveedor: f.proveedor.trim() } : {}),
          rapido: false,
          creado: ahora(),
          actualizado: ahora(),
        });
        nuevos++;
      }
    }
    return { nuevos, actualizados };
  });
}

/** Suma (o resta) stock al recibir mercadería o corregir un conteo. */
export async function ajustarStock(db: BaseKiosco, id: number, cantidad: number): Promise<void> {
  const n = await db.productos
    .where('id')
    .equals(id)
    .modify((p) => {
      p.stock = p.porPeso ? redondearStock(p.stock + cantidad) : p.stock + Math.floor(cantidad);
      p.actualizado = ahora();
    });
  if (n === 0) throw new ErrorKiosco('Ese producto ya no existe.');
}

export interface RenglonCompra {
  productoId: number;
  cantidad: number;
  /** Costo nuevo por unidad (o por kilo). 0 = no cambia. */
  costo: Pesos;
  /** Precio de venta nuevo (para mantener el margen con el costo nuevo). 0 o nada = no cambia. */
  precio?: Pesos;
}

/** El precio de la promo escalado con el precio suelto, redondeado a $10 y nunca más caro que comprar suelto. */
function promoProporcional(promo: Pesos, precioViejo: Pesos, precioNuevo: Pesos, cantidad: number): Pesos {
  const escalado = precioViejo > 0 ? Math.round((promo * precioNuevo) / precioViejo / 10) * 10 : promo;
  return Math.max(1, Math.min(escalado, precioNuevo * cantidad - 1));
}

/**
 * Llegó mercadería del proveedor: suma stock, actualiza el costo y, si se
 * pagó con plata de la caja, lo anota como gasto del turno.
 */
export async function ingresarMercaderia(
  db: BaseKiosco,
  renglones: RenglonCompra[],
  opciones: { proveedor: string; pagadoDeCaja: boolean; montoPagado?: Pesos },
  usuario?: string,
): Promise<Pesos> {
  const validos = renglones.filter((r) => r.cantidad > 0);
  if (validos.length === 0) throw new ErrorKiosco('Poné al menos una cantidad.');
  if (validos.some((r) => !(r.costo >= 0) || !Number.isInteger(r.costo))) throw new ErrorKiosco('El costo tiene que ser un número entero, sin centavos.');
  if (validos.some((r) => r.precio !== undefined && (!(r.precio >= 0) || !Number.isInteger(r.precio) || r.precio > RENGLON_MAXIMO))) {
    throw new ErrorKiosco('El precio nuevo no es válido.');
  }
  if (validos.some((r) => !(r.cantidad <= COMPRA_MAXIMA))) throw new ErrorKiosco(`Una cantidad es demasiado grande (máximo ${COMPRA_MAXIMA}): ¿se escaneó un código ahí?`);
  if (opciones.montoPagado !== undefined && (!Number.isInteger(opciones.montoPagado) || opciones.montoPagado < 0 || opciones.montoPagado > RENGLON_MAXIMO)) {
    throw new ErrorKiosco('El monto pagado de la caja no es válido.');
  }
  return db.transaction('rw', [db.productos, db.turnos, db.movimientosCaja], async () => {
    let total = 0;
    for (const r of validos) {
      const p = await db.productos.get(r.productoId);
      if (!p) throw new ErrorKiosco('Uno de los productos ya no existe.');
      const costo = r.costo > 0 ? r.costo : p.costo;
      // La misma cantidad para el stock y para la plata: kilos con gramos, o unidades enteras.
      const cant = p.porPeso ? redondearStock(r.cantidad) : Math.floor(r.cantidad);
      if (!(cant > 0) || !Number.isFinite(cant)) continue;
      total += Math.round(costo * cant);
      const precio = r.precio && r.precio > 0 ? r.precio : p.precio;
      const proveedor = opciones.proveedor.trim();
      await db.productos.update(r.productoId, {
        stock: p.porPeso ? redondearStock(p.stock + cant) : p.stock + cant,
        costo,
        precio,
        // El proveedor se recuerda para armar el próximo pedido.
        ...(proveedor && !p.proveedor?.trim() ? { proveedor } : {}),
        // La promo sube en la misma proporción que el precio: si no, el descuento crece solo.
        ...(p.promo && precio !== p.precio ? { promo: { ...p.promo, precio: promoProporcional(p.promo.precio, p.precio, precio, p.promo.cantidad) } } : {}),
        actualizado: ahora(),
      });
    }
    // Lo que salió de la caja es lo que se pagó, que puede no ser el costo calculado (sin costo cargado, con descuento).
    const gasto = opciones.montoPagado ?? total;
    if (opciones.pagadoDeCaja && gasto > 0) {
      const turno = await turnoAbierto(db);
      if (!turno) throw new ErrorKiosco('Para pagarlo con plata de la caja, primero abrí la caja.');
      await db.movimientosCaja.add({
        turnoId: turno.id!,
        fecha: ahora(),
        tipo: 'gasto',
        monto: gasto,
        motivo: `Mercadería${opciones.proveedor.trim() ? `: ${opciones.proveedor.trim()}` : ''}`,
        mercaderia: true,
        ...quien('usuario', usuario),
      });
      return gasto;
    }
    return opciones.pagadoDeCaja ? 0 : total;
  });
}

// ---------- Clientes y fiado ----------

export async function guardarCliente(
  db: BaseKiosco,
  datos: Pick<Cliente, 'nombre' | 'telefono' | 'limite'>,
  id?: number,
): Promise<number> {
  const nombre = datos.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre) throw new ErrorKiosco('Poné el nombre del cliente.');
  if (!(datos.limite >= 0)) throw new ErrorKiosco('El límite no puede ser negativo.');
  const limpio = { nombre, telefono: datos.telefono.trim(), limite: datos.limite };
  if (id === undefined) return db.clientes.add({ ...limpio, creado: ahora() });
  await db.clientes.update(id, limpio);
  return id;
}

export async function saldoDe(db: BaseKiosco, clienteId: number): Promise<Pesos> {
  return saldoCliente(await db.movimientosFiado.where('clienteId').equals(clienteId).toArray());
}

/** Avisa si la compra al fiado pasa el límite del cliente (no la bloquea). */
export async function controlarLimite(db: BaseKiosco, clienteId: number, compra: Pesos): Promise<string | null> {
  const cliente = await db.clientes.get(clienteId);
  if (!cliente) return null;
  const saldo = await saldoDe(db, clienteId);
  return superaLimite(saldo, compra, cliente.limite)
    ? `${cliente.nombre} pasaría su límite de fiado.`
    : null;
}

export async function registrarPagoFiado(
  db: BaseKiosco,
  clienteId: number,
  monto: Pesos,
  medio: Exclude<MedioPago, 'fiado'>,
  nota = '',
): Promise<number> {
  if (!(monto > 0)) throw new ErrorKiosco('Poné un monto mayor a cero.');
  if (monto > RENGLON_MAXIMO) throw new ErrorKiosco('Ese monto es demasiado alto: parece un código de barras.');
  return db.transaction('rw', [db.turnos, db.clientes, db.movimientosFiado], async () => {
    if (!(await db.clientes.get(clienteId))) throw new ErrorKiosco('Ese cliente ya no existe.');
    const turno = await turnoAbierto(db);
    if (medio === 'efectivo' && !turno) throw new ErrorKiosco('Para cobrar en efectivo, primero abrí la caja.');
    return db.movimientosFiado.add({
      clienteId,
      fecha: ahora(),
      tipo: 'pago',
      monto,
      ventaId: null,
      turnoId: turno?.id ?? null,
      medio,
      nota: nota.trim(),
      anulado: false,
    });
  });
}

/** Un pago de fiado mal cargado se anula: vuelve a sumar en la cuenta del cliente. */
export async function anularPagoFiado(db: BaseKiosco, id: number, usuario?: string): Promise<void> {
  await db.transaction('rw', db.movimientosFiado, async () => {
    const m = await db.movimientosFiado.get(id);
    if (!m) throw new ErrorKiosco('No se encontró el pago.');
    if (m.tipo !== 'pago') throw new ErrorKiosco('Una compra se anula desde la venta, no desde la cuenta.');
    if (m.medio === null) throw new ErrorKiosco('Eso es una devolución, no un pago: no se puede anular desde la cuenta.');
    if (m.anulado) throw new ErrorKiosco('Ese pago ya estaba anulado.');
    await db.movimientosFiado.update(id, { anulado: true, ...quien('anuladoPor', usuario) });
  });
}

// ---------- Ajustes ----------

export async function leerAjuste<T>(db: BaseKiosco, clave: string, porDefecto: T): Promise<T> {
  const fila = await db.ajustes.get(clave);
  return fila === undefined ? porDefecto : (fila.valor as T);
}

export async function guardarAjuste(db: BaseKiosco, clave: string, valor: unknown): Promise<void> {
  await db.ajustes.put({ clave, valor });
}
