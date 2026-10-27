import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { db } from '../datos/db';
import { ingresar } from '../datos/usuarios';
import { Icono, Modal } from './componentes';
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
          setEnCurso(true);
          const u = await ingresar(db, usuario.trim().toLowerCase(), clave).catch(() => null);
          setEnCurso(false);
          if (!u || !u.admin) {
            setError(u ? 'Ese usuario no tiene permiso de dueño.' : 'Usuario o clave incorrectos.');
            setClave('');
            return;
          }
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
