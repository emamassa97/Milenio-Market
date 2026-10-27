import { pagosDeVenta, stockQueUsa, subtotal } from './carrito';
import { itemsNetos, totalNeto } from './devoluciones';
import type { MedioPago, Pesos, Producto, Venta } from './tipos';

export interface FilaProducto {
  clave: string;
  nombre: string;
  unidades: number;
  /** Productos por peso: kilos vendidos (en vez de unidades). */
  kilos?: number;
  total: Pesos;
}

export interface ResumenVentas {
  cantidad: number;
  total: Pesos;
  promedio: Pesos;
  /** Sólo de los productos con costo cargado. */
  ganancia: Pesos;
  ventasSinCosto: Pesos;
  /** Lo que volvió por devoluciones; `total` ya lo tiene descontado. */
  devuelto: Pesos;
  /** Cómo pagaron, bruto: las devoluciones van aparte en `devuelto`. */
  porMedio: Record<MedioPago, Pesos>;
  porHora: number[];
  productos: FilaProducto[];
}

export function resumirVentas(ventas: Venta[]): ResumenVentas {
  const porMedio: Record<MedioPago, Pesos> = { efectivo: 0, mercadopago: 0, tarjeta: 0, transferencia: 0, fiado: 0 };
  const porHora = Array.from({ length: 24 }, () => 0);
  const productos = new Map<string, FilaProducto>();
  let cantidad = 0;
  let total = 0;
  let ganancia = 0;
  let ventasSinCosto = 0;
  let devuelto = 0;
  for (const v of ventas) {
    if (v.anulada) continue;
    cantidad++;
    // Lo devuelto se descuenta: queda lo que de verdad se vendió.
    const neto = totalNeto(v);
    total += neto;
    devuelto += v.total - neto;
    for (const p of pagosDeVenta(v)) porMedio[p.medio] += p.monto;
    porHora[new Date(v.fecha).getHours()]! += neto;
    // El descuento de la venta sale de la ganancia (los renglones siguen a precio de lista), en proporción a lo que quedó vendido.
    if (v.descuento && v.total > 0) {
      const descuento = Math.round((v.descuento * neto) / v.total);
      if (v.items.some((it) => it.costoUnitario > 0)) ganancia -= descuento;
      else ventasSinCosto -= descuento;
    }
    for (const it of itemsNetos(v)) {
      const sub = subtotal(it);
      if (it.costoUnitario > 0) ganancia += sub - it.costoUnitario * it.cantidad;
      else ventasSinCosto += sub;
      const clave = it.productoId !== null ? `p${it.productoId}` : `libre:${it.nombre}`;
      // Las ventas por peso viejas guardaban los gramos en el nombre: "Queso (250 g)".
      const nombre = it.gramos ? it.nombre.replace(/ \([\d.,]+ k?g\)$/, '') : it.nombre;
      const fila = productos.get(clave) ?? { clave, nombre, unidades: 0, total: 0 };
      if (it.gramos) fila.kilos = Math.round(((fila.kilos ?? 0) + stockQueUsa(it)) * 1000) / 1000;
      else fila.unidades += it.cantidad;
      fila.total += sub;
      productos.set(clave, fila);
    }
  }
  return {
    cantidad,
    total,
    promedio: cantidad > 0 ? Math.round(total / cantidad) : 0,
    ganancia,
    ventasSinCosto,
    devuelto,
    porMedio,
    porHora,
    productos: [...productos.values()].sort((a, b) => b.total - a.total),
  };
}

export interface FilaDevuelto {
  clave: string;
  nombre: string;
  /** Unidades (o veces, en los productos por peso) que volvieron. */
  unidades: number;
  importe: Pesos;
  /** El motivo que más se repitió, si lo anotaron. */
  motivo: string;
}

/** Qué productos vuelven más (por lo que se devolvió en el período), para detectar lo que viene fallado o vencido. */
export interface FilaCajero {
  /** El usuario que cobró; si la venta no lo tiene, quien abrió la caja. */
  clave: string;
  cantidad: number;
  total: Pesos;
  devuelto: Pesos;
}

/** Ventas por quien cobró, de mayor a menor. Las anuladas no cuentan; lo devuelto va aparte y ya está fuera de `total`. */
export function porCajero(ventas: Venta[]): FilaCajero[] {
  const filas = new Map<string, FilaCajero>();
  for (const v of ventas) {
    if (v.anulada) continue;
    const clave = v.usuario?.trim() || v.cajero.trim() || 'Sin nombre';
    const fila = filas.get(clave) ?? { clave, cantidad: 0, total: 0, devuelto: 0 };
    const neto = totalNeto(v);
    fila.cantidad++;
    fila.total += neto;
    fila.devuelto += v.total - neto;
    filas.set(clave, fila);
  }
  return [...filas.values()].sort((a, b) => b.total - a.total);
}

export function masDevueltos(ventas: Venta[], desde = -Infinity, hasta = Infinity): FilaDevuelto[] {
  const filas = new Map<string, FilaDevuelto & { motivos: Map<string, number> }>();
  for (const v of ventas) {
    if (v.anulada) continue;
    for (const d of v.devoluciones ?? []) {
      // Cuenta la fecha en que se devolvió, no la de la venta.
      if (d.fecha < desde || d.fecha >= hasta) continue;
      // Lo devuelto de verdad (puede ser menos que el precio de lista, por promo o descuento), repartido entre los renglones.
      const lista = d.items.reduce((s, { indice, cantidad }) => s + cantidad * (v.items[indice]?.precioUnitario ?? 0), 0);
      for (const { indice, cantidad } of d.items) {
        const it = v.items[indice];
        if (!it || cantidad <= 0) continue;
        const clave = it.productoId !== null ? `p${it.productoId}` : `libre:${it.nombre}`;
        const nombre = it.gramos ? it.nombre.replace(/ \([\d.,]+ k?g\)$/, '') : it.nombre;
        const fila = filas.get(clave) ?? { clave, nombre, unidades: 0, importe: 0, motivo: '', motivos: new Map<string, number>() };
        fila.unidades += cantidad;
        fila.importe += lista > 0 ? Math.round((d.monto * cantidad * it.precioUnitario) / lista) : 0;
        const motivo = d.motivo.trim();
        if (motivo) fila.motivos.set(motivo, (fila.motivos.get(motivo) ?? 0) + cantidad);
        filas.set(clave, fila);
      }
    }
  }
  return [...filas.values()]
    .map(({ motivos, ...fila }) => ({ ...fila, motivo: [...motivos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }))
    .sort((a, b) => b.unidades - a.unidades || b.importe - a.importe);
}

export function paraReponer(productos: Producto[]): Producto[] {
  return productos
    .filter((p) => p.stockMinimo > 0 && p.stock <= p.stockMinimo)
    .sort((a, b) => a.stock - a.stockMinimo - (b.stock - b.stockMinimo) || a.stock - b.stock);
}

/** Productos con stock que no se vendieron en el período. */
export function sinMovimiento(productos: Producto[], ventas: Venta[]): Producto[] {
  const vendidos = new Set<number>();
  for (const v of ventas) {
    if (v.anulada) continue;
    for (const it of v.items) if (it.productoId !== null) vendidos.add(it.productoId);
  }
  return productos.filter((p) => p.id !== undefined && p.stock > 0 && !vendidos.has(p.id));
}

/** Días que faltan para la fecha 'AAAA-MM-DD' (negativo si ya venció). */
export function diasParaVencer(vence: string, hoy = new Date()): number {
  const [a, m, d] = vence.split('-').map(Number);
  const fecha = new Date(a!, (m ?? 1) - 1, d ?? 1);
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((fecha.getTime() - base.getTime()) / 86_400_000);
}

/** Productos con stock que vencen dentro de `dias` (o ya vencieron), el más urgente primero. */
export function porVencer(productos: Producto[], dias = 15, hoy = new Date()): (Producto & { faltan: number })[] {
  return productos
    .filter((p) => p.vence && p.stock > 0)
    .map((p) => ({ ...p, faltan: diasParaVencer(p.vence!, hoy) }))
    .filter((p) => p.faltan <= dias)
    .sort((a, b) => a.faltan - b.faltan);
}
