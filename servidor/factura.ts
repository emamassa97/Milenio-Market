import { rolDeOtroPedido, type Dependencias } from './sincronizar.js';

// Lee la foto de una factura o remito de un proveedor con un modelo de visión (por el AI Gateway de Vercel,
// que dentro de Vercel se autoriza solo con el token OIDC del proyecto: no hay claves que cargar a mano).
// Devuelve los renglones en un JSON simple; la app los reconoce contra sus productos y el dueño revisa todo.

const PASARELA = 'https://ai-gateway.vercel.sh/v1/chat/completions';
/** Primero el que mejor lee tablas; si no está disponible, uno más barato. */
export const MODELOS = ['anthropic/claude-sonnet-4.6', 'google/gemini-2.5-flash'];
/** Lecturas por día: corta un uso raro (o un equipo con la clave robada) antes de que cueste plata. */
const LECTURAS_POR_DIA = 80;
const MAX_IMAGENES = 4;
const MAX_BYTES_IMAGEN = 2_500_000;

const CREAR_LECTURAS = `create table if not exists lecturas_factura (dia date primary key, n integer not null default 0)`;

export const INSTRUCCIONES = `Sos un asistente que pasa a datos la factura, remito o ticket que un proveedor le dio a un kiosco de Argentina.
Leé TODAS las fotos (pueden ser varias páginas del mismo comprobante) y devolvé SOLO un objeto JSON, sin texto antes ni después, con esta forma:
{"proveedor": "razón social o nombre del proveedor (no el del kiosco)", "fecha": "AAAA-MM-DD", "comprobante": "Factura A | Factura B | Factura C | Remito | Ticket | Presupuesto", "numero": "0001-00012345", "total": 123456.78,
 "renglones": [{"codigo": "código de barras o de artículo si figura, si no vacío", "descripcion": "texto del producto tal cual", "cantidad": 24, "costoUnitario": 850.5, "importe": 20412}]}
Reglas:
- "cantidad" son UNIDADES que el kiosco va a vender sueltas. Si el renglón dice bultos/cajas/packs y se ve cuántas unidades trae cada uno (ej. "x12", "6u", "PACK X 6"), multiplicá: 2 bultos x 12 = 24. Si no se puede saber, dejá la cantidad como figura.
- "costoUnitario" es lo que termina costando UNA unidad: con IVA e impuestos incluidos y con los descuentos o bonificaciones del renglón ya restados. En una Factura A los precios suelen estar sin IVA: sumale el IVA del renglón (21 % o 10,5 %). Si hay un descuento general al pie, repartilo en proporción.
- "importe" es el total del renglón tal como figura.
- "total" es el TOTAL final a pagar del comprobante.
- Números con punto decimal, sin separador de miles ni signo $.
- No inventes renglones: si una línea no se lee, salteala. No incluyas subtotales, IVA, percepciones ni fletes como renglones.
- Si no se ve un dato, poné "" (o null para total).`;

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
}

/** El JSON que vino en la respuesta del modelo (aunque venga envuelto en ```json o con texto alrededor). */
export function extraerJson(texto: string): unknown {
  const sinCercas = texto.replace(/```(?:json)?/gi, '');
  const desde = sinCercas.indexOf('{');
  const hasta = sinCercas.lastIndexOf('}');
  if (desde < 0 || hasta <= desde) return null;
  try {
    return JSON.parse(sinCercas.slice(desde, hasta + 1));
  } catch {
    return null;
  }
}

/** Una foto válida: data URL de imagen, no muy pesada. */
function imagenValida(v: unknown): v is string {
  return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_BYTES_IMAGEN * 1.4;
}

export interface DependenciasFactura extends Dependencias {
  /** Token para la pasarela: el OIDC de Vercel (llega en el pedido) o una clave cargada en el proyecto. */
  token: string | undefined;
  pedirAlModelo?: typeof fetch;
}

/** Cuenta una lectura del día; false si ya se pasó el tope. */
async function contarLectura(deps: DependenciasFactura): Promise<boolean> {
  const consulta = deps.consulta!;
  await consulta(CREAR_LECTURAS, []);
  const [fila] = await consulta(
    `insert into lecturas_factura (dia, n) values (current_date, 1) on conflict (dia) do update set n = lecturas_factura.n + 1 returning n`,
    [],
  );
  return Number(fila?.n) <= LECTURAS_POR_DIA;
}

async function preguntar(deps: DependenciasFactura, modelo: string, contenido: unknown[]): Promise<{ ok: true; texto: string } | { ok: false; estado: number; detalle: string }> {
  const pedir = deps.pedirAlModelo ?? fetch;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 90_000);
  try {
    const r = await pedir(PASARELA, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.token}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: INSTRUCCIONES },
          { role: 'user', content: contenido },
        ],
      }),
      signal: corte.signal,
    });
    const cuerpo = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } | string };
    if (!r.ok) {
      const detalle = typeof cuerpo.error === 'string' ? cuerpo.error : (cuerpo.error?.message ?? '');
      return { ok: false, estado: r.status, detalle: detalle.slice(0, 300) };
    }
    const c = cuerpo.choices?.[0]?.message?.content;
    const texto = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : '')).join('') : '';
    return { ok: true, texto };
  } catch (e) {
    return { ok: false, estado: 504, detalle: e instanceof Error ? e.message : 'sin respuesta' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * POST con {imagenes: [dataURL…], proveedores?: [nombres conocidos]} y la clave de nube del dueño en x-clave.
 * Respuestas: 200 {factura}, 401 sin permiso, 422 no se leyó nada, 429 tope del día, 503 {sinIA} lectura no activada.
 */
export async function leerFactura(pedido: Request, deps: DependenciasFactura): Promise<Response> {
  if (pedido.method !== 'POST') return json({ error: 'Usá POST.' }, 405);
  if (!deps.consulta) return json({ error: 'La nube no está configurada: sin nube no se pueden leer fotos.', sinIA: true }, 503);
  const rol = await rolDeOtroPedido(pedido, deps);
  if (rol !== 'dueño') return json({ error: 'Sólo el dueño puede cargar facturas con foto.' }, 401);
  if (!deps.token) return json({ error: 'La lectura de fotos todavía no está activada en el servidor.', sinIA: true }, 503);
  let cuerpo: { imagenes?: unknown; proveedores?: unknown };
  try {
    cuerpo = (await pedido.json()) as typeof cuerpo;
  } catch {
    return json({ error: 'No llegó la foto.' }, 400);
  }
  const imagenes = Array.isArray(cuerpo.imagenes) ? cuerpo.imagenes.slice(0, MAX_IMAGENES) : [];
  if (imagenes.length === 0 || !imagenes.every(imagenValida)) return json({ error: 'La foto no llegó bien: probá sacarla de nuevo.' }, 400);
  const proveedores = Array.isArray(cuerpo.proveedores) ? cuerpo.proveedores.filter((x): x is string => typeof x === 'string').slice(0, 60).map((x) => x.slice(0, 60)) : [];
  if (!(await contarLectura(deps))) return json({ error: 'Se llegó al tope de fotos leídas por hoy. Cargala a mano o probá mañana.' }, 429);

  const contenido: unknown[] = [
    {
      type: 'text',
      text: `Pasá a JSON este comprobante (${imagenes.length === 1 ? '1 foto' : `${imagenes.length} fotos del mismo comprobante`}).${
        proveedores.length > 0 ? ` Proveedores que ya tiene cargados el kiosco (si es uno de éstos, escribilo igual): ${proveedores.join(', ')}.` : ''
      }`,
    },
    ...imagenes.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  let ultimo = '';
  let sinPermiso = false;
  for (const modelo of MODELOS) {
    const r = await preguntar(deps, modelo, contenido);
    if (r.ok) {
      const datos = extraerJson(r.texto);
      if (datos && typeof datos === 'object') return json({ factura: datos, modelo });
      ultimo = 'La respuesta no se pudo leer.';
      continue;
    }
    console.error('leer-factura', modelo, r.estado, r.detalle);
    ultimo = r.detalle;
    if (r.estado === 401 || r.estado === 403) sinPermiso = true;
  }
  if (sinPermiso) return json({ error: 'La lectura de fotos todavía no está activada en el servidor.', sinIA: true, detalle: ultimo }, 503);
  return json({ error: 'No se pudo leer la foto. Probá con otra más derecha y con luz, o cargala a mano.', detalle: ultimo }, 422);
}

/** GET ?estado=1: si la lectura de fotos está lista (sin gastar: no le pregunta nada al modelo). */
export function estadoFactura(deps: DependenciasFactura): Response {
  return json({ base: Boolean(deps.consulta), token: Boolean(deps.token), modelos: MODELOS });
}
