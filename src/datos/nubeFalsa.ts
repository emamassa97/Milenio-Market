// La nube para las pruebas: el manejador real de servidor/sincronizar.ts sobre un Postgres de verdad
// (PGlite, Postgres compilado a WebAssembly, en memoria). Así las pruebas corren el mismo SQL que Vercel.
import { PGlite } from '@electric-sql/pglite';
import { manejar, type Consulta } from '../../servidor/sincronizar';

export interface FilaV2 { tabla: string; id: string; datos: any; borrado: boolean; equipo: number; seq: number }

let base: PGlite | null = null;

/** Una sola base por archivo de pruebas (arrancarla tarda); cada nube nueva la deja vacía. */
async function baseVacia(): Promise<PGlite> {
  base ??= new PGlite();
  await base.exec('drop schema public cascade; create schema public;');
  return base;
}

export async function crearNube() {
  const pg = await baseVacia();
  // Una función nueva por nube: el servidor crea las tablas una vez por cada una.
  const consulta: Consulta = async (texto, parametros) => (await pg.query<Record<string, unknown>>(texto, parametros)).rows;
  const fetchFalso = async (url: string | URL | Request, init?: RequestInit) =>
    manejar(new Request(new URL(String(url), 'http://kiosco.test'), init), { consulta, clave: undefined });
  /** Lo que quedó guardado en la nube (tabla filas). */
  const filas = async (): Promise<FilaV2[]> =>
    (await consulta(`select tabla, id, datos, borrado, equipo, seq from filas order by seq`, [])).map((f) => ({
      ...(f as unknown as FilaV2),
      seq: Number(f.seq),
    }));
  return { consulta, fetchFalso, filas, pg };
}
