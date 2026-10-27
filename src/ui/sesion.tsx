import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Usuario } from '../datos/usuarios';

// Quién está usando el sistema. Dura mientras la pestaña esté abierta:
// al cerrar el navegador se vuelve a pedir usuario y clave.

export type Sesion = Pick<Usuario, 'usuario' | 'nombre' | 'admin'>;

const LLAVE = 'milenio.sesion';

function leer(): Sesion | null {
  try {
    const crudo = sessionStorage.getItem(LLAVE);
    return crudo ? (JSON.parse(crudo) as Sesion) : null;
  } catch {
    return null;
  }
}

const Contexto = createContext<{ sesion: Sesion | null; entrar: (u: Sesion) => void; salir: () => void }>({
  sesion: null,
  entrar: () => {},
  salir: () => {},
});

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(leer);
  const entrar = (u: Sesion) => {
    const s = { usuario: u.usuario, nombre: u.nombre, admin: u.admin };
    try {
      sessionStorage.setItem(LLAVE, JSON.stringify(s));
    } catch {
      /* sin almacenamiento: la sesión dura hasta recargar */
    }
    setSesion(s);
  };
  const salir = () => {
    try {
      sessionStorage.removeItem(LLAVE);
      // La venta a medio hacer no pasa al usuario que entre después.
      for (const k of ['milenio.carrito', 'milenio.espera', 'milenio.ultima']) {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
      }
    } catch {
      /* nada */
    }
    setSesion(null);
  };
  return <Contexto.Provider value={{ sesion, entrar, salir }}>{children}</Contexto.Provider>;
}

export const useSesion = () => useContext(Contexto);
