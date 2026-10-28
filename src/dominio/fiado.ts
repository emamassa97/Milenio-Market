import type { MovimientoFiado, Pesos } from './tipos';

/** Lo que debe un cliente: compras menos pagos, sin contar lo anulado. */
export function saldoCliente(movimientos: MovimientoFiado[]): Pesos {
  let saldo = 0;
  for (const m of movimientos) {
    if (m.anulado) continue;
    saldo += m.tipo === 'compra' ? m.monto : -m.monto;
  }
  return saldo;
}

/** Fecha de la compra más vieja que todavía no se terminó de pagar. */
export function deudaDesde(movimientos: MovimientoFiado[]): number | null {
  const ordenados = movimientos.filter((m) => !m.anulado).sort((a, b) => a.fecha - b.fecha);
  let pagado = ordenados.filter((m) => m.tipo === 'pago').reduce((s, m) => s + m.monto, 0);
  for (const m of ordenados) {
    if (m.tipo !== 'compra') continue;
    if (pagado >= m.monto) {
      pagado -= m.monto;
      continue;
    }
    return m.fecha;
  }
  return null;
}

/** true si la compra pasa el límite (0 = sin límite). */
export function superaLimite(saldoActual: Pesos, compra: Pesos, limite: Pesos): boolean {
  return limite > 0 && saldoActual + compra > limite;
}

/** Días que hace que debe; para avisar se toma a los que deben hace más de una semana. */
export const DIAS_PARA_AVISAR = 7;

export function diasDeDeuda(desde: number | null, ahora = Date.now()): number {
  return desde === null ? 0 : Math.floor((ahora - desde) / 86_400_000);
}

/** "Marta (la del 3° B)" → "Marta" para el saludo. */
export function nombreParaSaludo(nombre: string): string {
  return nombre.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(' ')[0] ?? nombre;
}

/** El mensaje de WhatsApp para recordarle el saldo. */
export function mensajeRecordatorio(nombre: string, saldo: Pesos, formato: (p: Pesos) => string): string {
  return `Hola ${nombreParaSaludo(nombre)}! Te escribo de Milenio Market. Te quedó un saldo de ${formato(saldo)}. Cuando puedas pasá. Gracias!`;
}
