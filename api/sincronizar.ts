import { neon } from '@neondatabase/serverless';
import { manejar, type Consulta } from '../servidor/sincronizar';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const sql = url ? neon(url) : null;
const consulta: Consulta | null = sql ? (texto, parametros) => sql.query(texto, parametros) as Promise<Record<string, unknown>[]> : null;

const atender = (pedido: Request) => manejar(pedido, { consulta, clave: process.env.SYNC_CLAVE });

export const GET = atender;
export const POST = atender;
