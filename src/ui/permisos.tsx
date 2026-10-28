import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { db } from '../datos/db';
import { comprobarDueño } from '../datos/ingreso';
import { errorATexto, Icono, Modal } from './componentes';
import { useSesion } from './sesion';

// El dueño hace todo. Un empleado cobra y cierra su caja; para anular una venta
// o sacar plata de la caja tiene que poner la clave alguien con permiso de dueño.

export function useEsDueño(): boolean {
  const { sesion } = useSesion();
  return !sesion || sesion.admin;
}

type Pedir = (motivo: string) => Promise<string | null>;

const Contexto = createContext<Pedir>(async () => null);

/** Devuelve el usuario que autorizó, o null si se canceló. */
export const usePedirDueño = () => useContext(Contexto);

export function ProveedorPermisos({ children }: { children: ReactNode }) {
  const { sesion } = useSesion();
  const [pedido, setPedido] = useState<string | null>(null);
  const resolver = useRef<(u: string | null) => void>(() => {});

  const pedir = useCallback<Pedir>(
    (motivo) => {
      if (!sesion) return Promise.resolve('dueño');
      if (sesion.admin) return Promise.resolve(sesion.usuario);
      setPedido(motivo);
      return new Promise((r) => (resolver.current = r));
    },
    [sesion],
  );

  const terminar = (u: string | null) => {
    setPedido(null);
    resolver.current(u);
  };

  return (
    <Contexto.Provider value={pedir}>
      {children}
      {pedido && <ClaveDelDueño motivo={pedido} onListo={terminar} />}
    </Contexto.Provider>
  );
}

// Probar claves de 4 cifras a mano no tiene que ser fácil: después de 5 fallos
// seguidos hay que esperar un minuto (y otro más por cada fallo siguiente).
const fallos: number[] = [];
const anotarFallo = () => fallos.push(Date.now());
function esperaPorFallos(): number {
  if (fallos.length < 5) return 0;
  return Math.max(0, fallos[fallos.length - 1]! + 60_000 - Date.now());
}

function ClaveDelDueño({ motivo, onListo }: { motivo: string; onListo: (u: string | null) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enCurso, setEnCurso] = useState(false);
  const cerrar = useCallback(() => onListo(null), [onListo]);
  return (
    <Modal titulo="Hace falta el dueño" onCerrar={cerrar}>
      <form
        className="formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          const espera = esperaPorFallos();
          if (espera > 0) return setError(`Demasiadas claves mal seguidas: esperá ${Math.ceil(espera / 1000)} segundos.`);
          setEnCurso(true);
          let u: Awaited<ReturnType<typeof comprobarDueño>>;
          try {
            u = await comprobarDueño(db, usuario, clave);
          } catch (err) {
            setEnCurso(false);
            return setError(errorATexto(err));
          }
          setEnCurso(false);
          if (!u || !u.admin) {
            if (!u) anotarFallo();
            setError(u ? 'Ese usuario no tiene permiso de dueño.' : 'Usuario o clave incorrectos.');
            setClave('');
            return;
          }
          fallos.length = 0;
          onListo(u.usuario);
        }}
      >
        <p className="permiso-motivo">
          <Icono nombre="candado" tam={20} />
          <span>{motivo}. Pedile al dueño que ponga su usuario y clave.</span>
        </p>
        <label className="campo">
          <span className="campo-etiqueta">Usuario del dueño</span>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="off" autoCapitalize="none" />
        </label>
        <label className="campo">
          <span className="campo-etiqueta">Clave</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
        </label>
        {error && (
          <p className="texto-alerta" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton boton-primario boton-grande" disabled={!usuario.trim() || !clave || enCurso} aria-busy={enCurso}>
          {enCurso ? 'Comprobando la clave…' : 'Autorizar'}
        </button>
      </form>
    </Modal>
  );
}
