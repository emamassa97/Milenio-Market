import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cobrosDeMedio, diferenciaConApp } from '../dominio/caja';
import { itemDeProducto, itemMontoLibre, repetirVenta } from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { mapaPorCodigo } from '../dominio/entrada';
import { diasDeDeuda, mensajeRecordatorio } from '../dominio/fiado';
import type { Producto, Venta } from '../dominio/tipos';
import { BaseKiosco } from './db';
import { buscarPorCodigo, guardarProducto, quitarCodigoAlt, sumarCodigo, type DatosProducto } from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`tanda2-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '7790895000997', nombre: 'Coca-Cola 500 ml', precio: 1400, costo: 900, stock: 10, stockMinimo: 3, categoria: 'Bebidas', rapido: true, ...extra,
});

describe('es un producto que ya tengo', () => {
  it('el código nuevo se suma como otro código y el lector lo encuentra', async () => {
    const id = await guardarProducto(db, prod());
    const p = await sumarCodigo(db, id, '7790895000010');
    expect(p.codigo).toBe('7790895000997');
    expect(p.codigosAlt).toEqual(['7790895000010']);
    expect((await buscarPorCodigo(db, '7790895000010'))?.id).toBe(id);
    expect((await buscarPorCodigo(db, '7790895000997'))?.id).toBe(id);
  });

  it('a un producto sin código, el leído le queda como principal', async () => {
    const id = await guardarProducto(db, prod({ codigo: '' }));
    const p = await sumarCodigo(db, id, '7790895000010');
    expect(p.codigo).toBe('7790895000010');
    expect(p.codigosAlt).toBeUndefined();
  });

  it('no deja usar un código de otro producto, ni como principal ni como otro', async () => {
    const coca = await guardarProducto(db, prod());
    const agua = await guardarProducto(db, prod({ codigo: '7790000000001', nombre: 'Agua' }));
    await sumarCodigo(db, coca, '7790895000010');
    await expect(sumarCodigo(db, agua, '7790895000997')).rejects.toThrow('ya es de "Coca-Cola 500 ml"');
    await expect(sumarCodigo(db, agua, '7790895000010')).rejects.toThrow('ya es de "Coca-Cola 500 ml"');
    await expect(guardarProducto(db, prod({ codigo: '7790895000010', nombre: 'Otra' }))).rejects.toThrow('ya es de');
  });

  it('editar el producto no le borra los otros códigos, y se pueden quitar', async () => {
    const id = await guardarProducto(db, prod());
    await sumarCodigo(db, id, '7790895000010');
    await guardarProducto(db, prod({ precio: 1500 }), id, 10);
    expect((await db.productos.get(id))?.codigosAlt).toEqual(['7790895000010']);
    await quitarCodigoAlt(db, id, '7790895000010');
    expect(await buscarPorCodigo(db, '7790895000010')).toBeUndefined();
  });

  it('el mapa de la caja encuentra por cualquiera de los códigos; el principal gana', () => {
    const a = { id: 1, codigo: '111', codigosAlt: ['222'] };
    const b = { id: 2, codigo: '222' };
    const m = mapaPorCodigo([a, b]);
    expect(m.get('111')).toBe(a);
    expect(m.get('222')).toBe(b);
  });
});

const producto = (id: number, extra: Partial<Producto> = {}): Producto => ({
  id, codigo: String(id), nombre: `P${id}`, precio: 100 * id, costo: 50, stock: 5, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0, ...extra,
});

describe('repetir lo de la última vez', () => {
  it('trae los productos con el precio de hoy y avisa lo que ya no está', () => {
    const viejo = producto(1, { precio: 80 });
    const venta = { items: [itemDeProducto(viejo, 2), itemDeProducto(producto(9), 1), { ...itemDeProducto(producto(3, { porPeso: true }), 1), gramos: 250 }] };
    const { items, faltan } = repetirVenta(venta, [producto(1), producto(3, { porPeso: true, precio: 4000 })]);
    expect(items[0]).toMatchObject({ productoId: 1, cantidad: 2, precioUnitario: 100 });
    expect(items[1]).toMatchObject({ productoId: 3, gramos: 250, precioUnitario: 1000 });
    expect(faltan).toEqual(['P9']);
  });
  it('repite un monto libre (una recarga) como monto libre, no dice que "ya no está cargado"', () => {
    const venta = { items: [itemMontoLibre(2000, 'Recarga SUBE'), itemDeProducto(producto(1), 1)] };
    const { items, faltan } = repetirVenta(venta, [producto(1)]);
    expect(faltan).toEqual([]);
    expect(items[0]).toMatchObject({ productoId: null, nombre: 'Recarga SUBE', precioUnitario: 2000, cantidad: 1 });
  });
});

describe('controlar Mercado Pago', () => {
  const venta = (id: number, extra: Partial<Venta>): Venta =>
    ({ id, fecha: id, turnoId: 1, cajero: '', items: [], total: 0, medio: 'efectivo', pagaCon: null, vuelto: 0, clienteId: null, anulada: false, ...extra }) as Venta;
  it('lista cada cobro de MP, también la parte de un pago dividido, y no las anuladas', () => {
    const ventas = [
      venta(3, { medio: 'mercadopago', total: 1000 }),
      venta(1, { medio: 'efectivo', total: 500, pagos: [{ medio: 'efectivo', monto: 200 }, { medio: 'mercadopago', monto: 300 }] }),
      venta(2, { medio: 'mercadopago', total: 900, anulada: true }),
      venta(4, { medio: 'efectivo', total: 700 }),
    ];
    expect(cobrosDeMedio(ventas, 'mercadopago')).toEqual([
      { ventaId: 1, fecha: 1, monto: 300, dividido: true },
      { ventaId: 3, fecha: 3, monto: 1000, dividido: false },
    ]);
  });
  it('dice si en la app hay más, menos o lo mismo', () => {
    expect(diferenciaConApp(1300, 1300).diferencia).toBe(0);
    expect(diferenciaConApp(1300, 1500).diferencia).toBe(200);
    expect(diferenciaConApp(1300, 1000).texto).toContain('menos');
  });
});

describe('avisar a los que deben', () => {
  it('cuenta los días y arma el mensaje con el primer nombre', () => {
    const ahora = Date.UTC(2026, 9, 28);
    expect(diasDeDeuda(ahora - 8 * 86_400_000, ahora)).toBe(8);
    expect(diasDeDeuda(null, ahora)).toBe(0);
    expect(mensajeRecordatorio('Marta (la del 3° B)', 4500, formatPesos)).toBe(
      `Hola Marta! Te escribo de Milenio Market. Te quedó un saldo de ${formatPesos(4500)}. Cuando puedas pasá. Gracias!`,
    );
  });
});
