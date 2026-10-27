import { describe, expect, it } from 'vitest';
import { DENOMINACIONES, resumirTurno, totalConteo } from './caja';
import {
  agregarItem,
  aplicarDescuento,
  calcularVuelto,
  cambiarCantidad,
  quitarItem,
  sumaCarrito,
  carritoVacio,
  esCodigo,
  interpretarEntrada,
  itemMontoLibre,
  pagosSugeridos,
  totalCarrito,
} from './carrito';
import { exportarCsv, importarCsv } from './csv';
import { formatPesos, parsePesos, textoTecleado } from './dinero';
import { deudaDesde, saldoCliente, superaLimite } from './fiado';
import { aplicarAumento, margen } from './precios';
import { masDevueltos, paraReponer, resumirVentas, sinMovimiento } from './reportes';
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
    expect(interpretarEntrada('3*7790895000997')).toEqual({ cantidad: 3, busqueda: '7790895000997', consulta: false });
    expect(interpretarEntrada('2x coca')).toEqual({ cantidad: 2, busqueda: 'coca', consulta: false });
    expect(interpretarEntrada('7790895000997')).toEqual({ cantidad: 1, busqueda: '7790895000997', consulta: false });
    expect(interpretarEntrada('0*123')).toEqual({ cantidad: 1, busqueda: '0*123', consulta: false });
    // "?" adelante pregunta el precio sin cargar el producto.
    expect(interpretarEntrada('? coca')).toEqual({ cantidad: 1, busqueda: 'coca', consulta: true });
    expect(interpretarEntrada('?7790895000997')).toEqual({ cantidad: 1, busqueda: '7790895000997', consulta: true });
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
    // Siempre están el de $10.000 y el de $20.000: son los billetes que más vuelto generan.
    // 10.150 y 10.450 son el "vuelto redondo": se devuelven billetes grandes.
    expect(pagosSugeridos(6150)).toEqual([6150, 7000, 8000, 10000, 10150, 20000]);
    expect(pagosSugeridos(1000)).toEqual([1000, 2000, 10000, 20000]);
    expect(pagosSugeridos(3450)).toEqual([3450, 4000, 10000, 10450, 20000]);
    expect(pagosSugeridos(12300)).toEqual([12300, 13000, 14000, 20000, 20300]);
    expect(pagosSugeridos(0)).toEqual([]);
  });

  it('el descuento baja el total, se saca si ya no entra y nunca deja la venta en cero', () => {
    let c = agregarItem(agregarItem(carritoVacio, item(1, 2000)), item(2, 1150));
    c = aplicarDescuento(c, 150);
    expect(sumaCarrito(c)).toBe(3150);
    expect(totalCarrito(c)).toBe(3000);
    expect(aplicarDescuento(c, 3150).descuento).toBeUndefined();
    expect(aplicarDescuento(c, 0).descuento).toBeUndefined();
    // Queda sólo el renglón de 1.150 (el último agregado va primero): el descuento de 150 entra; con 1.200 no.
    expect(totalCarrito(quitarItem(c, 1))).toBe(1000);
    expect(quitarItem(aplicarDescuento(c, 1200), 1).descuento).toBeUndefined();
  });

  it('un campo de plata acepta cinco cifras aunque ya haya puesto el punto de miles', () => {
    // Lo que hace CampoPesos tecla por tecla: "1500" se muestra "1.500" y el "0" siguiente tiene que dar 15.000.
    let texto = '';
    for (const tecla of '150000') {
      const crudo = texto + tecla;
      const v = parsePesos(textoTecleado(crudo));
      texto = v !== null && !crudo.includes(',') && !/\.\d{0,2}$/.test(crudo) ? formatPesos(v).replace('$ ', '') : crudo;
    }
    expect(texto).toBe('150.000');
    expect(parsePesos(textoTecleado('1.0005'))).toBe(10005);
    expect(parsePesos(textoTecleado('12.345.678'))).toBe(12345678);
    expect(textoTecleado('1.400,50')).toBe('1.400,50');
    expect(textoTecleado('1400.5')).toBe('1400.5');
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
  it('lo que más se devolvió, con el motivo más repetido', () => {
    const base: Venta = {
      fecha: 0, turnoId: 1, cajero: '', total: 3000, medio: 'efectivo', pagaCon: null, vuelto: 0, clienteId: null, anulada: false,
      items: [item(1, 1000, 2), item(2, 500, 2)],
    };
    const v1: Venta = { ...base, devoluciones: [{ fecha: 1, turnoId: 1, items: [{ indice: 0, cantidad: 1 }, { indice: 1, cantidad: 2 }], monto: 2000, medio: 'efectivo', motivo: 'Vencido' }] };
    const v2: Venta = { ...base, devoluciones: [{ fecha: 2, turnoId: 1, items: [{ indice: 0, cantidad: 2 }], monto: 2000, medio: 'efectivo', motivo: 'Vino fallado' }] };
    const filas = masDevueltos([v1, v2, { ...v2, anulada: true }]);
    expect(filas.map((f) => [f.nombre, f.unidades, f.importe, f.motivo])).toEqual([
      ['P1', 3, 3000, 'Vino fallado'],
      ['P2', 2, 1000, 'Vencido'],
    ]);
    expect(masDevueltos([base])).toEqual([]);
    // Por fecha de la devolución (no de la venta), y con lo devuelto de verdad repartido: $1.200 por 2 P1 de lista $2.000.
    const v3: Venta = { ...base, fecha: 0, devoluciones: [{ fecha: 50, turnoId: 1, items: [{ indice: 0, cantidad: 2 }], monto: 1200, medio: 'efectivo', motivo: '' }] };
    expect(masDevueltos([v1, v3], 10, 100)).toEqual([{ clave: 'p1', nombre: 'P1', unidades: 2, importe: 1200, motivo: '' }]);
    expect(masDevueltos([v1, v3], 60, 100)).toEqual([]);
  });
  it('el descuento sale de la ganancia en proporción a lo que quedó vendido', () => {
    const v: Venta = {
      fecha: 0, turnoId: 1, cajero: '', total: 1800, medio: 'efectivo', pagaCon: null, vuelto: 0, clienteId: null, anulada: false, descuento: 200,
      items: [{ ...item(1, 1000, 2), costoUnitario: 600 }],
    };
    // Sin devolver: ganancia 2000 - 1200 - 200.
    expect(resumirVentas([v]).ganancia).toBe(600);
    // Devuelta la mitad ($900 de los $1.800): queda la mitad de la ganancia y la mitad del descuento.
    const mitad: Venta = { ...v, devoluciones: [{ fecha: 1, turnoId: 1, items: [{ indice: 0, cantidad: 1 }], monto: 900, medio: 'efectivo', motivo: '' }] };
    expect(resumirVentas([mitad]).ganancia).toBe(300);
    // Devuelta entera: nada de ganancia, nada de descuento.
    const toda: Venta = { ...v, devoluciones: [{ fecha: 1, turnoId: 1, items: [{ indice: 0, cantidad: 2 }], monto: 1800, medio: 'efectivo', motivo: '' }] };
    expect(resumirVentas([toda]).ganancia).toBe(0);
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

describe('quién cobró', () => {
  it('agrupa por el usuario de la venta (o quien abrió la caja), sin anuladas y con lo devuelto aparte', async () => {
    const { porCajero } = await import('./reportes');
    const base: Venta = {
      fecha: 0, turnoId: 1, cajero: 'Emanuel', total: 1000, medio: 'efectivo', pagaCon: null, vuelto: 0, clienteId: null, anulada: false,
      items: [{ productoId: 1, codigo: '1', nombre: 'P1', precioUnitario: 1000, costoUnitario: 0, cantidad: 1 }],
    };
    const filas = porCajero(
      [
        { ...base, usuario: 'caro' },
        { ...base, usuario: 'caro', devoluciones: [{ fecha: 1, turnoId: 1, items: [{ indice: 0, cantidad: 1 }], monto: 1000, medio: 'efectivo', motivo: '' }] },
        // Venta vieja sin usuario, con el nombre de quien abrió la caja: es la misma Caro.
        { ...base, cajero: 'Caro' },
        { ...base },
        { ...base, total: 3000 },
        { ...base, anulada: true },
      ],
      new Map([['caro', 'Caro']]),
    );
    expect(filas).toEqual([
      { nombre: 'Emanuel', cantidad: 2, total: 4000, devuelto: 0 },
      { nombre: 'Caro', cantidad: 3, total: 2000, devuelto: 1000 },
    ]);
  });
});
