import { pagosDeVenta } from './carrito';
import { totalDevuelto } from './devoluciones';
import { formatPesos } from './dinero';
import { MEDIOS, type MedioPago, type MovimientoCaja, type MovimientoFiado, type Pesos, type Turno, type Venta } from './tipos';

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
  /** Plata que salió de la caja por devoluciones en efectivo (también de ventas de otros turnos). */
  devoluciones: Pesos;
  /** Lo devuelto de las ventas de este turno, por cualquier medio. */
  devuelto: Pesos;
  efectivoEsperado: Pesos;
}

function porMedioVacio(): Record<MedioPago, Pesos> {
  return { efectivo: 0, mercadopago: 0, tarjeta: 0, transferencia: 0, fiado: 0 };
}

/**
 * La única regla para saber cuánta plata debería haber en la caja.
 * Efectivo esperado = fondo + ventas en efectivo + fiado cobrado en efectivo
 * + ingresos - retiros - gastos - devoluciones en efectivo. Las ventas
 * anuladas no cuentan; las vendidas se cuentan como se cobraron y lo devuelto
 * va aparte.
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
  let devuelto = 0;
  for (const v of ventas) {
    if (v.anulada) continue;
    cantidadVentas++;
    totalVendido += v.total;
    devuelto += totalDevuelto(v);
    for (const p of pagosDeVenta(v)) porMedio[p.medio] += p.monto;
  }
  for (const p of pagosFiado) {
    if (p.anulado || p.tipo !== 'pago' || !p.medio) continue;
    cobrosFiado[p.medio] += p.monto;
  }
  let retiros = 0;
  let gastos = 0;
  let ingresos = 0;
  let devoluciones = 0;
  for (const m of movimientos) {
    if (m.tipo === 'retiro') retiros += m.monto;
    else if (m.tipo === 'gasto') gastos += m.monto;
    else if (m.tipo === 'devolucion') devoluciones += m.monto;
    else ingresos += m.monto;
  }
  const efectivoEsperado = fondoInicial + porMedio.efectivo + cobrosFiado.efectivo + ingresos - retiros - gastos - devoluciones;
  return { cantidadVentas, totalVendido, porMedio, cobrosFiado, retiros, gastos, ingresos, devoluciones, devuelto, efectivoEsperado };
}

/** El cierre en texto, para mandarlo por WhatsApp o copiarlo. */
export function textoCierre(turno: Turno, r: ResumenTurno, contado: Pesos | null): string {
  const f = (ms: number) => new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fiadoCobrado = Object.values(r.cobrosFiado).reduce((a, b) => a + b, 0);
  const lineas = [
    `Cierre de caja · ${f(turno.apertura)} a ${turno.cierre ? f(turno.cierre) : 'ahora'} · ${turno.cajero}`,
    `Vendido: ${formatPesos(r.totalVendido)} (${r.cantidadVentas} ${r.cantidadVentas === 1 ? 'venta' : 'ventas'})`,
    ...MEDIOS.filter((m) => r.porMedio[m.id] > 0).map((m) => `• ${m.nombre}: ${formatPesos(r.porMedio[m.id])}`),
  ];
  if (fiadoCobrado > 0) lineas.push(`Fiado cobrado: ${formatPesos(fiadoCobrado)}`);
  if (r.devuelto > 0) lineas.push(`Devoluciones: ${formatPesos(r.devuelto)}`);
  if (r.gastos > 0) lineas.push(`Gastos: ${formatPesos(r.gastos)}`);
  if (r.retiros > 0) lineas.push(`Retiros: ${formatPesos(r.retiros)}`);
  if (r.ingresos > 0) lineas.push(`Ingresos: ${formatPesos(r.ingresos)}`);
  lineas.push(`Efectivo que debía haber: ${formatPesos(r.efectivoEsperado)}`);
  if (contado !== null) {
    const dif = contado - r.efectivoEsperado;
    lineas.push(`Contado: ${formatPesos(contado)} · ${dif === 0 ? 'dio justo' : dif < 0 ? `faltaron ${formatPesos(-dif)}` : `sobraron ${formatPesos(dif)}`}`);
  }
  return lineas.join('\n');
}

/** Gasto del local (luz, alquiler...). La mercadería no: ya está en el costo de lo vendido. */
export function esGastoDelLocal(m: MovimientoCaja): boolean {
  return m.tipo === 'gasto' && !(m.mercaderia ?? m.motivo.startsWith('Mercadería'));
}
