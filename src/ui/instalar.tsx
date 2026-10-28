import { useEffect, useState } from 'react';
import { comoInstalar, detectarNavegador } from '../dominio/instalacion';
import { Icono, useAvisar } from './componentes';
import { TextoAyuda } from './Ayuda';

// Chrome y Edge avisan con `beforeinstallprompt` que la caja se puede instalar. Hay que guardarlo
// apenas llega (antes de que se dibuje Ajustes) para poder abrir su ventana "Instalar" con un botón.

interface EventoInstalar extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pedido: EventoInstalar | null = null;
const avisos = new Set<() => void>();
const cambio = () => avisos.forEach((f) => f());

/** Abierta como aplicación instalada (ventana propia), no en una pestaña del navegador. */
function abiertaComoApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

let recienInstalada = false;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedido = e as EventoInstalar;
    cambio();
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    recienInstalada = true;
    cambio();
  });
}

export type EstadoInstalacion = 'app' | 'instalada' | 'directo' | 'manual';

/** 'app': ya se está usando instalada. 'instalada': se acaba de instalar desde esta pestaña. 'directo': hay botón. 'manual': pasos a mano. */
export function useInstalacion() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((n) => n + 1);
    avisos.add(f);
    const modo = window.matchMedia?.('(display-mode: standalone)');
    modo?.addEventListener?.('change', f);
    return () => {
      avisos.delete(f);
      modo?.removeEventListener?.('change', f);
    };
  }, []);
  const estado: EstadoInstalacion = abiertaComoApp() ? 'app' : recienInstalada ? 'instalada' : pedido ? 'directo' : 'manual';
  const instalar = async (): Promise<boolean> => {
    if (!pedido) return false;
    const p = pedido;
    await p.prompt();
    const { outcome } = await p.userChoice;
    // El mismo aviso no se puede usar dos veces: si dijo que no, Chrome manda otro más adelante.
    pedido = null;
    cambio();
    return outcome === 'accepted';
  };
  return { estado, instalar };
}

/** "Instalar en esta compu": en Ajustes, en la Ayuda y (mientras no esté instalada) en el panel. */
export function InstalarApp({ compacto = false }: { compacto?: boolean }) {
  const { estado, instalar } = useInstalacion();
  const avisar = useAvisar();
  const [verPasos, setVerPasos] = useState(false);
  const navegador = detectarNavegador(navigator.userAgent);
  const como = comoInstalar(navegador);
  const celular = navegador === 'android' || navegador === 'iphone';
  const titulo = celular ? 'Instalar en este celular' : 'Instalar en esta compu';

  if (estado === 'app')
    return compacto ? null : (
      <p className="instalar-listo">
        <Icono nombre="check" tam={18} /> Estás usando Milenio Market instalada en esta compu. Se abre desde el ícono del escritorio o del menú Inicio y se actualiza sola.
      </p>
    );
  if (estado === 'instalada')
    return (
      <p className="instalar-listo">
        <Icono nombre="check" tam={18} /> Listo, quedó instalada. Ya podés cerrar esta pestaña y abrir Milenio Market desde su ícono{celular ? '' : ' en el escritorio o el menú Inicio'}.
      </p>
    );

  return (
    <div className={`instalar ${compacto ? 'instalar-compacto' : ''}`}>
      <div className="instalar-cabeza">
        <img src="/pwa-192.png" alt="" width={48} height={48} />
        <div>
          <strong>{titulo}</strong>
          <p className="texto-suave">
            {celular ? 'Queda como cualquier aplicación: ícono en la pantalla principal, pantalla completa y funciona sin internet.' : 'Queda como un programa: ícono en el escritorio, ventana propia sin barra del navegador y funciona sin internet.'}
          </p>
        </div>
      </div>
      <div className="botonera">
        {estado === 'directo' ? (
          <button
            type="button"
            className="boton boton-primario"
            onClick={async () => {
              try {
                if (!(await instalar())) avisar({ texto: 'No se instaló. Cuando quieras, volvé a tocar el botón.', tipo: 'info' });
              } catch {
                setVerPasos(true);
              }
            }}
          >
            <Icono nombre="instalar" tam={18} /> {titulo}
          </button>
        ) : (
          <button type="button" className={`boton ${compacto ? '' : 'boton-primario'}`} aria-expanded={verPasos} onClick={() => setVerPasos(!verPasos)}>
            <Icono nombre="instalar" tam={18} /> {verPasos ? 'Ocultar los pasos' : 'Cómo instalarla'}
          </button>
        )}
      </div>
      {verPasos && estado === 'manual' && (
        <div className="instalar-pasos">
          {como.puede && <p className="texto-suave">Este navegador no ofrece el botón directo, pero se instala así:</p>}
          <ol className="ayuda-pasos">
            {como.pasos.map((p, i) => (
              <li key={i}>
                <TextoAyuda texto={p} />
              </li>
            ))}
          </ol>
          {como.puede && <p className="texto-suave">¿No aparece la opción? Puede que ya esté instalada: buscá "Milenio Market" en el menú Inicio.</p>}
        </div>
      )}
    </div>
  );
}

const CLAVE_NO_AHORA = 'milenio-instalar-no-ahora';

/** En el panel: sólo cuando el navegador ofrece instalarla con un clic, y hasta que diga "Ahora no". */
export function AvisoInstalar() {
  const { estado } = useInstalacion();
  const [noAhora, setNoAhora] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_NO_AHORA) === '1';
    } catch {
      return false;
    }
  });
  if (noAhora || (estado !== 'directo' && estado !== 'instalada')) return null;
  return (
    <section className="tarjeta aviso-instalar solo-pc">
      <InstalarApp compacto />
      {estado === 'directo' && (
        <button
          type="button"
          className="boton boton-chico boton-texto"
          onClick={() => {
            try {
              localStorage.setItem(CLAVE_NO_AHORA, '1');
            } catch {
              /* sin almacenamiento: se oculta hasta recargar */
            }
            setNoAhora(true);
          }}
        >
          Ahora no
        </button>
      )}
    </section>
  );
}
