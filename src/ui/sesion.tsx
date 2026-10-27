import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Usuario } from '../datos/usuarios';

// Quién está usando el sistema. Con "Recordarme" queda guardado en el equipo: el empleado 30 días
// (se renuevan cada vez que abre); el dueño sólo 12 horas, porque su sesión abierta deja al que
// atienda después con permiso para anular, retirar plata o borrar datos. Sin "Recordarme" dura
// mientras la pestaña esté abierta.

export type Sesion = Pick<Usuario, 'usuario' | 'nombre' | 'admin'>;
type Guardada = Sesion & { vence?: number };

const LLAVE = 'milenio.sesion';
// Marca de "en esta pestaña entra otra persona": no se toma la sesión recordada del equipo hasta que alguien entre.
const LLAVE_OTRA = 'milenio.sesion.otra';
/** Quién tendría que entrar ahora (p. ej. a quien se le pasó la caja): el ingreso lo deja escrito. */
export const LLAVE_SIGUIENTE = 'milenio.sesion.siguiente';
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

// Cada persona recordada tiene además su propia copia: si entra otra con "Recordarme" (o sale), la de esta no se pisa.
const llaveDe = (usuario: string) => `${LLAVE}.de.${usuario}`;

function leerDe(usuario: string): Guardada | null {
  const crudo = localStorage.getItem(llaveDe(usuario));
  if (!crudo) {
    // Sesiones guardadas antes de que existiera la copia propia.
    const larga = leerLarga();
    return larga?.usuario === usuario ? larga : null;
  }
  const s = JSON.parse(crudo) as Guardada;
  if (!s.vence || s.vence < Date.now()) {
    localStorage.removeItem(llaveDe(usuario));
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
      // Si en otra pestaña entró otra persona con "Recordarme", esta pestaña sigue siendo de quien era.
      const propia = leerDe(s.usuario);
      if (!propia) {
        sessionStorage.removeItem(LLAVE);
        return null;
      }
      return propia;
    }
    if (sessionStorage.getItem(LLAVE_OTRA)) return null;
    const larga = leerLarga();
    if (!larga) return null;
    // El empleado renueva el plazo cada vez que abre; el dueño no.
    const renovada = larga.admin ? larga : { ...larga, vence: vencimiento(false) };
    localStorage.setItem(LLAVE, JSON.stringify(renovada));
    localStorage.setItem(llaveDe(renovada.usuario), JSON.stringify(renovada));
    sessionStorage.setItem(LLAVE, JSON.stringify(renovada));
    return renovada;
  } catch {
    return null;
  }
}

const Contexto = createContext<{ sesion: Sesion | null; entrar: (u: Sesion, recordar?: boolean) => void; salir: () => void; cambiar: (siguiente?: string) => void }>({
  sesion: null,
  entrar: () => {},
  salir: () => {},
  cambiar: () => {},
});

/** Saca la sesión recordada del equipo sólo si es de este usuario: la de otra persona (en otra pestaña) no se toca. */
function olvidarSiEsDe(usuario: string) {
  localStorage.removeItem(llaveDe(usuario));
  if (leerLarga()?.usuario === usuario) localStorage.removeItem(LLAVE);
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Guardada | null>(leer);
  const entrar = (u: Sesion, recordar?: boolean) => {
    // Si no se dice, se mantiene lo que había (p. ej. cuando se refresca el nombre): recordada sólo si el guardado en el equipo es este mismo usuario.
    let larga = recordar;
    if (larga === undefined) {
      try {
        larga = leerDe(u.usuario) !== null;
      } catch {
        larga = false;
      }
    }
    const s: Guardada = { usuario: u.usuario, nombre: u.nombre, admin: u.admin, ...(larga ? { vence: vencimiento(u.admin) } : {}) };
    try {
      sessionStorage.removeItem(LLAVE_OTRA);
      sessionStorage.setItem(LLAVE, JSON.stringify(s));
      if (larga) {
        localStorage.setItem(LLAVE, JSON.stringify(s));
        localStorage.setItem(llaveDe(u.usuario), JSON.stringify(s));
      }
      // Entrar sin "Recordarme" olvida la propia sesión recordada; la de otra persona queda.
      else if (recordar === false) olvidarSiEsDe(u.usuario);
    } catch {
      /* sin almacenamiento: la sesión dura hasta recargar */
    }
    setSesion(s);
  };
  const salir = () => {
    // La venta armada y las que están en espera son del kiosco, no del usuario: quedan para el que sigue.
    try {
      sessionStorage.removeItem(LLAVE);
      if (sesion) olvidarSiEsDe(sesion.usuario);
    } catch {
      /* nada */
    }
    setSesion(null);
  };
  // "Cambiar de usuario": esta pestaña pasa a la pantalla de ingreso sin tocar la sesión recordada del equipo (la otra persona sigue en su pestaña).
  const cambiar = (siguiente?: string) => {
    try {
      sessionStorage.removeItem(LLAVE);
      sessionStorage.setItem(LLAVE_OTRA, '1');
      if (siguiente) sessionStorage.setItem(LLAVE_SIGUIENTE, siguiente);
    } catch {
      /* nada */
    }
    setSesion(null);
  };
  // Salir en una pestaña cierra la sesión recordada de esa misma persona en todas las demás.
  useEffect(() => {
    const cambio = (e: StorageEvent) => {
      if (!e.key?.startsWith(`${LLAVE}.de.`) || e.newValue !== null) return;
      const quien = e.key.slice(`${LLAVE}.de.`.length);
      setSesion((s) => {
        if (!s?.vence || quien !== s.usuario) return s;
        try {
          sessionStorage.removeItem(LLAVE);
        } catch {
          /* nada */
        }
        return null;
      });
    };
    window.addEventListener('storage', cambio);
    return () => window.removeEventListener('storage', cambio);
  }, []);
  return <Contexto.Provider value={{ sesion, entrar, salir, cambiar }}>{children}</Contexto.Provider>;
}

export const useSesion = () => useContext(Contexto);
