import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

// Recibe la copia de la caja y la guarda en Postgres (Neon).
// Una fila por registro de la caja: (equipo, tabla, id) -> datos.
// Volver a mandar lo mismo reemplaza la fila, nunca duplica.
// La clave: si existe SYNC_CLAVE se usa esa; si no, la primera caja que se
// conecta pide el alta y el servidor genera una clave al azar, la guarda y se
// la da sólo a ella. Después de eso nadie más puede pedir el alta.
// Ingreso: los usuarios viajan en la copia (ajuste 'usuarios', con la clave
// hasheada), así que el mismo usuario puede entrar desde cualquier equipo:
// el servidor controla la clave y le da al equipo la clave de la nube.

export type Consulta = (texto: string, parametros: unknown[]) => Promise<Record<string, unknown>[]>;

export interface Dependencias {
  consulta: Consulta | null;
  /** Clave fija opcional (SYNC_CLAVE). Sin ella se usa la generada en el alta. */
  clave: string | undefined;
}

/**
 * Tablas que acepta la nube. Es la misma lista que TABLAS_NUBE de
 * src/datos/db.ts (acá no se puede importar Dexie); un test controla que
 * coincidan.
 */
export const TABLAS_SERVIDOR = ['productos', 'ventas', 'turnos', 'movimientosCaja', 'clientes', 'movimientosFiado', 'ajustes', 'eventos'] as const;
const TABLAS = new Set<string>(TABLAS_SERVIDOR);
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

const CREAR_CONFIG = `create table if not exists config_nube (
  nombre text primary key,
  valor text not null
)`;

const CREAR_INTENTOS = `create table if not exists intentos_ingreso (
  usuario text primary key,
  fallos integer not null default 0,
  hasta timestamptz
)`;

/** Con 5 claves mal seguidas, ese usuario queda bloqueado 15 minutos (una clave de 4 cifras no se puede probar entera). */
const FALLOS_MAXIMOS = 5;
const MINUTOS_BLOQUEO = 15;
/** Igual que ITERACIONES en src/datos/usuarios.ts: si cambia allá, cambia acá. */
const ITERACIONES = 120_000;

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

/** Fecha de Postgres (Date o texto) a milisegundos; null si no se entiende. */
function aMilisegundos(v: unknown): number | null {
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

let tablasCreadas = false;

interface UsuarioGuardado {
  usuario: string;
  admin?: boolean;
  sal: string;
  hash: string;
}

/** La lista de usuarios más nueva de la nube (cada equipo sube la suya) y el equipo que subió datos más recientemente. */
async function usuariosDeLaNube(consulta: Consulta): Promise<UsuarioGuardado[]> {
  const filas = await consulta(
    `select datos from registros where tabla = 'ajustes' and id = 'usuarios' and not borrado
     order by coalesce((datos->>'_v')::numeric, 0) desc, actualizado desc limit 1`,
    [],
  );
  const valor = (filas[0]?.datos as { valor?: unknown } | undefined)?.valor;
  return Array.isArray(valor) ? (valor as UsuarioGuardado[]).filter((u) => u && typeof u.usuario === 'string' && typeof u.sal === 'string' && typeof u.hash === 'string') : [];
}

function claveDelUsuario(clave: string, u: UsuarioGuardado): boolean {
  if (!/^[0-9a-f]+$/.test(u.sal) || !/^[0-9a-f]{64}$/.test(u.hash)) return false;
  const calculado = pbkdf2Sync(clave, Buffer.from(u.sal, 'hex'), ITERACIONES, 32, 'sha256');
  return timingSafeEqual(calculado, Buffer.from(u.hash, 'hex'));
}

async function ingresar(pedido: Request, consulta: Consulta, esperada: string | undefined): Promise<Response> {
  let cuerpo: { usuario?: unknown; clave?: unknown };
  try {
    cuerpo = (await pedido.json()) as typeof cuerpo;
  } catch {
    return json({ error: 'El pedido no es JSON.' }, 400);
  }
  if (!esTexto(cuerpo.usuario, 60) || !esTexto(cuerpo.clave, 200)) return json({ error: 'Usuario o clave incorrectos.' }, 401);
  const usuario = cuerpo.usuario.trim().toLowerCase();
  const bloqueo = await consulta(`select 1 from intentos_ingreso where usuario = $1 and hasta > now()`, [usuario]);
  if (bloqueo.length > 0) return json({ error: `Demasiadas claves mal seguidas: probá de nuevo en ${MINUTOS_BLOQUEO} minutos.` }, 429);
  const usuarios = await usuariosDeLaNube(consulta);
  const u = usuarios.find((x) => x.usuario === usuario);
  if (!esperada || !u || !claveDelUsuario(cuerpo.clave, u)) {
    await consulta(
      `insert into intentos_ingreso (usuario, fallos, hasta) values ($1, 1, null)
       on conflict (usuario) do update set
         fallos = case when intentos_ingreso.fallos + 1 >= $2 then 0 else intentos_ingreso.fallos + 1 end,
         hasta = case when intentos_ingreso.fallos + 1 >= $2 then now() + make_interval(mins => $3) else intentos_ingreso.hasta end`,
      [usuario, FALLOS_MAXIMOS, MINUTOS_BLOQUEO],
    );
    // Sin usuarios en la nube, el equipo prueba con los suyos: no es un error de clave.
    return json({ error: 'Usuario o clave incorrectos.', sinUsuarios: usuarios.length === 0 }, 401);
  }
  await consulta(`delete from intentos_ingreso where usuario = $1`, [usuario]);
  const ultimo = await consulta(`select dispositivo from registros group by dispositivo order by max(actualizado) desc limit 1`, []);
  return json({ clave: esperada, usuarios, dispositivo: (ultimo[0]?.dispositivo as string | undefined) ?? '' });
}

async function claveGuardada(consulta: Consulta): Promise<string | undefined> {
  const filas = await consulta(`select valor from config_nube where nombre = 'clave'`, []);
  return filas[0]?.valor as string | undefined;
}

/** La primera caja que se conecta recibe una clave nueva; las demás, 409. */
async function darDeAlta(consulta: Consulta, claveFija: string | undefined): Promise<Response> {
  if (claveFija) return json({ error: 'La nube ya tiene clave.' }, 409);
  const nueva = randomBytes(18).toString('base64url');
  const filas = await consulta(
    `insert into config_nube (nombre, valor) values ('clave', $1) on conflict (nombre) do nothing returning valor`,
    [nueva],
  );
  if (filas.length === 0) return json({ error: 'La nube ya tiene clave.' }, 409);
  return json({ clave: nueva });
}

export async function manejar(pedido: Request, deps: Dependencias): Promise<Response> {
  if (!deps.consulta) return json({ error: 'La copia en la nube no está configurada.' }, 503);
  const consulta = deps.consulta;
  if (!tablasCreadas) {
    await consulta(CREAR_TABLA, []);
    await consulta(CREAR_CONFIG, []);
    await consulta(CREAR_INTENTOS, []);
    tablasCreadas = true;
  }
  if (pedido.method === 'POST' && pedido.headers.get('x-alta') === '1') return darDeAlta(consulta, deps.clave);
  const esperada = deps.clave || (await claveGuardada(consulta));
  if (pedido.method === 'POST' && pedido.headers.get('x-ingreso') === '1') return ingresar(pedido, consulta, esperada);
  // ?usuarios=1: si ya hay usuarios en la nube (un equipo nuevo pide ingresar en vez de crear el dueño).
  if (pedido.method === 'GET' && new URL(pedido.url).searchParams.get('usuarios') === '1') {
    return json({ hay: (await usuariosDeLaNube(consulta)).length > 0 });
  }
  if (!esperada || !claveCorrecta(pedido.headers.get('x-clave'), esperada)) return json({ error: 'Clave incorrecta.' }, 401);

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
    const parametros = new URL(pedido.url).searchParams;
    // ?equipos=1: qué equipos subieron datos, para elegir cuál recuperar.
    if (parametros.get('equipos') === '1') {
      const filas = await consulta(
        `select dispositivo, count(*) filter (where not borrado) as registros, max(actualizado) as ultima
         from registros group by dispositivo order by max(actualizado) desc`,
        [],
      );
      return json({
        equipos: filas.map((f) => ({
          dispositivo: String(f.dispositivo),
          registros: Number(f.registros) || 0,
          ultima: aMilisegundos(f.ultima),
        })),
      });
    }
    // ?dispositivo=X elige el equipo; sin él, el que subió datos más recientemente.
    let dispositivo: string | undefined;
    const elegido = parametros.get('dispositivo');
    if (elegido !== null) {
      if (!esTexto(elegido, 100)) return json({ error: 'El equipo no es válido.' }, 400);
      dispositivo = elegido;
    } else {
      const ultimo = await consulta(
        `select dispositivo from registros group by dispositivo order by max(actualizado) desc limit 1`,
        [],
      );
      dispositivo = ultimo[0]?.dispositivo as string | undefined;
    }
    if (!dispositivo) return json({ dispositivo: '', registros: [], siguiente: null });
    const desde = parametros.get('desde') ?? '';
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
