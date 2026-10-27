import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemDeProducto, itemPorPeso, subtotal } from '../dominio/carrito';
import { resumirVentas } from '../dominio/reportes';
import { BaseKiosco } from './db';
import { abrirTurno, anularVenta, guardarProducto, registrarVenta, resumenDeTurno, turnoAbierto, type DatosProducto } from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`etapa2-${n++}`);
  await db.open();
  await abrirTurno(db, 'Ema', 0);
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '', nombre: 'Alfajor', precio: 1000, costo: 600, stock: 20, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});

describe('promos por cantidad', () => {
  it('cobra los grupos completos a precio de promo y el resto suelto', async () => {
    const id = await guardarProducto(db, prod({ promo: { cantidad: 2, precio: 1500 } }));
    const it3 = itemDeProducto((await db.productos.get(id))!, 3);
    expect(subtotal(it3)).toBe(2500);
    const v = await registrarVenta(db, { items: [it3], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect(v.total).toBe(2500);
    expect(resumirVentas([v]).ganancia).toBe(2500 - 1800);
  });
});

describe('venta por peso', () => {
  it('cobra los gramos y descuenta kilos del stock, y anular los devuelve', async () => {
    const id = await guardarProducto(db, prod({ nombre: 'Queso', precio: 8000, costo: 5000, stock: 2.5, porPeso: true }));
    const item = itemPorPeso((await db.productos.get(id))!, 350);
    expect(item.precioUnitario).toBe(2800);
    const v = await registrarVenta(db, { items: [item], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect((await db.productos.get(id))!.stock).toBe(2.15);
    await anularVenta(db, v.id!);
    expect((await db.productos.get(id))!.stock).toBe(2.5);
  });
});

describe('pago dividido', () => {
  it('reparte la venta en los medios y el cierre cuenta sólo el efectivo', async () => {
    const id = await guardarProducto(db, prod());
    const items = [itemDeProducto((await db.productos.get(id))!, 5)];
    const v = await registrarVenta(db, {
      items, medio: 'efectivo', pagaCon: null, clienteId: null,
      pagos: [{ medio: 'efectivo', monto: 2000 }, { medio: 'mercadopago', monto: 3000 }],
    });
    expect(v.pagos).toHaveLength(2);
    const r = await resumenDeTurno(db, (await turnoAbierto(db))!);
    expect(r.resumen.porMedio.efectivo).toBe(2000);
    expect(r.resumen.porMedio.mercadopago).toBe(3000);
  });

  it('rechaza pagos que no suman el total o que incluyen fiado', async () => {
    const id = await guardarProducto(db, prod());
    const items = [itemDeProducto((await db.productos.get(id))!, 1)];
    await expect(registrarVenta(db, { items, medio: 'efectivo', pagaCon: null, clienteId: null,
      pagos: [{ medio: 'efectivo', monto: 500 }, { medio: 'tarjeta', monto: 400 }] })).rejects.toThrow(/suman/);
    await expect(registrarVenta(db, { items, medio: 'efectivo', pagaCon: null, clienteId: null,
      pagos: [{ medio: 'efectivo', monto: 500 }, { medio: 'fiado', monto: 500 }] })).rejects.toThrow(/fiado/);
  });
});

describe('ingreso de mercadería', () => {
  it('suma stock, actualiza el costo y anota el gasto en la caja', async () => {
    const { ingresarMercaderia } = await import('./operaciones');
    const id = await guardarProducto(db, prod({ stock: 2, costo: 600 }));
    const total = await ingresarMercaderia(db, [{ productoId: id, cantidad: 24, costo: 650 }], { proveedor: 'Arcor', pagadoDeCaja: true });
    expect(total).toBe(24 * 650);
    const p = (await db.productos.get(id))!;
    expect(p.stock).toBe(26);
    expect(p.costo).toBe(650);
    const movs = await db.movimientosCaja.toArray();
    expect(movs[0]).toMatchObject({ tipo: 'gasto', monto: 15600, motivo: 'Mercadería: Arcor' });
  });
});

describe('arreglos del jurado técnico', () => {
  it('rechaza promos sin descuento o inválidas', async () => {
    await expect(guardarProducto(db, prod({ promo: { cantidad: 2, precio: 3000 } }))).rejects.toThrow(/promo/);
    await expect(guardarProducto(db, prod({ promo: { cantidad: 2.5, precio: -100 } }))).rejects.toThrow(/promo/);
  });

  it('mercadería con decimales: misma cantidad para stock y plata', async () => {
    const { ingresarMercaderia } = await import('./operaciones');
    const id = await guardarProducto(db, prod({ stock: 0, costo: 1000 }));
    const total = await ingresarMercaderia(db, [{ productoId: id, cantidad: 1.9, costo: 1000 }], { proveedor: '', pagadoDeCaja: false });
    expect(total).toBe(1000);
    expect((await db.productos.get(id))!.stock).toBe(1);
  });

  it('sumar kilos a un producto por peso respeta los decimales', async () => {
    const { ajustarStock } = await import('./operaciones');
    const id = await guardarProducto(db, prod({ porPeso: true, stock: 0.4 }));
    await ajustarStock(db, id, 1.5);
    expect((await db.productos.get(id))!.stock).toBe(1.9);
  });

  it('el ticket escapa textos y valida el ancho', async () => {
    const { htmlTicket } = await import('../ui/ticket');
    const v = await registrarVenta(db, {
      items: [{ productoId: null, codigo: '', nombre: '<img src=x onerror=alert(1)>', precioUnitario: 100, costoUnitario: 0, cantidad: 1 }],
      medio: 'efectivo', pagaCon: null, clienteId: null,
    });
    const html = htmlTicket(v, { ancho: 58, encabezado: '<b>x</b>', pie: '"pie"', auto: false });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x');
  });
});
