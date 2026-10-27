import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resumirTurno, textoCierre } from '../dominio/caja';
import { itemDeProducto, itemPorPeso } from '../dominio/carrito';
import { describirPagos, fiadoDisponible, itemsNetos, montoDevolucion, totalNeto } from '../dominio/devoluciones';
import { saldoCliente } from '../dominio/fiado';
import { precioParaMargen } from '../dominio/precios';
import { resumirVentas } from '../dominio/reportes';
import { BaseKiosco } from './db';
import {
  abrirTurno,
  anularPagoFiado,
  anularVenta,
  cerrarTurno,
  devolverProductos,
  fondoSugerido,
  guardarCliente,
  guardarProducto,
  ingresarMercaderia,
  registrarCancelacion,
  registrarPagoFiado,
  registrarVenta,
  resumenDeTurno,
  turnoAbierto,
  type DatosProducto,
} from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`etapa4-${n++}`);
  await db.open();
  await abrirTurno(db, 'Ema', 1000);
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '', nombre: 'Alfajor', precio: 1000, costo: 600, stock: 20, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});

describe('devoluciones', () => {
  it('devuelve el stock, saca la plata de la caja y deja la venta con lo que quedó', async () => {
    const id = await guardarProducto(db, prod());
    const item = itemDeProducto((await db.productos.get(id))!, 3);
    const v = await registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect((await db.productos.get(id))!.stock).toBe(17);

    const d = await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 2 }], 'efectivo', 'Estaba vencido', 'ema');
    expect(d.monto).toBe(2000);
    expect((await db.productos.get(id))!.stock).toBe(19);
    const guardada = (await db.ventas.get(v.id!))!;
    expect(guardada.total).toBe(3000);
    expect(totalNeto(guardada)).toBe(1000);
    expect(itemsNetos(guardada)).toEqual([{ ...item, cantidad: 1 }]);

    const { resumen, movimientos } = await resumenDeTurno(db, (await turnoAbierto(db))!);
    expect(movimientos.map((m) => m.tipo)).toEqual(['devolucion']);
    expect(movimientos[0]!.motivo).toBe('Devolución: 2 Alfajor');
    expect(resumen.devoluciones).toBe(2000);
    expect(resumen.devuelto).toBe(2000);
    expect(resumen.efectivoEsperado).toBe(1000 + 3000 - 2000);
    // En los reportes queda lo que de verdad se vendió.
    const r = resumirVentas([guardada]);
    expect(r.total).toBe(1000);
    expect(r.devuelto).toBe(2000);
    // Cómo pagaron se muestra bruto: lo devuelto va aparte (pudo volver por otro medio).
    expect(r.porMedio.efectivo).toBe(3000);
    expect(r.productos[0]!.unidades).toBe(1);
    expect(r.ganancia).toBe(400);
  });

  it('con promo, devolver una unidad cobra el resto a precio suelto', async () => {
    const id = await guardarProducto(db, prod({ promo: { cantidad: 3, precio: 2400 } }));
    const item = itemDeProducto((await db.productos.get(id))!, 3);
    const v = await registrarVenta(db, { items: [item], medio: 'mercadopago', pagaCon: null, clienteId: null });
    expect(v.total).toBe(2400);
    expect(montoDevolucion(v, [{ indice: 0, cantidad: 1 }])).toBe(400);
    const d = await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'mercadopago');
    expect(d.monto).toBe(400);
    // Por Mercado Pago no sale plata de la caja: sólo queda anotado.
    expect((await resumenDeTurno(db, (await turnoAbierto(db))!)).resumen.devoluciones).toBe(0);
    const r = resumirVentas([(await db.ventas.get(v.id!))!]);
    expect(r.total).toBe(2000);
    expect(r.porMedio.mercadopago).toBe(2400);
    expect(r.devuelto).toBe(400);
  });

  it('no deja devolver más de lo que queda ni anular una venta con devolución', async () => {
    const id = await guardarProducto(db, prod());
    const item = itemDeProducto((await db.productos.get(id))!, 2);
    const v = await registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: null, clienteId: null });
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    await expect(devolverProductos(db, v.id!, [{ indice: 0, cantidad: 2 }], 'efectivo')).rejects.toThrow('queda 1');
    await expect(anularVenta(db, v.id!)).rejects.toThrow('devolución');
    await expect(devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'fiado')).rejects.toThrow('no fue al fiado');
  });

  it('una venta fiada se devuelve a la cuenta del cliente', async () => {
    const id = await guardarProducto(db, prod());
    const clienteId = await guardarCliente(db, { nombre: 'Marta', telefono: '', limite: 0 });
    const item = itemDeProducto((await db.productos.get(id))!, 2);
    const v = await registrarVenta(db, { items: [item], medio: 'fiado', pagaCon: null, clienteId });
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'fiado');
    const movs = await db.movimientosFiado.where('clienteId').equals(clienteId).toArray();
    expect(saldoCliente(movs)).toBe(1000);
    // El descuento no es plata que entró: no cuenta como fiado cobrado.
    expect((await resumenDeTurno(db, (await turnoAbierto(db))!)).resumen.cobrosFiado.efectivo).toBe(0);
    // Y una devolución no se puede "anular" como si fuera un pago.
    const devolucion = movs.find((m) => m.tipo === 'pago' && m.medio === null)!;
    await expect(anularPagoFiado(db, devolucion.id!)).rejects.toThrow('devolución');
  });

  it('de la cuenta sólo se descuenta lo que se fió; lo pagado con otro medio vuelve por ese medio', async () => {
    const id = await guardarProducto(db, prod());
    const clienteId = await guardarCliente(db, { nombre: 'Marta', telefono: '', limite: 0 });
    const item = itemDeProducto((await db.productos.get(id))!, 5);
    const v = await registrarVenta(db, {
      items: [item], medio: 'mercadopago', pagaCon: null, clienteId, pagos: [{ medio: 'mercadopago', monto: 4000 }, { medio: 'fiado', monto: 1000 }],
    });
    expect(fiadoDisponible(v)).toBe(1000);
    await expect(devolverProductos(db, v.id!, [{ indice: 0, cantidad: 2 }], 'fiado')).rejects.toThrow('sólo quedan $ 1.000');
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'fiado');
    expect(saldoCliente(await db.movimientosFiado.toArray())).toBe(0);
    expect(fiadoDisponible((await db.ventas.get(v.id!))!)).toBe(0);
    await expect(devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'fiado')).rejects.toThrow('no queda nada');
    const pagada = await registrarVenta(db, { items: [itemDeProducto((await db.productos.get(id))!, 1)], medio: 'efectivo', pagaCon: null, clienteId: null });
    await expect(devolverProductos(db, pagada.id!, [{ indice: 0, cantidad: 1 }], 'fiado')).rejects.toThrow('no fue al fiado');
  });

  it('lo que va por peso vuelve entero, en kilos', async () => {
    const id = await guardarProducto(db, prod({ nombre: 'Queso', precio: 8000, costo: 5000, stock: 2, porPeso: true }));
    const item = itemPorPeso((await db.productos.get(id))!, 250);
    const v = await registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect((await db.productos.get(id))!.stock).toBe(1.75);
    const d = await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    expect(d.monto).toBe(2000);
    expect((await db.productos.get(id))!.stock).toBe(2);
  });
});

describe('pago dividido con fiado y vuelto', () => {
  it('anota al cliente sólo la parte fiada', async () => {
    const id = await guardarProducto(db, prod());
    const clienteId = await guardarCliente(db, { nombre: 'Juan', telefono: '', limite: 0 });
    const item = itemDeProducto((await db.productos.get(id))!, 5);
    const v = await registrarVenta(db, {
      items: [item],
      medio: 'efectivo',
      pagaCon: null,
      clienteId,
      pagos: [{ medio: 'efectivo', monto: 3000 }, { medio: 'fiado', monto: 2000 }],
    });
    expect(v.clienteId).toBe(clienteId);
    expect(saldoCliente(await db.movimientosFiado.toArray())).toBe(2000);
    const { resumen } = await resumenDeTurno(db, (await turnoAbierto(db))!);
    expect(resumen.porMedio.efectivo).toBe(3000);
    expect(resumen.porMedio.fiado).toBe(2000);
    expect(resumen.efectivoEsperado).toBe(1000 + 3000);
  });

  it('sin cliente no se puede fiar una parte', async () => {
    const id = await guardarProducto(db, prod());
    const item = itemDeProducto((await db.productos.get(id))!, 2);
    await expect(
      registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: null, clienteId: null, pagos: [{ medio: 'efectivo', monto: 1000 }, { medio: 'fiado', monto: 1000 }] }),
    ).rejects.toThrow('a quién');
  });

  it('el vuelto sale de la parte en efectivo', async () => {
    const id = await guardarProducto(db, prod());
    const item = itemDeProducto((await db.productos.get(id))!, 5);
    const v = await registrarVenta(db, {
      items: [item],
      medio: 'efectivo',
      pagaCon: 5000,
      clienteId: null,
      pagos: [{ medio: 'efectivo', monto: 3000 }, { medio: 'mercadopago', monto: 2000 }],
    });
    expect(v.pagaCon).toBe(5000);
    expect(v.vuelto).toBe(2000);
    await expect(
      registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: 2000, clienteId: null, pagos: [{ medio: 'efectivo', monto: 3000 }, { medio: 'mercadopago', monto: 2000 }] }),
    ).rejects.toThrow('no alcanza');
  });
});

describe('cuenta del cliente', () => {
  it('anular un pago vuelve a sumar la deuda', async () => {
    const id = await guardarProducto(db, prod());
    const clienteId = await guardarCliente(db, { nombre: 'Marta', telefono: '', limite: 0 });
    const item = itemDeProducto((await db.productos.get(id))!, 3);
    await registrarVenta(db, { items: [item], medio: 'fiado', pagaCon: null, clienteId });
    const pagoId = await registrarPagoFiado(db, clienteId, 1000, 'efectivo');
    expect(saldoCliente(await db.movimientosFiado.toArray())).toBe(2000);
    await anularPagoFiado(db, pagoId, 'ema');
    expect(saldoCliente(await db.movimientosFiado.toArray())).toBe(3000);
    expect((await db.movimientosFiado.get(pagoId))!.anuladoPor).toBe('ema');
    await expect(anularPagoFiado(db, pagoId)).rejects.toThrow('ya estaba');
    const compra = (await db.movimientosFiado.toArray()).find((m) => m.tipo === 'compra')!;
    await expect(anularPagoFiado(db, compra.id!)).rejects.toThrow('desde la venta');
  });
});

describe('caja', () => {
  it('sugiere como cambio lo que se contó en el último cierre', async () => {
    expect(await fondoSugerido(db)).toBeNull();
    await cerrarTurno(db, { '1000': 2, '500': 1 }, '');
    expect((await fondoSugerido(db))!.monto).toBe(2500);
  });

  it('una venta cancelada antes de cobrar queda anotada para el dueño', async () => {
    const id = await guardarProducto(db, prod());
    const item = itemDeProducto((await db.productos.get(id))!, 2);
    await registrarCancelacion(db, [item], 'juan');
    await registrarCancelacion(db, [], 'juan');
    const eventos = await db.eventos.toArray();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: 'cancelacion', monto: 2000, detalle: '2 Alfajor', usuario: 'juan' });
    expect(eventos[0]!.turnoId).toBe((await turnoAbierto(db))!.id);
    // El stock no se toca: nunca se cobró.
    expect((await db.productos.get(id))!.stock).toBe(20);
  });

  it('la devolución queda como evento del día, aunque la venta sea vieja', async () => {
    const id = await guardarProducto(db, prod());
    const v = await registrarVenta(db, { items: [itemDeProducto((await db.productos.get(id))!, 2)], medio: 'mercadopago', pagaCon: null, clienteId: null });
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'mercadopago', '', 'ema');
    const eventos = await db.eventos.toArray();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: 'devolucion', monto: 1000, detalle: '1 Alfajor', usuario: 'ema' });
    // Por Mercado Pago no sale plata de la caja.
    expect(await db.movimientosCaja.count()).toBe(0);
  });

  it('el resumen por WhatsApp explica el efectivo: cambio inicial y devoluciones', () => {
    const turno = { id: 1, apertura: Date.UTC(2026, 9, 27, 10), cierre: null, cajero: 'Ema', fondoInicial: 1000, conteo: null, contado: null, esperado: null, nota: '' };
    const r = resumirTurno(1000, [], [{ turnoId: 1, fecha: 1, tipo: 'devolucion', monto: 2000, motivo: '' }], []);
    const texto = textoCierre(turno, { ...r, totalVendido: 3000, vendidoNeto: 1000, devuelto: 2000, cantidadVentas: 1, porMedio: { ...r.porMedio, efectivo: 3000 } }, null);
    expect(texto).toContain('Cambio inicial: $ 1.000');
    expect(texto).toContain('Devoluciones en efectivo: $ 2.000');
    expect(texto).toContain('• Efectivo: $ 3.000 (cobrado, antes de devoluciones)');
    expect(texto).toContain('Efectivo que debía haber: -$ 1.000');
    expect(describirPagos([{ medio: 'efectivo', monto: 1900 }, { medio: 'fiado', monto: 2000 }])).toBe('$ 1.900 efectivo + $ 2.000 fiado');
  });

  it('el resumen del turno separa las devoluciones de los retiros', () => {
    const r = resumirTurno(500, [], [
      { turnoId: 1, fecha: 1, tipo: 'retiro', monto: 100, motivo: '' },
      { turnoId: 1, fecha: 1, tipo: 'devolucion', monto: 50, motivo: '' },
      { turnoId: 1, fecha: 1, tipo: 'ingreso', monto: 20, motivo: '' },
    ], []);
    expect(r.retiros).toBe(100);
    expect(r.devoluciones).toBe(50);
    expect(r.ingresos).toBe(20);
    expect(r.efectivoEsperado).toBe(370);
  });
});

describe('proveedor', () => {
  it('se guarda sin espacios de más y se recuerda al ingresar mercadería', async () => {
    const id = await guardarProducto(db, prod({ proveedor: '  Arcor   ' }));
    expect((await db.productos.get(id))!.proveedor).toBe('Arcor');
    const otro = await guardarProducto(db, prod({ nombre: 'Chicles', proveedor: ' ' }));
    await ingresarMercaderia(db, [{ productoId: otro, cantidad: 5, costo: 0 }], { proveedor: 'Mayorista Vital', pagadoDeCaja: false });
    expect((await db.productos.get(otro))!.proveedor).toBe('Mayorista Vital');
    // Al que ya tiene proveedor no se lo pisa.
    await ingresarMercaderia(db, [{ productoId: id, cantidad: 5, costo: 0 }], { proveedor: 'Otro', pagadoDeCaja: false });
    expect((await db.productos.get(id))!.proveedor).toBe('Arcor');
  });
});

describe('mercadería con precio nuevo', () => {
  it('mantiene el margen: con el costo nuevo sugiere un precio y lo guarda', async () => {
    expect(precioParaMargen(500, 38)).toBe(810);
    expect(precioParaMargen(0, 38)).toBe(0);
    expect(precioParaMargen(500, 100)).toBe(0);
    const id = await guardarProducto(db, prod({ precio: 1000, costo: 600, promo: { cantidad: 3, precio: 2700 } }));
    await ingresarMercaderia(db, [{ productoId: id, cantidad: 10, costo: 800, precio: 1340 }], { proveedor: '', pagadoDeCaja: false });
    const p = (await db.productos.get(id))!;
    expect(p.costo).toBe(800);
    expect(p.precio).toBe(1340);
    expect(p.stock).toBe(30);
    // La promo sube en la misma proporción que el precio (2.700 × 1,34 = 3.618 → $3.620), sin pasarse de comprar suelto.
    expect(p.promo).toEqual({ cantidad: 3, precio: 3620 });
    await expect(ingresarMercaderia(db, [{ productoId: id, cantidad: 1, costo: 800, precio: -5 }], { proveedor: '', pagadoDeCaja: false })).rejects.toThrow('precio nuevo');
  });
});

describe('devolver en efectivo (jurado 9)', () => {
  it('una venta con tarjeta no se devuelve en efectivo sin la clave del dueño', async () => {
    const id = await guardarProducto(db, { codigo: '', nombre: 'Fernet', precio: 15000, costo: 0, stock: 5, stockMinimo: 0, categoria: '', rapido: false });
    if (!(await turnoAbierto(db))) await abrirTurno(db, 'Juan', 10000);
    const p = (await db.productos.get(id))!;
    const antes = (await resumenDeTurno(db, (await turnoAbierto(db))!)).resumen.efectivoEsperado;
    const v = await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'tarjeta', pagaCon: null, clienteId: null });
    await expect(devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo')).rejects.toThrow(/no se cobró en efectivo/);
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'tarjeta');
    const v2 = await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'tarjeta', pagaCon: null, clienteId: null });
    await devolverProductos(db, v2.id!, [{ indice: 0, cantidad: 1 }], 'efectivo', '', 'ema', true);
    expect((await resumenDeTurno(db, (await turnoAbierto(db))!)).resumen.efectivoEsperado).toBe(antes - 15000);
  });
});
