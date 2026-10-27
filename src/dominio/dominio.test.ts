import { describe, expect, it } from 'vitest';
import { DENOMINACIONES, resumirTurno, totalConteo } from './caja';
import {
  agregarItem,
  calcularVuelto,
  cambiarCantidad,
  quitarItem,
  carritoVacio,
  esCodigo,
  interpretarEntrada,
  itemMontoLibre,
  pagosSugeridos,
  totalCarrito,
} from './carrito';
import { exportarCsv, importarCsv } from './csv';
import { formatPesos, parsePesos } from './dinero';
import { deudaDesde, saldoCliente, superaLimite } from './fiado';
import { aplicarAumento, margen } from './precios';
import { paraReponer, resumirVentas, sinMovimiento } from './reportes';
import type { ItemVenta, MovimientoFiado, Producto, Venta } from './tipos';

const item = (productoId: number, precio: number, cantidad = 1): ItemVenta => ({
  productoId,
  codigo: String(productoId),
  nombre: `P${productoId}`,
  precioUnitario: precio,
  costoUnitario: 0,
  cantidad,
});

describe('dinero', () => {
  it('formatea en pesos argentinos', () => {
    expect(formatPesos(1400)).toBe('$ 1.400');
    expect(formatPesos(0)).toBe('$ 0');
    expect(formatPesos(-500)).toBe('-$ 500');
    expect(formatPesos(1234567)).toBe('$ 1.234.567');
  });
  it('lee importes escritos de muchas formas', () => {
    expect(parsePesos('1400')).toBe(1400);
    expect(parsePesos('1.400')).toBe(1400);
    expect(parsePesos('$ 1.400')).toBe(1400);
    expect(parsePesos('1.400,50')).toBe(1401);
    expect(parsePesos('1400,4')).toBe(1400);
    expect(parsePesos('1400.5')).toBe(1401);
    expect(parsePesos('1.234.567')).toBe(1234567);
    expect(parsePesos('')).toBeNull();
    expect(parsePesos('abc')).toBeNull();
    expect(parsePesos('1,2,3')).toBeNull();
    expect(parsePesos('-200')).toBe(-200);
  });
});

describe('carrito', () => {
  it('interpreta el multiplicador', () => {
    expect(interpretarEntrada('3*7790895000997')).toEqual({ cantidad: 3, busqueda: '7790895000997' });
    expect(interpretarEntrada('2x coca')).toEqual({ cantidad: 2, busqueda: 'coca' });
    expect(interpretarEntrada('7790895000997')).toEqual({ cantidad: 1, busqueda: '7790895000997' });
    expect(interpretarEntrada('0*123')).toEqual({ cantidad: 1, busqueda: '0*123' });
    expect(esCodigo('7790895000997')).toBe(true);
    expect(esCodigo('coca')).toBe(false);
  });
  it('junta el mismo producto y lo sube arriba', () => {
    let c = agregarItem(carritoVacio, item(1, 100));
    c = agregarItem(c, item(2, 50));
    c = agregarItem(c, item(1, 100, 2));
    expect(c.items.map((i) => [i.productoId, i.cantidad])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(totalCarrito(c)).toBe(350);
  });
  it('el último agregado queda primero (Supr y "-" en la caja corrigen items[0])', () => {
    let c = agregarItem(carritoVacio, item(1, 100));
    c = agregarItem(c, item(2, 50));
    expect(c.items[0]!.productoId).toBe(2);
    c = agregarItem(c, item(3, 70, 2));
    expect(c.items[0]!.productoId).toBe(3);
    expect(quitarItem(c, 0).items.map((i) => i.productoId)).toEqual([2, 1]);
    expect(cambiarCantidad(c, 0, 1).items[0]!.cantidad).toBe(1);
  });
  it('los montos libres no se juntan', () => {
    let c = agregarItem(carritoVacio, itemMontoLibre(500, ''));
    c = agregarItem(c, itemMontoLibre(500, 'Fotocopia'));
    expect(c.items).toHaveLength(2);
    expect(c.items[1]!.nombre).toBe('Varios');
  });
  it('cantidad 0 saca el renglón', () => {
    const c = agregarItem(carritoVacio, item(1, 100));
    expect(cambiarCantidad(c, 0, 0).items).toHaveLength(0);
  });
  it('vuelto y billetes sugeridos', () => {
    expect(calcularVuelto(6150, 10000)).toBe(3850);
    expect(calcularVuelto(6150, 5000)).toBeNull();
    expect(pagosSugeridos(6150)).toEqual([6150, 7000, 8000, 10000]);
    expect(pagosSugeridos(1000)).toEqual([1000, 2000, 5000, 10000]);
    expect(pagosSugeridos(0)).toEqual([]);
  });
});

describe('caja', () => {
  it('cuenta billetes', () => {
    expect(totalConteo({ '20000': 3, '10000': 5, '100': 6, monedas: 30 })).toBe(110630);
    expect(DENOMINACIONES[0]).toBe(20000);
  });
  it('calcula el efectivo esperado sin contar anuladas', () => {
    const venta = (total: number, medio: Venta['medio'], anulada = false): Venta => ({
      fecha: 0, turnoId: 1, cajero: '', items: [], total, medio, pagaCon: null, vuelto: 0, clienteId: null, anulada,
    });
    const pago: MovimientoFiado = {
      clienteId: 1, fecha: 0, tipo: 'pago', monto: 1000, ventaId: null, turnoId: 1, medio: 'efectivo', nota: '', anulado: false,
    };
    const r = resumirTurno(
      20000,
      [venta(5000, 'efectivo'), venta(3000, 'mercadopago'), venta(9999, 'efectivo', true), venta(700, 'fiado')],
      [
        { turnoId: 1, fecha: 0, tipo: 'retiro', monto: 2000, motivo: '' },
        { turnoId: 1, fecha: 0, tipo: 'gasto', monto: 500, motivo: '' },
        { turnoId: 1, fecha: 0, tipo: 'ingreso', monto: 100, motivo: '' },
      ],
      [pago],
    );
    expect(r.cantidadVentas).toBe(3);
    expect(r.totalVendido).toBe(8700);
    expect(r.porMedio.fiado).toBe(700);
    expect(r.efectivoEsperado).toBe(20000 + 5000 + 1000 + 100 - 2000 - 500);
  });
});

describe('precios', () => {
  it('aumenta y redondea hacia arriba', () => {
    expect(aplicarAumento(1400, 10, 10)).toBe(1540);
    expect(aplicarAumento(1437, 0, 10)).toBe(1440);
    expect(aplicarAumento(1000, 15, 100)).toBe(1200);
    expect(aplicarAumento(1000, 15, 1)).toBe(1150);
    expect(aplicarAumento(1000, -10, 50)).toBe(900);
    expect(aplicarAumento(1200, 20, 10)).toBe(1440);
  });
  it('margen', () => {
    expect(margen(1000, 700)).toBe(30);
    expect(margen(1000, 0)).toBeNull();
  });
});

describe('fiado', () => {
  const mov = (tipo: 'compra' | 'pago', monto: number, fecha: number, anulado = false): MovimientoFiado => ({
    clienteId: 1, fecha, tipo, monto, ventaId: null, turnoId: null, medio: null, nota: '', anulado,
  });
  it('saldo y desde cuándo debe', () => {
    const m = [mov('compra', 1000, 1), mov('compra', 500, 2), mov('pago', 1200, 3), mov('compra', 9999, 4, true)];
    expect(saldoCliente(m)).toBe(300);
    expect(deudaDesde(m)).toBe(2);
    expect(deudaDesde([mov('compra', 100, 1), mov('pago', 100, 2)])).toBeNull();
  });
  it('límite', () => {
    expect(superaLimite(4000, 2000, 5000)).toBe(true);
    expect(superaLimite(4000, 1000, 5000)).toBe(false);
    expect(superaLimite(99999, 1000, 0)).toBe(false);
  });
});

describe('reportes', () => {
  it('resume ventas y ganancia', () => {
    const v: Venta = {
      fecha: new Date(2026, 9, 26, 18, 30).getTime(), turnoId: 1, cajero: '', total: 2500, medio: 'efectivo',
      pagaCon: null, vuelto: 0, clienteId: null, anulada: false,
      items: [
        { ...item(1, 1000, 2), costoUnitario: 700 },
        { ...item(2, 500), costoUnitario: 0 },
      ],
    };
    const r = resumirVentas([v, { ...v, anulada: true }]);
    expect(r.cantidad).toBe(1);
    expect(r.ganancia).toBe(600);
    expect(r.ventasSinCosto).toBe(500);
    expect(r.porHora[18]).toBe(2500);
    expect(r.productos[0]).toMatchObject({ nombre: 'P1', unidades: 2, total: 2000 });
  });
  it('reposición y sin movimiento', () => {
    const p = (id: number, stock: number, stockMinimo: number): Producto => ({
      id, codigo: '', nombre: `P${id}`, precio: 1, costo: 0, stock, stockMinimo, categoria: '', rapido: false, creado: 0, actualizado: 0,
    });
    const productos = [p(1, 2, 5), p(2, 10, 5), p(3, 0, 3), p(4, 4, 0)];
    expect(paraReponer(productos).map((x) => x.id)).toEqual([3, 1]);
    const venta = { anulada: false, items: [item(2, 1)] } as unknown as Venta;
    expect(sinMovimiento(productos, [venta]).map((x) => x.id)).toEqual([1, 4]);
  });
});

describe('planillas', () => {
  it('lee CSV de Excel con punto y coma y precios argentinos', () => {
    const texto = '﻿Código;Descripción;Precio venta;Costo;Stock;Rubro\r\n7790895000997;Coca-Cola 500 ml;"1.400";900;24;Bebidas\r\n;Alfajor "simple";650;;;\r\n123;Sin precio;abc;;;\r\n';
    const r = importarCsv(texto);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toEqual({ codigo: '7790895000997', nombre: 'Coca-Cola 500 ml', precio: 1400, costo: 900, stock: 24, categoria: 'Bebidas' });
    expect(r.filas[1]!.nombre).toBe('Alfajor "simple"');
    expect(r.errores).toHaveLength(1);
  });
  it('lee CSV con comas', () => {
    const r = importarCsv('nombre,precio\nChicles,500\n');
    expect(r.filas[0]).toMatchObject({ nombre: 'Chicles', precio: 500, codigo: '' });
  });
  it('pide nombre y precio', () => {
    expect(importarCsv('a;b\n1;2').errores[0]).toMatch(/nombre/);
  });
  it('lo exportado se vuelve a leer igual', () => {
    const filas = [{ codigo: '1', nombre: 'Uno; con "comillas"', precio: 10, costo: 5, stock: 3, categoria: 'X' }];
    expect(importarCsv(exportarCsv(filas)).filas).toEqual(filas);
  });
});
