import { marcarRemota, olvidarRango, type Ajuste, type BaseKiosco } from './db';
import { estaVacia } from './copia';
import { activarNube, recuperarDeLaNube } from './nube';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';
import { combinarUsuarios, ingresar, leerUsuarios, type Usuario } from './usuarios';

// Un solo usuario para todos los equipos: con internet, la clave la controla
// la nube (donde viaja la lista de usuarios con la clave hasheada) y un equipo
// nuevo se trae los datos solo. Sin internet se entra con lo guardado en el equipo.

const URL_NUBE = '/api/sincronizar';
const ESPERA_MS = 6000;

type RespuestaNube =
  | { tipo: 'ok'; clave: string; usuarios: Usuario[]; nube: string }
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
    const cuerpo = (await r.json().catch(() => ({}))) as { clave?: string; usuarios?: Usuario[]; nube?: string; error?: string; sinUsuarios?: boolean };
    if (r.ok && cuerpo.clave && Array.isArray(cuerpo.usuarios)) {
      return { tipo: 'ok', clave: cuerpo.clave, usuarios: cuerpo.usuarios, nube: cuerpo.nube ?? '' };
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

/** Igual que idDeNube del servidor: para los equipos que se unieron antes de que la nube diera su id. */
async function idDeNube(clave: string): Promise<string> {
  if (!clave || clave.startsWith('e.') || !globalThis.crypto?.subtle) return '';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nube:${clave}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** La lista que vino de la nube se guarda como ya subida: este equipo no la vuelve a mandar (pisaría cambios de otro). */
async function guardarUsuariosDeLaNube(db: BaseKiosco, usuarios: Usuario[]): Promise<void> {
  await db.transaction('rw', db.ajustes, async (tx) => {
    marcarRemota(tx);
    await db.ajustes.put({ clave: 'usuarios', valor: usuarios, _v: 0 } as Ajuste);
  });
}

/**
 * A un empleado la nube le manda los demás usuarios sin sal ni hash. En un equipo que ya los tiene (la
 * compu donde entró el dueño), esos no se pierden por que entre un empleado.
 */
function completarUsuarios(deLaNube: Usuario[], locales: Usuario[]): Usuario[] {
  return deLaNube.map((u) => {
    if (u.hash) return u;
    const local = locales.find((x) => x.usuario === u.usuario && x.hash);
    return local ? { ...u, sal: local.sal, hash: local.hash } : u;
  });
}

/**
 * La clave de un dueño, para autorizar algo en la caja. En un equipo de empleado no está el hash del dueño
 * (la nube no se lo manda): ahí la comprueba la nube. Devuelve el usuario, o null si la clave no es esa.
 */
export async function comprobarDueño(db: BaseKiosco, usuario: string, clave: string, url = URL_NUBE): Promise<Usuario | null> {
  const nombre = usuario.trim().toLowerCase();
  const u = (await leerUsuarios(db)).find((x) => x.usuario === nombre);
  if (!u) return null;
  if (u.hash) return ingresar(db, nombre, clave);
  const claveNube = await leerAjuste<string>(db, 'nube.clave', '');
  if (!claveNube) return null;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-autorizar': '1', 'x-clave': claveNube },
      body: JSON.stringify({ usuario: nombre, clave }),
      signal: corte.signal,
    });
  } catch {
    throw new ErrorKiosco('Sin internet no se puede comprobar la clave del dueño en este equipo. Probá de nuevo cuando vuelva.');
  } finally {
    clearTimeout(reloj);
  }
  const cuerpo = (await r.json().catch(() => ({}))) as { ok?: boolean; admin?: boolean; error?: string };
  if (r.ok && cuerpo.ok) return { ...u, admin: Boolean(cuerpo.admin) };
  if (r.status === 429) throw new ErrorKiosco(cuerpo.error ?? 'Demasiadas claves mal seguidas: esperá unos minutos.');
  if (r.status === 401) return null;
  throw new ErrorKiosco('La nube no responde ahora: no se puede comprobar la clave del dueño en este equipo.');
}

/** Si ya hay usuarios en la nube: un equipo nuevo tiene que pedir ingresar, no crear otro dueño. null: no se sabe (sin internet o la nube no responde). */
export async function hayUsuariosEnLaNube(url = URL_NUBE): Promise<boolean | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const corte = new AbortController();
  // La pantalla espera esta respuesta: con la nube lenta, mejor decidir rápido.
  const reloj = setTimeout(() => corte.abort(), 2500);
  try {
    const r = await fetch(`${url}?usuarios=1`, { signal: corte.signal });
    if (!r.ok) return r.status >= 500 ? null : false; // sin nube armada (404, 409) no hay a quién preguntar
    return ((await r.json()) as { hay?: boolean }).hay === true;
  } catch {
    return null;
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
  const claveLocal = await leerAjuste<string>(db, 'nube.clave', '');
  // Equipo ya unido a la nube: los usuarios llegan solos cada medio minuto, así que se
  // comprueba acá primero (entra al instante aunque la nube esté lenta). Si acá no
  // coincide (una clave cambiada recién en otro equipo), se pregunta a la nube.
  if (claveLocal && (await leerAjuste<string | boolean>(db, 'nube.v2', false)) === true) {
    const local = await ingresar(db, nombre, clave);
    if (local) return local;
  }
  const enLinea = typeof navigator === 'undefined' || navigator.onLine !== false;
  const nube = enLinea ? await preguntarALaNube(nombre, clave, url) : ({ tipo: 'sin-nube' } as const);

  if (nube.tipo === 'ok') {
    const u = nube.usuarios.find((x) => x.usuario === nombre);
    if (!u) throw new ErrorKiosco('Usuario o clave incorrectos.');
    const idLocal = (await leerAjuste<string>(db, 'nube.id', '')) || (await idDeNube(claveLocal));
    const mismaNube = (idLocal !== '' && idLocal === nube.nube) || claveLocal === nube.clave;
    if (!mismaNube) {
      if (await estaVacia(db)) {
        // Equipo nuevo (la compu nueva, el celular): se une a la nube y se trae todo.
        await recuperarDeLaNube(db, nube.clave, url, nube.nube);
      } else {
        // Equipo con datos propios y otra nube (la nube se rehízo o cambió de clave):
        // entra igual, se une a la nueva y sube lo suyo sin pisar nada de acá.
        await activarNube(db, nube.clave, nube.nube);
        olvidarRango(db);
        await guardarAjuste(db, 'nube.n', null);
        await guardarAjuste(db, 'nube.cursor', 0);
        await guardarAjuste(db, 'nube.v2', false);
        // Sus usuarios se juntan con los de la nube (nadie desaparece); se suben en la próxima vuelta.
        await guardarAjuste(db, 'usuarios', combinarUsuarios(nube.usuarios, await leerUsuarios(db)));
        return u;
      }
      await guardarUsuariosDeLaNube(db, nube.usuarios);
    } else {
      // Misma nube: el dueño deja en el equipo su clave (la de un empleado sirve para menos).
      if (claveLocal !== nube.clave && (claveLocal === '' || claveLocal.startsWith('e.')) ) await activarNube(db, nube.clave, nube.nube);
      else if (!(await leerAjuste<string>(db, 'nube.id', ''))) await guardarAjuste(db, 'nube.id', nube.nube);
      const locales = await leerUsuarios(db);
      const lista = completarUsuarios(nube.usuarios, locales);
      if (!(await usuariosSinSubir(db)) && JSON.stringify(locales) !== JSON.stringify(lista)) {
        // Una clave cambiada o un empleado nuevo en otro equipo llega a éste.
        await guardarUsuariosDeLaNube(db, lista);
      }
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
  if (!local && nube.tipo === 'sin-nube' && (await leerUsuarios(db)).length === 0) {
    throw new ErrorKiosco('No hay conexión con la nube. Para entrar por primera vez en este equipo hace falta internet.');
  }
  if (!local) throw new ErrorKiosco(nube.tipo === 'rechazado' ? nube.error : 'Usuario o clave incorrectos.');
  return local;
}
