import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

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

// Versión 2 (sincronización entre equipos): una sola copia por (tabla, id), sin
// separar por equipo, y un número de cambio global (seq) para que cada equipo
// baje sólo lo que cambió desde la última vez.
const CREAR_SECUENCIA = `create sequence if not exists filas_cambios`;
const CREAR_FILAS = `create table if not exists filas (
  tabla text not null,
  id text not null,
  datos jsonb,
  borrado boolean not null default false,
  equipo integer,
  seq bigint not null default nextval('filas_cambios'),
  tx xid8 not null default pg_current_xact_id(),
  actualizado timestamptz not null default now(),
  primary key (tabla, id)
)`;
// Cambios de stock ya sumados: si se pierde la respuesta y el equipo reintenta, no se suman dos veces.
const CREAR_OPS = `create table if not exists ops_aplicadas (o text primary key, creado timestamptz not null default now())`;
const CREAR_INDICE_SEQ = `create index if not exists filas_por_seq on filas (seq)`;
// La bajada avanza por (tx, seq): una transacción que confirma tarde siempre tiene un tx más alto que
// lo ya entregado, así que nunca queda "detrás" del cursor (con sólo seq, una venta se podía saltear).
const CREAR_INDICE_TX = `create index if not exists filas_por_tx on filas (tx, seq)`;
// Producto que llega con `_c` (los campos que cambió ese equipo): se toman sólo esos campos y el resto queda
// como está en la nube. Así una venta (que sólo cambia el stock) no pisa un precio cambiado en otro equipo.
// El stock, si viene como operación (`_ov`), lo suma la consulta de abajo. El candado evita que dos arranques
// a la vez choquen al reemplazar la función.
const CREAR_MEZCLA = `do $d$ begin perform pg_advisory_xact_lock(482601);
create or replace function milenio_producto(vieja jsonb, nueva jsonb) returns jsonb language sql immutable as $f$
  select case when jsonb_typeof(nueva->'_c') = 'array' then
    ((vieja - '_ov' - '_dv' - '_c' - '_o')
      || coalesce((select jsonb_object_agg(k, nueva->k) from jsonb_array_elements_text(nueva->'_c') k
                   where nueva ? k and left(k, 1) <> '_' and (k <> 'stock' or jsonb_typeof(nueva->'_ov') <> 'string')), '{}'::jsonb)
      || coalesce((select jsonb_object_agg(key, value) from jsonb_each(nueva) where left(key, 1) = '_'), '{}'::jsonb))
    - coalesce((select array_agg(k) from jsonb_array_elements_text(nueva->'_c') k where not nueva ? k and left(k, 1) <> '_'), '{}'::text[])
  else nueva end
$f$;
end $d$`;
const CREAR_EQUIPOS = `create table if not exists equipos (
  n serial primary key,
  dispositivo text not null unique,
  creado timestamptz not null default now()
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

/** Bases donde ya se crearon las tablas (en Vercel es una sola; en las pruebas, una por prueba). */
const tablasCreadas = new WeakSet<Consulta>();

interface UsuarioGuardado {
  usuario: string;
  admin?: boolean;
  sal: string;
  hash: string;
}

/** La lista de usuarios más nueva de la nube (cada equipo sube la suya) y el equipo que subió datos más recientemente. */
async function usuariosDeLaNube(consulta: Consulta): Promise<UsuarioGuardado[]> {
  // Primero la copia compartida (versión 2): manda el último cambio que llegó al servidor, no el reloj de cada equipo.
  const nuevas = await consulta(`select datos from filas where tabla = 'ajustes' and id = 'usuarios' and not borrado`, []);
  const filas = nuevas.length > 0 ? nuevas : await consulta(
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

type Comprobacion = { u: UsuarioGuardado; usuarios: UsuarioGuardado[] } | Response;

/** Usuario y clave contra la lista de la nube, con el bloqueo por claves mal seguidas. */
async function comprobarClave(pedido: Request, consulta: Consulta, esperada: string | undefined): Promise<Comprobacion> {
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
  return { u, usuarios };
}

/**
 * Lo que ve un empleado de la lista de usuarios: todos (para saber quién es dueño), pero sin la sal ni el
 * hash de los demás. Con el hash del dueño, una clave de 4 cifras se adivina en minutos.
 */
export function usuariosParaEmpleado(usuarios: UsuarioGuardado[], yo: string): UsuarioGuardado[] {
  return usuarios.map((u) => (u.usuario === yo ? u : { ...u, sal: '', hash: '' }));
}

async function ingresar(pedido: Request, consulta: Consulta, esperada: string | undefined): Promise<Response> {
  const c = await comprobarClave(pedido, consulta, esperada);
  if (c instanceof Response) return c;
  const { u, usuarios } = c;
  const ultimo = await consulta(`select dispositivo from registros group by dispositivo order by max(actualizado) desc limit 1`, []);
  // El dueño se lleva la clave de la nube; un empleado, una clave propia que no deja tocar los usuarios.
  const clave = u.admin ? esperada! : claveDeEmpleado(esperada!, u.usuario);
  return json({
    clave,
    usuarios: u.admin ? usuarios : usuariosParaEmpleado(usuarios, u.usuario),
    nube: idDeNube(esperada!),
    dispositivo: (ultimo[0]?.dispositivo as string | undefined) ?? '',
  });
}

/**
 * La clave del dueño para autorizar algo (anular, retirar plata) en un equipo de empleado, que no tiene el
 * hash del dueño: la controla la nube. Sólo dice sí o no; no entrega ninguna clave.
 */
async function autorizar(pedido: Request, consulta: Consulta, esperada: string | undefined): Promise<Response> {
  const c = await comprobarClave(pedido, consulta, esperada);
  if (c instanceof Response) return c;
  return json({ ok: true, usuario: c.u.usuario, admin: Boolean(c.u.admin) });
}

/** Un id de la nube que no revela la clave: dos equipos con el mismo id están en la misma nube. */
export function idDeNube(clave: string): string {
  return createHash('sha256').update(`nube:${clave}`).digest('hex').slice(0, 16);
}

/** Clave de un empleado: `e.<usuario>.<firma>`. Deja de valer si el usuario se borra o se vuelve dueño. */
export function claveDeEmpleado(clave: string, usuario: string): string {
  return `e.${usuario}.${createHmac('sha256', clave).update(`empleado:${usuario}`).digest('base64url')}`;
}

type Rol = 'dueño' | 'empleado';

/** Quién manda el pedido: el dueño (clave de la nube) o un empleado (su clave propia, si sigue existiendo). */
async function rolDelPedido(recibida: string | null, esperada: string, consulta: Consulta): Promise<Rol | null> {
  if (!recibida) return null;
  if (claveCorrecta(recibida, esperada)) return 'dueño';
  // El usuario puede tener puntos (ana.p): la firma (base64url, 43 letras) nunca los tiene.
  const m = /^e\.(.{1,60})\.[A-Za-z0-9_-]{43}$/.exec(recibida);
  if (!m || !claveCorrecta(recibida, claveDeEmpleado(esperada, m[1]!))) return null;
  const u = (await usuariosDeLaNube(consulta)).find((x) => x.usuario === m[1]);
  return u && !u.admin ? 'empleado' : null;
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
  // ?estado=1: diagnóstico sin datos ni claves (siempre 200, para poder mirarlo desde un navegador).
  const pideEstado = pedido.method === 'GET' && new URL(pedido.url).searchParams.get('estado') === '1';
  if (!deps.consulta) {
    return pideEstado ? json({ base: false, activada: false }) : json({ error: 'La copia en la nube no está configurada.' }, 503);
  }
  const consulta = deps.consulta;
  try {
    if (!tablasCreadas.has(consulta)) {
      await consulta(CREAR_TABLA, []);
      await consulta(CREAR_CONFIG, []);
      await consulta(CREAR_INTENTOS, []);
      await consulta(CREAR_SECUENCIA, []);
      await consulta(CREAR_FILAS, []);
      await consulta(CREAR_INDICE_SEQ, []);
      await consulta(CREAR_EQUIPOS, []);
      await consulta(CREAR_OPS, []);
      await consulta(CREAR_INDICE_TX, []);
      await consulta(CREAR_MEZCLA, []);
      tablasCreadas.add(consulta);
    }
  } catch (e) {
    // El detalle del error queda en el registro de Vercel, no en una página pública.
    console.error('nube: no conecta con la base', e);
    return pideEstado ? json({ base: true, conecta: false }) : json({ error: 'No se pudo conectar con la base de la nube.' }, 503);
  }
  if (pideEstado) {
    const [equipos] = await consulta(`select greatest((select count(*) from equipos), (select count(distinct dispositivo) from registros)) as n`, []);
    return json({
      base: true,
      conecta: true,
      activada: Boolean(deps.clave || (await claveGuardada(consulta))),
      equipos: Number(equipos?.n) || 0,
      usuarios: (await usuariosDeLaNube(consulta)).length,
    });
  }
  if (pedido.method === 'POST' && pedido.headers.get('x-alta') === '1') return darDeAlta(consulta, deps.clave);
  const esperada = deps.clave || (await claveGuardada(consulta));
  if (pedido.method === 'POST' && pedido.headers.get('x-ingreso') === '1') return ingresar(pedido, consulta, esperada);
  if (pedido.method === 'POST' && pedido.headers.get('x-autorizar') === '1') {
    // Sólo desde un equipo de la nube (dueño o empleado): no es una puerta para probar claves desde afuera.
    const quien = esperada ? await rolDelPedido(pedido.headers.get('x-clave'), esperada, consulta) : null;
    if (!quien) return json({ error: 'Clave incorrecta.' }, 401);
    return autorizar(pedido, consulta, esperada);
  }
  // ?usuarios=1: si ya hay usuarios en la nube (un equipo nuevo pide ingresar en vez de crear el dueño).
  if (pedido.method === 'GET' && new URL(pedido.url).searchParams.get('usuarios') === '1') {
    return json({ hay: (await usuariosDeLaNube(consulta)).length > 0 });
  }
  const rol = esperada ? await rolDelPedido(pedido.headers.get('x-clave'), esperada, consulta) : null;
  if (!esperada || !rol) return json({ error: 'Clave incorrecta.' }, 401);
  const parametros = new URL(pedido.url).searchParams;
  if (parametros.get('v') === '2') return sincronizarV2(pedido, consulta, rol, parametros);
  // Lo de abajo es la copia vieja (versión 1), para las cajas que todavía no se actualizaron. Sólo el dueño.
  if (rol !== 'dueño') return json({ error: 'Clave incorrecta.' }, 401);

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

// ---------- Versión 2: sincronización entre equipos ----------

/** El usuario de una clave de empleado (`e.<usuario>.<firma>`). */
const empleadoDe = (clave: string | null) => /^e\.(.{1,60})\.[A-Za-z0-9_-]{43}$/.exec(clave ?? '')?.[1];

type Registro = { tabla: string; id: string; datos: Record<string, unknown> | null };

/** Lo que un empleado puede cambiar de una venta que ya está en la nube: anularla (con la clave del dueño) o devolver. */
const CAMPOS_VENTA_EMPLEADO = ['anulada', 'anuladaFecha', 'anuladaPor', 'devoluciones'];
/** De un producto que ya existe, el empleado cambia el stock (como operación) y le suma códigos. */
const CAMPOS_PRODUCTO_EMPLEADO = new Set(['codigosAlt', 'actualizado']);

/**
 * Reglas del empleado, que el servidor hace cumplir (el equipo del empleado podría mandar cualquier cosa):
 * - Filas nuevas, sí (ventas, cajas, movimientos, productos o clientes nuevos).
 * - De lo que ya existe: en productos sólo stock y códigos; en ventas sólo anular o devolver; en el fiado
 *   sólo anular; su caja abierta sí, una caja cerrada no; clientes, movimientos de caja y eventos, no.
 * - La lista de usuarios: sólo su propia clave.
 */
async function reglasDeEmpleado(registros: Registro[], yo: string, consulta: Consulta): Promise<Registro[]> {
  if (registros.length === 0) return registros;
  const existentes = new Map<string, { datos: Record<string, unknown>; borrado: boolean }>();
  for (const f of await consulta(
    `select tabla, id, datos, borrado from filas where (tabla, id) in (select r->>'tabla', r->>'id' from jsonb_array_elements($1::jsonb) r)`,
    [JSON.stringify(registros.map((r) => ({ tabla: r.tabla, id: r.id })))],
  )) {
    existentes.set(`${String(f.tabla)}\u0000${String(f.id)}`, { datos: (f.datos ?? {}) as Record<string, unknown>, borrado: Boolean(f.borrado) });
  }
  const salida: Registro[] = [];
  for (const r of registros) {
    const datos = r.datos ?? {};
    if (r.tabla === 'ajustes' && r.id === 'usuarios') {
      const lista = await usuariosDelEmpleado(datos, yo, consulta);
      if (lista) salida.push({ ...r, datos: { ...datos, valor: lista } });
      continue;
    }
    const previa = existentes.get(`${r.tabla}\u0000${r.id}`);
    if (!previa || previa.borrado) {
      salida.push(r);
      continue;
    }
    const marcas = { _o: datos._o, _v: datos._v };
    switch (r.tabla) {
      case 'productos': {
        const c = Array.isArray(datos._c) ? (datos._c as unknown[]).filter((k): k is string => typeof k === 'string' && CAMPOS_PRODUCTO_EMPLEADO.has(k)) : [];
        salida.push({ ...r, datos: { ...datos, _c: c } });
        break;
      }
      case 'ventas': {
        const cambios = Object.fromEntries(CAMPOS_VENTA_EMPLEADO.filter((k) => k in datos).map((k) => [k, datos[k]]));
        salida.push({ ...r, datos: { ...previa.datos, ...cambios, ...marcas } });
        break;
      }
      case 'movimientosFiado':
        if (datos.anulado === true && previa.datos.anulado !== true) {
          salida.push({ ...r, datos: { ...previa.datos, anulado: true, ...('anuladoPor' in datos ? { anuladoPor: datos.anuladoPor } : {}), ...marcas } });
        }
        break;
      case 'turnos':
        if (previa.datos.cierre === null || previa.datos.cierre === undefined) salida.push(r);
        break;
      case 'ajustes':
        salida.push(r);
        break;
      default:
        // clientes, movimientosCaja, eventos: lo ya anotado no lo cambia un empleado.
        break;
    }
  }
  return salida;
}

/** La lista de usuarios que sube un empleado: la de la nube, con su clave nueva si la cambió. null: no se toca. */
async function usuariosDelEmpleado(datos: Record<string, unknown>, yo: string, consulta: Consulta): Promise<UsuarioGuardado[] | null> {
  const nueva = Array.isArray(datos.valor) ? (datos.valor as UsuarioGuardado[]) : [];
  const propia = nueva.find((u) => u?.usuario === yo);
  const actual = await usuariosDeLaNube(consulta);
  const enLaNube = actual.find((u) => u.usuario === yo);
  if (!propia || !enLaNube || enLaNube.admin || typeof propia.sal !== 'string' || typeof propia.hash !== 'string') return null;
  if (!/^[0-9a-f]{32}$/.test(propia.sal) || !/^[0-9a-f]{64}$/.test(propia.hash)) return null;
  if (propia.sal === enLaNube.sal && propia.hash === enLaNube.hash) return null;
  return actual.map((u) => (u.usuario === yo ? { ...u, sal: propia.sal, hash: propia.hash } : u));
}

const PAGINA_CAMBIOS = 1000;

/** Cursor de bajada `tx:seq`. `seq:N` es el de antes (sólo seq): se convierte acá. */
async function leerCursor(texto: string, consulta: Consulta): Promise<[string, number] | null> {
  const nuevo = /^(\d{1,20}):(-1|\d{1,18})$/.exec(texto);
  if (nuevo) return [nuevo[1]!, Number(nuevo[2])];
  const viejo = /^seq:(\d{1,18})$/.exec(texto);
  if (!viejo) return null;
  // Todo lo que tiene un seq mayor tiene un tx igual o mayor que el más chico de ellos: se vuelve a bajar
  // desde ahí (repetir filas no hace daño; saltear sí).
  const [fila] = await consulta(
    `select coalesce((select min(tx) from filas where seq > $1), pg_snapshot_xmin(pg_current_snapshot()))::text as tx`,
    [Number(viejo[1])],
  );
  return [String(fila?.tx ?? '0'), -1];
}

/**
 * - POST ?v=2&equipo=1 `{ dispositivo }` → `{ n }`: el número del equipo (siempre el mismo para ese dispositivo).
 * - POST ?v=2 `{ equipo, registros, borrados }`: guarda. En productos, si llega `_ov` (una operación de
 *   stock), suma la diferencia `_dv` al stock de la nube en vez de pisarlo, una sola vez por operación; y
 *   si llega `_c`, sólo cambian esos campos. `_o` (equipo y marca) evita aplicar dos veces el mismo cambio.
 * - GET ?v=2&desde=<tx:seq> → `{ filas, hasta, mas }`: lo cambiado después del cursor, en orden.
 *   (GET ?v=2&cambios=<seq> es el de antes, para los equipos que todavía no se actualizaron.)
 */
async function sincronizarV2(pedido: Request, consulta: Consulta, rol: Rol, parametros: URLSearchParams): Promise<Response> {
  const yo = rol === 'empleado' ? empleadoDe(pedido.headers.get('x-clave')) : undefined;
  if (pedido.method === 'GET') {
    let filas: Record<string, unknown>[];
    let hasta: string | number;
    const desdeTexto = parametros.get('desde');
    if (desdeTexto !== null) {
      const cursor = await leerCursor(desdeTexto, consulta);
      if (!cursor) return json({ error: 'El cursor no es válido.' }, 400);
      // Sólo lo de transacciones ya terminadas antes que cualquiera en curso, en orden de (tx, seq).
      filas = await consulta(
        `select tabla, id, datos, borrado, seq, tx::text as tx from filas
         where (tx, seq) > ($1::xid8, $2::bigint) and tx < pg_snapshot_xmin(pg_current_snapshot())
         order by tx, seq limit ${PAGINA_CAMBIOS}`,
        cursor,
      );
      const ultima = filas[filas.length - 1];
      hasta = ultima ? `${String(ultima.tx)}:${String(ultima.seq)}` : `${cursor[0]}:${cursor[1]}`;
    } else {
      const desde = Number(parametros.get('cambios') ?? '0');
      if (!Number.isSafeInteger(desde) || desde < 0) return json({ error: 'El cursor no es válido.' }, 400);
      filas = await consulta(
        `select tabla, id, datos, borrado, seq from filas
         where seq > $1 and tx < pg_snapshot_xmin(pg_current_snapshot())
         order by seq limit ${PAGINA_CAMBIOS}`,
        [desde],
      );
      hasta = filas.reduce((m, f) => Math.max(m, Number(f.seq) || 0), desde);
    }
    return json({
      filas: filas.map((f) => {
        let datos = f.borrado ? null : (f.datos as Record<string, unknown> | null);
        // El empleado no recibe la sal ni el hash de los demás usuarios.
        if (yo && datos && f.tabla === 'ajustes' && f.id === 'usuarios' && Array.isArray(datos.valor)) {
          datos = { ...datos, valor: usuariosParaEmpleado(datos.valor as UsuarioGuardado[], yo) };
        }
        return { tabla: f.tabla, id: f.id, datos, borrado: Boolean(f.borrado), seq: Number(f.seq) };
      }),
      hasta,
      mas: filas.length === PAGINA_CAMBIOS,
    });
  }
  if (pedido.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  let cuerpo: { dispositivo?: unknown; equipo?: unknown; registros?: unknown; borrados?: unknown };
  try {
    cuerpo = (await pedido.json()) as typeof cuerpo;
  } catch {
    return json({ error: 'El pedido no es JSON.' }, 400);
  }
  if (parametros.get('equipo') === '1') {
    if (!esTexto(cuerpo.dispositivo, 100)) return json({ error: 'Falta el equipo.' }, 400);
    const [fila] = await consulta(
      `insert into equipos (dispositivo) values ($1) on conflict (dispositivo) do update set dispositivo = excluded.dispositivo returning n`,
      [cuerpo.dispositivo],
    );
    return json({ n: Number(fila?.n) });
  }
  const equipo = Number(cuerpo.equipo);
  if (!Number.isSafeInteger(equipo) || equipo <= 0) return json({ error: 'Falta el número de equipo.' }, 400);
  const registros = Array.isArray(cuerpo.registros) ? (cuerpo.registros as Registro[]) : [];
  const borrados = Array.isArray(cuerpo.borrados) ? (cuerpo.borrados as Record<string, unknown>[]) : [];
  if (registros.length + borrados.length > MAX_REGISTROS) return json({ error: 'Demasiados registros juntos.' }, 413);
  for (const r of [...registros, ...borrados] as Record<string, unknown>[]) {
    if (!r || !esTexto(r.tabla, 40) || !TABLAS.has(r.tabla) || !esTexto(r.id, 200)) {
      return json({ error: 'Hay un registro con tabla o id no válidos.' }, 400);
    }
  }
  if (rol === 'empleado' && !yo) return json({ error: 'Clave incorrecta.' }, 401);
  // La misma fila dos veces en un lote haría fallar todo el lote: queda la última.
  const unicos = [...new Map(registros.map((r) => [`${r.tabla}\u0000${r.id}`, r])).values()];
  const aceptados = rol === 'dueño' ? unicos : await reglasDeEmpleado(unicos, yo!, consulta);
  // Borrar es cosa del dueño (un producto, los datos de prueba). Un empleado no borra nada.
  const aBorrar = rol === 'dueño' ? borrados : [];
  if (aceptados.length > 0) {
    await consulta(
      `with nuevas as (
         insert into ops_aplicadas (o)
         select r->'datos'->>'_ov' from jsonb_array_elements($2::jsonb) r
         where r->>'tabla' = 'productos' and jsonb_typeof(r->'datos'->'_ov') = 'string'
         on conflict do nothing returning o
       )
       insert into filas (tabla, id, datos, borrado, equipo)
       select r->>'tabla', r->>'id',
         case when r->'datos'->>'_ov' is null or r->'datos'->>'_ov' in (select o from nuevas) then r->'datos' else (r->'datos') - '_dv' end,
         false, $1
       from jsonb_array_elements($2::jsonb) r
       on conflict (tabla, id) do update set
         datos = case
           -- Stock: se suma la diferencia que mandó el equipo (una sola vez por operación), no se pisa.
           -- Los demás campos, sólo los que ese equipo cambió (_c).
           when filas.tabla = 'productos' and not filas.borrado and jsonb_typeof(excluded.datos->'_ov') = 'string'
             and jsonb_typeof(filas.datos->'stock') = 'number'
           then jsonb_set(milenio_producto(filas.datos, excluded.datos), '{stock}', case when jsonb_typeof(excluded.datos->'_dv') = 'number'
             then to_jsonb(round(((filas.datos->>'stock')::numeric + (excluded.datos->>'_dv')::numeric) * 1000) / 1000)
             else filas.datos->'stock' end)
           when filas.tabla = 'productos' and not filas.borrado then milenio_producto(filas.datos, excluded.datos)
           -- Una caja cerrada no se reabre con una copia vieja.
           when filas.tabla = 'turnos' and not filas.borrado and filas.datos->>'cierre' is not null and excluded.datos->>'cierre' is null
           then filas.datos
           -- Una caja abierta es del primer equipo que la tomó, salvo que otro la traiga a mano ("Seguir esta caja acá").
           when filas.tabla = 'turnos' and not filas.borrado and filas.datos->>'cierre' is null and excluded.datos->>'cierre' is null
             and filas.datos->'equipo' is not null and excluded.datos->'equipo' is not null and filas.datos->'equipo' <> excluded.datos->'equipo'
             and coalesce((excluded.datos->>'reclamo')::numeric, 0) <= coalesce((filas.datos->>'reclamo')::numeric, 0)
           then filas.datos
           else excluded.datos end,
         borrado = false, equipo = excluded.equipo, seq = nextval('filas_cambios'), tx = pg_current_xact_id(), actualizado = now()
       -- Un producto borrado no revive porque otro equipo, sin internet, lo vendió o le cambió algo (_c):
       -- sólo vuelve si se lo carga entero de nuevo.
       where (filas.borrado and not (filas.tabla = 'productos' and jsonb_typeof(excluded.datos->'_c') = 'array'))
          or (not filas.borrado and (filas.datos->>'_o') is distinct from (excluded.datos->>'_o'))`,
      [equipo, JSON.stringify(aceptados.map((r) => ({ tabla: r.tabla, id: r.id, datos: r.datos })))],
    );
  }
  if (aBorrar.length > 0) {
    await consulta(
      `update filas set borrado = true, seq = nextval('filas_cambios'), tx = pg_current_xact_id(), actualizado = now()
       where not borrado and (tabla, id) in (select r->>'tabla', r->>'id' from jsonb_array_elements($1::jsonb) r)`,
      [JSON.stringify(aBorrar.map((b) => ({ tabla: b.tabla, id: b.id })))],
    );
  }
  return json({ ok: true, guardados: aceptados.length, borrados: aBorrar.length });
}
