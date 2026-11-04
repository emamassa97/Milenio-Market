import { stockQueUsa } from './carrito';
import type { Componente, ItemVenta, Producto } from './tipos';

/** Unidades de un mismo producto que puede llevar un combo (más es un código en el campo cantidad). */
export const COMPONENTE_MAXIMO = 99;

export function esCombo(p: Pick<Producto, 'componentes'> | undefined | null): boolean {
  return !!p?.componentes && p.componentes.length > 0;
}

/** Qué stock mueve un renglón vendido: el del producto o, si es un combo, el de cada cosa que lleva. */
export function stockQueMueve(item: ItemVenta, cantidad = item.cantidad): { productoId: number; cantidad: number }[] {
  if (item.productoId === null || cantidad <= 0) return [];
  if (item.componentes && item.componentes.length > 0) {
    return item.componentes.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad * cantidad }));
  }
  return [{ productoId: item.productoId, cantidad: stockQueUsa({ ...item, cantidad }) }];
}

/** Cuántos combos se pueden armar con el stock de lo que llevan (null si no es combo). */
export function alcanzaPara(combo: Producto, porId: Map<number, Producto>): number | null {
  if (!esCombo(combo)) return null;
  let min = Infinity;
  for (const c of combo.componentes!) {
    const p = porId.get(c.productoId);
    if (!p) continue;
    min = Math.min(min, Math.floor(p.stock / c.cantidad));
  }
  return min === Infinity ? 0 : Math.max(0, min);
}

/** Lo que cuestan las cosas que lleva el combo (para sugerir su costo). */
export function costoDeComponentes(componentes: Componente[], porId: Map<number, Producto>): number {
  return componentes.reduce((s, c) => s + (porId.get(c.productoId)?.costo ?? 0) * c.cantidad, 0);
}

/** "1 Fernet + 2 Coca 500" */
export function describirComponentes(componentes: Componente[], porId: Map<number, Producto>): string {
  return componentes
    .map((c) => {
      const p = porId.get(c.productoId);
      return `${c.cantidad} ${p ? p.nombre : '(producto borrado)'}`;
    })
    .join(' + ');
}

/**
 * Para mostrar en la caja: el stock de un combo es cuántos se pueden armar con lo que hay.
 * Los productos comunes quedan igual.
 */
export function conStockDeCombos(productos: Producto[]): Producto[] {
  if (!productos.some(esCombo)) return productos;
  const porId = new Map(productos.filter((p) => p.id !== undefined).map((p) => [p.id!, p]));
  return productos.map((p) => (esCombo(p) ? { ...p, stock: alcanzaPara(p, porId) ?? 0 } : p));
}
