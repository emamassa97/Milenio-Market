import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Banknote,
  Calculator,
  ChartColumn,
  Check,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  CreditCard,
  Download,
  Ellipsis,
  Inbox,
  Landmark,
  Lock,
  LogOut,
  MessageCircle,
  Minus,
  NotebookPen,
  Package,
  PackageOpen,
  Pause,
  Pencil,
  Percent,
  Plus,
  QrCode,
  Receipt,
  ScanBarcode,
  Search,
  Split,
  LayoutDashboard,
  Printer,
  Scale,
  Truck,
  CalendarClock,
  Tag,
  TrendingUp,
  TrendingDown,
  Wallet,
  Settings,
  ShoppingCart,
  Star,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
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
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`} role={a.tipo === 'error' ? 'alert' : 'status'}>
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
    if (d && !d.open) {
      // React ya enfocó el campo con autoFocus; showModal() lo movería a la ✕.
      const previo = document.activeElement as HTMLElement | null;
      d.showModal();
      const elegido =
        previo && d.contains(previo) && !previo.closest('.modal-cabecera')
          ? previo
          : d.querySelector<HTMLElement>('.modal-cuerpo input:not([type=checkbox]), .modal-cuerpo select, .modal-cuerpo textarea') ??
            d.querySelector<HTMLElement>('.modal-cuerpo button');
      elegido?.focus();
    }
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

// ---------- Íconos (Lucide, heredan el color del texto) ----------

const ICONOS = {
  cerrar: X,
  camara: ScanBarcode,
  mas: Plus,
  menos: Minus,
  basura: Trash2,
  estrella: Star,
  lapiz: Pencil,
  buscar: Search,
  check: Check,
  pausa: Pause,
  whatsapp: MessageCircle,
  descargar: Download,
  subir: Upload,
  nube: Cloud,
  'nube-no': CloudOff,
  porcentaje: Percent,
  caja: ShoppingCart,
  productos: Package,
  cierre: Calculator,
  reportes: ChartColumn,
  clientes: NotebookPen,
  ajustes: Settings,
  salir: LogOut,
  wifi: Wifi,
  'wifi-no': WifiOff,
  menu: Ellipsis,
  candado: Lock,
  efectivo: Banknote,
  tarjeta: CreditCard,
  qr: QrCode,
  transferencia: Landmark,
  ticket: Receipt,
  alerta: TriangleAlert,
  vacio: PackageOpen,
  usuario: UserRound,
  reloj: Clock,
  deshacer: Undo2,
  copiar: Copy,
  bandeja: Inbox,
  dividir: Split,
  inicio: LayoutDashboard,
  impresora: Printer,
  peso: Scale,
  camion: Truck,
  vence: CalendarClock,
  promo: Tag,
  sube: TrendingUp,
  baja: TrendingDown,
  billetera: Wallet,
} satisfies Record<string, LucideIcon>;

export type NombreIcono = keyof typeof ICONOS;

export function Icono({ nombre, tam = 22 }: { nombre: NombreIcono; tam?: number }) {
  const Componente = ICONOS[nombre];
  return <Componente size={tam} strokeWidth={1.75} aria-hidden="true" />;
}

export function Vacio({ titulo, children, icono = 'vacio' }: { titulo: string; children?: ReactNode; icono?: NombreIcono }) {
  return (
    <div className="vacio">
      <span className="vacio-icono">
        <Icono nombre={icono} tam={28} />
      </span>
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
