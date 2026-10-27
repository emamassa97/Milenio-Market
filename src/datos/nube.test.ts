import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manejar, type Consulta } from '../../servidor/sincronizar';
import { BaseKiosco } from './db';
import { cargarEjemplo } from './ejemplo';
import { borrarProducto, guardarAjuste, guardarProducto } from './operaciones';
import { pendientes, subirCambios, type Lote } from './nube';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`nube-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('copia en la nube (equipo)', () => {
  it('sube todo una vez, de a lotes, y después sólo lo que cambia', async () => {
    for (let i = 0; i < 950; i++) {
      await db.productos.add({ codigo: '', nombre: `P${i}`, precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0 });
    }
    const lotes: Lote[] = [];
    const enviar = async (l: Lote) => void lotes.push(l);
    expect(await subirCambios(db, enviar)).toBe(950);
    const ids = new Set(lotes.flatMap((l) => l.registros.map((r) => `${r.tabla}:${r.id}`)));
    expect([...ids].filter((x) => x.startsWith('productos')).length).toBe(950);
    expect(lotes.every((l) => l.registros.length <= 400)).toBe(true);
    lotes.length = 0;
    expect(await subirCambios(db, enviar)).toBe(0);
    await db.productos.update(5, { precio: 99 });
    expect(await pendientes(db)).toBe(1);
    await subirCambios(db, enviar);
    expect(lotes[0]!.registros).toHaveLength(1);
    expect((lotes[0]!.registros[0]!.datos as { precio: number }).precio).toBe(99);
  });

  it('si el envío falla, lo vuelve a mandar la próxima vez', async () => {
    await guardarProducto(db, { codigo: '', nombre: 'A', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false });
    await expect(subirCambios(db, async () => { throw new Error('sin internet'); })).rejects.toThrow();
    const lotes: Lote[] = [];
    await subirCambios(db, async (l) => void lotes.push(l));
    expect(lotes.flatMap((l) => l.registros).some((r) => r.tabla === 'productos')).toBe(true);
  });

  it('no sube los ajustes propios del equipo y avisa los borrados', async () => {
    await guardarAjuste(db, 'nube.clave', 'secreta');
    await guardarAjuste(db, 'cajero', 'Ema');
    const id = await guardarProducto(db, { codigo: '', nombre: 'A', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false });
    await borrarProducto(db, id);
    const lotes: Lote[] = [];
    await subirCambios(db, async (l) => void lotes.push(l));
    const ajustes = lotes.flatMap((l) => l.registros).filter((r) => r.tabla === 'ajustes').map((r) => r.id);
    expect(ajustes).toEqual(['cajero']);
    expect(lotes.flatMap((l) => l.borrados)).toEqual([{ tabla: 'productos', id: String(id) }]);
  });
});

describe('actualizar la base de la versión 1 a la 2', () => {
  it('conserva todo lo cargado, incluidos campos desconocidos', async () => {
    const nombre = `vieja-${n++}`;
    const vieja = new Dexie(nombre);
    vieja.version(1).stores({
      productos: '++id, codigo, nombre, categoria', ventas: '++id, fecha, turnoId, clienteId', turnos: '++id, apertura',
      movimientosCaja: '++id, turnoId', clientes: '++id, nombre', movimientosFiado: '++id, clienteId, turnoId, ventaId', ajustes: 'clave',
    });
    await vieja.table('productos').add({ codigo: '1', nombre: 'Coca', precio: 1400, costo: 0, stock: 3, stockMinimo: 0, categoria: '', rapido: true, creado: 1, actualizado: 1, extra: 'x' });
    await vieja.table('ajustes').put({ clave: 'cajero', valor: 'Ema' });
    vieja.close();
    const nueva = new BaseKiosco(nombre);
    await nueva.open();
    const p = (await nueva.productos.toArray())[0] as unknown as Record<string, unknown>;
    expect(p).toMatchObject({ nombre: 'Coca', precio: 1400, stock: 3, extra: 'x' });
    expect(Number(p._v)).toBeGreaterThan(0);
    expect(await pendientes(nueva)).toBe(2);
    await nueva.delete();
  });
});

describe('servidor', () => {
  const llamadas: { texto: string; parametros: unknown[] }[] = [];
  const consulta: Consulta = async (texto, parametros) => {
    llamadas.push({ texto, parametros });
    return [];
  };
  const pedir = (cuerpo: unknown, clave = 'secreta') =>
    manejar(new Request('http://x/api/sincronizar', { method: 'POST', headers: { 'x-clave': clave }, body: JSON.stringify(cuerpo) }), { consulta, clave: 'secreta' });

  it('sin configurar responde 503 y con clave mala 401', async () => {
    expect((await manejar(new Request('http://x', { method: 'POST' }), { consulta: null, clave: undefined })).status).toBe(503);
    expect((await pedir({}, 'otra')).status).toBe(401);
  });
  it('rechaza tablas desconocidas', async () => {
    const r = await pedir({ dispositivo: 'd', registros: [{ tabla: 'usuarios', id: '1', datos: {} }] });
    expect(r.status).toBe(400);
  });
  it('guarda un lote válido', async () => {
    llamadas.length = 0;
    const r = await pedir({ dispositivo: 'd', registros: [{ tabla: 'ventas', id: '1', datos: { total: 1 } }], borrados: [] });
    expect(r.status).toBe(200);
    expect(llamadas.some((l) => l.texto.includes('insert into registros'))).toBe(true);
  });
});

it('el ejemplo también queda listo para subir', async () => {
  await cargarEjemplo(db);
  expect(await pendientes(db)).toBeGreaterThan(20);
});

describe('alta automática de la clave', () => {
  const crearNube = () => {
    let guardada: string | undefined;
    const consulta: Consulta = async (texto, parametros) => {
      if (texto.includes('insert into config_nube')) {
        if (guardada) return [];
        guardada = parametros[0] as string;
        return [{ valor: guardada }];
      }
      if (texto.includes('from config_nube')) return guardada ? [{ valor: guardada }] : [];
      return [];
    };
    return consulta;
  };
  const alta = (consulta: Consulta, clave?: string) =>
    manejar(new Request('http://x/api/sincronizar', { method: 'POST', headers: { 'x-alta': '1' } }), { consulta, clave });
  const subir = (consulta: Consulta, x: string) =>
    manejar(new Request('http://x/api/sincronizar', { method: 'POST', headers: { 'x-clave': x }, body: JSON.stringify({ dispositivo: 'd', registros: [] }) }), { consulta, clave: undefined });

  it('la primera caja recibe una clave y la segunda no', async () => {
    const consulta = crearNube();
    const r1 = await alta(consulta);
    expect(r1.status).toBe(200);
    const { clave } = (await r1.json()) as { clave: string };
    expect(clave.length).toBeGreaterThan(20);
    expect((await alta(consulta)).status).toBe(409);
    expect((await subir(consulta, clave)).status).toBe(200);
    expect((await subir(consulta, 'otra')).status).toBe(401);
  });
  it('sin alta nadie entra, y con SYNC_CLAVE no hay alta', async () => {
    const consulta = crearNube();
    expect((await subir(consulta, '')).status).toBe(401);
    expect((await alta(consulta, 'fija')).status).toBe(409);
  });
});
