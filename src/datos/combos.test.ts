import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemDeProducto } from '../dominio/carrito';
import { alcanzaPara, conStockDeCombos, costoDeComponentes, describirComponentes } from '../dominio/combos';
import { BaseKiosco } from './db';
import { abrirTurno, anularVenta, devolverProductos, guardarProducto, registrarVenta, type DatosProducto } from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`combos-${n++}`);
  await db.open();
  await abrirTurno(db, 'Ema', 1000);
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '', nombre: 'Producto', precio: 1000, costo: 600, stock: 20, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});

async function armar() {
  const fernet = await guardarProducto(db, prod({ nombre: 'Fernet 750', precio: 12000, costo: 9000, stock: 10 }));
  const coca = await guardarProducto(db, prod({ nombre: 'Coca 1,5 L', precio: 3000, costo: 2000, stock: 30 }));
  const combo = await guardarProducto(db, prod({ nombre: 'Combo Fernet', precio: 17000, costo: 13000, stock: 0, componentes: [{ productoId: fernet, cantidad: 1 }, { productoId: coca, cantidad: 2 }] }));
  return { fernet, coca, combo };
}

const vender = async (id: number, cantidad: number) =>
  registrarVenta(db, { items: [itemDeProducto((await db.productos.get(id))!, cantidad)], medio: 'efectivo', pagaCon: null, clienteId: null });

describe('combos', () => {
  it('vender un combo descuenta cada producto que lleva, no el combo', async () => {
    const { fernet, coca, combo } = await armar();
    const v = await vender(combo, 2);
    expect((await db.productos.get(fernet))!.stock).toBe(8);
    expect((await db.productos.get(coca))!.stock).toBe(26);
    expect((await db.productos.get(combo))!.stock).toBe(0);
    expect(v.items[0]!.componentes).toEqual([{ productoId: fernet, cantidad: 1 }, { productoId: coca, cantidad: 2 }]);
  });

  it('un combo y el producto suelto en la misma venta se suman', async () => {
    const { fernet, coca, combo } = await armar();
    const p = (id: number) => db.productos.get(id).then((x) => x!);
    await registrarVenta(db, { items: [itemDeProducto(await p(combo), 1), itemDeProducto(await p(coca), 1)], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect((await p(fernet)).stock).toBe(9);
    expect((await p(coca)).stock).toBe(27);
  });

  it('anular repone lo que llevaba el combo al venderse, aunque después se haya cambiado', async () => {
    const { fernet, coca, combo } = await armar();
    const v = await vender(combo, 1);
    const c = (await db.productos.get(combo))!;
    await guardarProducto(db, { ...c, componentes: [{ productoId: fernet, cantidad: 1 }] }, combo, c.stock);
    await anularVenta(db, v.id!);
    expect((await db.productos.get(fernet))!.stock).toBe(10);
    expect((await db.productos.get(coca))!.stock).toBe(30);
  });

  it('devolver un combo repone sus productos', async () => {
    const { fernet, coca, combo } = await armar();
    const v = await vender(combo, 3);
    await devolverProductos(db, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    expect((await db.productos.get(fernet))!.stock).toBe(8);
    expect((await db.productos.get(coca))!.stock).toBe(26);
  });

  it('cuántos combos alcanzan, costo y descripción', async () => {
    const { combo } = await armar();
    const todos = await db.productos.toArray();
    const porId = new Map(todos.map((p) => [p.id!, p]));
    const c = porId.get(combo)!;
    expect(alcanzaPara(c, porId)).toBe(10);
    expect(costoDeComponentes(c.componentes!, porId)).toBe(13000);
    expect(describirComponentes(c.componentes!, porId)).toBe('1 Fernet 750 + 2 Coca 1,5 L');
    expect(conStockDeCombos(todos).find((p) => p.id === combo)!.stock).toBe(10);
  });

  it('junta repetidos y rechaza combos que no tienen sentido', async () => {
    const { fernet, coca, combo } = await armar();
    const doble = await guardarProducto(db, prod({ nombre: 'Doble', componentes: [{ productoId: coca, cantidad: 1 }, { productoId: coca, cantidad: 1 }] }));
    expect((await db.productos.get(doble))!.componentes).toEqual([{ productoId: coca, cantidad: 2 }]);
    await expect(guardarProducto(db, prod({ nombre: 'Combo de combo', componentes: [{ productoId: combo, cantidad: 1 }] }))).rejects.toThrow('ya es un combo');
    await expect(guardarProducto(db, prod({ nombre: 'Cero', componentes: [{ productoId: fernet, cantidad: 0 }] }))).rejects.toThrow('de 1 a');
    await expect(guardarProducto(db, prod({ nombre: 'Fantasma', componentes: [{ productoId: 999, cantidad: 1 }] }))).rejects.toThrow('ya no existe');
    const f = (await db.productos.get(fernet))!;
    await expect(guardarProducto(db, { ...f, componentes: [{ productoId: coca, cantidad: 1 }] }, fernet, f.stock)).rejects.toThrow('va dentro del combo');
    const c = (await db.productos.get(combo))!;
    await expect(guardarProducto(db, { ...c, componentes: [{ productoId: combo, cantidad: 1 }] }, combo, c.stock)).rejects.toThrow('sí mismo');
  });

  it('sacarle todos los productos lo vuelve un producto común', async () => {
    const { fernet, combo } = await armar();
    const c = (await db.productos.get(combo))!;
    await guardarProducto(db, { ...c, componentes: [] }, combo, c.stock);
    expect((await db.productos.get(combo))!.componentes).toBeUndefined();
    await vender(combo, 1);
    expect((await db.productos.get(combo))!.stock).toBe(-1);
    expect((await db.productos.get(fernet))!.stock).toBe(10);
  });
});
