import type { Pesos } from './tipos';

export type Redondeo = 1 | 10 | 50 | 100;

/**
 * Aplica un aumento (o rebaja, con % negativo) y redondea hacia arriba al
 * múltiplo elegido, como se suele hacer en el kiosco ($1.437 -> $1.440 con 10).
 * Nunca deja un precio por debajo de $0.
 */
export function aplicarAumento(precio: Pesos, porcentaje: number, redondeo: Redondeo): Pesos {
  const nuevo = (precio * (100 + porcentaje)) / 100;
  // El 1e-9 evita que un 1440.0000000001 de la cuenta suba a 1450.
  const redondo = Math.ceil(nuevo / redondeo - 1e-9) * redondeo;
  return Math.max(0, redondo);
}

/** Margen sobre el precio de venta, en %. null si no hay costo cargado. */
export function margen(precio: Pesos, costo: Pesos): number | null {
  if (costo <= 0 || precio <= 0) return null;
  return Math.round(((precio - costo) / precio) * 100);
}
