import { createHash, timingSafeEqual } from 'node:crypto';

// Recibe la copia de la caja y la guarda en Postgres (Neon).
// Una fila por registro de la caja: (equipo, tabla, id) -> datos.
// Volver a mandar lo mismo reemplaza la fila, nunca duplica.

export type Consulta = (texto: string, parametros: unknown[]) => Promise<Record<string, unknown>[]>;

export interface Dependencias {
  consulta: Consulta | null;
  clave: string | undefined;
}

const TABLAS = new Set(['productos', 'ventas', 'turnos', 'movimientosCaja', 'clientes', 'movimientosFiado', 'ajustes']);
const MAX_REGISTROS = 1000;
const PAGINA = 1000;

const CREAR_TABLA = `create table if not exists registros (
  dispositivo text not null,
  tabla text not null,
  id text not null,
  datos jsonb,
  borrado boolean not null default false,
  actualizado timestamptz not null default now(),
  primary key (dispositivo, tabla, id)
)`;

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
}

function claveCorrecta(recibida: string | null, esperada: string): boolean {
  if (!recibida) return false;
  const a = createHash('sha256').update(recibida).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

const esTexto = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

let tablaCreada = false;

export async function manejar(pedido: Request, deps: Dependencias): Promise<Response> {
  if (!deps.consulta || !deps.clave) return json({ error: 'La copia en la nube no está configurada.' }, 503);
  if (!claveCorrecta(pedido.headers.get('x-clave'), deps.clave)) return json({ error: 'Clave incorrecta.' }, 401);
  const consulta = deps.consulta;
  if (!tablaCreada) {
    await consulta(CREAR_TABLA, []);
    tablaCreada = true;
  }

  if (pedido.method === 'POST') {
    let cuerpo: { dispositivo?: unknown; registros?: unknown; borrados?: unknown };
    try {
      cuerpo = (await pedido.json()) as typeof cuerpo;
    } catch {
      return json({ error: 'El pedido no es JSON.' }, 400);
    }
    const { dispositivo } = cuerpo;
    const registros = Array.isArray(cuerpo.registros) ? cuerpo.registros : [];
    const borrados = Array.isArray(cuerpo.borrados) ? cuerpo.borrados : [];
    if (!esTexto(dispositivo, 100)) return json({ error: 'Falta el equipo.' }, 400);
    if (registros.length + borrados.length > MAX_REGISTROS) return json({ error: 'Demasiados registros juntos.' }, 413);
    for (const r of [...registros, ...borrados] as Record<string, unknown>[]) {
      if (!r || !esTexto(r.tabla, 40) || !TABLAS.has(r.tabla) || !esTexto(r.id, 200)) {
        return json({ error: 'Hay un registro con tabla o id no válidos.' }, 400);
      }
    }
    if (registros.length > 0) {
      await consulta(
        `insert into registros (dispositivo, tabla, id, datos, borrado, actualizado)
         select $1, r->>'tabla', r->>'id', r->'datos', false, now() from jsonb_array_elements($2::jsonb) r
         on conflict (dispositivo, tabla, id) do update set datos = excluded.datos, borrado = false, actualizado = now()`,
        [dispositivo, JSON.stringify(registros)],
      );
    }
    if (borrados.length > 0) {
      await consulta(
        `update registros set borrado = true, actualizado = now()
         where dispositivo = $1 and (tabla, id) in (select r->>'tabla', r->>'id' from jsonb_array_elements($2::jsonb) r)`,
        [dispositivo, JSON.stringify(borrados)],
      );
    }
    return json({ ok: true, guardados: registros.length, borrados: borrados.length });
  }

  if (pedido.method === 'GET') {
    const ultimo = await consulta(
      `select dispositivo from registros group by dispositivo order by max(actualizado) desc limit 1`,
      [],
    );
    const dispositivo = ultimo[0]?.dispositivo as string | undefined;
    if (!dispositivo) return json({ dispositivo: '', registros: [], siguiente: null });
    const desde = new URL(pedido.url).searchParams.get('desde') ?? '';
    const [tabla = '', id = ''] = desde ? desde.split('|') : [];
    const filas = await consulta(
      `select tabla, id, datos from registros
       where dispositivo = $1 and borrado = false and (tabla, id) > ($2, $3)
       order by tabla, id limit ${PAGINA}`,
      [dispositivo, tabla, id],
    );
    const ultimaFila = filas[filas.length - 1];
    return json({
      dispositivo,
      registros: filas,
      siguiente: filas.length === PAGINA && ultimaFila ? `${ultimaFila.tabla}|${ultimaFila.id}` : null,
    });
  }

  return json({ error: 'Método no permitido.' }, 405);
}
