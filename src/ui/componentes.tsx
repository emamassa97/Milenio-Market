import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatPesos, parsePesos } from '../dominio/dinero';
import { ErrorKiosco } from '../datos/operaciones';

// ---------- Avisos ----------

interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
  accion?: { texto: string; hacer: () => void };
}

const ContextoAvisos = createContext<(a: Omit<Aviso, 'id'>) => void>(() => {});

export function useAvisar() {
  return useContext(ContextoAvisos);
}

export function errorATexto(e: unknown): string {
  if (e instanceof ErrorKiosco) return e.message;
  console.error(e);
  return 'Algo falló y no se guardó. Probá de nuevo.';
}

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);
  const avisar = useCallback((a: Omit<Aviso, 'id'>) => {
    const id = siguiente.current++;
    setAvisos((lista) => [...lista.slice(-1), { ...a, id }]);
    window.setTimeout(() => setAvisos((lista) => lista.filter((x) => x.id !== id)), a.accion ? 6000 : 3000);
  }, []);
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`}>
            <span>{a.texto}</span>
            {a.accion && (
              <button
                type="button"
                className="aviso-accion"
                onClick={() => {
                  a.accion!.hacer();
                  setAvisos((lista) => lista.filter((x) => x.id !== a.id));
                }}
              >
                {a.accion.texto}
              </button>
            )}
          </div>
        ))}
      </div>
    </ContextoAvisos.Provider>
  );
}

// ---------- Ventana ----------

export function Modal({
  titulo,
  onCerrar,
  children,
  ancho = 'normal',
}: {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  ancho?: 'normal' | 'ancho';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onCerrar();
    };
    d?.addEventListener('cancel', cancelar);
    return () => d?.removeEventListener('cancel', cancelar);
  }, [onCerrar]);
  return (
    <dialog ref={ref} className={`modal modal-${ancho}`} aria-label={titulo}>
      <div className="modal-cabecera">
        <h2>{titulo}</h2>
        <button type="button" className="boton-icono" onClick={onCerrar} aria-label="Cerrar">
          <Icono nombre="cerrar" />
        </button>
      </div>
      <div className="modal-cuerpo">{children}</div>
    </dialog>
  );
}

// ---------- Campo de pesos ----------

export function CampoPesos({
  valor,
  onCambio,
  etiqueta,
  autoFocus,
  grande,
  placeholder,
  id,
}: {
  valor: number | null;
  onCambio: (v: number | null) => void;
  etiqueta?: string;
  autoFocus?: boolean;
  grande?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const [texto, setTexto] = useState(valor === null ? '' : formatearEdicion(valor));
  const ultimo = useRef(valor);
  useEffect(() => {
    if (valor !== ultimo.current) {
      setTexto(valor === null ? '' : formatearEdicion(valor));
      ultimo.current = valor;
    }
  }, [valor]);
  const input = (
    <div className={`campo-pesos ${grande ? 'campo-pesos-grande' : ''}`}>
      <span aria-hidden="true">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder ?? '0'}
        value={texto}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setTexto(e.target.value);
          const v = parsePesos(e.target.value);
          ultimo.current = v;
          onCambio(v);
        }}
      />
    </div>
  );
  if (!etiqueta) return input;
  return (
    <label className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      {input}
    </label>
  );
}

function formatearEdicion(v: number): string {
  return formatPesos(v).replace('$ ', '');
}

// ---------- Íconos (trazo, heredan el color del texto) ----------

const TRAZOS: Record<string, ReactNode> = {
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  camara: (
    <>
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 8v8M11 8v8M14 8v8M17 8v8" />
    </>
  ),
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  basura: <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />,
  estrella: <path d="M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.3 7.2 18.8l1-5.4-4-3.7 5.4-.7z" />,
  lapiz: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  buscar: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  check: <path d="M5 12l5 5L19 7" />,
  pausa: <path d="M9 6v12M15 6v12" />,
  whatsapp: <path d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.6zM9.5 9.5c0 3 2 5 5 5l1-1.5-2-1-1 1c-1 0-2.5-1.5-2.5-2.5l1-1-1-2z" />,
  descargar: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  subir: <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />,
  nube: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18Z" />,
  porcentaje: (
    <>
      <path d="M6 18L18 6" />
      <circle cx="7.5" cy="7.5" r="2" />
      <circle cx="16.5" cy="16.5" r="2" />
    </>
  ),
  caja: <path d="M4 8h16v11H4zM4 8l2-4h12l2 4M9 12h6" />,
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </>
  ),
  copiar: <path d="M9 9h10v10H9zM5 15V5h10" />,
  deshacer: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
};

export function Icono({ nombre, tam = 22 }: { nombre: keyof typeof TRAZOS | string; tam?: number }) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <p className="vacio-titulo">{titulo}</p>
      {children}
    </div>
  );
}

export function fechaCorta(ms: number): string {
  return new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function descargarArchivo(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
