import { liveQuery } from 'dexie';
import { totalCarrito, type Carrito } from '../dominio/carrito';
import { db } from '../datos/db';
import { AL_VOLVER_CADA, estadoNube, pedirAlta, pendientes, sincronizarAhora, tocaSincronizar, type EstadoNube } from '../datos/nube';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** Lee de la base y se actualiza sola cuando los datos cambian. */
export function useConsulta<T>(consulta: () => Promise<T>, deps: DependencyList, inicial: T): T {
  const [valor, setValor] = useState<T>(inicial);
  useEffect(() => {
    const sub = liveQuery(consulta).subscribe({
      next: setValor,
      error: (e: unknown) => console.error('Error leyendo datos', e),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return valor;
}

export function useConexion(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const si = () => setOnline(true);
    const no = () => setOnline(false);
    window.addEventListener('online', si);
    window.addEventListener('offline', no);
    return () => {
      window.removeEventListener('online', si);
      window.removeEventListener('offline', no);
    };
  }, []);
  return online;
}

let audio: AudioContext | null = null;

/** Pitido corto al escanear o cobrar. Si el navegador no deja, no pasa nada. */
export function pitido(tipo: 'ok' | 'error' = 'ok') {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.frequency.value = tipo === 'ok' ? 1500 : 300;
    vol.gain.value = 0.08;
    osc.connect(vol).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (tipo === 'ok' ? 0.08 : 0.25));
  } catch {
    /* sin sonido */
  }
}


/** `true` mientras se va bajando por la página (para esconder el botón redondo del celular y que no tape la lista). */
export function useBajando(): boolean {
  const [bajando, setBajando] = useState(false);
  useEffect(() => {
    let ultimo = window.scrollY;
    const mirar = () => {
      const y = window.scrollY;
      // Cerca del tope siempre se ve; si no, se esconde al bajar y vuelve al subir. El punto de referencia
      // sólo se mueve cuando se pasó el umbral, así un arrastre lento también cuenta.
      if (y < 80) {
        setBajando(false);
        ultimo = y;
      } else if (Math.abs(y - ultimo) > 12) {
        setBajando(y > ultimo);
        ultimo = y;
      }
    };
    window.addEventListener('scroll', mirar, { passive: true });
    return () => window.removeEventListener('scroll', mirar);
  }, []);
  return bajando;
}

/**
 * Evita guardar dos veces por un doble clic o doble Enter:
 * mientras una acción está en curso, las siguientes se ignoran.
 */
export function useUnaVez(): [boolean, (accion: () => Promise<void>) => Promise<void>] {
  const [enCurso, setEnCurso] = useState(false);
  const bloqueo = useRef(false);
  const ejecutar = useCallback(async (accion: () => Promise<void>) => {
    if (bloqueo.current) return;
    bloqueo.current = true;
    setEnCurso(true);
    try {
      await accion();
    } finally {
      bloqueo.current = false;
      setEnCurso(false);
    }
  }, []);
  return [enCurso, ejecutar];
}

/**
 * Sincroniza con la nube sin tenerla prendida todo el día: lo nuevo sube cada
 * 10 minutos como mucho y, si no hay nada nuevo, se baja lo de los otros equipos
 * cada media hora (ver `tocaSincronizar`). Al volver internet o a la pantalla
 * (el celular que se saca del bolsillo se pone al día) va en el momento, con un
 * mínimo de 2 minutos entre vueltas. La primera vez, si la nube todavía no tiene
 * dueño, este equipo recibe la clave solo. Los errores quedan anotados para mostrarlos.
 */
export function useCopiaEnLaNube(activa: boolean) {
  useEffect(() => {
    if (!activa) return;
    let ultimoIntento: number | null = null;
    const sincronizar = () => {
      if (!navigator.onLine) return;
      ultimoIntento = Date.now();
      pedirAlta(db)
        .then((conClave) => (conClave ? sincronizarAhora(db) : null))
        .catch(() => {});
    };
    const revisar = () => {
      if (!navigator.onLine) return;
      pendientes(db)
        .then((n) => {
          if (tocaSincronizar(Date.now(), ultimoIntento, n > 0)) sincronizar();
        })
        .catch(() => {});
    };
    const alVolver = () => {
      if (ultimoIntento === null || Date.now() - ultimoIntento >= AL_VOLVER_CADA) sincronizar();
    };
    sincronizar();
    const reloj = window.setInterval(revisar, 30_000);
    window.addEventListener('online', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(reloj);
      window.removeEventListener('online', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [activa]);
}

const NUBE_INICIAL: EstadoNube = { activa: false, sinActivar: false, error: null, pendientes: 0, ultima: null, aviso: null };

/**
 * Estado de la copia en la nube, al día. `aviso` trae el texto para mostrar
 * (por ejemplo "Nube sin activar: escribí la clave en Ajustes.") o null.
 */
export function useEstadoNube(): EstadoNube {
  return useConsulta(() => estadoNube(db), [], NUBE_INICIAL);
}

/** Si la pantalla cumple una media query (`(max-width: 1400px)`), al día cuando cambia el tamaño. */
export function useMedia(consulta: string): boolean {
  const [cumple, setCumple] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const cambio = () => setCumple(m.matches);
    cambio();
    m.addEventListener('change', cambio);
    return () => m.removeEventListener('change', cambio);
  }, [consulta]);
  return cumple;
}

// Lo que la caja deja guardado en el navegador (carrito, ventas en espera, última venta), para leerlo desde otra pantalla.
export const LLAVE_CARRITO = 'milenio.carrito';
export const LLAVE_ESPERA = 'milenio.espera';
export const LLAVE_ULTIMA = 'milenio.ultima';
/** Con cuánto paga el cliente que se está atendiendo: sólo para la pantalla del cliente. */
export const LLAVE_PAGA_CON = 'milenio.pagacon';

export function leerGuardado<T>(llave: string, porDefecto: T): T {
  try {
    const crudo = localStorage.getItem(llave) ?? sessionStorage.getItem(llave);
    const valor = crudo ? (JSON.parse(crudo) as T | null) : null;
    return valor ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

/** Cuántas ventas hay en espera y cuánto suman, con el texto que se muestra. */
export function resumenEspera(espera: unknown): { cantidad: number; total: number; texto: string } {
  const lista = Array.isArray(espera) ? (espera as { carrito?: Carrito }[]) : [];
  const total = lista.reduce((s, e) => s + (e?.carrito ? totalCarrito(e.carrito) : 0), 0);
  const cantidad = lista.length;
  return { cantidad, total, texto: cantidad === 1 ? 'Una venta en espera' : `${cantidad} ventas en espera` };
}
