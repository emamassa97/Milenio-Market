import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cambioDePrecio,
  cantidadDeCompra,
  cuentasDeProveedores,
  estadoDeCompras,
  limpiarFacturaLeida,
  parecido,
  reconocer,
} from '../dominio/compras';
import { mapaPorCodigo } from '../dominio/entrada';
import type { Producto } from '../dominio/tipos';
import { extraerJson, leerFactura } from '../../servidor/factura';
import { anularCompra, anularPagoProveedor, faltaEnCaja, registrarCompra, registrarPagoProveedor } from './compras';
import { BaseKiosco } from './db';
import { leerFotosDeFactura } from './lecturaFactura';
import { crearNube } from './nubeFalsa';
import { pedirAlta, sincronizarAhora } from './nube';
import { abrirTurno, guardarAjuste, guardarProducto, leerAjuste, resumenDeTurno, turnoAbierto, type DatosProducto } from './operaciones';
import { ingresarDondeSea } from './ingreso';
import { crearUsuario } from './usuarios';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`compras-${n++}`);
  await db.open();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
});

const prod = (extra: Partial<DatosProducto> = {}): DatosProducto => ({
  codigo: '', nombre: 'Alfajor', precio: 1000, costo: 600, stock: 10, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});
const hoy = () => Date.now();

describe('compras: cuentas y precios (sin base)', () => {
  it('el precio sugerido mantiene la ganancia y redondea como un kiosco', () => {
    // Ganaba 40 % (600 → 1000). Costo 660: exacto 1100, ya redondo.
    expect(cambioDePrecio({ precio: 1000, costo: 600 }, 660, 35, 50).sugerido).toBe(1100);
    // Costo 650: exacto 1083,3 → a $50 sube a 1100; a $10, 1090.
    expect(cambioDePrecio({ precio: 1000, costo: 600 }, 650, 35, 50).sugerido).toBe(1100);
    expect(cambioDePrecio({ precio: 1000, costo: 600 }, 650, 35, 10).sugerido).toBe(1090);
    // Mismo costo: nada que cambiar.
    expect(cambioDePrecio({ precio: 1000, costo: 600 }, 600, 35, 50).sugerido).toBeNull();
    // Bajó el costo: propone bajar (la pantalla lo deja destildado).
    const baja = cambioDePrecio({ precio: 1000, costo: 600 }, 480, 35, 50);
    expect(baja.costo).toBe('baja');
    expect(baja.sugerido).toBe(800);
    // Sin costo cargado y con precio elegido: no lo toca si no pierde plata.
    expect(cambioDePrecio({ precio: 1000, costo: 0 }, 700, 35, 50).sugerido).toBeNull();
    // ...pero si vender así da pérdida, propone con la ganancia general.
    expect(cambioDePrecio({ precio: 1000, costo: 0 }, 1200, 35, 50).sugerido).toBe(1850);
  });

  it('entiende "2x12" como 24 unidades y rechaza basura', () => {
    expect(cantidadDeCompra('2x12', false)).toBe(24);
    expect(cantidadDeCompra('3 × 6', false)).toBe(18);
    expect(cantidadDeCompra('24', false)).toBe(24);
    expect(cantidadDeCompra('2,5', true)).toBe(2.5);
    expect(cantidadDeCompra('2,5', false)).toBe(2);
    expect(cantidadDeCompra('', false)).toBeNull();
    expect(cantidadDeCompra('abc', false)).toBeNull();
    expect(cantidadDeCompra('0', false)).toBeNull();
  });

  it('la cuenta de cada proveedor junta nombres escritos distinto y reparte el pago a cuenta desde la factura más vieja', () => {
    const c = (id: number, fecha: number, total: number, proveedor = 'Arcor') => ({ id, fecha, creada: fecha, proveedor, renglones: [], total });
    const compras = [c(1, 1000, 5000), c(2, 2000, 3000, '  arcor '), { ...c(3, 3000, 9999), anulada: true }];
    const pagos = [
      { id: 1, fecha: 1500, proveedor: 'ARCOR', monto: 1000, medio: 'caja' as const, compraId: 1, nota: '', anulado: false },
      { id: 2, fecha: 2500, proveedor: 'Arcor', monto: 4500, medio: 'transferencia' as const, compraId: null, nota: '', anulado: false },
      { id: 3, fecha: 2600, proveedor: 'Arcor', monto: 777, medio: 'cheque' as const, compraId: null, nota: '', anulado: true },
    ];
    const [cuenta] = cuentasDeProveedores(compras, pagos, ['Coca']).filter((x) => x.clave === 'arcor');
    expect(cuenta!.comprado).toBe(8000);
    expect(cuenta!.pagado).toBe(5500);
    expect(cuenta!.saldo).toBe(2500);
    const estado = estadoDeCompras(cuenta!);
    // Factura 1: 1000 propio + 4000 a cuenta = pagada. Factura 2: 500 a cuenta → debe 2500.
    expect(estado.get(1)).toEqual({ pagado: 5000, debe: 0 });
    expect(estado.get(2)).toEqual({ pagado: 500, debe: 2500 });
    expect(cuentasDeProveedores(compras, pagos, ['Coca']).some((x) => x.nombre === 'Coca' && x.saldo === 0)).toBe(true);
  });

  it('reconoce los renglones de la factura por código, por lo aprendido y por el nombre (sin confundir tamaños)', () => {
    const p = (id: number, nombre: string, codigo = ''): Producto => ({ id, nombre, codigo, precio: 1, costo: 1, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0 });
    const productos = [p(1, 'Coca Cola 500 ml', '7790895000997'), p(2, 'Coca Cola 2,25 L'), p(3, 'Alfajor Jorgito Chocolate'), p(4, 'Sprite 500 ml')];
    const mapa = mapaPorCodigo(productos);
    expect(reconocer({ codigo: '7790895000997', descripcion: 'cualquier cosa' }, 'Coca', productos, mapa, {}).producto?.id).toBe(1);
    const grande = reconocer({ codigo: '', descripcion: 'COCA COLA 2.25LT X6' }, 'Coca', productos, mapa, {});
    expect(grande.producto?.id).toBe(2);
    expect(parecido('COCA COLA 2.25LT', 'Coca Cola 500 ml')).toBeLessThan(parecido('COCA COLA 2.25LT', 'Coca Cola 2,25 L'));
    expect(reconocer({ codigo: '', descripcion: 'ALF JORGITO CHOC' }, 'x', productos, mapa, {}).producto?.id).toBe(3);
    expect(reconocer({ codigo: '', descripcion: 'Yerba Playadito 1kg' }, 'x', productos, mapa, {}).producto).toBeNull();
    // Lo que se eligió una vez para ese proveedor gana.
    const alias = { 'distri sur|jgt ch': 3 };
    expect(reconocer({ codigo: '', descripcion: 'JGT CH' }, 'Distri Sur', productos, mapa, alias)).toMatchObject({ certeza: 'aprendido', producto: { id: 3 } });
  });

  it('lo leído de la foto se controla: números argentinos, renglones vacíos fuera, nada absurdo', () => {
    const f = limpiarFacturaLeida({
      proveedor: ' Distribuidora  Sur ',
      fecha: '2026-11-14',
      numero: '0003-00012345',
      total: '123.456,50',
      renglones: [
        { codigo: '779-0895', descripcion: 'COCA 500', cantidad: 24, costoUnitario: '850,40' },
        { descripcion: 'SIN COSTO', cantidad: 6, importe: 6000 },
        { descripcion: '', cantidad: 2, costoUnitario: 10 },
        { descripcion: 'CODIGO EN CANTIDAD', cantidad: 7790895000997, costoUnitario: 10 },
        'basura',
      ],
    });
    expect(f.proveedor).toBe('Distribuidora Sur');
    expect(f.total).toBe(123457);
    expect(f.renglones).toEqual([
      { codigo: '7790895', descripcion: 'COCA 500', cantidad: 24, costo: 850 },
      { codigo: '', descripcion: 'SIN COSTO', cantidad: 6, costo: 1000 },
    ]);
    expect(limpiarFacturaLeida('nada').renglones).toEqual([]);
    expect(extraerJson('Acá va:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('sin json')).toBeNull();
  });
});

describe('compras: guardar, pagar y anular', () => {
  it('suma stock, deja el costo, cambia sólo los precios elegidos (con la promo en proporción) y queda debiendo', async () => {
    const alfajor = await guardarProducto(db, prod({ promo: { cantidad: 2, precio: 1800 } }));
    const coca = await guardarProducto(db, prod({ nombre: 'Coca', precio: 1500, costo: 900, stock: 4 }));
    const compra = await registrarCompra(db, {
      proveedor: 'Distribuidora Sur',
      fecha: hoy(),
      numero: '0003-1',
      renglones: [
        { productoId: alfajor, cantidad: 24, costo: 660, precio: 1100, descripcion: 'ALF X24' },
        { productoId: coca, cantidad: 12, costo: 990 },
        { nuevo: { nombre: 'Yerba Playadito 1kg', codigo: '7790387000017', categoria: 'Almacén' }, cantidad: 6, costo: 3000, precio: 4650 },
      ],
    });
    expect(compra.total).toBe(24 * 660 + 12 * 990 + 6 * 3000);
    const a = (await db.productos.get(alfajor))!;
    expect(a).toMatchObject({ stock: 34, costo: 660, precio: 1100, proveedor: 'Distribuidora Sur' });
    expect(a.promo!.precio).toBe(1980);
    // A la Coca no se le eligió precio: queda igual aunque subió el costo.
    expect((await db.productos.get(coca))!).toMatchObject({ stock: 16, costo: 990, precio: 1500 });
    const yerba = (await db.productos.where('codigo').equals('7790387000017').first())!;
    expect(yerba).toMatchObject({ nombre: 'Yerba Playadito 1kg', stock: 6, costo: 3000, precio: 4650, categoria: 'Almacén' });
    expect(compra.renglones[0]).toMatchObject({ costoAnterior: 600, precioAnterior: 1000, costo: 660, precio: 1100 });
    // Sin pago: se le debe todo.
    const [cuenta] = cuentasDeProveedores(await db.compras.toArray(), await db.pagosProveedor.toArray());
    expect(cuenta!.saldo).toBe(compra.total);
    // Lo que decía la factura queda aprendido.
    expect((await leerAjuste<Record<string, number>>(db, 'compras.alias', {}))['distribuidora sur|alf 24']).toBe(alfajor);
  });

  it('pagada con plata de la caja: sale como mercadería en el cierre; anular el pago la devuelve', async () => {
    await abrirTurno(db, 'Ema', 50_000);
    const id = await guardarProducto(db, prod());
    const compra = await registrarCompra(db, { proveedor: 'Panadero', fecha: hoy(), renglones: [{ productoId: id, cantidad: 10, costo: 700 }], pago: { monto: 7000, medio: 'caja' } }, 'ema');
    const turno = (await turnoAbierto(db))!;
    const { resumen } = await resumenDeTurno(db, turno);
    expect(resumen.efectivoEsperado).toBe(43_000);
    const mov = (await db.movimientosCaja.toArray())[0]!;
    expect(mov).toMatchObject({ tipo: 'gasto', monto: 7000, mercaderia: true, motivo: 'Mercadería: Panadero' });
    const pago = (await db.pagosProveedor.toArray())[0]!;
    expect(pago).toMatchObject({ compraId: compra.id, turnoId: turno.id, movimientoCajaId: mov.id });
    expect(await anularPagoProveedor(db, pago.id!, 'ema')).toBe('volvio-a-la-caja');
    expect((await resumenDeTurno(db, turno)).resumen.efectivoEsperado).toBe(50_000);
    expect((await db.borrados.toArray()).filter((b) => b.tabla === 'movimientosCaja').length).toBe(1);
    // Avisa si se paga más de lo que hay.
    expect(await faltaEnCaja(db, 60_000)).toBe(50_000);
    expect(await faltaEnCaja(db, 1_000)).toBeNull();
  });

  it('sin caja abierta no deja pagar "de la caja" y no guarda nada a medias', async () => {
    const id = await guardarProducto(db, prod());
    await expect(registrarCompra(db, { proveedor: 'X', fecha: hoy(), renglones: [{ productoId: id, cantidad: 5, costo: 700 }], pago: { monto: 3500, medio: 'caja' } })).rejects.toThrow(/abrí la caja/);
    expect(await db.compras.count()).toBe(0);
    expect((await db.productos.get(id))!.stock).toBe(10);
  });

  it('valida: sin proveedor, sin productos, cantidad que es un código, producto nuevo sin precio o con código ya usado', async () => {
    const id = await guardarProducto(db, prod({ codigo: '7790001' }));
    const base = { proveedor: 'X', fecha: hoy() };
    await expect(registrarCompra(db, { ...base, proveedor: ' ', renglones: [{ productoId: id, cantidad: 1, costo: 1 }] })).rejects.toThrow(/proveedor/);
    await expect(registrarCompra(db, { ...base, renglones: [] })).rejects.toThrow(/al menos un producto/);
    await expect(registrarCompra(db, { ...base, renglones: [{ productoId: id, cantidad: 7790895000997, costo: 1 }] })).rejects.toThrow(/demasiado grande/);
    await expect(registrarCompra(db, { ...base, renglones: [{ nuevo: { nombre: 'Nuevo', codigo: '', categoria: '' }, cantidad: 1, costo: 100 }] })).rejects.toThrow(/a cuánto vas a vender/);
    await expect(registrarCompra(db, { ...base, renglones: [{ nuevo: { nombre: 'Otro', codigo: '7790001', categoria: '' }, cantidad: 1, costo: 100, precio: 200 }] })).rejects.toThrow(/ya es de "Alfajor"/);
    await expect(registrarCompra(db, { ...base, fecha: hoy() + 10 * 86_400_000, renglones: [{ productoId: id, cantidad: 1, costo: 1 }] })).rejects.toThrow(/fecha/);
    expect(await db.compras.count()).toBe(0);
    expect(await db.productos.count()).toBe(1);
  });

  it('anular una compra resta el stock, devuelve costo y precio si nadie los tocó, y lo pagado queda a favor', async () => {
    const a = await guardarProducto(db, prod());
    const b = await guardarProducto(db, prod({ nombre: 'Chicle', precio: 300, costo: 150 }));
    const compra = await registrarCompra(db, {
      proveedor: 'Sur',
      fecha: hoy(),
      renglones: [
        { productoId: a, cantidad: 10, costo: 700, precio: 1200 },
        { productoId: b, cantidad: 5, costo: 180, precio: 350 },
      ],
      pago: { monto: 2000, medio: 'transferencia' },
    });
    // Después alguien cambió el precio del chicle a mano: ése no se toca.
    await guardarProducto(db, { ...(await db.productos.get(b))!, precio: 400 }, b);
    const r = await anularCompra(db, compra.id!, 'ema');
    expect(r).toEqual({ preciosVueltos: 1, pagado: 2000 });
    expect((await db.productos.get(a))!).toMatchObject({ stock: 10, costo: 600, precio: 1000 });
    expect((await db.productos.get(b))!).toMatchObject({ stock: 10, costo: 180, precio: 400 });
    const [cuenta] = cuentasDeProveedores(await db.compras.toArray(), await db.pagosProveedor.toArray());
    expect(cuenta!.saldo).toBe(-2000);
    await expect(anularCompra(db, compra.id!)).rejects.toThrow(/ya estaba anulada/);
  });

  it('pagos a cuenta y de una factura puntual', async () => {
    const id = await guardarProducto(db, prod());
    const c1 = await registrarCompra(db, { proveedor: 'Sur', fecha: hoy() - 86_400_000, renglones: [{ productoId: id, cantidad: 10, costo: 500 }] });
    const c2 = await registrarCompra(db, { proveedor: 'sur', fecha: hoy(), renglones: [{ productoId: id, cantidad: 4, costo: 500 }] });
    await registrarPagoProveedor(db, { proveedor: 'Sur', monto: 2000, medio: 'cheque', compraId: c2.id });
    await registrarPagoProveedor(db, { proveedor: 'SUR', monto: 3000, medio: 'efectivo' });
    const [cuenta] = cuentasDeProveedores(await db.compras.toArray(), await db.pagosProveedor.toArray());
    expect(cuenta!.saldo).toBe(2000);
    const e = estadoDeCompras(cuenta!);
    expect(e.get(c1.id!)).toEqual({ pagado: 3000, debe: 2000 });
    expect(e.get(c2.id!)).toEqual({ pagado: 2000, debe: 0 });
    await expect(registrarPagoProveedor(db, { proveedor: 'Sur', monto: 0, medio: 'cheque' })).rejects.toThrow(/cuánto/);
    await expect(registrarPagoProveedor(db, { proveedor: 'Sur', monto: 10, medio: 'bitcoin' as never })).rejects.toThrow(/cómo se pagó/);
  });
});

describe('compras: nube y lectura de fotos', () => {
  it('las compras y los pagos viajan entre equipos, y el stock de la compra suma con lo vendido en el otro', async () => {
    const nube = await crearNube();
    vi.stubGlobal('fetch', nube.fetchFalso);
    const pc = db;
    await crearUsuario(pc, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
    const id = await guardarProducto(pc, prod({ stock: 10 }));
    expect(await pedirAlta(pc)).toBe(true);
    await sincronizarAhora(pc);
    const cel = new BaseKiosco(`compras-cel-${n++}`);
    await cel.open();
    await ingresarDondeSea(cel, 'ema', '4826');
    // El dueño carga la factura desde el celular mientras la PC vende 3.
    await abrirTurno(pc, 'Ema', 0);
    const { registrarVenta } = await import('./operaciones');
    await registrarVenta(pc, { items: [{ productoId: id, codigo: '', nombre: 'Alfajor', precioUnitario: 1000, costoUnitario: 600, cantidad: 3 }], medio: 'efectivo', pagaCon: null, clienteId: null });
    const compra = await registrarCompra(cel, { proveedor: 'Sur', fecha: hoy(), renglones: [{ productoId: id, cantidad: 24, costo: 650, precio: 1100 }] });
    await registrarPagoProveedor(cel, { proveedor: 'Sur', monto: 5000, medio: 'transferencia', compraId: compra.id });
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    for (const equipo of [pc, cel]) {
      expect(await equipo.compras.count()).toBe(1);
      expect(await equipo.pagosProveedor.count()).toBe(1);
      // 10 − 3 + 24, con el precio y el costo nuevos en los dos.
      expect((await equipo.productos.get(id))!).toMatchObject({ stock: 31, precio: 1100, costo: 650 });
    }
    await cel.delete();
  });

  it('un equipo que siguió con la versión anterior (que salteaba las compras) las baja una vez al actualizarse', async () => {
    const nube = await crearNube();
    vi.stubGlobal('fetch', nube.fetchFalso);
    const pc = db;
    await crearUsuario(pc, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
    const id = await guardarProducto(pc, prod({ stock: 10 }));
    expect(await pedirAlta(pc)).toBe(true);
    await sincronizarAhora(pc);
    const cel = new BaseKiosco(`compras-viejo-${n++}`);
    await cel.open();
    await ingresarDondeSea(cel, 'ema', '4826');
    const compra = await registrarCompra(pc, { proveedor: 'Sur', fecha: hoy(), renglones: [{ productoId: id, cantidad: 24, costo: 650, precio: 1100 }] });
    await registrarPagoProveedor(pc, { proveedor: 'Sur', monto: 5000, medio: 'transferencia', compraId: compra.id });
    await sincronizarAhora(pc);
    // El celular con la versión vieja: la nube le manda las compras, él no las conoce y avanza el cursor igual.
    const viejo: typeof fetch = async (entrada, init) => {
      const r = await nube.fetchFalso(entrada, init);
      if (!String(entrada).includes('desde=')) return r;
      const pagina = (await r.json()) as { filas: { tabla: string }[] };
      pagina.filas = pagina.filas.filter((f) => f.tabla !== 'compras' && f.tabla !== 'pagosProveedor');
      return new Response(JSON.stringify(pagina), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    vi.stubGlobal('fetch', viejo);
    await guardarAjuste(cel, 'nube.ponerAlDia', '');
    await sincronizarAhora(cel);
    expect(await cel.compras.count()).toBe(0);
    expect((await cel.productos.get(id))!.stock).toBe(34);
    // Se actualiza: en la próxima vuelta se pone al día, una sola vez.
    vi.stubGlobal('fetch', nube.fetchFalso);
    await guardarAjuste(cel, 'nube.ponerAlDia', '');
    await sincronizarAhora(cel);
    expect(await cel.compras.count()).toBe(1);
    expect(await cel.pagosProveedor.count()).toBe(1);
    expect(await leerAjuste(cel, 'nube.ponerAlDia', '')).toBe('compras-v1');
    expect((await cel.productos.get(id))!.stock).toBe(34);
    await cel.delete();
  });

  it('leer la foto: sólo el dueño, con tope por día, y con la respuesta del modelo pasada a datos', async () => {
    const nube = await crearNube();
    vi.stubGlobal('fetch', nube.fetchFalso);
    await crearUsuario(db, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
    expect(await pedirAlta(db)).toBe(true);
    const clave = await leerAjuste<string>(db, 'nube.clave', '');
    const pedidos: { modelo: string; auth: string | null }[] = [];
    let respuesta: () => Response = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"proveedor":"Distribuidora Sur","fecha":"2026-11-14","total":20400,"renglones":[{"descripcion":"COCA 500 X12","cantidad":24,"costoUnitario":850}]}\n```' } }],
        }),
      );
    const pedirAlModelo = (async (_url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ modelo: JSON.parse(String(init!.body)).model, auth: new Headers(init!.headers).get('authorization') });
      return respuesta();
    }) as typeof fetch;
    const deps = { consulta: nube.consulta, clave: undefined, token: 'tok', pedirAlModelo };
    const foto = 'data:image/jpeg;base64,/9j/AAAA';
    const pedido = (x: string, cuerpo: unknown = { imagenes: [foto] }) =>
      new Request('http://kiosco.test/api/leer-factura', { method: 'POST', headers: { 'content-type': 'application/json', 'x-clave': x }, body: JSON.stringify(cuerpo) });

    expect((await leerFactura(pedido('otra'), deps)).status).toBe(401);
    expect((await leerFactura(pedido(clave, { imagenes: ['http://afuera/x.jpg'] }), deps)).status).toBe(400);
    expect((await leerFactura(pedido(clave), { ...deps, token: undefined })).status).toBe(503);
    const ok = await leerFactura(pedido(clave), deps);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { factura: { proveedor: string } }).factura.proveedor).toBe('Distribuidora Sur');
    expect(pedidos[0]).toEqual({ modelo: 'anthropic/claude-sonnet-4.6', auth: 'Bearer tok' });

    // Si el primer modelo falla, prueba con el otro; sin permiso en la pasarela, dice que no está activada.
    let veces = 0;
    respuesta = () => (veces++ === 0 ? new Response('{"error":"caído"}', { status: 500 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"renglones":[]}' } }] })));
    expect((await leerFactura(pedido(clave), deps)).status).toBe(200);
    respuesta = () => new Response('{"error":{"message":"no autorizado"}}', { status: 401 });
    const sin = await leerFactura(pedido(clave), deps);
    expect(sin.status).toBe(503);
    expect(((await sin.json()) as { sinIA: boolean }).sinIA).toBe(true);

    // El cliente: arma el pedido con la clave de la nube y limpia lo que vuelve.
    respuesta = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"proveedor":"Sur","renglones":[{"descripcion":"COCA","cantidad":"24","costoUnitario":"850,4"}]}' } }] }));
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => leerFactura(new Request(new URL(String(url), 'http://kiosco.test'), init), deps)) as typeof fetch);
    const leida = await leerFotosDeFactura(db, [foto], ['Sur']);
    expect(leida.factura.renglones).toEqual([{ codigo: '', descripcion: 'COCA', cantidad: 24, costo: 850 }]);

    // Tope del día.
    await nube.consulta(`update lecturas_factura set n = 1000`, []);
    expect((await leerFactura(pedido(clave), deps)).status).toBe(429);
  });
});
