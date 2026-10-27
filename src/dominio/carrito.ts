import type { ItemVenta, Pago, Pesos, Producto, Venta } from './tipos';

/** Más que esto en un renglón es casi seguro un error (un código en el campo cantidad). */
/** Más que esto en un renglón o de vuelto no es una venta de kiosco: es un código de barras en el campo equivocado. */
export const RENGLON_MAXIMO = 5_000_000;
export const VUELTO_MAXIMO = 500_000;
/** Unidades que pueden llegar de una vez en una compra. */
export const COMPRA_MAXIMA = 99_999;
export const CANTIDAD_MAXIMA = 999;

export interface Carrito {
  items: ItemVenta[];
  /** Descuento sobre toda la venta ("dejámelo en 3.000"). Siempre menor que la suma de los renglones. */
  descuento?: Pesos;
  /** El dueño (o su clave) autorizó el descuento: vale aunque después la venta se achique, se deje en espera o se recargue. */
  descuentoAutorizado?: boolean;
}

export const carritoVacio: Carrito = { items: [] };

/**
 * Lo que se escribe o escanea en la caja. "3*7790895000997" o "3x coca"
 * agrega 3 unidades. Sin multiplicador, 1. Con "?" adelante ("?coca") se
 * consulta el precio sin cargarlo en la venta.
 */
export function interpretarEntrada(texto: string): { cantidad: number; busqueda: string; consulta: boolean } {
  let limpio = texto.trim();
  const consulta = limpio.startsWith('?');
  if (consulta) limpio = limpio.slice(1).trim();
  const m = /^(\d{1,3})\s*[*xX]\s*(.+)$/.exec(limpio);
  if (m) {
    const cantidad = Number(m[1]);
    if (cantidad > 0) return { cantidad, busqueda: m[2]!.trim(), consulta };
  }
  return { cantidad: 1, busqueda: limpio, consulta };
}

/** Un código de barras: sólo cifras, de 4 a 14. */
export function esCodigo(texto: string): boolean {
  return /^\d{4,14}$/.test(texto.trim());
}

export function itemDeProducto(producto: Producto, cantidad: number): ItemVenta {
  if (producto.id === undefined) throw new Error('El producto no está guardado');
  return {
    productoId: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    precioUnitario: producto.precio,
    costoUnitario: producto.costo,
    cantidad,
    ...(producto.promo && producto.promo.cantidad > 1 ? { promo: producto.promo } : {}),
  };
}

/** Un producto por peso: el precio es por kilo y se cobra lo que pesó. */
export function itemPorPeso(producto: Producto, gramos: number): ItemVenta {
  if (producto.id === undefined) throw new Error('El producto no está guardado');
  const g = Math.round(gramos);
  return {
    productoId: producto.id,
    codigo: producto.codigo,
    nombre: producto.nombre,
    precioUnitario: Math.round((producto.precio * g) / 1000),
    costoUnitario: Math.round((producto.costo * g) / 1000),
    cantidad: 1,
    gramos: g,
  };
}

export function formatoPeso(gramos: number): string {
  return gramos >= 1000 ? `${(gramos / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg` : `${gramos} g`;
}

/** Cuánto stock descuenta un renglón: unidades, o kilos si es por peso. */
export function stockQueUsa(item: ItemVenta): number {
  return item.gramos ? (item.gramos * item.cantidad) / 1000 : item.cantidad;
}

/** Los pagos de una venta, aunque sea de antes del pago dividido. */
export function pagosDeVenta(venta: Pick<Venta, 'medio' | 'total' | 'pagos'>): Pago[] {
  return venta.pagos && venta.pagos.length > 0 ? venta.pagos : [{ medio: venta.medio, monto: venta.total }];
}

export function itemMontoLibre(monto: Pesos, descripcion: string): ItemVenta {
  return {
    productoId: null,
    codigo: '',
    nombre: descripcion.trim() || 'Varios',
    precioUnitario: monto,
    costoUnitario: 0,
    cantidad: 1,
  };
}

/** Agrega un ítem; si el mismo producto ya está, suma la cantidad y lo sube arriba. */
export function agregarItem(carrito: Carrito, item: ItemVenta): Carrito {
  if (item.productoId !== null && !item.gramos) {
    const i = carrito.items.findIndex((x) => x.productoId === item.productoId && !x.gramos);
    if (i >= 0) {
      const existente = carrito.items[i]!;
      const actualizado = { ...existente, cantidad: Math.min(existente.cantidad + item.cantidad, CANTIDAD_MAXIMA) };
      const resto = carrito.items.filter((_, j) => j !== i);
      return { ...carrito, items: [actualizado, ...resto] };
    }
  }
  return { ...carrito, items: [item, ...carrito.items] };
}

/** Cambia la cantidad del renglón; 0 o menos lo saca. */
export function cambiarCantidad(carrito: Carrito, indice: number, cantidad: number): Carrito {
  if (cantidad <= 0) return quitarItem(carrito, indice);
  const n = Math.min(Math.floor(cantidad), CANTIDAD_MAXIMA);
  return conDescuentoValido({
    ...carrito,
    items: carrito.items.map((x, i) => (i === indice ? { ...x, cantidad: n } : x)),
  });
}

export function quitarItem(carrito: Carrito, indice: number): Carrito {
  return conDescuentoValido({ ...carrito, items: carrito.items.filter((_, i) => i !== indice) });
}

/** Pone (o saca, con 0) el descuento de toda la venta; nunca puede llegar a la suma de los renglones. */
export function aplicarDescuento(carrito: Carrito, descuento: Pesos, autorizado = false): Carrito {
  const d = Math.floor(descuento);
  const { descuento: _anterior, descuentoAutorizado: _autorizado, ...sinDescuento } = carrito;
  return d > 0 && d < sumaCarrito(carrito) ? { ...sinDescuento, descuento: d, ...(autorizado ? { descuentoAutorizado: true } : {}) } : sinDescuento;
}

/** Si la venta se achicó y el descuento ya no entra, se saca: nunca se cobra cero o negativo. */
function conDescuentoValido(carrito: Carrito): Carrito {
  return carrito.descuento !== undefined ? aplicarDescuento(carrito, carrito.descuento, carrito.descuentoAutorizado) : carrito;
}

/** Con promo "N por $X" se cobran los grupos completos a precio de promo y el resto suelto. */
export function subtotal(item: ItemVenta): Pesos {
  const p = item.promo;
  if (p && p.cantidad > 1 && item.cantidad >= p.cantidad) {
    const grupos = Math.floor(item.cantidad / p.cantidad);
    const conPromo = grupos * p.precio + (item.cantidad - grupos * p.cantidad) * item.precioUnitario;
    // Una promo mal cargada nunca puede cobrar más que suelto ni dar negativo.
    return Math.max(0, Math.min(conPromo, item.precioUnitario * item.cantidad));
  }
  return item.precioUnitario * item.cantidad;
}

/** Lo que se ahorró el cliente por la promo en este renglón. */
export function ahorroPromo(item: ItemVenta): Pesos {
  return item.precioUnitario * item.cantidad - subtotal(item);
}

/** La suma de los renglones, antes del descuento. */
export function sumaCarrito(carrito: Carrito): Pesos {
  return carrito.items.reduce((suma, item) => suma + subtotal(item), 0);
}

/** Lo que se cobra: los renglones menos el descuento. */
export function totalCarrito(carrito: Carrito): Pesos {
  return Math.max(0, sumaCarrito(carrito) - (carrito.descuento ?? 0));
}

export function unidades(carrito: Carrito): number {
  return carrito.items.reduce((suma, item) => suma + item.cantidad, 0);
}

/** null si paga con menos de lo que debe. */
export function calcularVuelto(total: Pesos, pagaCon: Pesos): Pesos | null {
  if (pagaCon < total) return null;
  return pagaCon - total;
}

/**
 * Billetes con los que la gente suele pagar: el monto justo, los redondeos
 * al próximo $1.000 y $2.000, y siempre el de $10.000 y el de $20.000 (los
 * que más vuelto generan). Hasta cinco opciones.
 */
export function pagosSugeridos(total: Pesos): Pesos[] {
  if (total <= 0) return [];
  const opciones = new Set<Pesos>([total]);
  for (const paso of [1000, 2000, 10000, 20000]) {
    const arriba = Math.ceil(total / paso) * paso;
    if (arriba > total) opciones.add(arriba);
  }
  // El vuelto redondo: para $4.600 el cliente da $10.600 y se le devuelven $6.000 en billetes grandes.
  const resto = total % 1000;
  const grande = [10000, 20000].find((b) => b > total);
  if (resto > 0 && grande) opciones.add(grande + resto);
  return [...opciones].sort((a, b) => a - b).slice(0, 6);
}
