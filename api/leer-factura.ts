// Con .js: Vercel corre la función como módulo ES de Node, que no adivina la extensión.
import { neon } from '@neondatabase/serverless';
import type { Consulta } from '../servidor/sincronizar.js';
import { estadoFactura, leerFactura, type DependenciasFactura } from '../servidor/factura.js';

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

/** Dentro de Vercel el token OIDC del proyecto llega en cada pedido; si se cargó una clave del AI Gateway, gana ésa. */
function dependencias(pedido: Request): DependenciasFactura {
  const token = process.env.AI_GATEWAY_API_KEY || pedido.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || undefined;
  return { consulta, clave: process.env.SYNC_CLAVE, token };
}

export const POST = (pedido: Request) => leerFactura(pedido, dependencias(pedido));
export const GET = (pedido: Request) => estadoFactura(dependencias(pedido));
