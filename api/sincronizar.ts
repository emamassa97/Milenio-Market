import { neon } from '@neondatabase/serverless';
import { manejar, type Consulta } from '../servidor/sincronizar';

/** La base de Neon. Vercel la deja en DATABASE_URL, pero si se conectó con un prefijo (MI_DATABASE_URL) se busca cualquier variable con una dirección de Postgres. */
function urlDeLaBase(): string | undefined {
  const fija = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (fija) return fija;
  const candidatas = Object.entries(process.env)
    .filter(([nombre, valor]) => /^postgres(ql)?:\/\//.test(valor ?? '') && !/UNPOOLED|NON_POOLING/.test(nombre))
    .sort(([a], [b]) => Number(b.endsWith('DATABASE_URL')) - Number(a.endsWith('DATABASE_URL')));
  return candidatas[0]?.[1];
}

const url = urlDeLaBase();
const sql = url ? neon(url) : null;
const consulta: Consulta | null = sql ? (texto, parametros) => sql.query(texto, parametros) as Promise<Record<string, unknown>[]> : null;

const atender = (pedido: Request) => manejar(pedido, { consulta, clave: process.env.SYNC_CLAVE });

export const GET = atender;
export const POST = atender;
