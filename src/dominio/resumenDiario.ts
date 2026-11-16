import { esGastoDelLocal, type ResumenTurno } from './caja';
import type { CuentaProveedor } from './compras';
import { formatPesos } from './dinero';
import { paraReponer, resumirVentas } from './reportes';
import { MEDIOS, type Compra, type MedioPago, type MovimientoCaja, type PagoProveedor, type Pesos, type Producto, type Turno, type Venta } from './tipos';

// El resumen del día que le llega al dueño por WhatsApp al cerrar la caja (o a la noche, si nadie la cerró):
// lo vendido, la ganancia, cómo pagaron, cómo dio el cierre, lo más vendido, qué reponer, el fiado y los proveedores.
// Acá sólo hay cuentas y texto: no toca la base.

export interface DatosResumen {
  local: string;
  turno: Turno;
  /** El resumen de la caja (con lo que llegó tarde ya contado): `resumirTurno`. */
  caja: ResumenTurno;
  ventas: Venta[];
  movimientos: MovimientoCaja[];
  productos: Producto[];
  /** Clientes que deben (saldo > 0). */
  deudores: { nombre: string; saldo: Pesos }[];
  /** Cuentas de proveedores (`cuentasDeProveedores`). */
  proveedores: CuentaProveedor[];
  compras: Compra[];
  pagos: PagoProveedor[];
  /** Lo vendido la semana pasada en el mismo horario, para comparar (null: no hay con qué). */
  semanaPasada: Pesos | null;
  /** Nombres de los usuarios (usuario → nombre), para "cerró Matías". */
  nombres?: ReadonlyMap<string, string>;
  ahora?: number;
}

export interface MedioResumen {
  id: MedioPago;
  nombre: string;
  monto: Pesos;
  /** Del total cobrado, 0 a 100. */
  pct: number;
}

export interface ResumenDiario {
  local: string;
  turnoId: number;
  abierta: boolean;
  apertura: number;
  /** Cierre de la caja, o la hora del resumen si sigue abierta. */
  hasta: number;
  abrio: string;
  cerro: string | null;
  vendido: Pesos;
  ventas: number;
  promedio: Pesos;
  devuelto: Pesos;
  ganancia: Pesos;
  /** Lo vendido de productos sin costo cargado (la ganancia no lo cuenta). */
  sinCosto: Pesos;
  /** Ganancia sobre lo vendido con costo, 0 a 100 (null sin costos). */
  margen: number | null;
  comparacion: { antes: Pesos; pct: number; dia: string } | null;
  medios: MedioResumen[];
  fiadoCobrado: Pesos;
  efectivo: {
    fondo: Pesos;
    esperado: Pesos;
    contado: Pesos | null;
    /** contado - esperado (null sin contar o abierta). */
    diferencia: Pesos | null;
    gastosLocal: Pesos;
    mercaderia: Pesos;
    retiros: Pesos;
    ingresos: Pesos;
  };
  top: { nombre: string; cantidad: string; total: Pesos }[];
  reponer: { nombre: string; stock: number; minimo: number }[];
  fiado: { total: Pesos; deudores: number; mayores: { nombre: string; saldo: Pesos }[]; fiadoHoy: Pesos };
  proveedores: { deuda: Pesos; cuentas: { nombre: string; saldo: Pesos }[]; comprasHoy: Pesos; cantidadCompras: number; pagadoHoy: Pesos };
  /** Cosas para mirar, de la más importante a la menos. */
  alertas: string[];
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function cantidadTexto(unidades: number, kilos?: number): string {
  if (kilos !== undefined && kilos > 0) return `${kilos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg`;
  return `${unidades} u`;
}

export function armarResumen(d: DatosResumen): ResumenDiario {
  const ahora = d.ahora ?? Date.now();
  const t = d.turno;
  const abierta = t.cierre === null;
  const hasta = t.cierre ?? ahora;
  const v = resumirVentas(d.ventas);
  const nombre = (u: string | undefined, porDefecto: string) => (u ? (d.nombres?.get(u) ?? u) : porDefecto);

  const totalMedios = MEDIOS.reduce((s, m) => s + d.caja.porMedio[m.id], 0);
  const medios = MEDIOS.filter((m) => d.caja.porMedio[m.id] > 0)
    .map((m) => ({ id: m.id, nombre: m.nombre, monto: d.caja.porMedio[m.id], pct: totalMedios > 0 ? Math.round((d.caja.porMedio[m.id] * 100) / totalMedios) : 0 }))
    .sort((a, b) => b.monto - a.monto);

  let gastosLocal = 0;
  let mercaderia = 0;
  for (const m of d.movimientos) {
    if (m.tipo !== 'gasto') continue;
    if (esGastoDelLocal(m)) gastosLocal += m.monto;
    else mercaderia += m.monto;
  }
  const contado = abierta ? null : t.contado;
  const esperado = !abierta && t.esperado !== null ? t.esperado : d.caja.efectivoEsperado;
  const diferencia = contado === null ? null : contado - esperado;

  const conCosto = v.total - v.ventasSinCosto;
  const margen = conCosto > 0 && v.ganancia !== 0 ? Math.round((v.ganancia * 100) / conCosto) : null;
  const comparacion =
    d.semanaPasada !== null && d.semanaPasada > 0
      ? { antes: d.semanaPasada, pct: Math.round(((d.caja.vendidoNeto - d.semanaPasada) * 100) / d.semanaPasada), dia: DIAS[new Date(t.apertura).getDay()]! }
      : null;

  const deudores = [...d.deudores].filter((x) => x.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const debeA = d.proveedores.filter((c) => c.saldo > 0);
  const enLaCaja = (ms: number) => ms >= t.apertura && ms <= hasta;
  const comprasHoy = d.compras.filter((c) => !c.anulada && enLaCaja(c.creada));
  const pagadoHoy = d.pagos.filter((p) => !p.anulado && enLaCaja(p.fecha)).reduce((s, p) => s + p.monto, 0);
  const reponer = paraReponer(d.productos).map((p) => ({ nombre: p.nombre, stock: p.stock, minimo: p.stockMinimo }));

  const alertas: string[] = [];
  if (diferencia !== null && diferencia < 0) alertas.push(`Faltaron ${formatPesos(-diferencia)} en la caja`);
  if (diferencia !== null && diferencia > 0) alertas.push(`Sobraron ${formatPesos(diferencia)} en la caja`);
  if (!abierta && contado === null) alertas.push('Se cerró sin contar la plata');
  if (abierta) alertas.push('La caja todavía no se cerró');
  const sinStock = reponer.filter((p) => p.stock <= 0).length;
  if (sinStock > 0) alertas.push(`${sinStock} ${sinStock === 1 ? 'producto se quedó' : 'productos se quedaron'} sin stock`);
  if (v.ventasSinCosto > 0 && v.total > 0 && v.ventasSinCosto / v.total > 0.2) alertas.push(`${formatPesos(v.ventasSinCosto)} vendidos sin costo cargado: la ganancia queda corta`);

  return {
    local: d.local,
    turnoId: t.id ?? 0,
    abierta,
    apertura: t.apertura,
    hasta,
    abrio: nombre(t.usuario, t.cajero),
    cerro: abierta ? null : nombre(t.usuarioCierre, t.cajero),
    vendido: d.caja.vendidoNeto,
    ventas: d.caja.cantidadVentas,
    promedio: d.caja.cantidadVentas > 0 ? Math.round(d.caja.vendidoNeto / d.caja.cantidadVentas) : 0,
    devuelto: d.caja.devuelto,
    ganancia: v.ganancia,
    sinCosto: v.ventasSinCosto,
    margen,
    comparacion,
    medios,
    fiadoCobrado: Object.values(d.caja.cobrosFiado).reduce((a, b) => a + b, 0),
    efectivo: { fondo: t.fondoInicial, esperado, contado, diferencia, gastosLocal, mercaderia, retiros: d.caja.retiros, ingresos: d.caja.ingresos },
    top: v.productos.slice(0, 5).map((p) => ({ nombre: p.nombre, cantidad: cantidadTexto(p.unidades, p.kilos), total: p.total })),
    reponer,
    fiado: { total: deudores.reduce((s, x) => s + x.saldo, 0), deudores: deudores.length, mayores: deudores.slice(0, 3), fiadoHoy: d.caja.porMedio.fiado },
    proveedores: {
      deuda: debeA.reduce((s, c) => s + c.saldo, 0),
      cuentas: debeA.slice(0, 3).map((c) => ({ nombre: c.nombre, saldo: c.saldo })),
      comprasHoy: comprasHoy.reduce((s, c) => s + c.total, 0),
      cantidadCompras: comprasHoy.length,
      pagadoHoy,
    },
    alertas,
  };
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "lunes 16/11" */
export function diaDelResumen(ms: number): string {
  const f = new Date(ms);
  return `${DIAS[f.getDay()]} ${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}`;
}

/** Cómo dio el cierre, en pocas palabras. */
export function estadoCierre(r: ResumenDiario): { texto: string; tono: 'justo' | 'falta' | 'sobra' | 'sin-contar' | 'abierta' } {
  if (r.abierta) return { texto: 'Caja abierta', tono: 'abierta' };
  const dif = r.efectivo.diferencia;
  if (dif === null) return { texto: 'Cerrada sin contar', tono: 'sin-contar' };
  if (dif === 0) return { texto: 'Dio justo', tono: 'justo' };
  return dif < 0 ? { texto: `Faltaron ${formatPesos(-dif)}`, tono: 'falta' } : { texto: `Sobraron ${formatPesos(dif)}`, tono: 'sobra' };
}

const MAX_REPONER = 8;

/**
 * El resumen para WhatsApp (con *negritas* de WhatsApp). `ciego`: lo manda un empleado desde su equipo, sin
 * ganancia, sin lo que debía haber en la caja y sin cuentas de proveedores (eso lo ve el dueño en el Panel).
 */
export function textoResumen(r: ResumenDiario, { ciego = false }: { ciego?: boolean } = {}): string {
  const l: string[] = [];
  l.push(`*${r.local} · Resumen del ${diaDelResumen(r.apertura)}*`);
  l.push(
    r.abierta
      ? `Caja abierta desde las ${hhmm(r.apertura)} (abrió ${r.abrio}) · todavía no se cerró, esto es hasta las ${hhmm(r.hasta)}`
      : `Caja de ${hhmm(r.apertura)} a ${hhmm(r.hasta)} · abrió ${r.abrio}${r.cerro && r.cerro !== r.abrio ? `, cerró ${r.cerro}` : ''}`,
  );
  l.push('');
  l.push(`💰 *Vendido: ${formatPesos(r.vendido)}* (${r.ventas} ${r.ventas === 1 ? 'venta' : 'ventas'}${r.ventas > 0 ? `, promedio ${formatPesos(r.promedio)}` : ''})`);
  if (r.devuelto > 0) l.push(`↩️ Ya descontados ${formatPesos(r.devuelto)} devueltos`);
  if (!ciego) {
    if (r.ganancia !== 0 || r.sinCosto === 0) l.push(`📈 Ganancia estimada: ${formatPesos(r.ganancia)}${r.margen !== null ? ` (${r.margen}% sobre lo vendido)` : ''}`);
    if (r.sinCosto > 0) l.push(`   ${formatPesos(r.sinCosto)} se vendieron sin costo cargado`);
    if (r.comparacion) {
      const { pct, dia, antes } = r.comparacion;
      l.push(`${pct >= 0 ? '🔼' : '🔽'} ${pct > 0 ? '+' : ''}${pct}% contra el ${dia} pasado (${formatPesos(antes)})`);
    }
  }
  if (r.medios.length > 0) {
    l.push('');
    l.push('*Cómo pagaron*');
    for (const m of r.medios) l.push(`• ${m.nombre}: ${formatPesos(m.monto)} (${m.pct}%)`);
    if (r.fiadoCobrado > 0) l.push(`• Fiado cobrado: ${formatPesos(r.fiadoCobrado)}`);
  }
  l.push('');
  l.push('*Caja*');
  const e = r.efectivo;
  if (ciego) {
    l.push(r.abierta ? 'Todavía abierta' : e.contado === null ? 'Se cerró sin contar' : `Contado: ${formatPesos(e.contado)} (la diferencia la ves en el Panel)`);
  } else {
    const estado = estadoCierre(r);
    const icono = { justo: '✅', falta: '🔴', sobra: '🟡', 'sin-contar': '⚪', abierta: '🕒' }[estado.tono];
    l.push(`${icono} ${estado.texto}`);
    l.push(`Debía haber ${formatPesos(e.esperado)}${e.contado !== null ? ` · contado ${formatPesos(e.contado)}` : ''}`);
  }
  const salidas = [
    e.gastosLocal > 0 && `gastos ${formatPesos(e.gastosLocal)}`,
    e.mercaderia > 0 && `mercadería ${formatPesos(e.mercaderia)}`,
    e.retiros > 0 && `retiros ${formatPesos(e.retiros)}`,
    e.ingresos > 0 && `ingresos ${formatPesos(e.ingresos)}`,
  ].filter(Boolean);
  if (salidas.length > 0) l.push(`Movimientos: ${salidas.join(' · ')}`);

  if (r.top.length > 0) {
    l.push('');
    l.push('*Lo más vendido*');
    r.top.forEach((p, i) => l.push(`${i + 1}. ${p.nombre} · ${p.cantidad} · ${formatPesos(p.total)}`));
  }
  l.push('');
  if (r.reponer.length === 0) l.push('📦 Stock al día: nada por debajo del mínimo');
  else {
    l.push(`📦 *Para reponer (${r.reponer.length})*`);
    for (const p of r.reponer.slice(0, MAX_REPONER)) l.push(`• ${p.nombre}: ${p.stock <= 0 ? 'sin stock' : `quedan ${p.stock}`} (mínimo ${p.minimo})`);
    if (r.reponer.length > MAX_REPONER) l.push(`  y ${r.reponer.length - MAX_REPONER} más`);
  }
  if (!ciego) {
    l.push('');
    if (r.fiado.deudores === 0) l.push('📒 Fiado: nadie debe');
    else {
      l.push(`📒 *Fiado sin cobrar: ${formatPesos(r.fiado.total)}* (${r.fiado.deudores} ${r.fiado.deudores === 1 ? 'cliente' : 'clientes'})`);
      if (r.fiado.fiadoHoy > 0) l.push(`Hoy se fiaron ${formatPesos(r.fiado.fiadoHoy)}`);
      for (const c of r.fiado.mayores) l.push(`• ${c.nombre}: ${formatPesos(c.saldo)}`);
    }
    const p = r.proveedores;
    if (p.deuda > 0 || p.comprasHoy > 0 || p.pagadoHoy > 0) {
      l.push('');
      l.push('🚚 *Proveedores*');
      if (p.comprasHoy > 0) l.push(`Compras de hoy: ${formatPesos(p.comprasHoy)} (${p.cantidadCompras} ${p.cantidadCompras === 1 ? 'factura' : 'facturas'})`);
      if (p.pagadoHoy > 0) l.push(`Pagado hoy: ${formatPesos(p.pagadoHoy)}`);
      if (p.deuda > 0) {
        l.push(`Les debés ${formatPesos(p.deuda)}`);
        for (const c of p.cuentas) l.push(`• ${c.nombre}: ${formatPesos(c.saldo)}`);
      }
    }
  }
  return l.join('\n');
}

/** La fecha de hoy en Argentina 'AAAA-MM-DD' (el servidor corre en UTC). */
export function diaArgentina(ms: number): string {
  return new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
}
