import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearNube } from './nubeFalsa';
import { BaseKiosco, RANGO } from './db';
import { abrirTurno, borrarProducto, guardarProducto, registrarVenta, turnoAbierto } from './operaciones';
import { pedirAlta, sincronizarAhora } from './nube';
import { ingresarDondeSea } from './ingreso';
import { cambiarClave, crearUsuario, empezarDeCero, leerUsuarios } from './usuarios';

// Dos equipos (la PC del kiosco y el celular del dueño) contra una nube falsa
// en memoria que responde las consultas reales del servidor.

let n = 0;
const nueva = async () => {
  const d = new BaseKiosco(`sinc-${n++}`);
  await d.open();
  return d;
};
const prod = (nombre: string, stock = 10) => ({ codigo: '', nombre, precio: 1000, costo: 500, stock, stockMinimo: 0, categoria: '', rapido: false });
const vender = (db: BaseKiosco, productoId: number, cantidad: number, precio = 1000) =>
  registrarVenta(db, { items: [{ productoId, codigo: '', nombre: 'x', precioUnitario: precio, costoUnitario: 0, cantidad }], medio: 'efectivo', pagaCon: null, clienteId: null });

afterEach(() => vi.unstubAllGlobals());

async function escenario() {
  const nube = crearNube();
  vi.stubGlobal('fetch', nube.fetchFalso);
  const pc = await nueva();
  await crearUsuario(pc, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
  await crearUsuario(pc, { usuario: 'juan', nombre: 'Juan', clave: '7391', admin: false });
  const coca = await guardarProducto(pc, prod('Coca', 10));
  await abrirTurno(pc, 'Ema', 0);
  await vender(pc, coca, 1);
  expect(await pedirAlta(pc)).toBe(true);
  await sincronizarAhora(pc);
  const cel = await nueva();
  await ingresarDondeSea(cel, 'ema', '4826');
  return { nube, pc, cel, coca };
}

describe('sincronización entre equipos', () => {
  it('las ventas de los dos llegan a los dos, sin pisarse, y el stock suma lo de ambos', async () => {
    const { pc, cel, coca } = await escenario();
    // El celular no vende en la caja de la PC: tiene que abrir la suya.
    expect(await turnoAbierto(cel)).toBeUndefined();
    await abrirTurno(cel, 'Ema', 0);
    const vPc = await vender(pc, coca, 1);
    const vCel = await vender(cel, coca, 2, 1000);
    expect(vPc.id).not.toBe(vCel.id);
    expect(vCel.id!).toBeGreaterThanOrEqual(RANGO);
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    expect(await pc.ventas.count()).toBe(3);
    expect(await cel.ventas.count()).toBe(3);
    // 10 − 1 − 1 − 2 = 6 en los dos.
    expect((await pc.productos.get(coca))!.stock).toBe(6);
    expect((await cel.productos.get(coca))!.stock).toBe(6);
    // Cada uno sigue con su caja.
    expect((await turnoAbierto(pc))!.id).not.toBe((await turnoAbierto(cel))!.id);
  });

  it('lo vendido sin subir no se pierde cuando baja el stock de la nube', async () => {
    const { pc, cel, coca } = await escenario();
    await abrirTurno(cel, 'Ema', 0);
    await vender(cel, coca, 3);
    await sincronizarAhora(cel); // nube: 9 − 3 = 6
    await vender(pc, coca, 1); // PC: 9 − 1 = 8, sin subir
    // La PC baja antes de subir (otra pestaña, por ejemplo): no tiene que perder su venta.
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    expect((await pc.productos.get(coca))!.stock).toBe(5);
    expect((await cel.productos.get(coca))!.stock).toBe(5);
  });

  it('un precio cambiado en el celular llega a la PC, y un borrado borra sólo ese producto', async () => {
    const { pc, cel, coca } = await escenario();
    const alfajor = await guardarProducto(pc, prod('Alfajor'));
    const prueba = await guardarProducto(cel, prod('Prueba celu'));
    expect(alfajor).not.toBe(prueba);
    await guardarProducto(cel, { ...(await cel.productos.get(coca))!, precio: 1500 }, coca);
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await borrarProducto(cel, prueba);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    expect((await pc.productos.get(coca))!.precio).toBe(1500);
    expect(await pc.productos.get(alfajor)).toBeTruthy();
    expect(await pc.productos.get(prueba)).toBeUndefined();
    expect(await cel.productos.get(alfajor)).toBeTruthy();
  });

  it('un cambio de clave en la PC no lo deshace el celular', async () => {
    const { pc, cel } = await escenario();
    await sincronizarAhora(cel);
    await cambiarClave(pc, 'ema', '6203');
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    await expect(ingresarDondeSea(pc, 'ema', '6203')).resolves.toBeTruthy();
    await expect(ingresarDondeSea(pc, 'ema', '4826')).rejects.toThrow();
    expect(await ingresarDondeSea(cel, 'ema', '6203')).toBeTruthy();
  });

  it('un empleado no se lleva la clave de la nube ni puede cambiar los usuarios', async () => {
    const { nube } = await escenario();
    const r = await nube.fetchFalso('/api/sincronizar', { method: 'POST', headers: { 'x-ingreso': '1' }, body: JSON.stringify({ usuario: 'juan', clave: '7391' }) });
    const { clave, usuarios } = (await r.json()) as { clave: string; usuarios: { usuario: string; admin?: boolean }[] };
    expect(clave.startsWith('e.juan.')).toBe(true);
    const falsos = usuarios.map((u) => (u.usuario === 'juan' ? { ...u, admin: true } : u));
    const subida = await nube.fetchFalso('/api/sincronizar?v=2', {
      method: 'POST',
      headers: { 'x-clave': clave },
      body: JSON.stringify({ equipo: 9, registros: [{ tabla: 'ajustes', id: 'usuarios', datos: { clave: 'usuarios', valor: falsos, _v: 9e15 } }], borrados: [] }),
    });
    expect(subida.status).toBe(403);
    // Con la clave vieja de la nube tampoco se puede usar la copia vieja.
    const vieja = await nube.fetchFalso('/api/sincronizar?desde=', { headers: { 'x-clave': clave } });
    expect(vieja.status).toBe(401);
  });

  it('un equipo del empleado sigue sincronizando, y deja de poder cuando lo borran', async () => {
    const { pc, coca } = await escenario();
    const caja2 = await nueva();
    await ingresarDondeSea(caja2, 'juan', '7391');
    expect(await caja2.productos.get(coca)).toBeTruthy();
    await abrirTurno(caja2, 'Juan', 0);
    await vender(caja2, coca, 1);
    await sincronizarAhora(caja2);
    await sincronizarAhora(pc);
    expect((await pc.productos.get(coca))!.stock).toBe(8);
  });

  it('una PC que ya subía con la versión anterior se pasa sola, con su caja abierta', async () => {
    const nube = crearNube();
    vi.stubGlobal('fetch', nube.fetchFalso);
    const pc = await nueva();
    await crearUsuario(pc, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
    const coca = await guardarProducto(pc, prod('Coca', 10));
    await abrirTurno(pc, 'Ema', 0);
    await vender(pc, coca, 1);
    await pedirAlta(pc);
    // Como estaba antes: clave guardada, sin número de equipo ni versión 2.
    await pc.ajustes.put({ clave: 'nube.v2', valor: false });
    await sincronizarAhora(pc);
    expect([...nube.v2.values()].filter((f) => f.tabla === 'ventas')).toHaveLength(1);
    expect((await turnoAbierto(pc))?.equipo).toBe(1);
    await vender(pc, coca, 1);
    const cel = await nueva();
    await sincronizarAhora(pc);
    await ingresarDondeSea(cel, 'ema', '4826');
    expect(await cel.ventas.count()).toBe(2);
    expect((await cel.productos.get(coca))!.stock).toBe(8);
    expect(await turnoAbierto(cel)).toBeUndefined();
    expect((await leerUsuarios(cel)).map((u) => u.usuario)).toEqual(['ema']);
  });

  it('un equipo armado sin nube que se une no borra los usuarios de la nube (se juntan)', async () => {
    const { nube, pc } = await escenario();
    const otra = await nueva();
    await crearUsuario(otra, { usuario: 'ema', nombre: 'Ema', clave: '9157', admin: true });
    await crearUsuario(otra, { usuario: 'lucia', nombre: 'Lucía', clave: '2468', admin: false });
    await guardarProducto(otra, prod('Del otro'));
    await ingresarDondeSea(otra, 'ema', '4826');
    await sincronizarAhora(otra);
    await sincronizarAhora(pc);
    const nombres = (await leerUsuarios(pc)).map((u) => u.usuario).sort();
    expect(nombres).toEqual(['ema', 'juan', 'lucia']);
    await expect(ingresarDondeSea(pc, 'ema', '4826')).resolves.toBeTruthy();
    expect([...nube.v2.values()].some((f) => f.tabla === 'productos' && f.datos.nombre === 'Del otro')).toBe(true);
  });

  it('empezar de cero trae todo de vuelta de la nube y la clave nueva del dueño vale en todos lados', async () => {
    const { pc, cel, coca } = await escenario();
    await empezarDeCero(cel);
    expect(await cel.ventas.count()).toBe(0);
    await crearUsuario(cel, { usuario: 'ema', nombre: 'Ema', clave: '5931', admin: true });
    await sincronizarAhora(cel);
    expect(await cel.ventas.count()).toBe(1);
    expect((await cel.productos.get(coca))!.stock).toBe(9);
    await sincronizarAhora(pc);
    await expect(ingresarDondeSea(pc, 'ema', '5931')).resolves.toBeTruthy();
    expect((await leerUsuarios(pc)).map((u) => u.usuario).sort()).toEqual(['ema', 'juan']);
  });
});
