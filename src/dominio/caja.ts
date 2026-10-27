import { pagosDeVenta } from './carrito';
import type { MedioPago, MovimientoCaja, MovimientoFiado, Pesos, Venta } from './tipos';

/** Billetes y monedas que se cuentan al cerrar. */
export const DENOMINACIONES: Pesos[] = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

export function totalConteo(conteo: Record<string, number>): Pesos {
  return DENOMINACIONES.reduce((suma, d) => suma + d * (conteo[String(d)] ?? 0), 0) + (conteo['monedas'] ?? 0);
}

export interface ResumenTurno {
  cantidadVentas: number;
  totalVendido: Pesos;
  porMedio: Record<MedioPago, Pesos>;
  /** Cobros de fiado que entraron en este turno, por medio. */
  cobrosFiado: Record<MedioPago, Pesos>;
  retiros: Pesos;
  gastos: Pesos;
  ingresos: Pesos;
  efectivoEsperado: Pesos;
}

function porMedioVacio(): Record<MedioPago, Pesos> {
  return { efectivo: 0, mercadopago: 0, tarjeta: 0, transferencia: 0, fiado: 0 };
}

/**
 * La única regla para saber cuánta plata debería haber en la caja.
 * Efectivo esperado = fondo + ventas en efectivo + fiado cobrado en efectivo
 * + ingresos - retiros - gastos. Las ventas anuladas no cuentan.
 */
export function resumirTurno(
  fondoInicial: Pesos,
  ventas: Venta[],
  movimientos: MovimientoCaja[],
  pagosFiado: MovimientoFiado[],
): ResumenTurno {
  const porMedio = porMedioVacio();
  const cobrosFiado = porMedioVacio();
  let cantidadVentas = 0;
  let totalVendido = 0;
  for (const v of ventas) {
    if (v.anulada) continue;
    cantidadVentas++;
    totalVendido += v.total;
    for (const p of pagosDeVenta(v)) porMedio[p.medio] += p.monto;
  }
  for (const p of pagosFiado) {
    if (p.anulado || p.tipo !== 'pago' || !p.medio) continue;
    cobrosFiado[p.medio] += p.monto;
  }
  let retiros = 0;
  let gastos = 0;
  let ingresos = 0;
  for (const m of movimientos) {
    if (m.tipo === 'retiro') retiros += m.monto;
    else if (m.tipo === 'gasto') gastos += m.monto;
    else ingresos += m.monto;
  }
  const efectivoEsperado = fondoInicial + porMedio.efectivo + cobrosFiado.efectivo + ingresos - retiros - gastos;
  return { cantidadVentas, totalVendido, porMedio, cobrosFiado, retiros, gastos, ingresos, efectivoEsperado };
}
