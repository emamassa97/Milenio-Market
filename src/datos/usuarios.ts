import type { BaseKiosco } from './db';
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

export async function leerUsuarios(db: BaseKiosco): Promise<Usuario[]> {
  return leerAjuste<Usuario[]>(db, 'usuarios', []);
}

export async function crearUsuario(
  db: BaseKiosco,
  datos: { usuario: string; nombre: string; clave: string; admin: boolean },
): Promise<Usuario> {
  const usuario = normalizar(datos.usuario);
  if (!/^[a-z0-9._-]{2,30}$/.test(usuario)) throw new ErrorKiosco('El usuario va sin espacios: letras, números, punto o guion (2 a 30).');
  if (datos.clave.length < CLAVE_MINIMA) throw new ErrorKiosco(`La clave tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
  const usuarios = await leerUsuarios(db);
  if (usuarios.some((u) => u.usuario === usuario)) throw new ErrorKiosco('Ya existe un usuario con ese nombre.');
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const nuevo: Usuario = { usuario, nombre: datos.nombre.trim() || usuario, admin: datos.admin, sal, hash: await derivar(datos.clave, sal) };
  await guardarAjuste(db, 'usuarios', [...usuarios, nuevo]);
  return nuevo;
}

/** Devuelve el usuario si la clave es correcta; si no, null. */
export async function ingresar(db: BaseKiosco, usuario: string, clave: string): Promise<Usuario | null> {
  const u = (await leerUsuarios(db)).find((x) => x.usuario === normalizar(usuario));
  if (!u) return null;
  return (await derivar(clave, u.sal)) === u.hash ? u : null;
}

export async function cambiarClave(db: BaseKiosco, usuario: string, nueva: string): Promise<void> {
  if (nueva.length < CLAVE_MINIMA) throw new ErrorKiosco(`La clave tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
  const usuarios = await leerUsuarios(db);
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derivar(nueva, sal);
  await guardarAjuste(db, 'usuarios', usuarios.map((u) => (u.usuario === usuario ? { ...u, sal, hash } : u)));
}

export async function borrarUsuario(db: BaseKiosco, usuario: string): Promise<void> {
  const usuarios = await leerUsuarios(db);
  const quedan = usuarios.filter((u) => u.usuario !== usuario);
  if (!quedan.some((u) => u.admin)) throw new ErrorKiosco('Tiene que quedar al menos un usuario administrador.');
  await guardarAjuste(db, 'usuarios', quedan);
}
