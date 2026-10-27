import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manejar, TABLAS_SERVIDOR, type Consulta } from '../../servidor/sincronizar';
import { BaseKiosco, TABLAS_NUBE } from './db';
import { cargarEjemplo } from './ejemplo';
import { borrarProducto, guardarAjuste, guardarProducto, leerAjuste } from './operaciones';
import { activarNube, estadoNube, listarEquipos, pedirAlta, pendientes, recuperarDeLaNube, subirCambios, type Lote } from './nube';

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

describe('nube sin activar', () => {
  const respuesta = (estado: number, cuerpo: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } }));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('si el alta responde 409 lo anota, y se limpia al activar', async () => {
    vi.stubGlobal('fetch', respuesta(409, { error: 'La nube ya tiene clave.' }));
    expect(await pedirAlta(db)).toBe(false);
    const sin = await estadoNube(db);
    expect(sin).toMatchObject({ activa: false, sinActivar: true, aviso: 'Nube sin activar: escribí la clave en Ajustes.' });
    await activarNube(db, ' la-clave ');
    expect(await leerAjuste(db, 'nube.clave', '')).toBe('la-clave');
    expect(await estadoNube(db)).toMatchObject({ activa: true, sinActivar: false, error: null, aviso: null });
  });

  it('con el alta concedida queda activa sin aviso', async () => {
    vi.stubGlobal('fetch', respuesta(200, { clave: 'nueva-clave-larga' }));
    expect(await pedirAlta(db)).toBe(true);
    const e = await estadoNube(db);
    expect(e).toMatchObject({ activa: true, sinActivar: false, aviso: null });
    expect(e.pendientes).toBe(0);
  });

  it('una clave escrita a mano tapa el aviso aunque quede anotado', async () => {
    await guardarAjuste(db, 'nube.estado', 'sin-activar');
    await guardarAjuste(db, 'nube.clave', 'puesta-a-mano');
    expect((await estadoNube(db)).sinActivar).toBe(false);
  });
});

describe('elegir qué equipo recuperar', () => {
  // Nube falsa en memoria que entiende las consultas del servidor.
  const crearNube = (filas: { dispositivo: string; tabla: string; id: string; datos: unknown; actualizado: number }[]) => {
    const consultas: string[] = [];
    const consulta: Consulta = async (texto, parametros) => {
      consultas.push(texto);
      if (texto.includes('from config_nube')) return [];
      if (texto.includes('count(*)')) {
        const por = new Map<string, { dispositivo: string; registros: number; ultima: Date }>();
        for (const f of filas) {
          const e = por.get(f.dispositivo) ?? { dispositivo: f.dispositivo, registros: 0, ultima: new Date(0) };
          e.registros++;
          if (f.actualizado > e.ultima.getTime()) e.ultima = new Date(f.actualizado);
          por.set(f.dispositivo, e);
        }
        return [...por.values()].sort((a, b) => b.ultima.getTime() - a.ultima.getTime()).map((e) => ({ ...e, registros: String(e.registros) }));
      }
      if (texto.includes('group by dispositivo order by max(actualizado) desc limit 1')) {
        const ultima = [...filas].sort((a, b) => b.actualizado - a.actualizado)[0];
        return ultima ? [{ dispositivo: ultima.dispositivo }] : [];
      }
      if (texto.includes('select tabla, id, datos')) {
        const [disp, tabla, id] = parametros as string[];
        return filas
          .filter((f) => f.dispositivo === disp && (f.tabla > tabla! || (f.tabla === tabla && f.id > id!)))
          .map((f) => ({ tabla: f.tabla, id: f.id, datos: f.datos }));
      }
      return [];
    };
    return { consulta, consultas };
  };
  const filas = [
    { dispositivo: 'caja-vieja', tabla: 'productos', id: '1', datos: { id: 1, codigo: '', nombre: 'Coca', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0 }, actualizado: 1000 },
    { dispositivo: 'caja-vieja', tabla: 'productos', id: '2', datos: { id: 2, codigo: '', nombre: 'Pepsi', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0 }, actualizado: 1000 },
    { dispositivo: 'notebook-prueba', tabla: 'productos', id: '1', datos: { id: 1, codigo: '', nombre: 'Prueba', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0 }, actualizado: 5000 },
  ];
  const conClave = (u: string) => new Request(`http://x${u}`, { headers: { 'x-clave': 'secreta' } });

  it('el servidor lista los equipos, el más reciente primero', async () => {
    const { consulta } = crearNube(filas);
    const r = await manejar(conClave('/api/sincronizar?equipos=1'), { consulta, clave: 'secreta' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      equipos: [
        { dispositivo: 'notebook-prueba', registros: 1, ultima: 5000 },
        { dispositivo: 'caja-vieja', registros: 2, ultima: 1000 },
      ],
    });
  });

  it('el servidor devuelve el equipo pedido, o el último si no se pide', async () => {
    const { consulta } = crearNube(filas);
    const pedido = await manejar(conClave('/api/sincronizar?desde=&dispositivo=caja-vieja'), { consulta, clave: 'secreta' });
    const cuerpo = (await pedido.json()) as { dispositivo: string; registros: unknown[] };
    expect(cuerpo.dispositivo).toBe('caja-vieja');
    expect(cuerpo.registros).toHaveLength(2);
    const ultimo = (await (await manejar(conClave('/api/sincronizar?desde='), { consulta, clave: 'secreta' })).json()) as { dispositivo: string };
    expect(ultimo.dispositivo).toBe('notebook-prueba');
    expect((await manejar(conClave(`/api/sincronizar?dispositivo=${'x'.repeat(101)}`), { consulta, clave: 'secreta' })).status).toBe(400);
    expect((await manejar(new Request('http://x/api/sincronizar?equipos=1'), { consulta, clave: 'secreta' })).status).toBe(401);
  });

  it('el equipo lista y recupera el equipo elegido', async () => {
    const { consulta } = crearNube(filas);
    vi.stubGlobal('fetch', (entrada: string, init?: RequestInit) => manejar(new Request(`http://x${entrada}`, init), { consulta, clave: 'secreta' }));
    try {
      const equipos = await listarEquipos('secreta');
      expect(equipos.map((e) => e.dispositivo)).toEqual(['notebook-prueba', 'caja-vieja']);
      await expect(listarEquipos('mala')).rejects.toThrow('no es correcta');
      expect(await recuperarDeLaNube(db, 'secreta', 'caja-vieja')).toBe(2);
      expect((await db.productos.toArray()).map((p) => p.nombre).sort()).toEqual(['Coca', 'Pepsi']);
      expect(await leerAjuste(db, 'dispositivo', '')).toBe('caja-vieja');
      expect(await pendientes(db)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('la lista de tablas del servidor coincide con la del equipo', () => {
  expect([...TABLAS_SERVIDOR]).toEqual([...TABLAS_NUBE]);
});
