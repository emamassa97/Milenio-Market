import type { BaseKiosco } from './db';
import { estaVacia } from './copia';
import { recuperarDeLaNube } from './nube';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';
import { ingresar, leerUsuarios, type Usuario } from './usuarios';

// Un solo usuario para todos los equipos: con internet, la clave la controla
// la nube (donde viaja la lista de usuarios con la clave hasheada) y un equipo
// nuevo se trae los datos solo. Sin internet se entra con lo guardado en el equipo.

const URL_NUBE = '/api/sincronizar';
const ESPERA_MS = 6000;

type RespuestaNube =
  | { tipo: 'ok'; clave: string; usuarios: Usuario[]; dispositivo: string }
  | { tipo: 'rechazado'; error: string; bloqueado: boolean; sinUsuarios: boolean }
  | { tipo: 'sin-nube' };

async function preguntarALaNube(usuario: string, clave: string, url: string): Promise<RespuestaNube> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingreso': '1' },
      body: JSON.stringify({ usuario, clave }),
      signal: corte.signal,
    });
    const cuerpo = (await r.json().catch(() => ({}))) as { clave?: string; usuarios?: Usuario[]; dispositivo?: string; error?: string; sinUsuarios?: boolean };
    if (r.ok && cuerpo.clave && Array.isArray(cuerpo.usuarios)) {
      return { tipo: 'ok', clave: cuerpo.clave, usuarios: cuerpo.usuarios, dispositivo: cuerpo.dispositivo ?? '' };
    }
    if (r.status === 401 || r.status === 429) {
      return { tipo: 'rechazado', error: cuerpo.error ?? 'Usuario o clave incorrectos.', bloqueado: r.status === 429, sinUsuarios: Boolean(cuerpo.sinUsuarios) };
    }
    return { tipo: 'sin-nube' };
  } catch {
    return { tipo: 'sin-nube' };
  } finally {
    clearTimeout(reloj);
  }
}

/** La lista de usuarios del equipo cambió y todavía no se subió (por ejemplo, un empleado sumado sin internet). */
async function usuariosSinSubir(db: BaseKiosco): Promise<boolean> {
  const fila = (await db.ajustes.get('usuarios')) as { _v?: number } | undefined;
  const marcas = await leerAjuste<Record<string, number>>(db, 'nube.marcas', {});
  return Number(fila?._v ?? 0) > (marcas.ajustes ?? 0);
}

/** Si ya hay usuarios en la nube: un equipo nuevo tiene que pedir ingresar, no crear otro dueño. */
export async function hayUsuariosEnLaNube(url = URL_NUBE): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    const r = await fetch(`${url}?usuarios=1`, { signal: corte.signal });
    return r.ok && ((await r.json()) as { hay?: boolean }).hay === true;
  } catch {
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Entra con el mismo usuario y clave en cualquier equipo. Devuelve el usuario
 * o tira ErrorKiosco con el motivo para mostrar.
 */
export async function ingresarDondeSea(db: BaseKiosco, usuario: string, clave: string, url = URL_NUBE): Promise<Usuario> {
  const nombre = usuario.trim().toLowerCase();
  const enLinea = typeof navigator === 'undefined' || navigator.onLine !== false;
  const nube = enLinea ? await preguntarALaNube(nombre, clave, url) : ({ tipo: 'sin-nube' } as const);
  const claveLocal = await leerAjuste<string>(db, 'nube.clave', '');

  if (nube.tipo === 'ok') {
    const u = nube.usuarios.find((x) => x.usuario === nombre);
    if (!u) throw new ErrorKiosco('Usuario o clave incorrectos.');
    if (claveLocal !== nube.clave) {
      // Equipo nuevo (o con un usuario de prueba suelto): se trae los datos de la nube.
      if (!(await estaVacia(db))) {
        throw new ErrorKiosco('Esta compu tiene ventas propias que no están en la nube: entrá con el usuario que creaste acá.');
      }
      await recuperarDeLaNube(db, nube.clave, nube.dispositivo || undefined, url);
      await guardarAjuste(db, 'usuarios', nube.usuarios);
    } else if (!(await usuariosSinSubir(db)) && JSON.stringify(await leerUsuarios(db)) !== JSON.stringify(nube.usuarios)) {
      // Una clave cambiada o un empleado nuevo en otro equipo llega a éste.
      await guardarAjuste(db, 'usuarios', nube.usuarios);
    }
    return u;
  }

  // Si el equipo ya está unido a la nube, lo que dice la nube manda (una clave vieja no sirve),
  // salvo que el equipo tenga usuarios nuevos que todavía no subió. Con el usuario bloqueado
  // por intentos ajenos, el equipo donde ya se entró sigue andando con su clave.
  if (nube.tipo === 'rechazado' && !nube.bloqueado && claveLocal && !nube.sinUsuarios && !(await usuariosSinSubir(db))) {
    throw new ErrorKiosco(nube.error);
  }
  const local = await ingresar(db, nombre, clave);
  if (!local) throw new ErrorKiosco(nube.tipo === 'rechazado' ? nube.error : 'Usuario o clave incorrectos.');
  return local;
}
