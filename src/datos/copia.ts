import { TABLAS_NUBE as TABLAS, type Ajuste, type BaseKiosco, type TablaNube as NombreTabla } from './db';
import { AJUSTES_LOCALES } from './nube';
import { ErrorKiosco } from './operaciones';

/** Saca los ajustes propios del equipo (clave de la nube, marcas, id del equipo). */
const sinAjustesLocales = (filas: unknown[]) => filas.filter((f) => !AJUSTES_LOCALES.has(String((f as Partial<Ajuste> | null)?.clave)));

export interface CopiaDeSeguridad {
  app: 'milenio-market';
  formato: 1;
  fecha: string;
  tablas: Record<NombreTabla, unknown[]>;
}

/**
 * Todo lo guardado, tal cual, incluidos campos que esta versión no conozca.
 * No incluye los ajustes propios del equipo: la copia se puede mandar o
 * guardar en cualquier lado sin llevarse la clave de la nube.
 */
export async function exportarTodo(db: BaseKiosco): Promise<CopiaDeSeguridad> {
  const tablas = {} as Record<NombreTabla, unknown[]>;
  await db.transaction('r', TABLAS.map((t) => db.table(t)), async () => {
    for (const t of TABLAS) tablas[t] = await db.table(t).toArray();
  });
  tablas.ajustes = sinAjustesLocales(tablas.ajustes);
  return { app: 'milenio-market', formato: 1, fecha: new Date().toISOString(), tablas };
}

export async function estaVacia(db: BaseKiosco): Promise<boolean> {
  const cuentas = await Promise.all(
    TABLAS.filter((t) => t !== 'ajustes').map((t) => db.table(t).count()),
  );
  return cuentas.every((c) => c === 0);
}

/**
 * Restaura una copia. Para no pisar nada, sólo se permite en un equipo
 * sin datos (por ejemplo, una compu nueva).
 */
export async function restaurarCopia(db: BaseKiosco, copia: unknown): Promise<void> {
  const c = copia as Partial<CopiaDeSeguridad> | null;
  if (!c || c.app !== 'milenio-market' || typeof c.tablas !== 'object' || c.tablas === null) {
    throw new ErrorKiosco('Ese archivo no es una copia de Milenio Market.');
  }
  if (c.formato !== 1) throw new ErrorKiosco('La copia es de una versión más nueva: actualizá el sistema primero.');
  const tablas = c.tablas;
  await db.transaction('rw', TABLAS.map((t) => db.table(t)), async () => {
    if (!(await estaVacia(db))) {
      throw new ErrorKiosco('Este equipo ya tiene datos. La copia sólo se puede restaurar en un equipo vacío.');
    }
    for (const t of TABLAS) {
      const crudas = tablas[t];
      if (!Array.isArray(crudas)) continue;
      // Una copia vieja puede traer la clave y las marcas de otro equipo: no se pisan las de éste.
      const filas = t === 'ajustes' ? sinAjustesLocales(crudas) : crudas;
      if (filas.length > 0) await db.table(t).bulkPut(filas);
    }
  });
}
