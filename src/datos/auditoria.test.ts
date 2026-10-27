import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemDeProducto } from '../dominio/carrito';
import { exportarCsv, importarCsv } from '../dominio/csv';
import { parsePesos } from '../dominio/dinero';
import { aplicarAumento } from '../dominio/precios';
import { BaseKiosco } from './db';
import { borrarTodo, cargarEjemplo } from './ejemplo';
import {
  abrirTurno, cerrarTurno, cargarPlanilla, guardarProducto, leerAjuste,
  registrarVenta,
} from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => { db = new BaseKiosco(`aud-${n++}`); await db.open(); });
afterEach(async () => { await db.delete(); });

describe('auditoría de datos', () => {
  it('A1 cargar el ejemplo dos veces a la vez no duplica', async () => {
    await Promise.all([cargarEjemplo(db), cargarEjemplo(db)]);
    expect(await db.productos.count()).toBe(23);
  });

  it('A2 el modo prueba se apaga al cerrar la primera caja', async () => {
    await cargarEjemplo(db);
    await abrirTurno(db, 'Ana', 1000);
    const p = (await db.productos.toArray())[0]!;
    await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'efectivo', pagaCon: null, clienteId: null });
    expect(await leerAjuste(db, 'modoPrueba', false)).toBe(true);
    await cerrarTurno(db, { monedas: -500 }, '');
    expect(await leerAjuste(db, 'modoPrueba', false)).toBe(false);
    expect((await db.turnos.toArray())[0]!.contado).toBe(0);
  });

  it('A3 export CSV then re-import duplicates products without code (and their stock)', async () => {
    await guardarProducto(db, { codigo: '', nombre: 'Pan casero', precio: 500, costo: 0, stock: 7, stockMinimo: 0, categoria: '', rapido: false });
    const filas = (await db.productos.toArray()).map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, costo: p.costo, stock: p.stock, categoria: p.categoria }));
    await cargarPlanilla(db, importarCsv(exportarCsv(filas)).filas);
    expect(await db.productos.count()).toBe(1);
  });

  it('A4 Excel scientific-notation codes collapse different products into one', async () => {
    const csv = 'codigo;nombre;precio\n7,79E+12;Coca 500;1400\n7,79E+12;Fernet 750;9000\n';
    const r = importarCsv(csv);
    expect(r.filas).toHaveLength(0);
    expect(r.errores[0]).toMatch(/Texto/);
    await cargarPlanilla(db, r.filas);
    expect(await db.productos.count()).toBe(0);
  });

  it('A5 CSV stock with thousands separator "1.200" becomes 1', () => {
    const r = importarCsv('nombre;precio;stock\nCaramelos;100;1.200\n');
    expect(r.filas[0]!.stock).toBe(1200);
  });

  it('A6 CSV negative cost bypasses validation', async () => {
    const r = importarCsv('nombre;precio;costo\nX;100;-50\n');
    expect(r.filas).toHaveLength(0);
    await expect(cargarPlanilla(db, [{ codigo: '', nombre: 'X', precio: 100, costo: -50, stock: 0, categoria: '' }])).rejects.toThrow();
  });

  it('A7 editing a product writes back the stock snapshot taken when the form opened', async () => {
    const id = await guardarProducto(db, { codigo: '123456', nombre: 'Alfajor', precio: 600, costo: 0, stock: 10, stockMinimo: 0, categoria: '', rapido: false });
    const abierto = (await db.productos.get(id))!; // form opens
    await abrirTurno(db, 'Ana', 0);
    await registrarVenta(db, { items: [itemDeProducto(abierto, 3)], medio: 'efectivo', pagaCon: null, clienteId: null }); // other tab sells
    const { id: _i, creado: _c, actualizado: _a, ...datos } = abierto;
    await guardarProducto(db, { ...datos, precio: 700 }, id, abierto.stock); // only price changed
    expect((await db.productos.get(id))!.stock).toBe(7);
  });

  it('A9 sale accepts absurd quantity (barcode typed into qty field)', async () => {
    await abrirTurno(db, 'Ana', 0);
    const id = await guardarProducto(db, { codigo: '', nombre: 'X', precio: 1000, costo: 0, stock: 5, stockMinimo: 0, categoria: '', rapido: false });
    await expect(registrarVenta(db, { items: [itemDeProducto((await db.productos.get(id))!, 7790895000997)], medio: 'efectivo', pagaCon: null, clienteId: null })).rejects.toThrow();
  });

  it('A10 a "rebaja" with rounding 100 leaves price unchanged while cost drops', async () => {
    expect(aplicarAumento(1000, -5, 100)).toBeLessThan(1000);
  });

  it('A11 parsePesos odd inputs', () => {
    expect(parsePesos('1.000.50')).toBeNull();
    expect(parsePesos('1.000')).toBe(1000);
  });

  it('A12 borrarTodo also wipes sales/fiado with no backup check', async () => {
    await cargarEjemplo(db);
    await abrirTurno(db, 'Ana', 0);
    const p = (await db.productos.toArray())[0]!;
    await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'efectivo', pagaCon: null, clienteId: null });
    await cerrarTurno(db, {}, '');
    await expect(borrarTodo(db)).rejects.toThrow(/cajas cerradas/);
    expect(await db.ventas.count()).toBeGreaterThan(0);
  });
});
