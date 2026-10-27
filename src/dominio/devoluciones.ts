import { pagosDeVenta, stockQueUsa, subtotal } from './carrito';
import { formatPesos } from './dinero';
import { nombreMedio, type ItemVenta, type Pago, type Pesos, type Venta } from './tipos';

/** "$ 1.900 efectivo + $ 2.000 fiado": cómo se pagó, en una línea. */
export function describirPagos(pagos: Pago[]): string {
  return pagos.map((p) => `${formatPesos(p.monto)} ${p.medio === 'fiado' ? 'fiado' : nombreMedio(p.medio).toLowerCase()}`).join(' + ');
}

/** "2 Coca-Cola 500 ml, Queso de máquina (250 g)": los renglones en una línea. */
export function describirItems(items: Pick<ItemVenta, 'nombre' | 'cantidad' | 'gramos'>[]): string {
  return items.map((i) => (i.gramos ? i.nombre : `${i.cantidad} ${i.nombre}`)).join(', ');
}

/** Un renglón de la venta y cuántas unidades vuelven. */
export interface RenglonDevuelto {
  indice: number;
  cantidad: number;
}

/** Cuántas unidades del renglón ya volvieron en devoluciones anteriores. */
export function cantidadDevuelta(venta: Pick<Venta, 'devoluciones'>, indice: number): number {
  let n = 0;
  for (const d of venta.devoluciones ?? []) for (const r of d.items) if (r.indice === indice) n += r.cantidad;
  return n;
}

/** Los renglones con lo que quedó después de las devoluciones; los que volvieron enteros no están. */
export function itemsNetos(venta: Pick<Venta, 'items' | 'devoluciones'>): ItemVenta[] {
  if (!venta.devoluciones?.length) return venta.items;
  return venta.items.map((it, i) => ({ ...it, cantidad: it.cantidad - cantidadDevuelta(venta, i) })).filter((it) => it.cantidad > 0);
}

export function totalDevuelto(venta: Pick<Venta, 'devoluciones'>): Pesos {
  return (venta.devoluciones ?? []).reduce((s, d) => s + d.monto, 0);
}

/** Lo que quedó cobrado de la venta después de las devoluciones. */
export function totalNeto(venta: Pick<Venta, 'total' | 'devoluciones'>): Pesos {
  return venta.total - totalDevuelto(venta);
}

/**
 * Cuánto se devuelve por estos renglones: lo cobrado por lo que había menos lo
 * que se cobraría por lo que queda. Con una promo "3 x $1.700", devolver 1 de
 * 3 devuelve $400, porque las otras 2 pasan a precio suelto.
 */
export function montoDevolucion(venta: Pick<Venta, 'items' | 'devoluciones' | 'total' | 'descuento'>, renglones: RenglonDevuelto[]): Pesos {
  const lista = venta.items.reduce((s, it) => s + subtotal(it), 0);
  if (lista <= 0) return 0;
  // Lo que se cobra por un estado de la venta: la suma de lista, en la proporción en que se cobró de verdad
  // (con descuento, una Coca de lista $1.400 vendida con 10 % menos vale $1.260). Se calcula lo cobrado antes y
  // después de esta devolución y se devuelve la diferencia: así varias devoluciones parciales suman exacto lo cobrado.
  const cobradoPor = (cantidades: number[]) =>
    Math.round((venta.items.reduce((s, it, i) => s + (cantidades[i]! > 0 ? subtotal({ ...it, cantidad: cantidades[i]! }) : 0), 0) * venta.total) / lista);
  const antes = venta.items.map((it, i) => it.cantidad - cantidadDevuelta(venta, i));
  const despues = [...antes];
  for (const r of renglones) if (venta.items[r.indice] && r.cantidad > 0) despues[r.indice] = Math.max(0, despues[r.indice]! - r.cantidad);
  const monto = cobradoPor(antes) - cobradoPor(despues);
  return Math.max(0, Math.min(monto, totalNeto(venta)));
}

/** "2 Coca-Cola 500 ml, Queso de máquina" (lo que va por peso vuelve entero). */
export function detalleDevolucion(venta: Pick<Venta, 'items'>, renglones: RenglonDevuelto[]): string {
  return describirItems(renglones.filter((r) => r.cantidad > 0 && venta.items[r.indice]).map((r) => ({ ...venta.items[r.indice]!, cantidad: r.cantidad })));
}

/**
 * Cuánto de la venta sigue anotado en la cuenta del cliente: lo que se fió
 * menos lo que ya se le descontó por devoluciones. Sólo hasta ahí se puede
 * devolver "descontando de su cuenta".
 */
export function fiadoDisponible(venta: Pick<Venta, 'medio' | 'total' | 'pagos' | 'devoluciones' | 'clienteId'>): Pesos {
  if (venta.clienteId === null) return 0;
  const fiado = pagosDeVenta(venta).filter((p) => p.medio === 'fiado').reduce((s, p) => s + p.monto, 0);
  const descontado = (venta.devoluciones ?? []).filter((d) => d.medio === 'fiado').reduce((s, d) => s + d.monto, 0);
  return Math.max(0, fiado - descontado);
}

/** Stock que vuelve a cada producto (unidades, o kilos si es por peso). */
export function stockQueVuelve(venta: Pick<Venta, 'items'>, renglones: RenglonDevuelto[]): { productoId: number; cantidad: number }[] {
  const salida: { productoId: number; cantidad: number }[] = [];
  for (const r of renglones) {
    const it = venta.items[r.indice];
    if (!it || it.productoId === null || r.cantidad <= 0) continue;
    salida.push({ productoId: it.productoId, cantidad: stockQueUsa({ ...it, cantidad: r.cantidad }) });
  }
  return salida;
}
