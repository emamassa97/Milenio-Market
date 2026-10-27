import Dexie, { type Table } from 'dexie';
import type { Cliente, Evento, MovimientoCaja, MovimientoFiado, Producto, Turno, Venta } from '../dominio/tipos';

export interface Ajuste {
  clave: string;
  valor: unknown;
}

/** Registro de algo borrado, para borrarlo también en la copia de la nube. */
export interface Borrado {
  n?: number;
  tabla: string;
  id: string;
  fecha: number;
}

/** Tablas que se copian a la nube. Cada fila lleva `_v`: cuándo cambió por última vez. */
export const TABLAS_NUBE = ['productos', 'ventas', 'turnos', 'movimientosCaja', 'clientes', 'movimientosFiado', 'ajustes', 'eventos'] as const;
export type TablaNube = (typeof TABLAS_NUBE)[number];

let ultimaMarca = 0;

/**
 * Un número que siempre crece, aunque se guarden muchas filas en el mismo
 * milisegundo o el reloj de la PC esté atrasado: nunca es menor que la última
 * marca usada (ni que las guardadas en la base, ver `marcaMasAlta`).
 */
export function nuevaMarca(): number {
  ultimaMarca = Math.max(Date.now(), ultimaMarca + 1);
  return ultimaMarca;
}

/** La marca más alta ya usada en la base: filas guardadas y marcas de lo subido. */
async function marcaMasAlta(db: Dexie): Promise<number> {
  let max = 0;
  for (const t of TABLAS_NUBE) {
    const ultima = (await db.table(t).orderBy('_v').last()) as { _v?: unknown } | undefined;
    max = Math.max(max, Number(ultima?._v) || 0);
  }
  // Lo subido puede haberse borrado después: su marca igual cuenta.
  const marcas = (await db.table('ajustes').get('nube.marcas')) as Ajuste | undefined;
  if (marcas && typeof marcas.valor === 'object' && marcas.valor !== null) {
    for (const v of Object.values(marcas.valor as Record<string, unknown>)) max = Math.max(max, Number(v) || 0);
  }
  return max;
}

// ---------- Ids por equipo ----------
// La nube le da a cada equipo un número n; sus filas nuevas usan ids entre
// n·1e9 y (n+1)·1e9. Así las ventas de la PC y las del celular nunca chocan,
// y las referencias (ventaId, turnoId…) siguen siendo números. Las filas de
// antes de tener número quedan con sus ids chicos.

export const RANGO = 1e9;
const rangos = new Map<string, { base: number; ultimo: Map<string, number> }>();

/** Ids de cada tabla también entre pestañas: la última usada se anota en localStorage. */
function anotado(llave: string): number {
  try {
    return Number(globalThis.localStorage?.getItem(llave)) || 0;
  } catch {
    return 0;
  }
}
function anotar(llave: string, id: number): void {
  try {
    globalThis.localStorage?.setItem(llave, String(id));
  } catch {
    // Sin localStorage alcanza con el contador de esta pestaña.
  }
}

function proximoId(base: string, tabla: string): number | undefined {
  const r = rangos.get(base);
  if (!r) return undefined;
  const llave = `milenio.id.${base}.${tabla}`;
  // Lo anotado por otra pestaña vale sólo si es de este mismo rango (el equipo pudo cambiar de número).
  const otra = anotado(llave);
  const previo = Math.max(r.ultimo.get(tabla) ?? r.base, otra >= r.base && otra < r.base + RANGO ? otra : 0, r.base);
  const id = previo >= r.base + RANGO - 1 ? undefined : previo + 1;
  if (id === undefined) return undefined;
  r.ultimo.set(tabla, id);
  anotar(llave, id);
  return id;
}

/** Desde ahora, las filas nuevas de este equipo usan el rango del equipo n. */
export async function fijarRango(db: BaseKiosco, n: number): Promise<void> {
  const base = n * RANGO;
  const ultimo = new Map<string, number>();
  for (const t of TABLAS_NUBE) {
    if (t === 'ajustes') continue;
    const fila = (await db.table(t).where(':id').between(base, base + RANGO).last()) as { id?: number } | undefined;
    ultimo.set(t, Number(fila?.id) || base);
  }
  rangos.set(db.name, { base, ultimo });
}

/** El equipo se pasa a otra nube: hasta que le den un número nuevo, las filas nuevas usan ids comunes. */
export function olvidarRango(db: Dexie): void {
  rangos.delete(db.name);
}

/** Número de este equipo en la nube (null: todavía no tiene). */
export function equipoDe(db: Dexie): number | null {
  const r = rangos.get(db.name);
  return r ? r.base / RANGO : null;
}

/** Número de venta para mostrar: "2-15" para la venta 15 del equipo 2. */
export function numeroVisible(id: number | undefined): string {
  if (id === undefined) return '';
  return id >= RANGO ? `${Math.floor(id / RANGO)}-${id % RANGO}` : String(id);
}

/** Transacción que aplica lo que bajó de la nube: no marca nada para volver a subir. */
const REMOTA = Symbol('remota');
export function marcarRemota(tx: unknown): void {
  (tx as Record<symbol, boolean>)[REMOTA] = true;
}
function esRemota(tx: unknown): boolean {
  let t = tx as { parent?: unknown } | undefined;
  while (t) {
    if ((t as Record<symbol, boolean>)[REMOTA]) return true;
    t = t.parent as { parent?: unknown } | undefined;
  }
  return false;
}

/**
 * Base de datos del equipo (IndexedDB). Funciona sin internet.
 * Para cambiar la forma de los datos se agrega un `version(n+1)` nuevo;
 * nunca se modifica uno ya publicado.
 */
export class BaseKiosco extends Dexie {
  productos!: Table<Producto, number>;
  ventas!: Table<Venta, number>;
  turnos!: Table<Turno, number>;
  movimientosCaja!: Table<MovimientoCaja, number>;
  clientes!: Table<Cliente, number>;
  movimientosFiado!: Table<MovimientoFiado, number>;
  ajustes!: Table<Ajuste, string>;
  borrados!: Table<Borrado, number>;
  eventos!: Table<Evento, number>;

  constructor(nombre = 'milenio-market') {
    super(nombre);
    this.version(1).stores({
      productos: '++id, codigo, nombre, categoria',
      ventas: '++id, fecha, turnoId, clienteId',
      turnos: '++id, apertura',
      movimientosCaja: '++id, turnoId',
      clientes: '++id, nombre',
      movimientosFiado: '++id, clienteId, turnoId, ventaId',
      ajustes: 'clave',
    });
    // Versión 2: copia en la nube. Cada fila suma `_v` (marca de cambio) y se
    // anotan los borrados. No cambia ningún dato ya cargado.
    this.version(2)
      .stores({
        productos: '++id, codigo, nombre, categoria, _v',
        ventas: '++id, fecha, turnoId, clienteId, _v',
        turnos: '++id, apertura, _v',
        movimientosCaja: '++id, turnoId, _v',
        clientes: '++id, nombre, _v',
        movimientosFiado: '++id, clienteId, turnoId, ventaId, _v',
        ajustes: 'clave, _v',
        borrados: '++n',
      })
      .upgrade(async (tx) => {
        let n = 0;
        for (const t of TABLAS_NUBE) {
          if (t === 'eventos') continue; // recién existe en la versión 3
          await tx
            .table(t)
            .toCollection()
            .modify((fila: Record<string, unknown>) => {
              fila._v = ++n;
            });
        }
      });
    // Versión 3: eventos de la caja (ventas canceladas antes de cobrar) para que el dueño los vea.
    this.version(3).stores({ eventos: '++id, fecha, tipo, _v' });
    for (const t of TABLAS_NUBE) {
      const tabla = this.table(t);
      tabla.hook('creating', (clave, fila: Record<string, unknown>, tx) => {
        // Lo que baja de la nube trae su propia marca (0: no se vuelve a subir).
        if (esRemota(tx)) return undefined;
        fila._v = nuevaMarca();
        // Con número de equipo, cada fila nueva lleva un id de su rango: dos equipos nunca usan el mismo.
        if (clave === undefined && t !== 'ajustes') {
          const id = proximoId(this.name, t);
          if (id !== undefined) fila.id = id;
        }
        return undefined;
      });
      tabla.hook('updating', (_cambios, _clave, _fila, tx) => (esRemota(tx) ? undefined : { _v: nuevaMarca() }));
    }
    // Al abrir, el contador arranca desde la marca más alta guardada. Sin esto,
    // con el reloj atrasado (o al recargar la página) los cambios nuevos
    // quedarían con marcas más viejas que lo ya subido y no se subirían nunca.
    // (Los borrados no usan marca: su `n` lo numera IndexedDB y siempre crece.)
    this.on('ready', async (base) => {
      ultimaMarca = Math.max(ultimaMarca, await marcaMasAlta(base as Dexie));
      const n = (await (base as Dexie).table('ajustes').get('nube.n')) as Ajuste | undefined;
      if (typeof n?.valor === 'number') await fijarRango(base as BaseKiosco, n.valor);
    });
  }
}

export const db = new BaseKiosco();
