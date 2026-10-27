import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Usuario } from '../datos/usuarios';

// Quién está usando el sistema. Con "Recordarme" queda guardado en el equipo: el empleado 30 días
// (se renuevan cada vez que abre); el dueño sólo 12 horas, porque su sesión abierta deja al que
// atienda después con permiso para anular, retirar plata o borrar datos. Sin "Recordarme" dura
// mientras la pestaña esté abierta.

export type Sesion = Pick<Usuario, 'usuario' | 'nombre' | 'admin'>;
type Guardada = Sesion & { vence?: number };

const LLAVE = 'milenio.sesion';
const HORA = 3_600_000;
const DURACION_EMPLEADO = 30 * 24 * HORA;
const DURACION_DUEÑO = 12 * HORA;

function vencimiento(admin: boolean): number {
  return Date.now() + (admin ? DURACION_DUEÑO : DURACION_EMPLEADO);
}

function leerLarga(): Guardada | null {
  const crudo = localStorage.getItem(LLAVE);
  if (!crudo) return null;
  const s = JSON.parse(crudo) as Guardada;
  if (!s.vence || s.vence < Date.now()) {
    localStorage.removeItem(LLAVE);
    return null;
  }
  return s;
}

function leer(): Guardada | null {
  try {
    const corta = sessionStorage.getItem(LLAVE);
    if (corta) {
      const s = JSON.parse(corta) as Guardada;
      // Si era recordada y otra pestaña salió (o venció), acá también se corta.
      if (!s.vence) return s;
      const larga = leerLarga();
      if (!larga) {
        sessionStorage.removeItem(LLAVE);
        return null;
      }
      // Si en otra pestaña entró otra persona con "Recordarme", esta pestaña sigue siendo de quien era (hasta su vencimiento).
      if (larga.usuario !== s.usuario) return s.vence > Date.now() ? s : null;
      return larga;
    }
    const larga = leerLarga();
    if (!larga) return null;
    // El empleado renueva el plazo cada vez que abre; el dueño no.
    const renovada = larga.admin ? larga : { ...larga, vence: vencimiento(false) };
    localStorage.setItem(LLAVE, JSON.stringify(renovada));
    sessionStorage.setItem(LLAVE, JSON.stringify(renovada));
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
  const entrar = (u: Sesion, recordar?: boolean) => {
    // Si no se dice, se mantiene lo que había (p. ej. cuando se refresca el nombre): recordada sólo si el guardado en el equipo es este mismo usuario.
    let larga = recordar;
    if (larga === undefined) {
      try {
        larga = leerLarga()?.usuario === u.usuario;
      } catch {
        larga = false;
      }
    }
    const s: Guardada = { usuario: u.usuario, nombre: u.nombre, admin: u.admin, ...(larga ? { vence: vencimiento(u.admin) } : {}) };
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
  // Salir en una pestaña cierra la sesión recordada en todas las demás.
  useEffect(() => {
    const cambio = (e: StorageEvent) => {
      if (e.key !== LLAVE || e.newValue !== null) return;
      try {
        sessionStorage.removeItem(LLAVE);
      } catch {
        /* nada */
      }
      setSesion((s) => (s?.vence ? null : s));
    };
    window.addEventListener('storage', cambio);
    return () => window.removeEventListener('storage', cambio);
  }, []);
  return <Contexto.Provider value={{ sesion, entrar, salir }}>{children}</Contexto.Provider>;
}

export const useSesion = () => useContext(Contexto);
