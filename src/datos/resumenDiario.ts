import { resumirTurno } from '../dominio/caja';
import { cuentasDeProveedores } from '../dominio/compras';
import { telefonoWhatsApp } from '../dominio/entrada';
import { saldoCliente } from '../dominio/fiado';
import { armarResumen, textoResumen, type ResumenDiario } from '../dominio/resumenDiario';
import type { MovimientoFiado, Turno } from '../dominio/tipos';
import { totalNeto } from '../dominio/devoluciones';
import type { BaseKiosco } from './db';
import { leerAjuste, guardarAjuste, movimientosDeCaja, turnoAbierto } from './operaciones';
import { leerUsuarios } from './usuarios';
import { leerAjustesTicket } from '../ui/ticket';

// Junta lo de la base para el resumen del día y lo manda: por WhatsApp a mano (wa.me) o solo, por el servidor.

export const AJUSTE_RESUMEN = 'resumen.whatsapp';
const SEMANA = 7 * 86_400_000;

export interface ConfigResumen {
  /** WhatsApp del dueño, como lo escribió (se pasa a 549… al mandar). */
  numero: string;
  /** Clave de CallMeBot para mandarlo solo (vacía: se manda a mano con el botón). */
  apikey: string;
  /** Mandarlo solo al cerrar la caja y a la noche si nadie la cerró. */
  automatico: boolean;
}

export const CONFIG_RESUMEN_INICIAL: ConfigResumen = { numero: '', apikey: '', automatico: false };

export async function leerConfigResumen(db: BaseKiosco): Promise<ConfigResumen> {
  const g = (await leerAjuste<Partial<Record<keyof ConfigResumen, unknown>>>(db, AJUSTE_RESUMEN, {})) ?? {};
  return {
    numero: typeof g.numero === 'string' ? g.numero.slice(0, 30) : '',
    apikey: typeof g.apikey === 'string' ? g.apikey.slice(0, 40) : '',
    automatico: g.automatico === true,
  };
}

export async function guardarConfigResumen(db: BaseKiosco, c: ConfigResumen): Promise<void> {
  await guardarAjuste(db, AJUSTE_RESUMEN, { numero: c.numero.trim(), apikey: c.apikey.trim(), automatico: c.automatico });
}

/** Se puede mandar solo: hay número y clave de CallMeBot, y está prendido. */
export function mandaSolo(c: ConfigResumen): boolean {
  return c.automatico && telefonoWhatsApp(c.numero) !== null && /^\d{4,12}$/.test(c.apikey);
}

/** El enlace de WhatsApp con el resumen escrito (al número del dueño si está cargado; si no, elige el chat). */
export function enlaceWhatsApp(texto: string, numero = ''): string {
  const tel = telefonoWhatsApp(numero);
  return `https://wa.me/${tel ?? ''}?text=${encodeURIComponent(texto)}`;
}

/**
 * El resumen de una caja (por defecto la abierta; si no hay, la última cerrada). undefined si nunca se abrió una caja.
 */
export async function cargarResumen(db: BaseKiosco, turno?: Turno, ahora = Date.now()): Promise<ResumenDiario | undefined> {
  const t = turno ?? (await turnoAbierto(db)) ?? (await db.turnos.orderBy('apertura').reverse().filter((x) => x.cierre !== null).first());
  if (!t) return undefined;
  const hasta = t.cierre ?? ahora;
  const [m, productos, clientes, movsFiado, compras, pagos, usuarios, ticket, antes] = await Promise.all([
    movimientosDeCaja(db, t),
    db.productos.toArray(),
    db.clientes.toArray(),
    db.movimientosFiado.toArray(),
    db.compras.toArray(),
    db.pagosProveedor.toArray(),
    leerUsuarios(db).catch(() => []),
    leerAjustesTicket(db),
    // La semana pasada, en el mismo horario de esta caja.
    db.ventas.where('fecha').between(t.apertura - SEMANA, hasta - SEMANA, true, true).toArray(),
  ]);
  const porCliente = new Map<number, MovimientoFiado[]>();
  for (const mov of movsFiado) {
    const lista = porCliente.get(mov.clienteId) ?? [];
    lista.push(mov);
    porCliente.set(mov.clienteId, lista);
  }
  const deudores = clientes
    .map((c) => ({ nombre: c.nombre, saldo: saldoCliente(porCliente.get(c.id!) ?? []) }))
    .filter((c) => c.saldo > 0);
  const vendidoAntes = antes.filter((v) => !v.anulada).reduce((s, v) => s + totalNeto(v), 0);
  return armarResumen({
    local: ticket.encabezado.split('\n')[0]?.trim() || 'Milenio Market',
    turno: t,
    caja: resumirTurno(t.fondoInicial, m.ventas, m.movimientos, m.pagos),
    ventas: m.ventas,
    movimientos: m.movimientos,
    productos,
    deudores,
    proveedores: cuentasDeProveedores(compras, pagos),
    compras,
    pagos,
    semanaPasada: antes.length > 0 ? vendidoAntes : null,
    nombres: new Map(usuarios.map((u) => [u.usuario, u.nombre])),
    ahora,
  });
}

export type ResultadoEnvio = { enviado: true } | { enviado: false; motivo: string };

/**
 * Le pasa el resumen al servidor. `tipo` 'cierre': lo manda ya por WhatsApp (si está configurado).
 * 'parcial': lo guarda para mandarlo a la noche si la caja sigue abierta.
 */
export async function subirResumen(db: BaseKiosco, r: ResumenDiario, tipo: 'cierre' | 'parcial', url = '/api/resumen'): Promise<ResultadoEnvio> {
  const clave = await leerAjuste<string>(db, 'nube.clave', '');
  if (!clave) return { enviado: false, motivo: 'Este equipo no está conectado a la nube.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { enviado: false, motivo: 'Sin internet.' };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': clave },
      body: JSON.stringify({ tipo, turnoId: r.turnoId, texto: textoResumen(r) }),
    });
    const cuerpo = (await resp.json().catch(() => ({}))) as { enviado?: boolean; error?: string };
    if (resp.ok && cuerpo.enviado) return { enviado: true };
    return { enviado: false, motivo: cuerpo.error ?? 'El servidor no lo pudo mandar.' };
  } catch {
    return { enviado: false, motivo: 'No hubo respuesta del servidor.' };
  }
}

/** Un mensaje de prueba al WhatsApp del dueño (sólo el dueño). */
export async function probarEnvio(db: BaseKiosco, c: ConfigResumen, url = '/api/resumen'): Promise<ResultadoEnvio> {
  const clave = await leerAjuste<string>(db, 'nube.clave', '');
  if (!clave) return { enviado: false, motivo: 'Para mandarlo solo, este equipo tiene que estar conectado a la nube.' };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': clave },
      body: JSON.stringify({ prueba: true, numero: c.numero, apikey: c.apikey }),
    });
    const cuerpo = (await resp.json().catch(() => ({}))) as { enviado?: boolean; error?: string };
    return resp.ok && cuerpo.enviado ? { enviado: true } : { enviado: false, motivo: cuerpo.error ?? 'No se pudo mandar.' };
  } catch {
    return { enviado: false, motivo: 'No hubo respuesta del servidor.' };
  }
}

// Cada media hora (no menos): cada envío prende la base de la nube, que se apaga sola a los 5 minutos sin uso.
const CADA = 30 * 60_000;

/**
 * Mientras la caja está abierta, cada media hora sube cómo va el día: si a la medianoche nadie la cerró,
 * el servidor manda eso. Sólo si el envío automático está configurado. Devuelve la función para cortarlo.
 */
export function subirParcialesCadaTanto(db: BaseKiosco, cada = CADA): () => void {
  let vivo = true;
  const vuelta = async () => {
    try {
      if (!mandaSolo(await leerConfigResumen(db))) return;
      const turno = await turnoAbierto(db);
      if (!turno) return;
      const r = await cargarResumen(db, turno);
      if (vivo && r) await subirResumen(db, r, 'parcial');
    } catch {
      /* se prueba en la próxima vuelta */
    }
  };
  const primera = window.setTimeout(vuelta, 60_000);
  const reloj = window.setInterval(vuelta, cada);
  return () => {
    vivo = false;
    window.clearTimeout(primera);
    window.clearInterval(reloj);
  };
}
