import type { BaseKiosco } from './db';
import { pendientes, sincronizarAhora } from './nube';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';

// Usuarios para entrar al sistema. Se guardan en los ajustes (así viajan con la
// copia en la nube) y la clave nunca se guarda tal cual: sólo su hash PBKDF2.

export interface Usuario {
  usuario: string;
  nombre: string;
  admin: boolean;
  sal: string;
  hash: string;
}

const ITERACIONES = 120_000;
const CLAVE_MINIMA = 4;

const aHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const deHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function derivar(clave: string, sal: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deHex(sal), iterations: ITERACIONES }, base, 256);
  return aHex(bits);
}

const normalizar = (usuario: string) => usuario.trim().toLowerCase();

/**
 * Junta dos listas de usuarios (la de un equipo que se une a la nube y la de la
 * nube): nadie desaparece. Si el mismo usuario está en las dos, gana `preferida`.
 */
export function combinarUsuarios(preferida: Usuario[], otra: Usuario[]): Usuario[] {
  const nombres = new Set(preferida.map((u) => u.usuario));
  return [...preferida, ...otra.filter((u) => u && !nombres.has(u.usuario))];
}

export async function leerUsuarios(db: BaseKiosco): Promise<Usuario[]> {
  return leerAjuste<Usuario[]>(db, 'usuarios', []);
}

/** Claves que se adivinan al toque: todos iguales (0000, aaaa) o seguidas (1234, 4321, 2345). */
function esClaveObvia(clave: string): boolean {
  if (/^(.)\1+$/.test(clave)) return true;
  if (!/^\d+$/.test(clave)) return false;
  const pasos = new Set([...clave].slice(1).map((c, i) => Number(c) - Number(clave[i])));
  return pasos.size === 1 && (pasos.has(1) || pasos.has(-1));
}

function validarClave(clave: string) {
  if (clave.length < CLAVE_MINIMA) throw new ErrorKiosco(`La clave tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
  if (esClaveObvia(clave)) {
    throw new ErrorKiosco('Esa clave es muy fácil de adivinar (como 1234, 4321 o 1111). Elegí otra.');
  }
}

export async function crearUsuario(
  db: BaseKiosco,
  datos: { usuario: string; nombre: string; clave: string; admin: boolean },
): Promise<Usuario> {
  const usuario = normalizar(datos.usuario);
  if (!/^[a-z0-9._-]{2,30}$/.test(usuario)) throw new ErrorKiosco('El usuario va sin espacios: letras, números, punto o guion (2 a 30).');
  validarClave(datos.clave);
  // El hash se calcula antes: IndexedDB cierra la transacción si se espera algo que no es de la base.
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const nuevo: Usuario = { usuario, nombre: datos.nombre.trim() || usuario, admin: datos.admin, sal, hash: await derivar(datos.clave, sal) };
  await db.transaction('rw', db.ajustes, async () => {
    const usuarios = await leerUsuarios(db);
    if (usuarios.some((u) => u.usuario === usuario)) throw new ErrorKiosco('Ya existe un usuario con ese nombre.');
    await guardarAjuste(db, 'usuarios', [...usuarios, nuevo]);
  });
  return nuevo;
}

/** Devuelve el usuario si la clave es correcta; si no, null. */
export async function ingresar(db: BaseKiosco, usuario: string, clave: string): Promise<Usuario | null> {
  const u = (await leerUsuarios(db)).find((x) => x.usuario === normalizar(usuario));
  if (!u) return null;
  return (await derivar(clave, u.sal)) === u.hash ? u : null;
}

export async function cambiarClave(db: BaseKiosco, usuario: string, nueva: string): Promise<void> {
  validarClave(nueva);
  const quien = normalizar(usuario);
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derivar(nueva, sal);
  await db.transaction('rw', db.ajustes, async () => {
    const usuarios = await leerUsuarios(db);
    if (!usuarios.some((u) => u.usuario === quien)) throw new ErrorKiosco('Ese usuario ya no existe.');
    await guardarAjuste(db, 'usuarios', usuarios.map((u) => (u.usuario === quien ? { ...u, sal, hash } : u)));
  });
}

export async function borrarUsuario(db: BaseKiosco, usuario: string): Promise<void> {
  const quien = normalizar(usuario);
  await db.transaction('rw', db.ajustes, async () => {
    const usuarios = await leerUsuarios(db);
    const quedan = usuarios.filter((u) => u.usuario !== quien);
    if (!quedan.some((u) => u.admin)) throw new ErrorKiosco('Tiene que quedar al menos un usuario administrador.');
    await guardarAjuste(db, 'usuarios', quedan);
  });
}

export type UsuarioSesion = Pick<Usuario, 'usuario' | 'nombre' | 'admin'>;

/**
 * Vuelve a leer al usuario de la sesión: si lo borraron devuelve null (hay que
 * pedir ingresar de nuevo); si no, sus datos al día (por ejemplo, si le
 * sacaron el permiso de administrador).
 */
export async function revalidarSesion(db: BaseKiosco, usuario: string | Pick<Usuario, 'usuario'>): Promise<UsuarioSesion | null> {
  const nombre = normalizar(typeof usuario === 'string' ? usuario : usuario.usuario);
  const u = (await leerUsuarios(db)).find((x) => x.usuario === nombre);
  return u ? { usuario: u.usuario, nombre: u.nombre, admin: u.admin } : null;
}

/** Lo que hay guardado en este equipo, para saber qué se pierde al empezar de cero. */
export async function resumenEquipo(db: BaseKiosco): Promise<{ productos: number; ventas: number; clientes: number; sinSubir: number }> {
  const [productos, ventas, clientes, clave] = await Promise.all([db.productos.count(), db.ventas.count(), db.clientes.count(), leerAjuste<string>(db, 'nube.clave', '')]);
  // Con nube, lo que todavía no se subió es lo único que se pierde de verdad.
  return { productos, ventas, clientes, sinSubir: clave ? await pendientes(db) : 0 };
}

/**
 * Para el dueño que se olvidó la clave: borra todo lo guardado en este equipo
 * (usuarios incluidos) y vuelve a la pantalla de crear el usuario. Con la nube,
 * los datos vuelven solos y la clave nueva del dueño llega a todos los equipos.
 */
export async function empezarDeCero(db: BaseKiosco): Promise<void> {
  // Lo que falte subir se sube antes (si hay internet), así no se pierde.
  await sincronizarAhora(db).catch(() => null);
  await db.transaction('rw', db.tables, async () => {
    // Se conserva la nube: al crear el usuario nuevo, este equipo vuelve a traer todo de ahí
    // (y la clave nueva del dueño pasa a valer en todos los equipos).
    const guardar = (await db.ajustes.toArray()).filter((x) => x.clave === 'nube.clave' || x.clave === 'nube.id');
    for (const t of db.tables) await t.clear();
    if (guardar.length) await db.ajustes.bulkPut(guardar);
  });
}
