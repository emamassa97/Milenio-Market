import { TABLAS_NUBE, type Ajuste, type BaseKiosco, type TablaNube } from './db';
import { restaurarCopia, type CopiaDeSeguridad } from './copia';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';

// Copia en la nube: la caja trabaja siempre con los datos del equipo y, cuando
// hay internet, sube a la nube (Neon) lo que cambió. Nunca baja datos sola:
// traer datos de la nube es un paso a mano y sólo en un equipo vacío.

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
]);

const LOTE = 400;

export interface Registro {
  tabla: TablaNube | 'borrados';
  id: string;
  datos: unknown;
}

export interface Lote {
  dispositivo: string;
  registros: Registro[];
  borrados: { tabla: string; id: string }[];
}

export type Enviar = (lote: Lote) => Promise<void>;

export async function idDispositivo(db: BaseKiosco): Promise<string> {
  const actual = await leerAjuste<string | null>(db, 'dispositivo', null);
  if (actual) return actual;
  const nuevo = crypto.randomUUID();
  await guardarAjuste(db, 'dispositivo', nuevo);
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
 * no se avanza la marca: lo mismo se vuelve a mandar la próxima vez (en la
 * nube cada fila se reemplaza, así que mandar dos veces no duplica nada).
 * Devuelve cuántas filas subió.
 */
export async function subirCambios(db: BaseKiosco, enviar: Enviar): Promise<number> {
  const dispositivo = await idDispositivo(db);
  let subidas = 0;
  for (const t of TABLAS_NUBE) {
    for (;;) {
      const marcas = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
      const desde = marcas[t] ?? 0;
      const filas = (await db.table(t).where('_v').above(desde).limit(LOTE).toArray()) as Record<string, unknown>[];
      if (filas.length === 0) break;
      const hasta = Math.max(...filas.map((f) => Number(f._v) || 0));
      const registros = filas
        .filter((f) => t !== 'ajustes' || !AJUSTES_LOCALES.has(String(f.clave)))
        .map((f) => ({ tabla: t, id: idDe(t, f), datos: f }));
      if (registros.length > 0) await enviar({ dispositivo, registros, borrados: [] });
      subidas += registros.length;
      await guardarAjuste(db, 'nube.marcas', { ...marcas, [t]: hasta });
      if (filas.length < LOTE) break;
    }
  }
  const ultimoBorrado = await leerAjuste<number>(db, 'nube.borrado', 0);
  const borrados = await db.borrados.where('n').above(ultimoBorrado).limit(LOTE).toArray();
  if (borrados.length > 0) {
    await enviar({ dispositivo, registros: [], borrados: borrados.map((b) => ({ tabla: b.tabla, id: b.id })) });
    await guardarAjuste(db, 'nube.borrado', Math.max(...borrados.map((b) => b.n!)));
    subidas += borrados.length;
  }
  return subidas;
}

// ---------- Conexión con el servidor ----------

export function enviarAlServidor(clave: string, url = '/api/sincronizar'): Enviar {
  return async (lote) => {
    const r = await fetch(url, {
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
  if (!r.ok) return false;
  const { clave } = (await r.json()) as { clave?: string };
  if (!clave) return false;
  await activarNube(db, clave);
  return true;
}

/** Guarda la clave de la nube en este equipo y limpia los avisos anteriores. */
export async function activarNube(db: BaseKiosco, clave: string): Promise<void> {
  await guardarAjuste(db, 'nube.clave', clave.trim());
  await guardarAjuste(db, 'nube.estado', null);
  await guardarAjuste(db, 'nube.error', null);
}

export const AVISO_SIN_ACTIVAR = 'Nube sin activar: escribí la clave en Ajustes.';

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
    pendientes(db),
  ]);
  const activa = Boolean(clave);
  const sinActivar = !activa && estado === 'sin-activar';
  return {
    activa,
    sinActivar,
    error: activa ? error : null,
    pendientes: cuantos,
    ultima,
    aviso: sinActivar ? AVISO_SIN_ACTIVAR : activa && error ? error : null,
  };
}

let enCurso: Promise<{ subidas: number } | null> | null = null;

/**
 * Una vuelta de sincronización con la clave guardada; anota cómo salió.
 * Si ya hay una en curso, espera esa en vez de arrancar otra.
 */
export function sincronizarAhora(db: BaseKiosco): Promise<{ subidas: number } | null> {
  enCurso ??= unaVuelta(db).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function unaVuelta(db: BaseKiosco): Promise<{ subidas: number } | null> {
  const clave = await leerAjuste<string>(db, 'nube.clave', '');
  if (!clave) return null;
  try {
    const subidas = await subirCambios(db, enviarAlServidor(clave));
    await guardarAjuste(db, 'nube.ultima', Date.now());
    await guardarAjuste(db, 'nube.error', null);
    await guardarAjuste(db, 'nube.estado', null);
    return { subidas };
  } catch (e) {
    await guardarAjuste(db, 'nube.error', e instanceof Error ? e.message : 'No se pudo subir.');
    throw e;
  }
}

interface RespuestaDescarga {
  dispositivo: string;
  registros: { tabla: string; id: string; datos: unknown }[];
  siguiente: string | null;
}

/** Un equipo que subió datos a la nube. */
export interface EquipoNube {
  dispositivo: string;
  /** Cuántos registros (no borrados) tiene guardados. */
  registros: number;
  /** Cuándo subió por última vez (ms). */
  ultima: number | null;
}

/** Los equipos que tienen datos en la nube, el más reciente primero. */
export async function listarEquipos(clave: string, url = '/api/sincronizar'): Promise<EquipoNube[]> {
  const r = await fetch(`${url}?equipos=1`, { headers: { 'x-clave': clave } });
  if (!r.ok) throw new ErrorKiosco(await mensajeServidor(r));
  const { equipos } = (await r.json()) as { equipos?: EquipoNube[] };
  return Array.isArray(equipos) ? equipos : [];
}

/**
 * Trae la copia de la nube a un equipo vacío (por ejemplo, una compu nueva).
 * Sin `dispositivo`, toma el equipo que subió datos más recientemente; con
 * él (ver `listarEquipos`), ese equipo.
 */
export async function recuperarDeLaNube(
  db: BaseKiosco,
  clave: string,
  dispositivo?: string,
  url = '/api/sincronizar',
): Promise<number> {
  const tablas = Object.fromEntries(TABLAS_NUBE.map((t) => [t, [] as unknown[]])) as Record<TablaNube, unknown[]>;
  let cursor: string | null = '';
  let elegido = dispositivo ?? '';
  let total = 0;
  while (cursor !== null) {
    // Desde la segunda página se pide siempre el mismo equipo, aunque otro suba datos mientras tanto.
    const filtro = elegido ? `&dispositivo=${encodeURIComponent(elegido)}` : '';
    const r = await fetch(`${url}?desde=${encodeURIComponent(cursor)}${filtro}`, { headers: { 'x-clave': clave } });
    if (!r.ok) throw new ErrorKiosco(await mensajeServidor(r));
    const pagina = (await r.json()) as RespuestaDescarga;
    elegido = pagina.dispositivo;
    if (!elegido) break;
    for (const reg of pagina.registros) {
      if ((TABLAS_NUBE as readonly string[]).includes(reg.tabla) && reg.datos) {
        tablas[reg.tabla as TablaNube].push(reg.datos);
        total++;
      }
    }
    cursor = pagina.siguiente;
  }
  if (!elegido || total === 0) throw new ErrorKiosco('La nube no tiene datos para recuperar.');
  const copia: CopiaDeSeguridad = { app: 'milenio-market', formato: 1, fecha: new Date().toISOString(), tablas };
  await restaurarCopia(db, copia);
  // Este equipo sigue la copia del que se recuperó, y no vuelve a subir lo que bajó.
  const marcas: Record<string, number> = {};
  for (const t of TABLAS_NUBE) {
    const ultima = await db.table(t).orderBy('_v').last();
    marcas[t] = Number(ultima?._v) || 0;
  }
  await guardarAjuste(db, 'dispositivo', elegido);
  await activarNube(db, clave);
  await guardarAjuste(db, 'nube.marcas', marcas);
  return total;
}
