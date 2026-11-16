import { rolDeOtroPedido, type Consulta, type Dependencias } from './sincronizar.js';

// El resumen del día por WhatsApp, mandado solo (sin que nadie toque nada) con CallMeBot, que es gratis para
// mandarse mensajes a uno mismo. El equipo arma el texto (tiene toda la lógica de la caja) y lo sube:
// - al cerrar la caja ('cierre'): se manda en el momento;
// - mientras la caja está abierta ('parcial'): se guarda, y si a la noche sigue abierta la tarea programada
//   de Vercel (cron) lo manda igual. También reintenta los cierres que no salieron.
// La configuración (número y clave de CallMeBot) es el ajuste 'resumen.whatsapp', que viaja por la nube.

const CREAR = `create table if not exists resumenes (
  turno_id bigint not null,
  tipo text not null,
  dia date not null,
  texto text not null,
  actualizado timestamptz not null default now(),
  enviado timestamptz,
  intentos integer not null default 0,
  error text,
  primary key (turno_id, tipo, dia)
)`;

const MAX_TEXTO = 3500;
const MAX_INTENTOS = 5;
export const URL_CALLMEBOT = 'https://api.callmebot.com/whatsapp.php';

export interface DependenciasResumen extends Dependencias {
  /** Para las pruebas: en vez de llamar a CallMeBot. */
  mandar?: typeof fetch;
  /** CRON_SECRET de Vercel: si está, la tarea programada tiene que traerlo. */
  secretoCron?: string;
  ahora?: () => number;
}

export interface ConfigServidor {
  telefono: string;
  apikey: string;
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** Igual que telefonoWhatsApp de src/dominio/entrada.ts (acá no se importa el código de la app). */
export function telefonoArgentino(telefono: string): string | null {
  let d = telefono.replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) d = d.slice(2);
  d = d.replace(/^0/, '');
  const conQuince = d.length === 12 ? d.match(/^(\d{2,4})15(\d{6,8})$/) : null;
  if (conQuince) d = conQuince[1]! + conQuince[2]!;
  return `549${d}`;
}

/** El día en Argentina (UTC-3, sin horario de verano) 'AAAA-MM-DD'. */
export function diaArgentina(ms: number): string {
  return new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
}

function configDe(valor: unknown): ConfigServidor | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  if (v.automatico !== true || typeof v.numero !== 'string' || typeof v.apikey !== 'string') return null;
  const telefono = telefonoArgentino(v.numero);
  const apikey = v.apikey.trim();
  return telefono && /^\d{4,12}$/.test(apikey) ? { telefono, apikey } : null;
}

async function leerConfig(consulta: Consulta): Promise<ConfigServidor | null> {
  const [fila] = await consulta(`select datos from filas where tabla = 'ajustes' and id = 'resumen.whatsapp' and not borrado`, []);
  return configDe((fila?.datos as Record<string, unknown> | undefined)?.valor);
}

/** Manda un WhatsApp con CallMeBot. null si salió; si no, el motivo. */
export async function mandarWhatsApp(config: ConfigServidor, texto: string, mandar: typeof fetch = fetch): Promise<string | null> {
  const url = `${URL_CALLMEBOT}?phone=%2B${config.telefono}&apikey=${encodeURIComponent(config.apikey)}&text=${encodeURIComponent(texto.slice(0, MAX_TEXTO))}`;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 20_000);
  try {
    const r = await mandar(url, { signal: corte.signal });
    const cuerpo = (await r.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (r.ok && /queued|sent|enviad/i.test(cuerpo) && !/error|invalid/i.test(cuerpo)) return null;
    if (/apikey/i.test(cuerpo) && /invalid|incorrect|not/i.test(cuerpo)) return 'CallMeBot dice que la clave no es válida para ese número.';
    return `CallMeBot respondió: ${cuerpo.slice(0, 160) || `error ${r.status}`}`;
  } catch {
    return 'CallMeBot no respondió.';
  } finally {
    clearTimeout(reloj);
  }
}

async function intentar(consulta: Consulta, config: ConfigServidor, fila: Record<string, unknown>, mandar?: typeof fetch): Promise<string | null> {
  const error = await mandarWhatsApp(config, String(fila.texto), mandar);
  await consulta(
    `update resumenes set enviado = case when $4::text is null then now() else null end, intentos = intentos + 1, error = $4
     where turno_id = $1 and tipo = $2 and dia = $3::date`,
    [fila.turno_id, fila.tipo, fila.dia, error],
  );
  return error;
}

/**
 * POST desde un equipo de la nube (dueño o empleado), con x-clave:
 * - {tipo: 'cierre'|'parcial', turnoId, texto}: guarda el resumen; el de cierre lo manda ya.
 * - {prueba: true, numero, apikey}: sólo el dueño; manda un mensaje de prueba con esos datos.
 */
export async function recibirResumen(pedido: Request, deps: DependenciasResumen): Promise<Response> {
  if (!deps.consulta) return json({ error: 'La nube no está configurada.' }, 503);
  const rol = await rolDeOtroPedido(pedido, deps);
  if (!rol) return json({ error: 'Este equipo no tiene permiso.' }, 401);
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await pedido.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'No llegó el resumen.' }, 400);
  }
  const consulta = deps.consulta;
  await consulta(CREAR, []);
  if (cuerpo.prueba === true) {
    if (rol !== 'dueño') return json({ error: 'Sólo el dueño puede probar el envío.' }, 401);
    const config = configDe({ automatico: true, numero: cuerpo.numero, apikey: cuerpo.apikey });
    if (!config) return json({ error: 'Revisá el número (con característica) y la clave de CallMeBot (son sólo números).' }, 400);
    const error = await mandarWhatsApp(config, '✅ Milenio Market: así te va a llegar el resumen del día cuando se cierre la caja.', deps.mandar);
    return error ? json({ enviado: false, error }, 502) : json({ enviado: true });
  }
  const tipo = cuerpo.tipo === 'cierre' ? 'cierre' : cuerpo.tipo === 'parcial' ? 'parcial' : null;
  const turnoId = Number(cuerpo.turnoId);
  const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.slice(0, MAX_TEXTO) : '';
  if (!tipo || !Number.isSafeInteger(turnoId) || turnoId <= 0 || !texto.trim()) return json({ error: 'El resumen no llegó bien.' }, 400);
  const dia = diaArgentina(deps.ahora?.() ?? Date.now());
  // Lo ya mandado no se pisa (que no llegue dos veces el mismo cierre).
  const [fila] = await consulta(
    `insert into resumenes (turno_id, tipo, dia, texto) values ($1, $2, $3::date, $4)
     on conflict (turno_id, tipo, dia) do update set texto = excluded.texto, actualizado = now() where resumenes.enviado is null
     returning turno_id, tipo, to_char(dia, 'YYYY-MM-DD') as dia, texto`,
    [turnoId, tipo, dia, texto],
  );
  if (tipo === 'parcial') return json({ enviado: false, guardado: true });
  if (!fila) return json({ enviado: true, yaEstaba: true });
  // Un cierre ya mandado ese día para la misma caja no se repite (por si se cerró desde dos equipos).
  const [previo] = await consulta(`select 1 from resumenes where turno_id = $1 and tipo = 'cierre' and enviado is not null limit 1`, [turnoId]);
  if (previo) return json({ enviado: true, yaEstaba: true });
  const config = await leerConfig(consulta);
  if (!config) return json({ enviado: false, error: 'El envío automático no está configurado.' });
  const error = await intentar(consulta, config, fila, deps.mandar);
  return error ? json({ enviado: false, error }) : json({ enviado: true });
}

/**
 * GET de la tarea programada (una vez por noche): manda los cierres que no salieron y, de las cajas que siguen
 * abiertas, lo último que subieron (sólo si esa caja todavía no mandó su cierre).
 */
export async function tareaNocturna(pedido: Request, deps: DependenciasResumen): Promise<Response> {
  if (deps.secretoCron && pedido.headers.get('authorization') !== `Bearer ${deps.secretoCron}`) return json({ error: 'Sin permiso.' }, 401);
  if (!deps.consulta) return json({ base: false });
  const consulta = deps.consulta;
  await consulta(CREAR, []);
  const config = await leerConfig(consulta);
  if (!config) return json({ configurado: false });
  const pendientes = await consulta(
    `select r.turno_id, r.tipo, to_char(r.dia, 'YYYY-MM-DD') as dia, r.texto from resumenes r
     where r.enviado is null and r.intentos < $1 and r.actualizado > now() - interval '26 hours'
       and (r.tipo = 'cierre' or (
         not exists (select 1 from resumenes c where c.turno_id = r.turno_id and c.tipo = 'cierre')
         and exists (select 1 from filas f where f.tabla = 'turnos' and f.id = r.turno_id::text and not f.borrado and f.datos->'cierre' = 'null'::jsonb)
       ))
     order by r.actualizado`,
    [MAX_INTENTOS],
  );
  let enviados = 0;
  const errores: string[] = [];
  for (const fila of pendientes.slice(0, 5)) {
    const error = await intentar(consulta, config, fila, deps.mandar);
    if (error) errores.push(error);
    else enviados++;
  }
  return json({ configurado: true, enviados, errores });
}

/** GET ?estado=1: diagnóstico sin datos. */
export async function estadoResumen(deps: DependenciasResumen): Promise<Response> {
  if (!deps.consulta) return json({ base: false });
  try {
    await deps.consulta(CREAR, []);
    const config = await leerConfig(deps.consulta);
    const [ultimo] = await deps.consulta(`select max(enviado) as enviado from resumenes`, []);
    return json({ base: true, automatico: Boolean(config), ultimoEnvio: ultimo?.enviado ?? null });
  } catch {
    return json({ base: true, conecta: false });
  }
}
