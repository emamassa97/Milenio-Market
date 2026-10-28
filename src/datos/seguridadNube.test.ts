import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearNube } from './nubeFalsa';
import { BaseKiosco, marcarRemota } from './db';
import { abrirTurno, aumentoMasivo, borrarProducto, guardarProducto, registrarVenta } from './operaciones';
import { pedirAlta, sincronizarAhora } from './nube';
import { comprobarDueño, ingresarDondeSea } from './ingreso';
import { crearUsuario, leerUsuarios } from './usuarios';

// Lo que encontró el jurado 10 (sistemas) en la sincronización y la seguridad de la nube. Cada prueba
// reproducía una falla; ahora dice cómo tiene que andar. Corren contra el SQL real (PGlite).

let n = 0;
const nueva = async () => {
  const d = new BaseKiosco(`seg-${n++}`);
  await d.open();
  return d;
};
const prod = (nombre: string, stock = 10) => ({ codigo: '', nombre, precio: 1000, costo: 500, stock, stockMinimo: 0, categoria: '', rapido: false });
const vender = (db: BaseKiosco, productoId: number, cantidad: number, precio = 1000) =>
  registrarVenta(db, { items: [{ productoId, codigo: '', nombre: 'x', precioUnitario: precio, costoUnitario: 0, cantidad }], medio: 'efectivo', pagaCon: null, clienteId: null });

afterEach(() => vi.unstubAllGlobals());

async function escenario() {
  const nube = await crearNube();
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

async function claveDeJuan(nube: Awaited<ReturnType<typeof crearNube>>) {
  const r = await nube.fetchFalso('/api/sincronizar', { method: 'POST', headers: { 'x-ingreso': '1' }, body: JSON.stringify({ usuario: 'juan', clave: '7391' }) });
  return (await r.json()) as { clave: string; usuarios: { usuario: string; admin: boolean; sal: string; hash: string }[] };
}

describe('nube: precios y stock entre equipos', () => {
  it('una venta en la PC no deshace el precio nuevo que el dueño puso desde el celular', async () => {
    const { pc, cel, coca } = await escenario();
    const stock = (await cel.productos.get(coca))!.stock;
    await guardarProducto(cel, { ...prod('Coca'), precio: 1500, stock }, coca, stock);
    await sincronizarAhora(cel);
    // La PC vende antes de su próxima vuelta (o sin internet).
    await vender(pc, coca, 1);
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    for (const equipo of [pc, cel]) {
      const p = (await equipo.productos.get(coca))!;
      expect(p.stock).toBe(8);
      expect(p.precio).toBe(1500);
    }
  });

  it('un aumento masivo desde el celular sobrevive a lo que la PC vendió sin internet', async () => {
    const { pc, cel, coca } = await escenario();
    const ids = [coca];
    for (let i = 0; i < 9; i++) ids.push(await guardarProducto(pc, prod('P' + i, 50)));
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await aumentoMasivo(cel, ids, 20, 10 as never, false);
    await sincronizarAhora(cel);
    for (const id of ids.slice(0, 5)) await vender(pc, id, 1);
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    for (const equipo of [pc, cel]) {
      const precios = await Promise.all(ids.map(async (id) => (await equipo.productos.get(id))!.precio));
      expect(precios.every((p) => p > 1000)).toBe(true);
    }
    expect((await pc.productos.get(ids[1]!))!.stock).toBe(49);
    expect((await cel.productos.get(ids[1]!))!.stock).toBe(49);
  });

  it('un producto borrado no revive porque otro equipo lo vendió sin internet', async () => {
    const { pc, cel, coca } = await escenario();
    await sincronizarAhora(cel);
    await vender(pc, coca, 1); // la PC sin internet
    await borrarProducto(cel, coca);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc); // vuelve internet
    await sincronizarAhora(cel);
    expect(await cel.productos.get(coca)).toBeUndefined();
    expect(await pc.productos.get(coca)).toBeUndefined();
  });

  it('la bajada no saltea una fila que se confirma tarde con un número de cambio más chico', async () => {
    const { nube } = await escenario();
    const { consulta, fetchFalso } = nube;
    const clave = (await consulta(`select valor from config_nube where nombre = 'clave'`, []))[0]!.valor as string;
    // Dos equipos suben a la vez: B (seq alto, tx chico) confirma primero; A (seq bajo, tx grande) después.
    await consulta(`insert into filas (tabla, id, datos, seq, tx) values ('eventos', 'B', '{"n":"B"}', 900002, '20')`, []);
    const leer = async (desde: string) =>
      (await (await fetchFalso(`/api/sincronizar?v=2&desde=${desde}`, { headers: { 'x-clave': clave } })).json()) as { filas: { id: string }[]; hasta: string };
    const primera = await leer('0:-1');
    expect(primera.filas.map((f) => f.id)).toContain('B');
    await consulta(`insert into filas (tabla, id, datos, seq, tx) values ('eventos', 'A', '{"n":"A"}', 900001, '30')`, []);
    const segunda = await leer(encodeURIComponent('20:900002'));
    expect(segunda.filas.map((f) => f.id)).toContain('A');
  });
});

describe('nube: lo que puede hacer un empleado', () => {
  it('con su clave de empleado no puede borrar ventas, cajas ni productos de nadie', async () => {
    const { nube, pc } = await escenario();
    await vender(pc, 1, 1);
    await sincronizarAhora(pc);
    const { clave } = await claveDeJuan(nube);
    const todo = (await (await nube.fetchFalso('/api/sincronizar?v=2&desde=0:-1', { headers: { 'x-clave': clave } })).json()) as { filas: { tabla: string; id: string }[] };
    const blanco = todo.filas.filter((f) => ['ventas', 'turnos', 'productos', 'movimientosFiado'].includes(f.tabla)).map((f) => ({ tabla: f.tabla, id: f.id }));
    expect(blanco.length).toBeGreaterThan(0);
    const b = await nube.fetchFalso('/api/sincronizar?v=2', { method: 'POST', headers: { 'x-clave': clave }, body: JSON.stringify({ equipo: 1, registros: [], borrados: blanco }) });
    expect(((await b.json()) as { borrados: number }).borrados).toBe(0);
    await sincronizarAhora(pc);
    expect(await pc.ventas.count()).toBe(2);
    expect(await pc.turnos.count()).toBe(1);
    expect(await pc.productos.count()).toBe(1);
  });

  it('con su clave de empleado no puede cambiar el total ni el medio de una venta, ni el precio de un producto', async () => {
    const { nube, pc, coca } = await escenario();
    const { clave } = await claveDeJuan(nube);
    const [v] = await pc.ventas.toArray();
    const p = await pc.productos.get(coca);
    await nube.fetchFalso('/api/sincronizar?v=2', {
      method: 'POST',
      headers: { 'x-clave': clave },
      body: JSON.stringify({
        equipo: 7,
        registros: [
          { tabla: 'ventas', id: String(v!.id), datos: { ...v, total: 1, medio: 'mercadopago', _o: 'x' } },
          { tabla: 'productos', id: String(coca), datos: { ...p, precio: 1, _o: 'y' } },
          { tabla: 'productos', id: String(coca), datos: { ...p, precio: 1, _c: ['precio'], _o: 'z' } },
        ],
        borrados: [],
      }),
    });
    await sincronizarAhora(pc);
    expect((await pc.ventas.get(v!.id!))!.total).toBe(1000);
    expect((await pc.ventas.get(v!.id!))!.medio).toBe('efectivo');
    expect((await pc.productos.get(coca))!.precio).toBe(1000);
  });

  it('el empleado no recibe la sal ni el hash del dueño, y la clave del dueño se comprueba en la nube', async () => {
    const { nube, coca } = await escenario();
    const { usuarios } = await claveDeJuan(nube);
    expect(usuarios.find((u) => u.usuario === 'ema')!.hash).toBe('');
    expect(usuarios.find((u) => u.usuario === 'juan')!.hash).toMatch(/^[0-9a-f]{64}$/);
    // Su equipo tampoco lo recibe al sincronizar.
    const caja2 = await nueva();
    await ingresarDondeSea(caja2, 'juan', '7391');
    await sincronizarAhora(caja2);
    expect((await leerUsuarios(caja2)).find((u) => u.usuario === 'ema')!.hash).toBe('');
    expect(await caja2.productos.get(coca)).toBeTruthy();
    // Autorizar con la clave del dueño en ese equipo: la contesta la nube.
    expect((await comprobarDueño(caja2, 'ema', '4826'))?.admin).toBe(true);
    expect(await comprobarDueño(caja2, 'ema', '1111')).toBeNull();
    // Y si el dueño entra en ese equipo, entra (y desde ahí el equipo es del dueño).
    expect((await ingresarDondeSea(caja2, 'ema', '4826')).admin).toBe(true);
  });

  it('el empleado que entra en la PC del dueño no le borra el hash del dueño', async () => {
    const { pc } = await escenario();
    // La PC tiene una clave vieja de Juan (la cambió en otro lado): al entrar, le pregunta a la nube,
    // que a un empleado le contesta la lista sin el hash del dueño.
    const lista = await leerUsuarios(pc);
    await pc.transaction('rw', pc.ajustes, async (tx) => {
      marcarRemota(tx);
      await pc.ajustes.put({ clave: 'usuarios', valor: lista.map((u) => (u.usuario === 'juan' ? { ...u, hash: '0'.repeat(64) } : u)), _v: 0 } as never);
    });
    expect((await ingresarDondeSea(pc, 'juan', '7391')).admin).toBe(false);
    const ema = (await leerUsuarios(pc)).find((u) => u.usuario === 'ema')!;
    expect(ema.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await ingresarDondeSea(pc, 'ema', '4826')).admin).toBe(true);
  });

  it('el empleado puede cambiar su propia clave, y nada más de la lista', async () => {
    const { nube } = await escenario();
    const { clave, usuarios } = await claveDeJuan(nube);
    const juan = usuarios.find((u) => u.usuario === 'juan')!;
    const nuevaLista = usuarios.map((u) => (u.usuario === 'juan' ? { ...juan, sal: 'a'.repeat(32), hash: 'b'.repeat(64), admin: true } : u));
    await nube.fetchFalso('/api/sincronizar?v=2', {
      method: 'POST',
      headers: { 'x-clave': clave },
      body: JSON.stringify({ equipo: 9, registros: [{ tabla: 'ajustes', id: 'usuarios', datos: { clave: 'usuarios', valor: nuevaLista, _o: 'u' } }], borrados: [] }),
    });
    const guardada = (await nube.filas()).find((f) => f.tabla === 'ajustes' && f.id === 'usuarios')!.datos.valor as typeof usuarios;
    expect(guardada.find((u) => u.usuario === 'juan')!.hash).toBe('b'.repeat(64));
    expect(guardada.find((u) => u.usuario === 'juan')!.admin).toBeFalsy();
    expect(guardada.find((u) => u.usuario === 'ema')!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
