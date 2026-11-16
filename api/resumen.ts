// Con .js: Vercel corre la función como módulo ES de Node, que no adivina la extensión.
import { neon } from '@neondatabase/serverless';
import type { Consulta } from '../servidor/sincronizar.js';
import { estadoResumen, recibirResumen, tareaNocturna, type DependenciasResumen } from '../servidor/resumen.js';

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
const deps: DependenciasResumen = { consulta, clave: process.env.SYNC_CLAVE, secretoCron: process.env.CRON_SECRET };

export const POST = (pedido: Request) => recibirResumen(pedido, deps);
export const GET = (pedido: Request) => (new URL(pedido.url).searchParams.get('estado') === '1' ? estadoResumen(deps) : tareaNocturna(pedido, deps));
