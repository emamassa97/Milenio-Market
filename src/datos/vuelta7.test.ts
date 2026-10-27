import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemDeProducto } from '../dominio/carrito';
import { codigoAlFinal } from '../dominio/entrada';
import { htmlTicket } from '../ui/ticket';
import { BaseKiosco } from './db';
import { abrirTurno, devolverProductos, guardarProducto, registrarVenta, type DatosProducto } from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`vuelta7-${n++}`);
  await db.open();
  await abrirTurno(db, 'Ema', 0);
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '', nombre: 'Chicles', precio: 500, costo: 300, stock: 20, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});

describe('jurado 7', () => {
  it('un código leído en el campo de stock no se guarda como stock', async () => {
    await expect(guardarProducto(db, prod({ stock: 1000000000011 }))).rejects.toThrow(/stock es demasiado grande/);
    await expect(guardarProducto(db, prod({ stockMinimo: 7790895000997 }))).rejects.toThrow(/stock es demasiado grande/);
    expect(await guardarProducto(db, prod({ stock: 99_999 }))).toBeGreaterThan(0);
  });

  it('separa el código que el lector pegó al final de un nombre', () => {
    expect(codigoAlFinal('Alfajor Jorgito1000000000011')).toEqual({ texto: 'Alfajor Jorgito', codigo: '1000000000011' });
    expect(codigoAlFinal('7790001234567')).toEqual({ texto: '', codigo: '7790001234567' });
    expect(codigoAlFinal('Cerveza lata 473 ml')).toBeNull();
    expect(codigoAlFinal('Pilas AA x 4')).toBeNull();
  });

  it('el ticket después de una devolución muestra lo cobrado, lo que volvió y el total que quedó', async () => {
    const coca = (await db.productos.get(await guardarProducto(db, prod({ nombre: 'Coca-Cola 500 ml', precio: 1400 }))))!;
    const alfajor = (await db.productos.get(await guardarProducto(db, prod({ nombre: 'Alfajor simple', precio: 600 }))))!;
    const v = await registrarVenta(db, { items: [itemDeProducto(coca, 1), itemDeProducto(alfajor, 2)], medio: 'efectivo', pagaCon: null, clienteId: null });
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    const html = htmlTicket((await db.ventas.get(v.id!))!, { ancho: 58, encabezado: 'Milenio', pie: '', auto: false });
    // El renglón devuelto sigue impreso arriba (el subtotal sale de lo que se ve) y aparece abajo como devuelto.
    expect(html.match(/Coca-Cola 500 ml/g)).toHaveLength(2);
    expect(html).toContain('Devuelto<div class="sub">1 Coca-Cola 500 ml</div>');
    expect(html).toMatch(/TOTAL<\/td><td class="der">\$\s?1\.200/);
  });
});
