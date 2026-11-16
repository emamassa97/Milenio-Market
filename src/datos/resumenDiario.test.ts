import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textoResumen } from '../dominio/resumenDiario';
import { diaArgentina, recibirResumen, tareaNocturna, telefonoArgentino } from '../../servidor/resumen';
import { registrarCompra } from './compras';
import { BaseKiosco } from './db';
import { ingresarDondeSea } from './ingreso';
import { pedirAlta, sincronizarAhora } from './nube';
import { crearNube } from './nubeFalsa';
import { abrirTurno, cerrarTurno, guardarAjuste, guardarCliente, guardarProducto, leerAjuste, registrarMovimientoCaja, registrarVenta } from './operaciones';
import { AJUSTE_RESUMEN, cargarResumen, enlaceWhatsApp, guardarConfigResumen, mandaSolo, subirResumen } from './resumenDiario';
import { crearUsuario } from './usuarios';

let n = 0;
const nueva = async () => {
  const d = new BaseKiosco(`resumen-${n++}`);
  await d.open();
  return d;
};
afterEach(() => vi.unstubAllGlobals());

const prod = (nombre: string, extra: Partial<{ precio: number; costo: number; stock: number; stockMinimo: number }> = {}) => ({
  codigo: '', nombre, precio: 1000, costo: 600, stock: 20, stockMinimo: 0, categoria: '', rapido: false, ...extra,
});

/** Un día de kiosco: ventas con distintos medios, un fiado, una compra a proveedor y un gasto. */
async function unDia(db: BaseKiosco) {
  await crearUsuario(db, { usuario: 'colo123', nombre: 'Matías', clave: '4826', admin: true });
  await crearUsuario(db, { usuario: 'lu', nombre: 'Lucía', clave: '7391', admin: false });
  const coca = await guardarProducto(db, prod('Coca 2,25 L', { precio: 3000, costo: 2000, stock: 8, stockMinimo: 6 }));
  const alfajor = await guardarProducto(db, prod('Alfajor', { precio: 1000, costo: 600, stock: 30 }));
  const chicle = await guardarProducto(db, prod('Chicle', { precio: 500, costo: 0, stock: 0, stockMinimo: 3 }));
  const marta = await guardarCliente(db, { nombre: 'Marta', telefono: '', limite: 0 });
  await abrirTurno(db, 'Lucía', 5000, 'lu');
  const item = (id: number, nombre: string, precio: number, costo: number, cantidad: number) => ({ productoId: id, codigo: '', nombre, precioUnitario: precio, costoUnitario: costo, cantidad });
  await registrarVenta(db, { items: [item(coca, 'Coca 2,25 L', 3000, 2000, 3)], medio: 'efectivo', pagaCon: null, clienteId: null }, 'lu');
  await registrarVenta(db, { items: [item(alfajor, 'Alfajor', 1000, 600, 4)], medio: 'mercadopago', pagaCon: null, clienteId: null }, 'lu');
  await registrarVenta(db, { items: [item(chicle, 'Chicle', 500, 0, 2)], medio: 'fiado', pagaCon: null, clienteId: marta }, 'lu');
  await registrarMovimientoCaja(db, 'gasto', 1500, 'Lavandina');
  await registrarCompra(db, { proveedor: 'Distribuidora Sur', fecha: Date.now(), renglones: [{ productoId: alfajor, cantidad: 10, costo: 600 }], pago: null }, 'colo123');
  return { coca, alfajor, chicle };
}

describe('resumen del día', () => {
  it('junta lo vendido, la ganancia, los medios, el cierre, lo más vendido, qué reponer, el fiado y los proveedores', async () => {
    const db = await nueva();
    await unDia(db);
    // Hay $14.000 en el cajón (fondo 5.000 + 9.000 de ventas - 1.500 de gasto = 12.500 esperados): sobran 1.500.
    const cerrado = await cerrarTurno(db, { '10000': 1, '2000': 2 }, '', 'colo123');
    const r = (await cargarResumen(db, cerrado))!;
    expect(r.vendido).toBe(14_000);
    expect(r.ventas).toBe(3);
    expect(r.ganancia).toBe(3 * 1000 + 4 * 400);
    expect(r.sinCosto).toBe(1000);
    expect(r.medios.map((m) => [m.id, m.monto])).toEqual([
      ['efectivo', 9000],
      ['mercadopago', 4000],
      ['fiado', 1000],
    ]);
    expect(r.efectivo).toMatchObject({ esperado: 12_500, contado: 14_000, diferencia: 1500, gastosLocal: 1500 });
    expect(r.abrio).toBe('Lucía');
    expect(r.cerro).toBe('Matías');
    expect(r.top[0]).toEqual({ nombre: 'Coca 2,25 L', cantidad: '3 u', total: 9000 });
    expect(r.reponer.map((p) => p.nombre)).toEqual(['Chicle', 'Coca 2,25 L']);
    expect(r.fiado).toMatchObject({ total: 1000, deudores: 1, fiadoHoy: 1000 });
    expect(r.proveedores).toMatchObject({ deuda: 6000, comprasHoy: 6000, cantidadCompras: 1 });
    expect(r.alertas).toContain('Sobraron $ 1.500 en la caja');

    const texto = textoResumen(r);
    expect(texto).toContain('*Vendido: $ 14.000* (3 ventas');
    expect(texto).toContain('Ganancia estimada: $ 4.600');
    expect(texto).toContain('🟡 Sobraron $ 1.500');
    expect(texto).toContain('abrió Lucía, cerró Matías');
    expect(texto).toContain('• Chicle: sin stock (mínimo 3)');
    expect(texto).toContain('📒 *Fiado sin cobrar: $ 1.000* (1 cliente)');
    expect(texto).toContain('Les debés $ 6.000');
    // Lo que manda un empleado desde su equipo no dice la ganancia, ni cuánto tenía que haber, ni las deudas.
    const ciego = textoResumen(r, { ciego: true });
    expect(ciego).not.toMatch(/Ganancia|Debía haber|Sobraron|Les debés|Fiado sin cobrar/);
    expect(ciego).toContain('Contado: $ 14.000');
    await db.delete();
  });

  it('con la caja abierta resume lo que va del día y lo compara con el mismo día de la semana pasada', async () => {
    const db = await nueva();
    await unDia(db);
    // Una venta de hace una semana, dentro del mismo horario.
    await db.ventas.add({ ...(await db.ventas.toCollection().first())!, id: undefined, fecha: Date.now() - 7 * 86_400_000, total: 7000, turnoId: 999 });
    const r = (await cargarResumen(db))!;
    expect(r.abierta).toBe(true);
    expect(r.cerro).toBeNull();
    expect(r.comparacion).toMatchObject({ antes: 7000, pct: 100 });
    expect(textoResumen(r)).toContain('todavía no se cerró');
    expect(r.alertas).toContain('La caja todavía no se cerró');
    await db.delete();
  });

  it('el enlace de WhatsApp va al número del dueño (sin 0 ni 15) o deja elegir el chat', () => {
    expect(enlaceWhatsApp('hola', '011 15 2345-6789')).toBe('https://wa.me/5491123456789?text=hola');
    expect(enlaceWhatsApp('a b')).toBe('https://wa.me/?text=a%20b');
    expect(telefonoArgentino('11 2345-6789')).toBe('5491123456789');
    expect(mandaSolo({ numero: '1123456789', apikey: '123456', automatico: true })).toBe(true);
    expect(mandaSolo({ numero: '1123456789', apikey: '', automatico: true })).toBe(false);
    expect(mandaSolo({ numero: '1123456789', apikey: '123456', automatico: false })).toBe(false);
    expect(diaArgentina(Date.UTC(2026, 10, 17, 2, 0))).toBe('2026-11-16');
  });
});

describe('resumen del día: envío automático por el servidor', () => {
  it('al cerrar sale una sola vez; la noche manda la caja que nadie cerró; el empleado no cambia a dónde va', async () => {
    const nube = await crearNube();
    vi.stubGlobal('fetch', nube.fetchFalso);
    const pc = await nueva();
    await unDia(pc);
    await guardarConfigResumen(pc, { numero: '11 2345-6789', apikey: '123456', automatico: true });
    expect(await pedirAlta(pc)).toBe(true);
    await sincronizarAhora(pc);
    const clave = await leerAjuste<string>(pc, 'nube.clave', '');

    const mandados: string[] = [];
    let respuesta = 'Message queued. You will receive it in a few seconds.';
    const mandar = (async (url: string | URL | Request) => {
      mandados.push(String(url));
      return new Response(`<p>${respuesta}</p>`);
    }) as typeof fetch;
    const deps = { consulta: nube.consulta, clave: undefined, mandar };
    const servidor = (async (url: string | URL | Request, init?: RequestInit) => recibirResumen(new Request(new URL(String(url), 'http://kiosco.test'), init), deps)) as typeof fetch;
    const noche = () => tareaNocturna(new Request('http://kiosco.test/api/resumen'), deps).then((r) => r.json() as Promise<{ enviados: number }>);

    // Mientras está abierta sube cómo va: no se manda nada.
    const abierta = (await cargarResumen(pc))!;
    vi.stubGlobal('fetch', servidor);
    expect(await subirResumen(pc, abierta, 'parcial')).toEqual({ enviado: false, motivo: 'El servidor no lo pudo mandar.' });
    expect(mandados).toHaveLength(0);
    // A la noche sigue abierta: sale lo último que subió.
    expect((await noche()).enviados).toBe(1);
    expect(mandados[0]).toContain('phone=%2B5491123456789');
    expect(mandados[0]).toContain('apikey=123456');
    expect(decodeURIComponent(mandados[0]!)).toContain('todavía no se cerró');
    expect((await noche()).enviados).toBe(0);

    // Se cierra: sale el resumen del cierre, una sola vez aunque se pida dos veces.
    vi.stubGlobal('fetch', nube.fetchFalso);
    const cerrado = await cerrarTurno(pc, { '10000': 1, '2000': 2 }, '', 'colo123');
    await sincronizarAhora(pc);
    const r = (await cargarResumen(pc, cerrado))!;
    vi.stubGlobal('fetch', servidor);
    expect(await subirResumen(pc, r, 'cierre')).toEqual({ enviado: true });
    expect(await subirResumen(pc, r, 'cierre')).toEqual({ enviado: true });
    expect(mandados).toHaveLength(2);
    expect(decodeURIComponent(mandados[1]!)).toContain('Sobraron $ 1.500');
    // Un parcial viejo de una caja ya cerrada no sale a la noche.
    expect((await noche()).enviados).toBe(0);

    // Si CallMeBot falla, queda para reintentar a la noche.
    vi.stubGlobal('fetch', nube.fetchFalso);
    const otra = await abrirTurno(pc, 'Matías', 0, 'colo123');
    const cerrada2 = await cerrarTurno(pc, {}, '', 'colo123');
    expect(cerrada2.id).toBe(otra);
    await sincronizarAhora(pc);
    const r2 = (await cargarResumen(pc, cerrada2))!;
    vi.stubGlobal('fetch', servidor);
    respuesta = 'ERROR: APIKey is invalid';
    const fallo = await subirResumen(pc, r2, 'cierre');
    expect(fallo.enviado).toBe(false);
    respuesta = 'Message queued.';
    expect((await noche()).enviados).toBe(1);

    // Prueba: sólo el dueño; un desconocido, nada.
    const prueba = (x: string) =>
      recibirResumen(
        new Request('http://kiosco.test/api/resumen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-clave': x }, body: JSON.stringify({ prueba: true, numero: '1123456789', apikey: '555' + '555' }) }),
        deps,
      );
    expect((await prueba('cualquiera')).status).toBe(401);
    expect((await prueba(clave)).status).toBe(200);

    // El empleado no puede mandar el resumen a otro número.
    vi.stubGlobal('fetch', nube.fetchFalso);
    const caja2 = await nueva();
    await ingresarDondeSea(caja2, 'lu', '7391');
    await guardarAjuste(caja2, AJUSTE_RESUMEN, { numero: '1199999999', apikey: '999999', automatico: true });
    await sincronizarAhora(caja2);
    const [fila] = await nube.consulta(`select datos from filas where tabla = 'ajustes' and id = $1`, [AJUSTE_RESUMEN]);
    expect((fila!.datos as { valor: { numero: string } }).valor.numero).toBe('11 2345-6789');
    await pc.delete();
    await caja2.delete();
  });
});
