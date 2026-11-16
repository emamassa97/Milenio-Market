import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearNube } from './nubeFalsa';
import { BaseKiosco } from './db';
import { abrirTurno, cerrarTurno, devolverProductos, guardarProducto, registrarVenta, resumenDeTurno, turnoAbierto } from './operaciones';
import { pedirAlta, sincronizarAhora } from './nube';
import { ingresarDondeSea } from './ingreso';
import { crearUsuario } from './usuarios';

// Jurado 11 (sistemas): una sola caja con varios equipos a la vez. Antes de este arreglo fallaban todas.
// Corren con el servidor real sobre PGlite (src/datos/nubeFalsa.ts), igual que sincronizacion.test.ts.

let n = 0;
const nueva = async () => {
  const d = new BaseKiosco(`j11-${n++}`);
  await d.open();
  return d;
};
const prod = (nombre: string, stock = 10) => ({ codigo: '', nombre, precio: 1000, costo: 500, stock, stockMinimo: 0, categoria: '', rapido: false });
const vender = (db: BaseKiosco, productoId: number, cantidad: number, precio = 1000) =>
  registrarVenta(db, { items: [{ productoId, codigo: '', nombre: 'Coca', precioUnitario: precio, costoUnitario: 0, cantidad }], medio: 'efectivo', pagaCon: null, clienteId: null });
/** El conteo de billetes: `n` billetes de $1.000. */
const billetes = (n: number) => ({ '1000': n });

afterEach(() => vi.unstubAllGlobals());

/** PC con la caja abierta (fondo 0) y una venta de $1.000 subida; celular del dueño unido y al día. */
async function escenario() {
  const nube = await crearNube();
  vi.stubGlobal('fetch', nube.fetchFalso);
  const pc = await nueva();
  await crearUsuario(pc, { usuario: 'ema', nombre: 'Ema', clave: '4826', admin: true });
  await crearUsuario(pc, { usuario: 'juan', nombre: 'Juan', clave: '7391', admin: false });
  const coca = await guardarProducto(pc, prod('Coca', 50));
  await abrirTurno(pc, 'Ema', 0);
  await vender(pc, coca, 1);
  expect(await pedirAlta(pc)).toBe(true);
  await sincronizarAhora(pc);
  const cel = await nueva();
  await ingresarDondeSea(cel, 'ema', '4826');
  return { nube, pc, cel, coca };
}

/** El efectivo de todas las ventas en efectivo (fondo 0 en todas las cajas de estas pruebas). */
async function efectivoVendido(db: BaseKiosco) {
  return (await db.ventas.toArray()).filter((v) => !v.anulada && v.medio === 'efectivo').reduce((s, v) => s + v.total, 0);
}
/** Lo que los cierres dicen que tenía que haber, sumado. */
async function esperadoDeLosCierres(db: BaseKiosco) {
  return (await db.turnos.toArray()).filter((t) => t.cierre !== null).reduce((s, t) => s + (t.esperado ?? 0), 0);
}

describe('jurado 11 · una sola caja', () => {
  it('A1. la PC cierra mientras el celular vendió y todavía no subió: el cierre tiene que incluir esa venta', async () => {
    const { pc, cel, coca } = await escenario();
    await sincronizarAhora(cel);
    await vender(cel, coca, 5); // $5.000 en efectivo, entra al mismo cajón; el celular sube en ≤30 s
    // El empleado cuenta el cajón en la PC: hay $6.000 (la venta de la PC + la del celular).
    const cerrado = await cerrarTurno(pc, billetes(6), '');
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const t = (await pc.turnos.get(cerrado.id!))!;
    const { resumen } = await resumenDeTurno(pc, t);
    void (`A1: cierre guardado esperado=${t.esperado} contado=${t.contado} → "Sobraron ${t.contado! - t.esperado!}"; vendido recalculado=${resumen.vendidoNeto}`);
    // Debería: esperado 6000 (o, al menos, no quedar una venta de esta caja fuera de su esperado).
    expect(t.esperado).toBe(resumen.efectivoEsperado);
  });

  it('A2. venta sin internet después del cierre: queda en una caja cerrada y no entra en ningún cierre', async () => {
    const { pc, cel, coca } = await escenario();
    await sincronizarAhora(cel);
    // La PC cierra a la noche (contado justo) y abre la caja del día siguiente.
    await cerrarTurno(pc, billetes(1), '');
    await abrirTurno(pc, 'Ema', 0);
    await sincronizarAhora(pc);
    // El celular estaba sin señal: para él la caja vieja sigue abierta y cobra $3.000 ahí.
    const v = await vender(cel, coca, 3);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const turnoDeLaVenta = (await pc.turnos.get(v.turnoId))!;
    void (`A2: la venta ${v.id} quedó en la caja ${v.turnoId}, cerrada=${turnoDeLaVenta.cierre !== null} (fecha venta ${v.fecha} > cierre ${turnoDeLaVenta.cierre})`);
    // Cerrar la caja nueva contando todo lo que hay en el cajón ($3.000).
    await cerrarTurno(pc, billetes(3), '');
    void (`A2: efectivo vendido=${await efectivoVendido(pc)}, suma de esperados de los cierres=${await esperadoDeLosCierres(pc)}`);
    expect(await esperadoDeLosCierres(pc)).toBe(await efectivoVendido(pc));
  });

  it('A3. cerrarCajasRepetidas en la PC cierra la caja del celular que ya tiene ventas (sin subir todavía)', async () => {
    const { pc, cel, coca } = await escenario();
    await sincronizarAhora(cel);
    await cerrarTurno(pc, billetes(1), '');
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    // A la mañana abren los dos dentro de los mismos 30 s (ninguno vio la del otro).
    const tPc = await abrirTurno(pc, 'Ema', 0);
    await new Promise((r) => setTimeout(r, 5));
    const tCel = await abrirTurno(cel, 'Juan', 0);
    await sincronizarAhora(cel); // sube la caja del celular, vacía
    await vender(cel, coca, 4); // $4.000, se sube en la próxima vuelta
    await sincronizarAhora(pc); // la PC ve la del celular "vacía" y la cierra sola
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const repetida = (await pc.turnos.get(tCel))!;
    const ventas = await pc.ventas.where('turnoId').equals(tCel).count();
    void (`A3: caja del celular cerrada sola=${repetida.cierre !== null}, nota="${repetida.nota}", esperado=${repetida.esperado}, ventas adentro=${ventas}`);
    expect(tPc).not.toBe(tCel);
    // Una caja con ventas no se cierra sola con esperado = fondo.
    expect(repetida.cierre !== null && ventas > 0).toBe(false);
  });

  it('A4. una caja vieja y vacía abierta sin internet pasa a ser "la caja" y esconde la que tiene las ventas', async () => {
    const { pc, cel, coca } = await escenario();
    await sincronizarAhora(cel);
    await cerrarTurno(pc, billetes(1), '');
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    // 8:00 el celular, sin señal, abre la caja (y no vende).
    const tCel = await abrirTurno(cel, 'Ema', 0);
    await new Promise((r) => setTimeout(r, 5));
    // 8:05 la PC abre la suya y vende toda la mañana.
    const tPc = await abrirTurno(pc, 'Juan', 0);
    await vender(pc, coca, 2);
    await vender(pc, coca, 3);
    await sincronizarAhora(pc);
    // 12:00 vuelve la señal al celular.
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const caja = (await turnoAbierto(pc))!;
    void (`A4: la caja de la PC ahora es ${caja.id} (${caja.id === tCel ? 'la vacía del celular' : 'la de la PC'}); abiertas=${await pc.turnos.filter((t) => t.cierre === null).count()}`);
    expect(caja.id).toBe(tPc);
  });

  it('A5. dos equipos cierran la misma caja: el segundo cierre ("sin contar") borra el conteo del primero', async () => {
    const { pc, cel } = await escenario();
    await sincronizarAhora(cel);
    const caja = (await turnoAbierto(pc))!;
    await cerrarTurno(pc, billetes(1), 'contado por Juan'); // contó $1.000
    await sincronizarAhora(pc);
    // El celular (sin haber bajado el cierre) también cierra, sin contar.
    await cerrarTurno(cel, {}, '');
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const t = (await pc.turnos.get(caja.id!))!;
    void (`A5: en la PC el cierre quedó contado=${t.contado} nota="${t.nota}"`);
    expect(t.contado).toBe(1000);
  });

  it('A6. dos devoluciones parciales de la misma venta en dos equipos: una se pierde de la venta pero su plata sí salió', async () => {
    const { pc, cel, coca } = await escenario();
    const v = await vender(pc, coca, 2); // 2 Cocas, $2.000
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await devolverProductos(pc, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    await devolverProductos(cel, v.id!, [{ indice: 0, cantidad: 1 }], 'efectivo');
    await sincronizarAhora(pc);
    await sincronizarAhora(cel);
    await sincronizarAhora(pc);
    const venta = (await pc.ventas.get(v.id!))!;
    const salidas = (await pc.movimientosCaja.toArray()).filter((m) => m.tipo === 'devolucion').length;
    void (`A6: devoluciones en la venta=${venta.devoluciones?.length ?? 0}, salidas de efectivo anotadas=${salidas}`);
    expect(venta.devoluciones?.length ?? 0).toBe(salidas);
  });
});

describe('jurado 11 · seguridad que quedó', () => {
  it('B2. con su token de empleado, Juan baja el fondo de la caja abierta que abrió el dueño', async () => {
    const { nube, pc } = await escenario();
    const caja = (await turnoAbierto(pc))!;
    // Fondo real: lo ponemos en 20.000 desde la PC (dueño).
    await pc.turnos.update(caja.id!, { fondoInicial: 20000 });
    await sincronizarAhora(pc);
    const r = await nube.fetchFalso('/api/sincronizar', { method: 'POST', headers: { 'x-ingreso': '1' }, body: JSON.stringify({ usuario: 'juan', clave: '7391' }) });
    const { clave } = (await r.json()) as { clave: string };
    const fila = (await nube.filas()).find((f) => f.tabla === 'turnos' && f.id === String(caja.id))!;
    const post = await nube.fetchFalso('/api/sincronizar?v=2', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': clave },
      body: JSON.stringify({ equipo: 1, registros: [{ tabla: 'turnos', id: String(caja.id), datos: { ...fila.datos, fondoInicial: 0, _o: 'juan:1', _v: Date.now() } }], borrados: [] }),
    });
    const despues = (await nube.filas()).find((f) => f.tabla === 'turnos' && f.id === String(caja.id))!;
    void (`B2: respuesta ${post.status}; fondo en la nube antes=${fila.datos.fondoInicial} después=${despues.datos.fondoInicial}`);
    expect(despues.datos.fondoInicial).toBe(20000);
  });

  it('B3. el ingreso revela qué usuarios existen por el tiempo de respuesta', async () => {
    const { nube } = await escenario();
    const medir = async (usuario: string) => {
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) {
        await nube.fetchFalso('/api/sincronizar', { method: 'POST', headers: { 'x-ingreso': '1' }, body: JSON.stringify({ usuario, clave: `x${i}` }) });
      }
      return (performance.now() - t0) / 3;
    };
    const existe = await medir('juan');
    const noExiste = await medir('zzz-no-existe');
    void (`B3: usuario que existe ${existe.toFixed(1)} ms, que no existe ${noExiste.toFixed(1)} ms`);
    expect(existe / noExiste).toBeLessThan(2);
  });

});
