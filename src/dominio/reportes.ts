import { pagosDeVenta, stockQueUsa, subtotal } from './carrito';
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
  for (const v of ventas) {
    if (v.anulada) continue;
    cantidad++;
    total += v.total;
    for (const p of pagosDeVenta(v)) porMedio[p.medio] += p.monto;
    porHora[new Date(v.fecha).getHours()]! += v.total;
    for (const it of v.items) {
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
    porMedio,
    porHora,
    productos: [...productos.values()].sort((a, b) => b.total - a.total),
  };
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
