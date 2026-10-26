import type { ItemVenta, Pesos, Producto } from './tipos';

export interface Carrito {
  items: ItemVenta[];
}

export const carritoVacio: Carrito = { items: [] };

/**
 * Lo que se escribe o escanea en la caja. "3*7790895000997" o "3x coca"
 * agrega 3 unidades. Sin multiplicador, 1.
 */
export function interpretarEntrada(texto: string): { cantidad: number; busqueda: string } {
  const limpio = texto.trim();
  const m = /^(\d{1,3})\s*[*xX]\s*(.+)$/.exec(limpio);
  if (m) {
    const cantidad = Number(m[1]);
    if (cantidad > 0) return { cantidad, busqueda: m[2]!.trim() };
  }
  return { cantidad: 1, busqueda: limpio };
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
  };
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
  if (item.productoId !== null) {
    const i = carrito.items.findIndex((x) => x.productoId === item.productoId);
    if (i >= 0) {
      const existente = carrito.items[i]!;
      const actualizado = { ...existente, cantidad: existente.cantidad + item.cantidad };
      const resto = carrito.items.filter((_, j) => j !== i);
      return { items: [actualizado, ...resto] };
    }
  }
  return { items: [item, ...carrito.items] };
}

/** Cambia la cantidad del renglón; 0 o menos lo saca. */
export function cambiarCantidad(carrito: Carrito, indice: number, cantidad: number): Carrito {
  if (cantidad <= 0) return quitarItem(carrito, indice);
  return {
    items: carrito.items.map((x, i) => (i === indice ? { ...x, cantidad: Math.floor(cantidad) } : x)),
  };
}

export function quitarItem(carrito: Carrito, indice: number): Carrito {
  return { items: carrito.items.filter((_, i) => i !== indice) };
}

export function subtotal(item: ItemVenta): Pesos {
  return item.precioUnitario * item.cantidad;
}

export function totalCarrito(carrito: Carrito): Pesos {
  return carrito.items.reduce((suma, item) => suma + subtotal(item), 0);
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
 * Billetes con los que la gente suele pagar: el monto justo y los
 * redondeos siguientes (al próximo $1.000, $2.000, $10.000, $20.000...).
 */
export function pagosSugeridos(total: Pesos): Pesos[] {
  if (total <= 0) return [];
  const opciones = new Set<Pesos>([total]);
  for (const paso of [1000, 2000, 5000, 10000, 20000]) {
    const arriba = Math.ceil(total / paso) * paso;
    if (arriba > total) opciones.add(arriba);
    if (opciones.size >= 4) break;
  }
  return [...opciones].sort((a, b) => a - b).slice(0, 4);
}
