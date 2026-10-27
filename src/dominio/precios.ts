import type { Pesos } from './tipos';

export type Redondeo = 1 | 10 | 50 | 100;

/**
 * Aplica un aumento (o rebaja, con % negativo) y redondea al múltiplo elegido:
 * hacia arriba si sube ($1.437 -> $1.440 con 10), hacia abajo si baja, para
 * que una rebaja siempre baje el precio.
 * Nunca deja un precio por debajo de $0.
 */
export function aplicarAumento(precio: Pesos, porcentaje: number, redondeo: Redondeo): Pesos {
  const nuevo = (precio * (100 + porcentaje)) / 100;
  // El 1e-9 evita que un 1440.0000000001 de la cuenta suba a 1450.
  const redondo =
    porcentaje >= 0
      ? Math.ceil(nuevo / redondeo - 1e-9) * redondeo
      : Math.floor(nuevo / redondeo + 1e-9) * redondeo;
  return Math.max(0, redondo);
}

/**
 * El precio que mantiene el mismo margen con un costo nuevo, redondeado hacia
 * arriba: con 38% de margen, un costo de $500 pide $810 (redondeo a $10).
 */
export function precioParaMargen(costo: Pesos, margenPorcentaje: number, redondeo: Redondeo = 10): Pesos {
  if (!(costo > 0) || !(margenPorcentaje < 100)) return 0;
  const exacto = costo / (1 - Math.max(0, margenPorcentaje) / 100);
  return Math.ceil(exacto / redondeo - 1e-9) * redondeo;
}

/** Margen sobre el precio de venta, en %. null si no hay costo cargado. */
export function margen(precio: Pesos, costo: Pesos): number | null {
  if (costo <= 0 || precio <= 0) return null;
  return Math.round(((precio - costo) / precio) * 100);
}
