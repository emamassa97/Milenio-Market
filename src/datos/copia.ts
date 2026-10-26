import type { BaseKiosco } from './db';
import { ErrorKiosco } from './operaciones';

const TABLAS = ['productos', 'ventas', 'turnos', 'movimientosCaja', 'clientes', 'movimientosFiado', 'ajustes'] as const;
type NombreTabla = (typeof TABLAS)[number];

export interface CopiaDeSeguridad {
  app: 'milenio-market';
  formato: 1;
  fecha: string;
  tablas: Record<NombreTabla, unknown[]>;
}

/** Todo lo guardado, tal cual, incluidos campos que esta versión no conozca. */
export async function exportarTodo(db: BaseKiosco): Promise<CopiaDeSeguridad> {
  const tablas = {} as Record<NombreTabla, unknown[]>;
  await db.transaction('r', TABLAS.map((t) => db.table(t)), async () => {
    for (const t of TABLAS) tablas[t] = await db.table(t).toArray();
  });
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
      const filas = tablas[t];
      if (Array.isArray(filas) && filas.length > 0) await db.table(t).bulkPut(filas);
    }
  });
}
