import type { MedioPago } from '../dominio/tipos';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  CircleDollarSign,
  ChevronDown,
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
  PackageX,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
  X,
  CircleHelp,
  Repeat,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import { CANTIDAD_MAXIMA, RENGLON_MAXIMO } from '../dominio/carrito';
import { formatPesos, parsePesos, textoTecleado } from '../dominio/dinero';
import { codigoEscaneado } from '../dominio/entrada';
import { ErrorKiosco } from '../datos/operaciones';

// ---------- Avisos ----------

interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
  accion?: { texto: string; hacer: () => void };
}

const ContextoAvisos = createContext<(a: Omit<Aviso, 'id'>) => void>(() => {});
const ContextoAvisosActuales = createContext<{ avisos: Aviso[]; quitar: (id: number) => void }>({ avisos: [], quitar: () => {} });

export function useAvisar() {
  return useContext(ContextoAvisos);
}

/** El navegador se quedó sin lugar para la base (IndexedDB): reintentar no sirve. */
function sinLugar(e: unknown): boolean {
  for (let x = e as { name?: string; inner?: unknown } | undefined, i = 0; x && i < 4; x = x.inner as typeof x, i++) {
    if (x.name === 'QuotaExceededError') return true;
  }
  return false;
}

export function errorATexto(e: unknown): string {
  if (e instanceof ErrorKiosco) return e.message;
  console.error(e);
  if (sinLugar(e)) return 'El navegador se quedó sin lugar y no se guardó. Bajá una copia en Ajustes y liberá espacio en el equipo (fotos, descargas).';
  return 'Algo falló y no se guardó. Probá de nuevo.';
}

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);
  const avisar = useCallback((a: Omit<Aviso, 'id'>) => {
    const id = siguiente.current++;
    // De a dos como mucho y uno de cada tipo: el nuevo reemplaza al anterior del mismo tipo, y un "listo" borra el error
    // que quedaba (si se pudo hacer, el error ya no corre).
    setAvisos((lista) => [...lista.filter((x) => x.tipo !== a.tipo && !(a.tipo === 'ok' && x.tipo === 'error')).slice(-1), { ...a, id }]);
    window.setTimeout(() => setAvisos((lista) => lista.filter((x) => x.id !== id)), a.accion ? 6000 : 3000);
  }, []);
  const quitar = useCallback((id: number) => setAvisos((lista) => lista.filter((x) => x.id !== id)), []);
  const actuales = useMemo(() => ({ avisos, quitar }), [avisos, quitar]);
  return (
    <ContextoAvisos.Provider value={avisar}>
      <ContextoAvisosActuales.Provider value={actuales}>{children}</ContextoAvisosActuales.Provider>
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

/**
 * El último aviso como una línea dentro de otro panel (el total de la caja en la PC), en vez de flotando
 * encima de algo. Con `en-linea` presente, el CSS esconde los avisos flotantes de esa pantalla.
 */
export function AvisoEnLinea({ className = '' }: { className?: string }) {
  const { avisos, quitar } = useContext(ContextoAvisosActuales);
  const a = avisos[avisos.length - 1];
  if (!a) return null;
  return (
    <span className={`aviso-en-linea aviso-en-linea-${a.tipo} ${className}`} role={a.tipo === 'error' ? 'alert' : 'status'}>
      <span className="aviso-en-linea-texto">{a.texto}</span>
      {a.accion && (
        <button
          type="button"
          className="aviso-accion"
          onClick={() => {
            a.accion!.hacer();
            quitar(a.id);
          }}
        >
          {a.accion.texto}
        </button>
      )}
    </span>
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
  // Al cerrar, el foco vuelve a donde estaba (el buscador de la caja, por ejemplo).
  const [origen] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    return () => {
      if (origen && document.contains(origen) && !origen.closest('dialog')) origen.focus();
    };
  }, [origen]);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      // React ya enfocó el campo con autoFocus; showModal() lo movería a la ✕.
      const previo = document.activeElement as HTMLElement | null;
      d.showModal();
      // Un botón con data-autofocus gana (autoFocus no llega porque el diálogo todavía está cerrado).
      // En una pantalla táctil un campo enfocado abre el teclado encima de la hoja: ahí sólo se enfoca lo pedido con autoFocus.
      const tactil = !window.matchMedia('(pointer: fine)').matches;
      const elegido =
        previo && d.contains(previo) && !previo.closest('.modal-cabecera')
          ? previo
          : d.querySelector<HTMLElement>('[data-autofocus]') ??
            (tactil
              ? null
              : d.querySelector<HTMLElement>('.modal-cuerpo input:not([type=checkbox]), .modal-cuerpo select, .modal-cuerpo textarea') ??
                d.querySelector<HTMLElement>('.modal-cuerpo button'));
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

/**
 * El lector de códigos tipea todas las cifras en milisegundos; una persona, no. Contando las teclas que llegaron
 * de corrido se sabe qué parte de lo escrito fue el lector (y qué parte, si la hay, se tecleó a mano antes).
 */
export const PAUSA_ENTRE_TECLAS = 100;
function useRafaga() {
  const rafaga = useRef({ ultimo: 0, n: 0 });
  return {
    tecla() {
      const ahora = Date.now();
      rafaga.current = { ultimo: ahora, n: ahora - rafaga.current.ultimo < PAUSA_ENTRE_TECLAS ? rafaga.current.n + 1 : 1 };
    },
    reiniciar() {
      rafaga.current = { ultimo: 0, n: 0 };
    },
    /** El código que acaba de tipear el lector (8 a 14 cifras de corrido al final de `texto`), o null. */
    codigo(texto: string): { codigo: string; cabeza: string } | null {
      const n = rafaga.current.n;
      if (n < 8) return null;
      const codigo = codigoEscaneado(texto.slice(-n));
      return codigo ? { codigo, cabeza: texto.slice(0, -n) } : null;
    },
  };
}

export function CampoPesos({
  valor,
  onCambio,
  etiqueta,
  autoFocus,
  grande,
  placeholder,
  id,
  ariaLabel,
  onKeyDown,
  maximo = RENGLON_MAXIMO,
  onEscaneo,
}: {
  valor: number | null;
  onCambio: (v: number | null) => void;
  etiqueta?: string;
  autoFocus?: boolean;
  grande?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Más que esto no se aplica: casi siempre es el lector de códigos con el cursor acá. */
  maximo?: number;
  /** Qué hacer con un código del lector; devuelve true si se hizo cargo. */
  onEscaneo?: (codigo: string) => boolean | void;
}) {
  const avisar = useAvisar();
  const [texto, setTexto] = useState(valor === null ? '' : formatearEdicion(valor));
  // "Como mucho…" va debajo del campo, no en un aviso flotante que queda sobre la ventana siguiente.
  const [error, setError] = useState('');
  const ultimo = useRef(valor);
  // Lo que había al entrar al campo: si lo tecleado rebota, se vuelve a eso (no a un parcial de lo que tipeó el lector).
  const alEntrar = useRef(valor);
  const rafaga = useRafaga();
  useEffect(() => {
    if (valor !== ultimo.current) {
      setTexto(valor === null ? '' : formatearEdicion(valor));
      ultimo.current = valor;
    }
  }, [valor]);
  const pasado = (t: string) => {
    const v = parsePesos(textoTecleado(t));
    return v !== null && v > maximo;
  };
  // Un monto imposible vuelve al valor de antes; si era un código de barras, se suma como producto o se avisa.
  const rebotar = (t: string) => {
    // Sólo lo que llegó de corrido es del lector; "15.000.000" tecleado a mano es un monto pasado, no un código.
    const leido = rafaga.codigo(t.replace(/\D/g, ''));
    const codigo = leido?.codigo ?? null;
    let antes = alEntrar.current;
    // El lector tipeó a continuación de un monto ya escrito ("5.000" + código): el monto queda y el código se suma aparte.
    if (leido && leido.cabeza !== '' && !t.includes(',') && Number(leido.cabeza) <= maximo) antes = Number(leido.cabeza);
    ultimo.current = antes;
    setTexto(antes === null ? '' : formatearEdicion(antes));
    onCambio(antes);
    if (codigo) {
      setError('');
      if (onEscaneo && onEscaneo(codigo) !== false) return;
      avisar({ texto: 'Eso fue el lector, no un monto: escaneá el producto en el buscador de la caja.', tipo: 'error' });
    } else setError(`Como mucho ${formatPesos(maximo)}.`);
  };
  const input = (
    <div className={`campo-pesos ${grande ? 'campo-pesos-grande' : ''} ${error ? 'campo-con-error' : ''}`}>
      <span aria-hidden="true">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder ?? '0'}
        aria-label={ariaLabel ?? etiqueta}
        aria-invalid={error ? true : undefined}
        value={texto}
        onFocus={(e) => {
          alEntrar.current = valor;
          rafaga.reiniciar();
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pasado(e.currentTarget.value)) {
            e.preventDefault();
            e.stopPropagation();
            rebotar(e.currentTarget.value);
            return;
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          if (pasado(e.currentTarget.value)) rebotar(e.currentTarget.value);
        }}
        onChange={(e) => {
          const crudo = e.target.value;
          rafaga.tecla();
          // Pasado el máximo (el lector tipeando su código) se muestra lo escrito pero no se aplica: al Enter o al salir rebota.
          if (pasado(crudo)) {
            setTexto(crudo);
            setError(`Como mucho ${formatPesos(maximo)}.`);
            return;
          }
          setError('');
          const conComa = crudo.includes(',');
          // Al borrar ("15.000" → "15.00") el punto era de miles: se saca y queda 1.500.
          const borrando = crudo.length < texto.length;
          // Los puntos de miles que puso el campo no cuentan al interpretar: "1.500" + "0" es 15.000.
          const v = parsePesos(borrando && !conComa ? crudo.replace(/\./g, '') : textoTecleado(crudo));
          // Los miles se separan mientras se escribe ("2000" → "2.000"); con coma, o con un punto recién tipeado, se deja tal cual.
          setTexto(v !== null && !conComa && (borrando || !/\.\d{0,2}$/.test(crudo)) ? formatearEdicion(v) : crudo);
          ultimo.current = v;
          onCambio(v);
        }}
      />
    </div>
  );
  const textoError = error && (
    <small className="texto-alerta campo-error" role="alert">
      {error}
    </small>
  );
  if (!etiqueta)
    return (
      <>
        {input}
        {textoError}
      </>
    );
  return (
    <label className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      {input}
      {textoError}
    </label>
  );
}

function formatearEdicion(v: number): string {
  return formatPesos(v).replace('$ ', '');
}

// ---------- Campo de cantidad ----------

/**
 * Cantidad entera: unidades de un renglón, billetes del cierre. Si el lector de códigos escanea con el
 * cursor acá, el código no queda como cantidad: se vuelve a la de antes y, si hay `onEscaneo`, se suma
 * como producto. Hasta el largo del máximo se aplica al toque; más largo se espera al Enter o al salir.
 */
export function CampoCantidad({
  valor,
  onCambio,
  ariaLabel,
  max = CANTIDAD_MAXIMA,
  minimo = 0,
  vacioEnCero = false,
  onEscaneo,
  enVivo = true,
}: {
  valor: number;
  onCambio: (n: number) => void;
  ariaLabel: string;
  max?: number;
  /** Por debajo no se aplica (1 en un renglón: borrar el campo no saca el producto). */
  minimo?: number;
  /** Con 0 se muestra vacío, con el placeholder. */
  vacioEnCero?: boolean;
  /** Qué hacer con un código del lector; devuelve true si se hizo cargo. */
  onEscaneo?: (texto: string) => boolean;
  /** Con `false`, la cantidad se aplica recién al Enter o al salir del campo (así "1" de "12" no toca la venta). */
  enVivo?: boolean;
}) {
  const avisar = useAvisar();
  const mostrar = (n: number) => (n === 0 && vacioEnCero ? '' : String(n));
  const [texto, setTexto] = useState(() => mostrar(valor));
  const [conFoco, setConFoco] = useState(false);
  const [error, setError] = useState('');
  const antes = useRef(valor);
  const rafaga = useRafaga();
  useEffect(() => {
    if (!conFoco) setTexto(valor === 0 && vacioEnCero ? '' : String(valor));
  }, [valor, conFoco, vacioEnCero]);
  const largo = String(max).length;
  const terminar = (crudo: string) => {
    setConFoco(false);
    if (crudo.length > largo) {
      // Lo que llegó de corrido fue el lector; "12" tecleado antes es la cantidad: se aplican las dos cosas.
      const leido = rafaga.codigo(crudo);
      const cabeza = leido ? Number(leido.cabeza) : NaN;
      const cantidad = leido && leido.cabeza !== '' && cabeza >= Math.max(1, minimo) && cabeza <= max ? cabeza : antes.current;
      // Primero la cantidad de este renglón; después lo escaneado (que puede reacomodar los renglones).
      onCambio(cantidad);
      setTexto(mostrar(cantidad));
      if (leido && onEscaneo && onEscaneo(leido.codigo)) {
        if (cantidad !== antes.current) avisar({ texto: `Quedaron ${cantidad}, y lo que pasó el lector se sumó aparte.`, tipo: 'ok' });
        return;
      }
      if (leido) avisar({ texto: 'Pasaste el lector con el cursor acá: en este campo va cuántos hay.', tipo: 'error' });
      else setError(`Como mucho ${max}.`);
      return;
    }
    const n = crudo === '' ? (minimo > 0 ? antes.current : 0) : Math.min(Number(crudo), max);
    const final = n < minimo ? antes.current : n;
    if (final !== valor) onCambio(final);
    setTexto(mostrar(final));
  };
  const campo = (
    <input
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={error ? true : undefined}
      placeholder="0"
      value={texto}
      onFocus={(e) => {
        antes.current = valor;
        rafaga.reiniciar();
        setConFoco(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, '');
        rafaga.tecla();
        setTexto(t);
        setError('');
        const n = Number(t);
        if (enVivo && t.length <= largo && n >= minimo) onCambio(Math.min(n, max));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.value = mostrar(antes.current);
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => terminar(e.currentTarget.value)}
    />
  );
  // El error queda pegado abajo del campo, sin correr el renglón. El envoltorio está siempre, así el campo no pierde el foco.
  return (
    <span className="campo-cantidad">
      {campo}
      {error && (
        <small className="texto-alerta campo-error campo-error-flotante" role="alert">
          {error}
        </small>
      )}
    </span>
  );
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
  devolver: PackageX,
  copiar: Copy,
  bandeja: Inbox,
  dividir: Split,
  inicio: LayoutDashboard,
  impresora: Printer,
  peso: Scale,
  camion: Truck,
  vence: CalendarClock,
  ayuda: CircleHelp,
  repetir: Repeat,
  consejo: Lightbulb,
  lector: ScanBarcode,
  abrir: ChevronDown,
  promo: Tag,
  sube: TrendingUp,
  baja: TrendingDown,
  billetera: Wallet,
  monto: CircleDollarSign,
} satisfies Record<string, LucideIcon>;

export type NombreIcono = keyof typeof ICONOS;

/** El ícono de cada medio de pago, el mismo en la caja, el cierre y las devoluciones. */
export const ICONO_MEDIO: Record<MedioPago, NombreIcono> = {
  efectivo: 'efectivo',
  mercadopago: 'qr',
  tarjeta: 'tarjeta',
  transferencia: 'transferencia',
  fiado: 'clientes',
};

/** Copia al portapapeles; en http (sin https) el navegador no da navigator.clipboard y se usa el método viejo. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* se prueba el método viejo */
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

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

/** "Coca-Cola 500 ml" no se parte entre el número y la unidad al cortar la línea. */
export function sinCortes(nombre: string): string {
  return nombre.replace(/(\d)\s+(ml|cc|g|gr|kg|l|lt|u|un|cm|m)\b/gi, '$1 $2');
}

/** Desplegable: la flecha gira cuando está abierto. */
export function Desplegable({ abierto, titulo, texto, onClick }: { abierto: boolean; titulo: string; texto?: string; onClick: () => void }) {
  return (
    <button type="button" className="desplegable" aria-expanded={abierto} onClick={onClick}>
      <span className="titulo-chico">{titulo}</span>
      <span className="texto-suave desplegable-indicador">
        {texto ?? (abierto ? 'Ocultar' : 'Mostrar')} <Icono nombre="abrir" tam={18} />
      </span>
    </button>
  );
}

/** "27/10, 18:45" (en Argentina la hora va en 24 h). */
export function fechaCorta(ms: number): string {
  return new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "hoy a las 18:45", "ayer a las 18:45" o "el 25/10 a las 18:45". */
export function cuando(ms: number, ahora = Date.now()): string {
  const dia = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const dias = Math.round((dia(ahora) - dia(ms)) / 86_400_000);
  const h = hora(ms);
  if (dias === 0) return `hoy a las ${h}`;
  if (dias === 1) return `ayer a las ${h}`;
  return `el ${new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} a las ${h}`;
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
