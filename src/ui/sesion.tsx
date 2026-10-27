import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { Usuario } from '../datos/usuarios';

// Quién está usando el sistema. Con "Recordarme" queda guardado en el equipo 30 días
// (se renueva cada vez que se abre); si no, dura mientras la pestaña esté abierta.

export type Sesion = Pick<Usuario, 'usuario' | 'nombre' | 'admin'>;
type Guardada = Sesion & { vence?: number };

const LLAVE = 'milenio.sesion';
const DIA = 86_400_000;
const DIAS_RECORDADA = 30;

function leer(): Guardada | null {
  try {
    const corta = sessionStorage.getItem(LLAVE);
    if (corta) return JSON.parse(corta) as Guardada;
    const larga = localStorage.getItem(LLAVE);
    if (!larga) return null;
    const s = JSON.parse(larga) as Guardada;
    if (!s.vence || s.vence < Date.now()) {
      localStorage.removeItem(LLAVE);
      return null;
    }
    // Cada vez que se usa, se renueva el plazo.
    const renovada = { ...s, vence: Date.now() + DIAS_RECORDADA * DIA };
    localStorage.setItem(LLAVE, JSON.stringify(renovada));
    return renovada;
  } catch {
    return null;
  }
}

const Contexto = createContext<{ sesion: Sesion | null; entrar: (u: Sesion, recordar?: boolean) => void; salir: () => void }>({
  sesion: null,
  entrar: () => {},
  salir: () => {},
});

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Guardada | null>(leer);
  const actual = useRef(sesion);
  actual.current = sesion;
  const entrar = (u: Sesion, recordar?: boolean) => {
    // Si no se dice, se mantiene lo que eligió al entrar (p. ej. cuando se refresca el nombre).
    const larga = recordar ?? !!actual.current?.vence;
    const s: Guardada = { usuario: u.usuario, nombre: u.nombre, admin: u.admin, ...(larga ? { vence: Date.now() + DIAS_RECORDADA * DIA } : {}) };
    try {
      sessionStorage.setItem(LLAVE, JSON.stringify(s));
      if (larga) localStorage.setItem(LLAVE, JSON.stringify(s));
      else localStorage.removeItem(LLAVE);
    } catch {
      /* sin almacenamiento: la sesión dura hasta recargar */
    }
    setSesion(s);
  };
  const salir = () => {
    // La venta armada y las que están en espera son del kiosco, no del usuario: quedan para el que sigue.
    try {
      sessionStorage.removeItem(LLAVE);
      localStorage.removeItem(LLAVE);
    } catch {
      /* nada */
    }
    setSesion(null);
  };
  return <Contexto.Provider value={{ sesion, entrar, salir }}>{children}</Contexto.Provider>;
}

export const useSesion = () => useContext(Contexto);
