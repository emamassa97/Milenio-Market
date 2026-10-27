import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemDeProducto, itemMontoLibre } from '../dominio/carrito';
import { BaseKiosco } from './db';
import { estaVacia, exportarTodo, restaurarCopia } from './copia';
import {
  abrirTurno,
  ajustarStock,
  anularVenta,
  aumentoMasivo,
  cargarPlanilla,
  cerrarTurno,
  controlarLimite,
  guardarCliente,
  guardarProducto,
  registrarMovimientoCaja,
  registrarPagoFiado,
  registrarVenta,
  resumenDeTurno,
  saldoDe,
  turnoAbierto,
  type DatosProducto,
} from './operaciones';

let db: BaseKiosco;
let n = 0;

beforeEach(async () => {
  db = new BaseKiosco(`prueba-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '7790895000997', nombre: 'Coca-Cola 500 ml', precio: 1400, costo: 900, stock: 10, stockMinimo: 3,
  categoria: 'Bebidas', rapido: true, ...extra,
});

describe('turnos y ventas', () => {
  it('no deja vender sin caja abierta', async () => {
    await expect(registrarVenta(db, { items: [itemMontoLibre(100, '')], medio: 'efectivo', pagaCon: null, clienteId: null }))
      .rejects.toThrow(/abrí la caja/);
  });

  it('una venta descuenta stock y anularla lo devuelve', async () => {
    await abrirTurno(db, 'Emanuel', 20000);
    const id = await guardarProducto(db, prod());
    const p = (await db.productos.get(id))!;
    const venta = await registrarVenta(db, {
      items: [itemDeProducto(p, 3), itemMontoLibre(500, 'Varios')], medio: 'efectivo', pagaCon: 5000, clienteId: null,
    });
    expect(venta.total).toBe(4700);
    expect(venta.vuelto).toBe(300);
    expect((await db.productos.get(id))!.stock).toBe(7);
    await anularVenta(db, venta.id!);
    expect((await db.productos.get(id))!.stock).toBe(10);
    await expect(anularVenta(db, venta.id!)).rejects.toThrow(/ya estaba anulada/);
  });

  it('el stock puede quedar negativo pero la venta se hace', async () => {
    await abrirTurno(db, 'E', 0);
    const id = await guardarProducto(db, prod({ stock: 1 }));
    await registrarVenta(db, { items: [itemDeProducto((await db.productos.get(id))!, 2)], medio: 'tarjeta', pagaCon: null, clienteId: null });
    expect((await db.productos.get(id))!.stock).toBe(-1);
  });

  it('rechaza pagar con menos del total', async () => {
    await abrirTurno(db, 'E', 0);
    await expect(registrarVenta(db, { items: [itemMontoLibre(1000, '')], medio: 'efectivo', pagaCon: 500, clienteId: null }))
      .rejects.toThrow(/no alcanza/);
    expect(await db.ventas.count()).toBe(0);
  });

  it('no abre dos cajas a la vez', async () => {
    await abrirTurno(db, 'E', 0);
    await expect(abrirTurno(db, 'E', 0)).rejects.toThrow(/Ya hay/);
  });

  it('cierre de caja con fiado, retiros y pagos', async () => {
    await abrirTurno(db, 'Emanuel', 20000);
    const cli = await guardarCliente(db, { nombre: 'Juan', telefono: '', limite: 0 });
    await registrarVenta(db, { items: [itemMontoLibre(5000, '')], medio: 'efectivo', pagaCon: null, clienteId: null });
    await registrarVenta(db, { items: [itemMontoLibre(3000, '')], medio: 'mercadopago', pagaCon: null, clienteId: null });
    await registrarVenta(db, { items: [itemMontoLibre(2000, '')], medio: 'fiado', pagaCon: null, clienteId: cli });
    await registrarPagoFiado(db, cli, 500, 'efectivo');
    await registrarMovimientoCaja(db, 'retiro', 1000, 'Proveedor');
    const turno = (await turnoAbierto(db))!;
    const { resumen } = await resumenDeTurno(db, turno);
    expect(resumen.totalVendido).toBe(10000);
    expect(resumen.efectivoEsperado).toBe(20000 + 5000 + 500 - 1000);
    expect(await saldoDe(db, cli)).toBe(1500);
    const cerrado = await cerrarTurno(db, { '20000': 1, '2000': 2 }, ' falta algo ');
    expect(cerrado.contado).toBe(24000);
    expect(cerrado.esperado).toBe(24500);
    expect(cerrado.nota).toBe('falta algo');
    expect(await turnoAbierto(db)).toBeUndefined();
  });

  it('anular una venta al fiado saca la deuda', async () => {
    await abrirTurno(db, 'E', 0);
    const cli = await guardarCliente(db, { nombre: 'Ana', telefono: '', limite: 1000 });
    const v = await registrarVenta(db, { items: [itemMontoLibre(800, '')], medio: 'fiado', pagaCon: null, clienteId: cli });
    expect(await controlarLimite(db, cli, 300)).toMatch(/límite/);
    await anularVenta(db, v.id!);
    expect(await saldoDe(db, cli)).toBe(0);
  });

  it('fiado sin cliente no se guarda', async () => {
    await abrirTurno(db, 'E', 0);
    await expect(registrarVenta(db, { items: [itemMontoLibre(800, '')], medio: 'fiado', pagaCon: null, clienteId: null }))
      .rejects.toThrow(/a quién/);
  });

  it('no se anula una venta de una caja ya cerrada', async () => {
    await abrirTurno(db, 'E', 0);
    const v = await registrarVenta(db, { items: [itemMontoLibre(800, '')], medio: 'efectivo', pagaCon: null, clienteId: null });
    await cerrarTurno(db, {}, '');
    await abrirTurno(db, 'E', 0);
    await expect(anularVenta(db, v.id!)).rejects.toThrow(/caja abierta/);
  });
});

describe('productos', () => {
  it('no repite códigos', async () => {
    await guardarProducto(db, prod());
    await expect(guardarProducto(db, prod({ nombre: 'Otro' }))).rejects.toThrow(/ya es de/);
    await guardarProducto(db, prod({ codigo: '', nombre: 'Sin código 1' }));
    await guardarProducto(db, prod({ codigo: '', nombre: 'Sin código 2' }));
    expect(await db.productos.count()).toBe(3);
  });

  it('editar no borra campos que esta versión no conoce', async () => {
    const id = await guardarProducto(db, prod());
    await db.productos.update(id, { campoFuturo: 'x' } as never);
    await guardarProducto(db, prod({ precio: 1500 }), id);
    const p = (await db.productos.get(id)) as unknown as Record<string, unknown>;
    expect(p.precio).toBe(1500);
    expect(p.campoFuturo).toBe('x');
  });

  it('aumento masivo sólo a los elegidos', async () => {
    const a = await guardarProducto(db, prod());
    const b = await guardarProducto(db, prod({ codigo: '1', precio: 1000 }));
    const cambiados = await aumentoMasivo(db, [a], 10, 10, true);
    expect(cambiados).toBe(1);
    expect((await db.productos.get(a))!.precio).toBe(1540);
    expect((await db.productos.get(a))!.costo).toBe(990);
    expect((await db.productos.get(b))!.precio).toBe(1000);
  });

  it('la planilla actualiza precios sin pisar el stock', async () => {
    const id = await guardarProducto(db, prod({ stock: 7 }));
    const r = await cargarPlanilla(db, [
      { codigo: '7790895000997', nombre: 'Coca 500', precio: 1600, costo: 0, stock: 99, categoria: '' },
      { codigo: '', nombre: 'Nuevo', precio: 100, costo: 0, stock: 5, categoria: '' },
    ]);
    expect(r).toEqual({ nuevos: 1, actualizados: 1 });
    const p = (await db.productos.get(id))!;
    expect([p.precio, p.stock, p.costo, p.categoria]).toEqual([1600, 7, 900, 'Bebidas']);
  });

  it('ajusta stock', async () => {
    const id = await guardarProducto(db, prod({ stock: 2 }));
    await ajustarStock(db, id, 24);
    expect((await db.productos.get(id))!.stock).toBe(26);
  });
});

describe('copia de seguridad', () => {
  it('se restaura en un equipo vacío y no en uno con datos', async () => {
    await abrirTurno(db, 'E', 100);
    await guardarProducto(db, prod());
    const copia = JSON.parse(JSON.stringify(await exportarTodo(db)));
    await expect(restaurarCopia(db, copia)).rejects.toThrow(/ya tiene datos/);
    const otra = new BaseKiosco(`prueba-${n++}`);
    await otra.open();
    expect(await estaVacia(otra)).toBe(true);
    await restaurarCopia(otra, copia);
    expect(await otra.productos.count()).toBe(1);
    expect((await turnoAbierto(otra))?.fondoInicial).toBe(100);
    await otra.delete();
  });
  it('rechaza archivos que no son copias', async () => {
    await expect(restaurarCopia(db, { hola: 1 })).rejects.toThrow(/no es una copia/);
  });
});

describe('quién hizo qué', () => {
  it('guarda el usuario al abrir, cobrar, mover plata, anular y cerrar', async () => {
    const id = await guardarProducto(db, prod());
    const p = (await db.productos.get(id))!;
    const turnoId = await abrirTurno(db, 'Ema', 1000, 'ema');
    const venta = await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'efectivo', pagaCon: null, clienteId: null }, 'ana');
    const movId = await registrarMovimientoCaja(db, 'retiro', 500, 'banco', 'ema');
    await anularVenta(db, venta.id!, 'ema');
    await cerrarTurno(db, { '1000': 1 }, '', 'ana');
    expect(await db.turnos.get(turnoId)).toMatchObject({ usuario: 'ema', usuarioCierre: 'ana' });
    expect(await db.ventas.get(venta.id!)).toMatchObject({ usuario: 'ana', anulada: true, anuladaPor: 'ema' });
    expect(await db.movimientosCaja.get(movId)).toMatchObject({ usuario: 'ema' });
  });

  it('sin usuario funciona igual que antes y no agrega campos', async () => {
    const id = await guardarProducto(db, prod());
    const p = (await db.productos.get(id))!;
    const turnoId = await abrirTurno(db, 'Ema', 0);
    const venta = await registrarVenta(db, { items: [itemDeProducto(p, 1)], medio: 'efectivo', pagaCon: null, clienteId: null });
    const movId = await registrarMovimientoCaja(db, 'gasto', 100, 'hielo');
    await anularVenta(db, venta.id!);
    await cerrarTurno(db, {}, '');
    const turno = (await db.turnos.get(turnoId))!;
    const guardada = (await db.ventas.get(venta.id!))!;
    expect('usuario' in turno || 'usuarioCierre' in turno).toBe(false);
    expect('usuario' in guardada || 'anuladaPor' in guardada).toBe(false);
    expect('usuario' in (await db.movimientosCaja.get(movId))!).toBe(false);
  });
});
