import { fijarRango, marcarRemota, TABLAS_NUBE, type Ajuste, type BaseKiosco, type TablaNube } from './db';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';

// La nube junta a todos los equipos (la PC del mostrador, el celular del
// dueño…). Cada equipo trabaja siempre con sus datos, así vende sin internet,
// y cuando hay internet sube lo que cambió y baja lo que cambiaron los otros.
// - Cada equipo tiene un número (la nube se lo da) y sus filas nuevas usan
//   ids de su rango: nunca pisa las de otro.
// - El stock no se pisa: se suma lo que cada equipo vendió o cargó.
// - Cada equipo tiene su propia caja; ve las de los otros en el panel.

/**
 * Ajustes propios de este equipo: no se suben a la nube ni van en la copia
 * que se exporta (tienen la clave de la nube y el estado de la sincronización).
 */
export const AJUSTES_LOCALES: ReadonlySet<string> = new Set([
  'dispositivo',
  'nube.clave',
  'nube.marcas',
  'nube.borrado',
  'nube.ultima',
  'nube.error',
  'nube.estado',
  'nube.equipo',
  'nube.n',
  'nube.cursor',
  'nube.v2',
  'nube.id',
]);

const LOTE = 400;
/**
 * Lo cambiado en los últimos 2 minutos se vuelve a mandar: con dos pestañas,
 * una puede guardar con una marca apenas menor a la que la otra ya subió. La
 * nube reconoce lo repetido (`_o`) y no lo aplica dos veces.
 */
const VENTANA = 120_000;

export interface Registro {
  tabla: TablaNube | 'borrados';
  id: string;
  datos: unknown;
}

export interface Lote {
  dispositivo: string;
  equipo: number;
  registros: Registro[];
  borrados: { tabla: string; id: string }[];
}

export type Enviar = (lote: Lote) => Promise<void>;

export async function idDispositivo(db: BaseKiosco): Promise<string> {
  const actual = await leerAjuste<string | null>(db, 'nube.equipo', null);
  if (actual) return actual;
  const nuevo = crypto.randomUUID();
  await guardarAjuste(db, 'nube.equipo', nuevo);
  return nuevo;
}

function idDe(tabla: TablaNube, fila: Record<string, unknown>): string {
  return String(tabla === 'ajustes' ? fila.clave : fila.id);
}

/** Cuántas filas cambiaron y todavía no se subieron. */
export async function pendientes(db: BaseKiosco): Promise<number> {
  const marcas = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
  let total = 0;
  for (const t of TABLAS_NUBE) {
    const cambiadas = db.table(t).where('_v').above(marcas[t] ?? 0);
    // Ajustes es chica: ahí se filtran en memoria los propios del equipo.
    total +=
      t === 'ajustes'
        ? (await cambiadas.toArray()).filter((f: Ajuste) => !AJUSTES_LOCALES.has(f.clave)).length
        : await cambiadas.count();
  }
  const ultimoBorrado = await leerAjuste<number>(db, 'nube.borrado', 0);
  total += await db.borrados.where('n').above(ultimoBorrado).count();
  return total;
}

/**
 * Sube todo lo que cambió desde la última vez, de a lotes. Si un envío falla,
 * no se avanza la marca: lo mismo se vuelve a mandar la próxima vez.
 * Devuelve cuántas filas subió.
 */
export async function subirCambios(db: BaseKiosco, enviar: Enviar): Promise<number> {
  const dispositivo = await idDispositivo(db);
  const equipo = (await leerAjuste<number | null>(db, 'nube.n', null)) ?? 0;
  let subidas = 0;
  for (const t of TABLAS_NUBE) {
    const marcas0 = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
    let desde = Math.max(0, (marcas0[t] ?? 0) - VENTANA);
    for (;;) {
      const filas = (await db.table(t).where('_v').above(desde).limit(LOTE).toArray()) as Record<string, unknown>[];
      if (filas.length === 0) break;
      const hasta = Math.max(...filas.map((f) => Number(f._v) || 0));
      const registros = filas
        .filter((f) => t !== 'ajustes' || !AJUSTES_LOCALES.has(String(f.clave)))
        .map((f) => ({ tabla: t, id: idDe(t, f), datos: { ...f, _o: `${dispositivo}:${String(f._v)}` } }));
      if (registros.length > 0) await enviar({ dispositivo, equipo, registros, borrados: [] });
      subidas += registros.length;
      if (t === 'productos') await anotarStockSubido(db, filas);
      const marcas = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
      await guardarAjuste(db, 'nube.marcas', { ...marcas, [t]: Math.max(marcas[t] ?? 0, hasta) });
      desde = hasta;
      if (filas.length < LOTE) break;
    }
  }
  const ultimoBorrado = await leerAjuste<number>(db, 'nube.borrado', 0);
  const borrados = await db.borrados.where('n').above(ultimoBorrado).limit(LOTE).toArray();
  if (borrados.length > 0) {
    await enviar({ dispositivo, equipo, registros: [], borrados: borrados.map((b) => ({ tabla: b.tabla, id: b.id })) });
    await guardarAjuste(db, 'nube.borrado', Math.max(...borrados.map((b) => b.n!)));
    subidas += borrados.length;
  }
  return subidas;
}

/** El stock que se acaba de subir pasa a ser la base: lo que se venda después es la diferencia a mandar. */
async function anotarStockSubido(db: BaseKiosco, filas: Record<string, unknown>[]): Promise<void> {
  await db.transaction('rw', db.productos, async (tx) => {
    marcarRemota(tx); // no cambia la marca: si se vendió algo mientras tanto, igual se sube
    for (const f of filas) {
      if (typeof f.stock === 'number') await db.productos.update(Number(f.id), { _s: f.stock } as never);
    }
  });
}

const redondearStock = (n: number) => Math.round(n * 1000) / 1000;

interface FilaRemota {
  tabla: string;
  id: string;
  datos: Record<string, unknown> | null;
  borrado: boolean;
}

/**
 * Aplica lo que bajó de la nube. Lo que este equipo cambió y todavía no subió
 * se respeta (salvo el stock, que suma lo de los dos). En la primera vez
 * (`migracion`), gana el cambio más nuevo de cada fila.
 */
export async function aplicarRemotas(db: BaseKiosco, filas: FilaRemota[], migracion = false): Promise<number> {
  const marcas = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
  let aplicadas = 0;
  await db.transaction('rw', TABLAS_NUBE.map((t) => db.table(t)), async (tx) => {
    marcarRemota(tx);
    for (const f of filas) {
      if (!(TABLAS_NUBE as readonly string[]).includes(f.tabla)) continue;
      const t = f.tabla as TablaNube;
      if (t === 'ajustes' && AJUSTES_LOCALES.has(f.id)) continue;
      const clave = t === 'ajustes' ? f.id : Number(f.id);
      if (typeof clave === 'number' && !Number.isSafeInteger(clave)) continue;
      const tabla = db.table(t);
      const local = (await tabla.get(clave)) as Record<string, unknown> | undefined;
      const pendiente = local !== undefined && Number(local._v) > (marcas[t] ?? 0);
      const remotaGana = !pendiente || (migracion && Number(f.datos?._v) >= Number(local?._v));
      if (f.borrado || !f.datos) {
        if (local && remotaGana) {
          await tabla.delete(clave);
          aplicadas++;
        }
        continue;
      }
      const { _o, ...datos } = f.datos;
      void _o;
      if (remotaGana) {
        await tabla.put({ ...datos, ...(t === 'productos' && typeof datos.stock === 'number' ? { _s: datos.stock } : {}), _v: 0 });
        aplicadas++;
      } else if (t === 'productos' && typeof datos.stock === 'number' && typeof local!.stock === 'number' && typeof local!._s === 'number') {
        // Lo vendido acá y todavía no subido se suma a lo que dice la nube.
        await tabla.put({ ...local, stock: redondearStock(datos.stock + (local!.stock as number) - (local!._s as number)), _s: datos.stock });
        aplicadas++;
      }
    }
  });
  return aplicadas;
}

// ---------- Conexión con el servidor ----------

export function enviarAlServidor(clave: string, url = '/api/sincronizar'): Enviar {
  return async (lote) => {
    const r = await fetch(`${url}?v=2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': clave },
      body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(await mensajeServidor(r));
  };
}

async function mensajeServidor(r: Response): Promise<string> {
  if (r.status === 401) return 'La clave de la copia en la nube no es correcta.';
  if (r.status === 503) return 'La copia en la nube todavía no está configurada en el servidor.';
  try {
    const cuerpo = (await r.json()) as { error?: string };
    return cuerpo.error ?? `Error ${r.status}`;
  } catch {
    return `Error ${r.status}`;
  }
}

/**
 * Si este equipo todavía no tiene clave, le pide una a la nube. Sólo la
 * consigue la primera caja que se conecta; si ya la tiene otra, no hace nada
 * (en ese caso la clave se escribe a mano en Ajustes).
 */
export async function pedirAlta(db: BaseKiosco, url = '/api/sincronizar'): Promise<boolean> {
  if (await leerAjuste<string>(db, 'nube.clave', '')) return true;
  const r = await fetch(url, { method: 'POST', headers: { 'x-alta': '1' } });
  if (r.status === 409) {
    // La nube ya es de otra caja (o tiene SYNC_CLAVE): hay que escribir la clave a mano.
    await guardarAjuste(db, 'nube.estado', 'sin-activar');
    return false;
  }
  if (r.status === 503) {
    // El servidor no tiene base de datos (o no conecta): se avisa en pantalla en vez de callar.
    await guardarAjuste(db, 'nube.estado', 'sin-servidor');
    return false;
  }
  if (!r.ok) return false;
  const { clave } = (await r.json()) as { clave?: string };
  if (!clave) return false;
  await activarNube(db, clave);
  // La primera caja es la que ya tiene los datos: no hay nada que bajar antes de subir todo.
  await guardarAjuste(db, 'nube.v2', 'subir');
  return true;
}

/** Guarda la clave de la nube en este equipo y limpia los avisos anteriores. */
export async function activarNube(db: BaseKiosco, clave: string, nube?: string): Promise<void> {
  await guardarAjuste(db, 'nube.clave', clave.trim());
  if (nube) await guardarAjuste(db, 'nube.id', nube);
  await guardarAjuste(db, 'nube.estado', null);
  await guardarAjuste(db, 'nube.error', null);
}

export const AVISO_SIN_ACTIVAR = 'Nube sin activar: escribí la clave en Ajustes.';
export const AVISO_SIN_SERVIDOR = 'La nube no responde: lo cargado queda sólo en este equipo.';

export interface EstadoNube {
  /** Este equipo tiene clave y sube sus cambios. */
  activa: boolean;
  /** La nube ya tiene dueño y este equipo no tiene la clave. */
  sinActivar: boolean;
  /** El último error al subir, si lo hubo. */
  error: string | null;
  /** Cambios que todavía no se subieron. */
  pendientes: number;
  /** Cuándo se subió bien por última vez (ms). */
  ultima: number | null;
  /** Texto corto para mostrar, o null si está todo bien. */
  aviso: string | null;
}

/** Cómo está la copia en la nube de este equipo, para mostrarlo en pantalla. */
export async function estadoNube(db: BaseKiosco): Promise<EstadoNube> {
  const [clave, estado, error, ultima, cuantos] = await Promise.all([
    leerAjuste<string>(db, 'nube.clave', ''),
    leerAjuste<string | null>(db, 'nube.estado', null),
    leerAjuste<string | null>(db, 'nube.error', null),
    leerAjuste<number | null>(db, 'nube.ultima', null),
    // Contar pendientes recorre las tablas: sin nube activa no hace falta.
    leerAjuste<string>(db, 'nube.clave', '').then((c) => (c ? pendientes(db) : 0)),
  ]);
  const activa = Boolean(clave);
  const sinActivar = !activa && (estado === 'sin-activar' || estado === 'sin-servidor');
  return {
    activa,
    sinActivar,
    error: activa ? error : null,
    pendientes: cuantos,
    ultima,
    aviso: sinActivar ? (estado === 'sin-servidor' ? AVISO_SIN_SERVIDOR : AVISO_SIN_ACTIVAR) : activa && error ? error : null,
  };
}

let enCurso: Promise<{ subidas: number; bajadas: number } | null> | null = null;

/** Una sola sincronización a la vez, también entre pestañas (si el navegador lo permite). */
function conCerrojo<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks.request('milenio-nube', fn) as Promise<T>) : fn();
}

/**
 * Una vuelta de sincronización con la clave guardada: sube lo de este equipo y
 * baja lo de los otros; anota cómo salió. Si ya hay una en curso, espera esa.
 */
export function sincronizarAhora(db: BaseKiosco, url = '/api/sincronizar'): Promise<{ subidas: number; bajadas: number } | null> {
  enCurso ??= conCerrojo(() => unaVuelta(db, url)).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function unaVuelta(db: BaseKiosco, url: string): Promise<{ subidas: number; bajadas: number } | null> {
  const clave = await leerAjuste<string>(db, 'nube.clave', '');
  if (!clave) return null;
  try {
    await asegurarNumero(db, clave, url);
    const migracion = await leerAjuste<string | boolean>(db, 'nube.v2', false);
    let bajadas = 0;
    if (migracion !== true) {
      // Primera vez con la sincronización entre equipos: se baja lo que ya hay
      // en la nube (gana lo más nuevo de cada fila) y después se sube todo lo propio.
      if (migracion !== 'subir') bajadas += await bajarCambios(db, clave, url, true);
      await adoptarCajasAbiertas(db);
      await guardarAjuste(db, 'nube.marcas', {});
      await guardarAjuste(db, 'nube.borrado', Number((await db.borrados.orderBy('n').last())?.n) || 0);
      await guardarAjuste(db, 'nube.v2', true);
    }
    const subidas = await subirCambios(db, enviarAlServidor(clave, url));
    bajadas += await bajarCambios(db, clave, url);
    await guardarAjuste(db, 'nube.ultima', Date.now());
    await guardarAjuste(db, 'nube.error', null);
    await guardarAjuste(db, 'nube.estado', null);
    return { subidas, bajadas };
  } catch (e) {
    await guardarAjuste(db, 'nube.error', e instanceof Error ? e.message : 'No se pudo sincronizar.');
    throw e;
  }
}

/** Le pide a la nube el número de este equipo (una sola vez) y desde ahí usa ids de su rango. */
async function asegurarNumero(db: BaseKiosco, clave: string, url: string): Promise<number> {
  const actual = await leerAjuste<number | null>(db, 'nube.n', null);
  if (typeof actual === 'number') return actual;
  const dispositivo = await idDispositivo(db);
  const r = await fetch(`${url}?v=2&equipo=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clave': clave },
    body: JSON.stringify({ dispositivo }),
  });
  if (!r.ok) throw new Error(await mensajeServidor(r));
  const { n } = (await r.json()) as { n?: number };
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new Error('La nube no dio un número de equipo.');
  await guardarAjuste(db, 'nube.n', n);
  await fijarRango(db, n);
  return n;
}

/** Las cajas abiertas de antes de tener número pasan a ser de este equipo (la nube ya trajo las que eran de otro). */
async function adoptarCajasAbiertas(db: BaseKiosco): Promise<void> {
  const n = await leerAjuste<number | null>(db, 'nube.n', null);
  if (typeof n !== 'number') return;
  await db.turnos.filter((t) => t.cierre === null && t.equipo === undefined).modify({ equipo: n });
}

/** Baja de la nube todo lo que cambió desde la última vez y lo aplica. Devuelve cuántas filas cambiaron acá. */
export async function bajarCambios(db: BaseKiosco, clave: string, url = '/api/sincronizar', migracion = false): Promise<number> {
  let cursor = await leerAjuste<number>(db, 'nube.cursor', 0);
  let aplicadas = 0;
  for (;;) {
    const r = await fetch(`${url}?v=2&cambios=${cursor}`, { headers: { 'x-clave': clave } });
    if (!r.ok) throw new Error(await mensajeServidor(r));
    const pagina = (await r.json()) as { filas?: FilaRemota[]; hasta?: number; mas?: boolean };
    const filas = Array.isArray(pagina.filas) ? pagina.filas : [];
    if (filas.length > 0) aplicadas += await aplicarRemotas(db, filas, migracion);
    if (typeof pagina.hasta === 'number' && pagina.hasta > cursor) {
      cursor = pagina.hasta;
      await guardarAjuste(db, 'nube.cursor', cursor);
    }
    if (!pagina.mas || filas.length === 0) break;
  }
  return aplicadas;
}

/**
 * Une a la nube un equipo vacío (una compu nueva, el celular) y se trae todo.
 * Devuelve cuántos registros bajó.
 */
export async function recuperarDeLaNube(db: BaseKiosco, clave: string, url = '/api/sincronizar', nube?: string): Promise<number> {
  await activarNube(db, clave, nube);
  try {
    await asegurarNumero(db, clave, url);
  } catch (e) {
    await guardarAjuste(db, 'nube.clave', '');
    throw new ErrorKiosco(e instanceof Error ? e.message : 'No se pudo conectar con la nube.');
  }
  await guardarAjuste(db, 'nube.cursor', 0);
  const total = await bajarCambios(db, clave, url);
  await guardarAjuste(db, 'nube.v2', true);
  return total;
}
