import { liveQuery } from 'dexie';
import { db } from '../datos/db';
import { sincronizarAhora } from '../datos/nube';
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
 * Sube los cambios a la nube cada minuto y apenas vuelve internet.
 * Sin clave guardada no hace nada; los errores quedan anotados para mostrarlos.
 */
export function useCopiaEnLaNube(activa: boolean) {
  useEffect(() => {
    if (!activa) return;
    const subir = () => {
      if (navigator.onLine) sincronizarAhora(db).catch(() => {});
    };
    subir();
    const reloj = window.setInterval(subir, 60_000);
    window.addEventListener('online', subir);
    return () => {
      window.clearInterval(reloj);
      window.removeEventListener('online', subir);
    };
  }, [activa]);
}
