import { useSesion } from '../ui/sesion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agregarItem,
  calcularVuelto,
  cambiarCantidad,
  carritoVacio,
  esCodigo,
  interpretarEntrada,
  ahorroPromo,
  stockQueUsa,
  itemDeProducto,
  itemPorPeso,
  formatoPeso,
  itemMontoLibre,
  pagosSugeridos,
  quitarItem,
  subtotal,
  totalCarrito,
  unidades,
  type Carrito,
} from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { codigoEscaneado, gramosDeTexto } from '../dominio/entrada';
import { saldoCliente } from '../dominio/fiado';
import { MEDIOS, nombreMedio, type Cliente, type MedioPago, type Pago, type Producto, type Venta } from '../dominio/tipos';
import { imprimirTicket, leerAjustesTicket, TICKET_INICIAL } from '../ui/ticket';
import { db } from '../datos/db';
import {
  abrirTurno,
  anularVenta,
  buscarPorCodigo,
  controlarLimite,
  fondoSugerido,
  guardarCliente,
  guardarProducto,
  leerAjuste,
  registrarCancelacion,
  registrarVenta,
  turnoAbierto,
} from '../datos/operaciones';
import { CampoPesos, errorATexto, fechaCorta, Icono, Modal, sinCortes, useAvisar, type NombreIcono } from '../ui/componentes';
import { Escaner } from '../ui/Escaner';
import { pitido, useConsulta, useUnaVez } from '../ui/hooks';
import { usePedirDueño } from '../ui/permisos';
import { DevolverVenta } from './Devolver';

// El carrito y las ventas en espera sobreviven a cambiar de pantalla, a recargar y a cerrar el navegador.
function useGuardado<T>(llave: string, inicial: T) {
  const [valor, setValor] = useState<T>(() => {
    try {
      const crudo = localStorage.getItem(llave) ?? sessionStorage.getItem(llave);
      return crudo ? (JSON.parse(crudo) as T) : inicial;
    } catch {
      return inicial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(llave, JSON.stringify(valor));
    } catch {
      /* sin almacenamiento: queda en memoria */
    }
  }, [llave, valor]);
  return [valor, setValor] as const;
}

const ICONO_MEDIO: Record<MedioPago, NombreIcono> = {
  efectivo: 'efectivo',
  mercadopago: 'qr',
  tarjeta: 'tarjeta',
  transferencia: 'transferencia',
  fiado: 'clientes',
};

interface UltimaVenta {
  id: number;
  total: number;
  medio: MedioPago;
  hora: number;
  dividido?: boolean;
  vuelto?: number;
  cliente?: string;
}

// Tope para que un código leído por el lector en un campo de plata no se cobre como monto.
const MONTO_MAXIMO = 1_000_000;

// Teclas de función para elegir el medio sin mouse (F3 lleva a "Paga con").
const TECLA_DE: Record<MedioPago, string> = { efectivo: 'F5', mercadopago: 'F6', tarjeta: 'F7', transferencia: 'F9', fiado: 'F10' };
const TECLA_MEDIO: Record<string, MedioPago> = Object.fromEntries(Object.entries(TECLA_DE).map(([m, t]) => [t, m as MedioPago]));

function normalizar(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function PantallaCaja() {
  const turno = useConsulta(() => turnoAbierto(db), [], null as Awaited<ReturnType<typeof turnoAbierto>> | null);
  const cargando = turno === null;
  if (cargando) return null;
  if (!turno) return <AbrirCaja />;
  return <Caja />;
}

function AbrirCaja() {
  const avisar = useAvisar();
  const [cajero, setCajero] = useState('');
  const [fondo, setFondo] = useState<number | null>(null);
  const [sugerido, setSugerido] = useState<{ monto: number; fecha: number } | null>(null);
  const [enCurso, unaVez] = useUnaVez();
  const { sesion } = useSesion();
  useEffect(() => {
    if (sesion) setCajero(sesion.nombre);
    else leerAjuste(db, 'cajero', '').then((c) => setCajero(String(c)));
  }, [sesion]);
  useEffect(() => {
    // Lo que quedó al cerrar la última caja suele ser el cambio con el que se arranca.
    let vigente = true;
    fondoSugerido(db).then((s) => {
      if (!vigente || !s) return;
      setSugerido(s);
      setFondo((f) => f ?? s.monto);
    });
    return () => {
      vigente = false;
    };
  }, []);
  const abrir = (e: React.FormEvent) => {
    e.preventDefault();
    unaVez(async () => {
      try {
        await abrirTurno(db, cajero, fondo ?? 0, sesion?.usuario);
        avisar({ texto: 'Caja abierta. ¡Buenas ventas!', tipo: 'ok' });
      } catch (err) {
        avisar({ texto: errorATexto(err), tipo: 'error' });
      }
    });
  };
  return (
    <div className="pagina pagina-angosta">
      <form className="tarjeta abrir-caja" onSubmit={abrir}>
        <h1>Abrir la caja</h1>
        <p className="texto-suave">Contá el cambio con el que arrancás. Al cerrar, el sistema te dice si falta o sobra plata.</p>
        <label className="campo">
          <span className="campo-etiqueta">¿Quién atiende?</span>
          <input value={cajero} onChange={(e) => setCajero(e.target.value)} placeholder="Tu nombre" autoComplete="off" />
        </label>
        <CampoPesos etiqueta="Cambio en la caja" valor={fondo} onCambio={setFondo} autoFocus grande />
        {sugerido && fondo === sugerido.monto && <p className="texto-suave abrir-caja-pista">Es lo que quedó en la caja anterior ({fechaCorta(sugerido.fecha)}). Si contaste otra cosa, corregilo.</p>}
        <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
          Abrir caja
        </button>
      </form>
    </div>
  );
}

interface Espera {
  id: number;
  carrito: Carrito;
  hora: number;
}

function Caja() {
  const avisar = useAvisar();
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const pedirDueño = usePedirDueño();
  const { sesion } = useSesion();
  const [carrito, setCarrito] = useGuardado<Carrito>('milenio.carrito', carritoVacio);
  const [espera, setEspera] = useGuardado<Espera[]>('milenio.espera', []);
  const [ultima, setUltima] = useGuardado<UltimaVenta | null>('milenio.ultima', null);
  const ticket = useConsulta(() => leerAjustesTicket(db), [], TICKET_INICIAL);
  const [entrada, setEntrada] = useState('');
  const [resaltado, setResaltado] = useState(0);
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [pagaCon, setPagaCon] = useState<number | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [modal, setModal] = useState<
    | null
    | { tipo: 'libre' }
    | { tipo: 'nuevo'; codigo: string; cantidad: number }
    | { tipo: 'camara' }
    | { tipo: 'cliente' }
    | { tipo: 'peso'; producto: Producto }
    | { tipo: 'dividir' }
    | { tipo: 'devolver'; venta: Venta }
  >(null);
  const [cobrando, setCobrando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  // Después de cobrar, el vuelto queda grande en pantalla hasta que arranca la próxima venta.
  const [cobrado, setCobrado] = useState<UltimaVenta | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const cobrandoRef = useRef(false);
  const ultimoAgregado = useRef(0);
  const ultimoError = useRef(0);

  const total = totalCarrito(carrito);
  const vuelto = pagaCon === null ? 0 : calcularVuelto(total, pagaCon);
  const rapidos = useMemo(() => productos.filter((p) => p.rapido).slice(0, 24), [productos]);

  const { busqueda } = interpretarEntrada(entrada);
  const resultados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (q.length < 2 || esCodigo(q)) return [];
    const palabras = q.split(/\s+/);
    return productos
      .filter((p) => {
        const texto = normalizar(`${p.nombre} ${p.codigo} ${p.categoria}`);
        return palabras.every((w) => texto.includes(w));
      })
      .slice(0, 8);
  }, [busqueda, productos]);

  const enfocar = useCallback(() => window.setTimeout(() => buscador.current?.focus(), 0), []);

  const limpiarCobro = () => {
    setMedio('efectivo');
    setPagaCon(null);
    setCliente(null);
  };

  const agregar = useCallback(
    (p: Producto, cantidad: number) => {
      if (buscador.current) buscador.current.value = '';
      // Mientras se guarda el cobro, lo escaneado no entra: se borraría con el carrito.
      if (cobrandoRef.current) {
        pitido('error');
        avisar({ texto: 'Esperá un segundo: se está guardando el cobro.', tipo: 'info' });
        return;
      }
      ultimoAgregado.current = Date.now();
      setCobrado(null);
      if (p.porPeso) {
        setEntrada('');
        setModal({ tipo: 'peso', producto: p });
        return;
      }
      setCarrito((c) => {
        // Se vende igual, pero se avisa: el stock del sistema puede estar mal y conviene saberlo.
        const enCarrito = c.items.filter((i) => i.productoId === p.id).reduce((n, i) => n + i.cantidad, 0);
        if (p.stock - enCarrito - cantidad < 0 && p.stock - enCarrito >= 0) {
          avisar({ texto: `Ojo: en el sistema ${p.stock === 1 ? 'queda 1' : `quedan ${p.stock}`} de ${p.nombre}.`, tipo: 'info' });
        }
        return agregarItem(c, itemDeProducto(p, cantidad));
      });
      setEntrada('');
      setResaltado(0);
      setPagaCon(null);
      pitido('ok');
      enfocar();
    },
    [enfocar, avisar, setCarrito],
  );

  // Un código leído por el lector cuando el cursor está en "Paga con" o en otro campo: se suma como producto.
  const escaneoEnCampo = (texto: string): boolean => {
    const q = codigoEscaneado(texto);
    if (!q) return false;
    const p = porCodigo.get(q);
    setPagaCon(null);
    if (p) agregar(p, 1);
    else {
      pitido('error');
      setModal({ tipo: 'nuevo', codigo: q, cantidad: 1 });
    }
    return true;
  };

  const porCodigo = useMemo(() => new Map(productos.filter((p) => p.codigo).map((p) => [p.codigo, p])), [productos]);

  // Todo sincrónico: el lector USB escribe muy rápido y no hay que perder ni mezclar códigos.
  const procesarEntrada = () => {
    const texto = buscador.current?.value ?? entrada;
    const { cantidad, busqueda: q } = interpretarEntrada(texto);
    if (!q) return;
    const p = porCodigo.get(q);
    if (p) return agregar(p, cantidad);
    if (esCodigo(q)) {
      pitido('error');
      setEntrada('');
      setModal({ tipo: 'nuevo', codigo: q, cantidad });
      return;
    }
    const elegido = resultados[resaltado];
    if (elegido) return agregar(elegido, cantidad);
    pitido('error');
    setEntrada('');
    // El próximo Enter no cobra: el cajero está reintentando la búsqueda, no cerrando la venta.
    ultimoError.current = Date.now();
    avisar({ texto: `No encontré "${q}".`, tipo: 'error' });
  };

  // Con el buscador vacío: Supr saca el último producto y "-" le resta uno.
  const corregirUltimo = (sacar: boolean) => {
    const i = carrito.items.length - 1;
    if (i < 0) return;
    const it = carrito.items[i]!;
    if (sacar || it.cantidad <= 1 || it.gramos) setCarrito((c) => quitarItem(c, i));
    else setCarrito((c) => cambiarCantidad(c, i, it.cantidad - 1));
    setPagaCon(null);
  };

  const ponerEnEspera = useCallback(() => {
    if (carrito.items.length === 0) return;
    setEspera((l) => [...l, { id: Date.now(), carrito, hora: Date.now() }]);
    setCarrito(carritoVacio);
    limpiarCobro();
    avisar({ texto: 'Venta en espera. Podés atender a otro.', tipo: 'info' });
    enfocar();
  }, [carrito, avisar, enfocar, setCarrito, setEspera]);

  const retomar = (e: Espera) => {
    setEspera((l) => {
      const resto = l.filter((x) => x.id !== e.id);
      return carrito.items.length > 0 ? [...resto, { id: Date.now(), carrito, hora: Date.now() }] : resto;
    });
    setCarrito(e.carrito);
    limpiarCobro();
    enfocar();
  };

  const cancelar = useCallback(() => {
    if (carrito.items.length === 0) return;
    if (!confirmarCancelar) {
      setConfirmarCancelar(true);
      window.setTimeout(() => setConfirmarCancelar(false), 3000);
      return;
    }
    // Queda registrado para que el dueño vea cuántas ventas se cancelan antes de cobrar.
    registrarCancelacion(db, carrito.items, sesion?.usuario).catch(() => {});
    setCarrito(carritoVacio);
    limpiarCobro();
    setConfirmarCancelar(false);
    enfocar();
  }, [carrito, confirmarCancelar, enfocar, setCarrito, sesion]);

  const cobrar = useCallback(async (pagos?: Pago[], pagaConDividido: number | null = null) => {
    if (cobrandoRef.current || carrito.items.length === 0) return;
    const fiaAlguien = pagos ? pagos.some((p) => p.medio === 'fiado') : medio === 'fiado';
    if (fiaAlguien && !cliente) {
      setModal({ tipo: 'cliente' });
      return;
    }
    if (!pagos && medio === 'efectivo' && pagaCon !== null && pagaCon < total) {
      pitido('error');
      avisar({ texto: `Faltan ${formatPesos(total - pagaCon)}: con eso no alcanza.`, tipo: 'error' });
      return;
    }
    const fiado = pagos ? pagos.filter((p) => p.medio === 'fiado').reduce((s, p) => s + p.monto, 0) : medio === 'fiado' ? total : 0;
    if (fiado > 0 && cliente?.id !== undefined) {
      // Pasarse del límite lo decide el dueño, antes de anotar.
      const aviso = await controlarLimite(db, cliente.id, fiado);
      if (aviso) {
        const quien = await pedirDueño(`${aviso} Fiar igual`);
        if (!quien) {
          avisar({ texto: `No se anotó: ${cliente.nombre} supera su límite de fiado.`, tipo: 'info' });
          enfocar();
          return;
        }
      }
    }
    setCobrando(true);
    cobrandoRef.current = true;
    try {
      const venta = await registrarVenta(db, {
        items: carrito.items,
        medio: pagos ? pagos[0]!.medio : medio,
        pagaCon: pagos ? pagaConDividido : medio === 'efectivo' ? pagaCon : null,
        clienteId: fiado > 0 ? (cliente?.id ?? null) : null,
        ...(pagos ? { pagos } : {}),
      }, sesion?.usuario);
      pitido('ok');
      const dividido = !!pagos && pagos.length > 1;
      const detalle = dividido
        ? `Cobrado ${formatPesos(venta.total)} en ${pagos!.length} pagos${fiado > 0 ? ` (${formatPesos(fiado)} fiados a ${cliente?.nombre})` : ''}${venta.vuelto > 0 ? ` · Vuelto ${formatPesos(venta.vuelto)}` : ''}`
        : venta.medio === 'efectivo' && venta.vuelto > 0
          ? `Cobrado ${formatPesos(venta.total)} · Vuelto ${formatPesos(venta.vuelto)}`
          : venta.medio === 'fiado'
            ? `Anotado ${formatPesos(venta.total)} a ${cliente?.nombre}`
            : `Cobrado ${formatPesos(venta.total)} con ${nombreMedio(venta.medio)}`;
      avisar({ texto: detalle, tipo: 'ok' });
      const resumen: UltimaVenta = { id: venta.id!, total: venta.total, medio: venta.medio, hora: Date.now(), dividido, vuelto: venta.vuelto, cliente: cliente?.nombre };
      setUltima(resumen);
      setCobrado(resumen);
      if (ticket.auto) imprimirTicket(venta, ticket);
      setCarrito(carritoVacio);
      limpiarCobro();
    } catch (e) {
      pitido('error');
      avisar({ texto: errorATexto(e), tipo: 'error' });
    } finally {
      cobrandoRef.current = false;
      setCobrando(false);
      enfocar();
    }
  }, [cobrando, carrito, medio, cliente, pagaCon, total, avisar, enfocar, setCarrito, setUltima, sesion, ticket, pedirDueño]);

  const ticketUltima = async () => {
    if (!ultima) return;
    const v = await db.ventas.get(ultima.id);
    if (v) imprimirTicket(v, ticket);
    enfocar();
  };

  const elegirMedio = useCallback(
    (m: MedioPago) => {
      setMedio(m);
      if (m === 'fiado' && !cliente) setModal({ tipo: 'cliente' });
      if (m === 'efectivo') window.setTimeout(() => document.getElementById('paga-con')?.focus(), 0);
    },
    [cliente],
  );

  const devolverUltima = async () => {
    if (!ultima) return;
    const v = await db.ventas.get(ultima.id);
    if (!v || v.anulada) {
      avisar({ texto: 'Esa venta ya no está.', tipo: 'error' });
      return;
    }
    setModal({ tipo: 'devolver', venta: v });
  };

  const anularUltima = async () => {
    if (!ultima) return;
    const quien = await pedirDueño('Anular una venta');
    if (!quien) return enfocar();
    try {
      await anularVenta(db, ultima.id, quien);
      setUltima(null);
      avisar({ texto: `Venta de ${formatPesos(ultima.total)} anulada. El stock volvió.`, tipo: 'info' });
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
    enfocar();
  };

  // Teclas rápidas y lector USB cuando el foco no está en un campo.
  // Se leen por referencia para usar siempre el estado más nuevo.
  const acciones = useRef({ cobrar, ponerEnEspera, elegirMedio });
  acciones.current = { cobrar, ponerEnEspera, elegirMedio };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const medioTecla = TECLA_MEDIO[e.key];
      if (medioTecla) {
        e.preventDefault();
        acciones.current.elegirMedio(medioTecla);
      } else if (e.key === 'F2') {
        e.preventDefault();
        buscador.current?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        acciones.current.elegirMedio('efectivo');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setModal({ tipo: 'libre' });
      } else if (e.key === 'F8') {
        e.preventDefault();
        acciones.current.ponerEnEspera();
      } else if (e.key === 'F12') {
        e.preventDefault();
        acciones.current.cobrar();
      } else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) buscador.current?.focus();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  const sugeridos = pagosSugeridos(total);

  return (
    <div className="caja">
      <section className="caja-izquierda" aria-label="Productos de la venta">
        <div className="buscador">
          <div className="buscador-campo">
            <Icono nombre="buscar" />
            <input
              ref={buscador}
              autoFocus
              value={entrada}
              onChange={(e) => {
                setEntrada(e.target.value);
                setResaltado(0);
                if (e.target.value) setCobrado(null);
              }}
              onKeyDown={(e) => {
                const vacio = !e.currentTarget.value.trim();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Con el buscador vacío, Enter cobra: todo se hace sin soltar el teclado.
                  if (vacio) {
                    // Algunos lectores mandan dos Enter, y después de un "no encontré" el Enter es un reintento: ninguno cobra.
                    if (Date.now() - ultimoAgregado.current > 400 && Date.now() - ultimoError.current > 1500) cobrar();
                    return;
                  }
                  procesarEntrada();
                } else if (vacio && e.key === 'Delete') {
                  e.preventDefault();
                  corregirUltimo(true);
                } else if (vacio && e.key === '-') {
                  e.preventDefault();
                  corregirUltimo(false);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setResaltado((r) => Math.min(r + 1, Math.max(0, resultados.length - 1)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setResaltado((r) => Math.max(0, r - 1));
                } else if (e.key === 'Escape') {
                  setEntrada('');
                }
              }}
              placeholder="Escaneá o escribí el producto"
              aria-label="Escaneá el código o escribí el nombre del producto"
              autoComplete="off"
              enterKeyHint="enter"
            />
            {resultados.length > 0 && (
              <ul className="resultados" role="listbox" aria-label="Productos encontrados">
                {resultados.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === resaltado}>
                    <button
                      type="button"
                      className={i === resaltado ? 'resaltado' : ''}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => agregar(p, interpretarEntrada(entrada).cantidad)}
                    >
                      <span>
                        <strong>{p.nombre}</strong>
                        <small className={p.stock <= p.stockMinimo && p.stockMinimo > 0 ? 'texto-aviso' : ''}>
                          {p.codigo || 'sin código'} · {p.stock === 1 ? 'queda 1' : `quedan ${p.stock}`}
                        </small>
                      </span>
                      <span className="importe">{formatPesos(p.precio)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="boton boton-cuadrado" onClick={() => setModal({ tipo: 'camara' })} aria-label="Escanear con la cámara" title="Escanear con la cámara">
            <Icono nombre="camara" />
          </button>
          <button type="button" className="boton" onClick={() => setModal({ tipo: 'libre' })} title="F4">
            Monto libre
          </button>
        </div>
        <p className="ayuda-teclas">
          <span><kbd>3*</kbd> antes del código suma 3</span>
          <span><kbd>Supr</kbd> saca el último</span>
          <span><kbd>F4</kbd> monto libre</span>
          <span><kbd>F8</kbd> en espera</span>
          <span><kbd>Enter</kbd> con el buscador vacío cobra</span>
        </p>

        {rapidos.length > 0 && (
          <div className="rapidos" role="group" aria-label="Productos rápidos">
            {rapidos.map((p) => (
              <button key={p.id} type="button" className="rapido" tabIndex={-1} onClick={() => agregar(p, 1)}>
                <span className="rapido-nombre">{sinCortes(p.nombre)}</span>
                <span className="rapido-pie">
                  <span className="rapido-precio importe">{formatPesos(p.precio)}</span>
                  {p.stockMinimo > 0 && p.stock <= p.stockMinimo && <span className={`rapido-stock ${p.stock <= 0 ? 'rapido-stock-cero' : ''}`}>{p.stock <= 0 ? 'Sin stock' : `Quedan ${p.stock}`}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {espera.length > 0 && (
          <div className="en-espera">
            <span>En espera:</span>
            {espera.map((e, i) => (
              <button key={e.id} type="button" className="chip" onClick={() => retomar(e)}>
                <Icono nombre="pausa" tam={16} /> Cliente {i + 1} · {formatPesos(totalCarrito(e.carrito))}
              </button>
            ))}
          </div>
        )}

        <div className="tarjeta lista-venta">
          {carrito.items.length === 0 ? (
            <div className="lista-vacia">
              <span className="vacio-icono">
                <Icono nombre="camara" tam={28} />
              </span>
              <p className="vacio-titulo">Listo para cobrar</p>
              <p className="texto-suave">Pasá el primer producto por el lector o tocá un botón rápido.</p>
            </div>
          ) : (
            <>
            <div className="lista-venta-cabecera">
              <h2 className="titulo-chico">Venta actual</h2>
              <span className="texto-suave">
                {unidades(carrito)} {unidades(carrito) === 1 ? 'producto' : 'productos'}
              </span>
            </div>
            <ul>
              {carrito.items.map((it, i) => {
                const prod = it.productoId !== null ? productos.find((p) => p.id === it.productoId) : undefined;
                const quedan = prod ? Math.round((prod.stock - stockQueUsa(it)) * 1000) / 1000 : null;
                return (
                  <li key={`${it.productoId ?? 'libre'}-${i}`} className="renglon">
                    <div className="renglon-nombre">
                      <strong>{sinCortes(it.nombre)}</strong>
                      <small className={quedan !== null && prod && prod.stockMinimo > 0 && quedan <= prod.stockMinimo ? 'texto-aviso' : ''}>
                        {it.gramos ? `${formatoPeso(it.gramos)} por peso` : `${formatPesos(it.precioUnitario)} c/u`}
                        {quedan !== null && prod && prod.stockMinimo > 0 && quedan <= prod.stockMinimo ? ` · ${quedan === 1 ? 'queda 1' : `quedan ${quedan}`}: reponer` : ''}
                      </small>
                      {it.promo && ahorroPromo(it) > 0 && (
                        <span className="promo-etiqueta">
                          <Icono nombre="promo" tam={13} /> Promo {it.promo.cantidad} x {formatPesos(it.promo.precio)}: ahorra {formatPesos(ahorroPromo(it))}
                        </span>
                      )}
                    </div>
                    <div className="cantidad">
                      <button type="button" className="boton-icono" aria-label={`Uno menos de ${it.nombre}`} onClick={() => setCarrito((c) => cambiarCantidad(c, i, it.cantidad - 1))}>
                        <Icono nombre="menos" tam={18} />
                      </button>
                      <input
                        aria-label={`Cantidad de ${it.nombre}`}
                        inputMode="numeric"
                        value={it.cantidad}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ''));
                          if (n > 0) setCarrito((c) => cambiarCantidad(c, i, n));
                        }}
                      />
                      <button type="button" className="boton-icono" aria-label={`Uno más de ${it.nombre}`} onClick={() => setCarrito((c) => cambiarCantidad(c, i, it.cantidad + 1))}>
                        <Icono nombre="mas" tam={18} />
                      </button>
                    </div>
                    <span className="importe renglon-subtotal">{formatPesos(subtotal(it))}</span>
                    <button type="button" className="boton-icono boton-quitar" aria-label={`Sacar ${it.nombre}`} onClick={() => setCarrito((c) => quitarItem(c, i))}>
                      <Icono nombre="basura" tam={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
          )}
        </div>
      </section>

      <aside className="caja-derecha" aria-label="Cobro">
        {cobrado && carrito.items.length === 0 ? (
          <div className="total total-cobrado" role="status">
            <span>
              {cobrado.vuelto && cobrado.vuelto > 0
                ? `Cobrado ${formatPesos(cobrado.total)} · Vuelto`
                : cobrado.medio === 'fiado'
                  ? `Anotado a ${cobrado.cliente ?? 'fiado'}`
                  : `Cobrado ${cobrado.dividido ? 'en dos medios' : `con ${nombreMedio(cobrado.medio)}`}`}
            </span>
            <strong className="importe">{formatPesos(cobrado.vuelto && cobrado.vuelto > 0 ? cobrado.vuelto : cobrado.total)}</strong>
            <button
              type="button"
              className="boton boton-chico total-siguiente"
              onClick={() => {
                setCobrado(null);
                enfocar();
              }}
            >
              Siguiente venta
            </button>
          </div>
        ) : (
          <div className="total">
            <span>Total a cobrar</span>
            <strong className="importe">{formatPesos(total)}</strong>
            <small>
              {unidades(carrito)} {unidades(carrito) === 1 ? 'producto' : 'productos'}
            </small>
          </div>
        )}

        <div className="tarjeta cobro">
          <div className="cobro-cabecera">
            <h2 className="titulo-chico">Medio de pago</h2>
            {medio !== 'fiado' && (
              <button type="button" className="enlace boton-dividir" onClick={() => setModal({ tipo: 'dividir' })} disabled={carrito.items.length === 0}>
                <Icono nombre="dividir" tam={15} /> Dividir pago
              </button>
            )}
          </div>
          <div className="medios">
            {MEDIOS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`medio ${medio === m.id ? 'activo' : ''} ${m.id === 'fiado' ? 'medio-ancho' : ''}`}
                aria-pressed={medio === m.id}
                aria-keyshortcuts={TECLA_DE[m.id]}
                onClick={() => elegirMedio(m.id)}
              >
                <Icono nombre={ICONO_MEDIO[m.id]} tam={18} />
                <span className="medio-nombre">{m.id === 'fiado' ? (cliente ? `Fiado: ${cliente.nombre}` : 'Fiado (anotar a un cliente)') : m.nombre}</span>
                <kbd>{TECLA_DE[m.id]}</kbd>
              </button>
            ))}
          </div>

          {medio === 'efectivo' && (
            <>
              <div className="paga-con">
                <label className="titulo-chico" htmlFor="paga-con">
                  Paga con <kbd>F3</kbd>
                </label>
                <CampoPesos
                  id="paga-con"
                  valor={pagaCon}
                  onCambio={setPagaCon}
                  grande
                  placeholder="Justo"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    // Si lo que hay es un código de barras, el lector escaneó acá: es un producto, no plata.
                    if (escaneoEnCampo(e.currentTarget.value)) return;
                    cobrar();
                  }}
                />
              </div>
              {sugeridos.length > 0 && (
                <div className="sugeridos">
                  {sugeridos.map((s) => (
                    <button key={s} type="button" className={`chip ${pagaCon === s ? 'activo' : ''}`} onClick={() => setPagaCon(s)}>
                      {s === total ? 'Justo' : formatPesos(s)}
                    </button>
                  ))}
                </div>
              )}
              <div className={`vuelto ${vuelto === null ? 'vuelto-falta' : !vuelto ? 'vuelto-cero' : ''}`}>
                <span>{vuelto === null ? 'Falta' : 'Vuelto'}</span>
                <strong className="importe">{formatPesos(vuelto === null ? total - (pagaCon ?? 0) : vuelto)}</strong>
              </div>
            </>
          )}
          {medio === 'fiado' && cliente && (
            <button type="button" className="boton boton-texto" onClick={() => setModal({ tipo: 'cliente' })}>
              Cambiar cliente
            </button>
          )}
        </div>

        <button type="button" className="boton boton-primario boton-rojo boton-cobrar" onClick={() => cobrar()} disabled={carrito.items.length === 0 || cobrando}>
          <span>
            {medio === 'fiado' ? 'Anotar' : 'Cobrar'} <span className="importe">{formatPesos(total)}</span>
          </span>
          <kbd>F12</kbd>
        </button>
        <div className="acciones-secundarias">
          <button type="button" className="boton" onClick={ponerEnEspera} disabled={carrito.items.length === 0}>
            Dejar en espera
          </button>
          <button type="button" className={`boton ${confirmarCancelar ? 'boton-peligro' : 'boton-texto-peligro'}`} onClick={cancelar} disabled={carrito.items.length === 0}>
            {confirmarCancelar ? 'Sí, cancelar' : 'Cancelar venta'}
          </button>
        </div>
        {/* Siempre ocupa su lugar, así el botón de cobrar no se mueve con la primera venta. */}
        {ultima ? (
          <div className="ultima-venta">
            <span>
              <small className="texto-suave">Última venta</small>
              <strong className="importe">
                {formatPesos(ultima.total)} · {ultima.dividido ? 'Pago dividido' : nombreMedio(ultima.medio)}
              </strong>
            </span>
            <span className="botonera">
              <button type="button" className="boton boton-chico" onClick={ticketUltima}>
                <Icono nombre="ticket" tam={16} /> Ticket
              </button>
              <button type="button" className="boton boton-chico" onClick={devolverUltima} title="El cliente devuelve o cambia algo">
                <Icono nombre="devolver" tam={16} /> Devolver
              </button>
              <button type="button" className="boton boton-chico boton-texto-peligro" onClick={anularUltima}>
                <Icono nombre="deshacer" tam={16} /> Anular
              </button>
            </span>
          </div>
        ) : (
          <div className="ultima-venta ultima-venta-vacia">
            <span>
              <small className="texto-suave">Última venta</small>
              <strong className="texto-suave">Todavía no hay ventas en este turno</strong>
            </span>
          </div>
        )}
      </aside>

      {carrito.items.length > 0 && (
      <div className="barra-cobro-movil">
        <div>
          <small>
            Total · {unidades(carrito)} {unidades(carrito) === 1 ? 'producto' : 'productos'}
          </small>
          <strong className="importe">{formatPesos(total)}</strong>
        </div>
        <button type="button" className="boton boton-primario boton-rojo" onClick={() => document.querySelector('.caja-derecha')?.scrollIntoView({ behavior: 'smooth' })} disabled={carrito.items.length === 0}>
          Cobrar
        </button>
      </div>
      )}

      {modal?.tipo === 'libre' && (
        <MontoLibre
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onAgregar={(monto, desc) => {
            setCarrito((c) => agregarItem(c, itemMontoLibre(monto, desc)));
            setModal(null);
            enfocar();
          }}
        />
      )}
      {modal?.tipo === 'peso' && (
        <PedirPeso
          producto={modal.producto}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onAgregar={(gramos) => {
            setCarrito((c) => agregarItem(c, itemPorPeso(modal.producto, gramos)));
            setModal(null);
            setPagaCon(null);
            pitido('ok');
            enfocar();
          }}
        />
      )}
      {modal?.tipo === 'dividir' && (
        <DividirPago
          total={total}
          cliente={cliente}
          onElegirCliente={setCliente}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onCobrar={(pagos, pagaConEfectivo) => {
            setModal(null);
            cobrar(pagos, pagaConEfectivo);
          }}
        />
      )}
      {modal?.tipo === 'devolver' && (
        <DevolverVenta
          venta={modal.venta}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onHecho={() => setUltima(null)}
        />
      )}
      {modal?.tipo === 'nuevo' && (
        <ProductoNuevoRapido
          codigo={modal.codigo}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onGuardado={(p) => {
            setModal(null);
            agregar(p, modal.cantidad);
          }}
        />
      )}
      {modal?.tipo === 'camara' && (
        <Escaner
          onCerrar={() => setModal(null)}
          onCodigo={async (codigo) => {
            setModal(null);
            const p = await buscarPorCodigo(db, codigo);
            if (p) agregar(p, 1);
            else setModal({ tipo: 'nuevo', codigo, cantidad: 1 });
          }}
        />
      )}
      {modal?.tipo === 'cliente' && (
        <ElegirCliente
          onCerrar={() => {
            setModal(null);
            if (!cliente) {
              setMedio('efectivo');
              avisar({ texto: 'No elegiste cliente: el cobro volvió a Efectivo.', tipo: 'info' });
            }
            enfocar();
          }}
          onElegir={(c) => {
            setCliente(c);
            setMedio('fiado');
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function MontoLibre({ onCerrar, onAgregar }: { onCerrar: () => void; onAgregar: (monto: number, desc: string) => void }) {
  const [monto, setMonto] = useState<number | null>(null);
  const [desc, setDesc] = useState('');
  const pasado = monto !== null && monto > MONTO_MAXIMO;
  return (
    <Modal titulo="Monto libre" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (monto && monto > 0 && !pasado) onAgregar(monto, desc);
        }}
      >
        <p className="texto-suave">Para algo que no está cargado: una fotocopia, una recarga, un producto suelto.</p>
        <div className="chips" role="group" aria-label="Qué es">
          {['Recarga SUBE', 'Recarga celular', 'Pago de servicio', 'Fotocopia', 'Varios'].map((t) => (
            <button key={t} type="button" className={`chip ${desc === t ? 'activo' : ''}`} onClick={() => setDesc(t)}>
              {t}
            </button>
          ))}
        </div>
        <CampoPesos etiqueta="Monto" valor={monto} onCambio={setMonto} autoFocus grande />
        {pasado && <p className="texto-alerta">Ese monto es demasiado alto. Si fue el lector, escaneá el producto en el buscador.</p>}
        <label className="campo">
          <span className="campo-etiqueta">Qué es (opcional)</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Varios" />
        </label>
        <button className="boton boton-primario boton-grande" type="submit" disabled={!monto || monto <= 0 || pasado}>
          Agregar {monto ? formatPesos(monto) : ''}
        </button>
      </form>
    </Modal>
  );
}

function ProductoNuevoRapido({
  codigo,
  onCerrar,
  onGuardado,
}: {
  codigo: string;
  onCerrar: () => void;
  onGuardado: (p: Producto) => void;
}) {
  const avisar = useAvisar();
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState<number | null>(null);
  const [stock, setStock] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    unaVez(async () => {
    try {
      const id = await guardarProducto(db, {
        codigo,
        nombre,
        precio: precio ?? 0,
        costo: 0,
        stock: Number(stock) || 0,
        stockMinimo: 0,
        categoria: '',
        rapido: false,
      });
      const p = await db.productos.get(id);
      if (p) onGuardado(p);
      avisar({ texto: `"${nombre.trim()}" quedó cargado. Completalo después en Productos.`, tipo: 'ok' });
    } catch (err) {
      avisar({ texto: errorATexto(err), tipo: 'error' });
    }
    });
  };
  return (
    <Modal titulo="Este código no está cargado" onCerrar={onCerrar}>
      <form className="formulario" onSubmit={guardar}>
        <p className="texto-suave">
          Código <strong>{codigo}</strong>. Cargalo ahora en tres datos y se suma a la venta.
        </p>
        <label className="campo">
          <span className="campo-etiqueta">Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej.: Alfajor Jorgito" />
        </label>
        <div className="fila-campos">
          <CampoPesos etiqueta="Precio de venta" valor={precio} onCambio={setPrecio} />
          <label className="campo">
            <span className="campo-etiqueta">Stock (opcional)</span>
            <input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
          </label>
        </div>
        <button className="boton boton-primario boton-grande" type="submit" disabled={!nombre.trim() || !precio || enCurso}>
          Guardar y agregar a la venta
        </button>
      </form>
    </Modal>
  );
}

function ElegirCliente({ onCerrar, onElegir }: { onCerrar: () => void; onElegir: (c: Cliente) => void }) {
  const avisar = useAvisar();
  const [q, setQ] = useState('');
  const [, unaVez] = useUnaVez();
  const datos = useConsulta(
    async () => {
      const [clientes, movs] = await Promise.all([db.clientes.toArray(), db.movimientosFiado.toArray()]);
      const porCliente = new Map<number, typeof movs>();
      for (const m of movs) {
        let lista = porCliente.get(m.clienteId);
        if (!lista) porCliente.set(m.clienteId, (lista = []));
        lista.push(m);
      }
      return clientes
        .map((c) => ({ c, saldo: saldoCliente(porCliente.get(c.id!) ?? []) }))
        .sort((a, b) => a.c.nombre.localeCompare(b.c.nombre));
    },
    [],
    [] as { c: Cliente; saldo: number }[],
  );
  const filtrados = datos.filter((d) => normalizar(d.c.nombre).includes(normalizar(q.trim())));
  const [resaltado, setResaltado] = useState(-1);
  const exacto = filtrados.find((d) => normalizar(d.c.nombre) === normalizar(q.trim()));
  const crear = () =>
    unaVez(async () => {
      try {
        const id = await guardarCliente(db, { nombre: q, telefono: '', limite: 0 });
        const c = await db.clientes.get(id);
        if (c) onElegir(c);
      } catch (e) {
        avisar({ texto: errorATexto(e), tipo: 'error' });
      }
    });
  return (
    <Modal titulo="¿A quién se lo anotás?" onCerrar={onCerrar}>
      <div className="formulario">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setResaltado(-1);
          }}
          autoFocus
          placeholder="Buscá o escribí un nombre nuevo"
          aria-label="Buscar cliente"
          onKeyDown={(e) => {
            // Enter elige sólo si está claro a quién: nombre exacto, un único resultado o el marcado con las flechas.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = Math.min(filtrados.length, 8);
              setResaltado((r) => (e.key === 'ArrowDown' ? Math.min(r + 1, n - 1) : Math.max(r - 1, 0)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (!q.trim()) return;
              const elegido = resaltado >= 0 ? filtrados[resaltado] : exacto ?? (filtrados.length === 1 ? filtrados[0] : undefined);
              if (elegido) onElegir(elegido.c);
            }
          }}
        />
        <ul className="lista-clientes">
          {filtrados.slice(0, 8).map(({ c, saldo }, i) => (
            <li key={c.id}>
              <button type="button" className={i === resaltado ? 'resaltado' : ''} onClick={() => onElegir(c)}>
                <span>{c.nombre}</span>
                <span className={saldo > 0 ? 'texto-alerta importe' : 'texto-suave importe'}>{saldo > 0 ? `debe ${formatPesos(saldo)}` : 'al día'}</span>
              </button>
            </li>
          ))}
        </ul>
        {q.trim() && !exacto && (
          <button type="button" className="boton" onClick={crear}>
            <Icono nombre="mas" tam={18} /> Crear cliente "{q.trim()}"
          </button>
        )}
      </div>
    </Modal>
  );
}

function PedirPeso({ producto, onCerrar, onAgregar }: { producto: Producto; onCerrar: () => void; onAgregar: (gramos: number) => void }) {
  const [texto, setTexto] = useState('');
  const gramos = gramosDeTexto(texto);
  const precio = Math.round((producto.precio * gramos) / 1000);
  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (gramos > 0) onAgregar(gramos);
        }}
      >
        <p className="texto-suave">
          {formatPesos(producto.precio)} el kilo. Poné los gramos (250) o los kilos con coma (0,5).
        </p>
        <div className="sugeridos">
          {[100, 250, 500, 1000].map((g) => (
            <button key={g} type="button" className={`chip ${gramos === g ? 'activo' : ''}`} onClick={() => setTexto(String(g))}>
              {formatoPeso(g)}
            </button>
          ))}
        </div>
        <label className="campo">
          <span className="campo-etiqueta">Gramos</span>
          <div className="campo-pesos campo-pesos-grande">
            <input inputMode="decimal" autoFocus value={texto} onChange={(e) => setTexto(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0" />
            <span aria-hidden="true">g</span>
          </div>
        </label>
        {gramos > 3000 && <p className="texto-aviso">Son {formatoPeso(gramos)}: fijate que esté bien antes de agregar.</p>}
        <button className="boton boton-primario boton-grande" type="submit" disabled={gramos <= 0}>
          {gramos > 0 ? `Agregar ${formatoPeso(gramos)}: ${formatPesos(precio)}` : 'Agregar'}
        </button>
      </form>
    </Modal>
  );
}


function DividirPago({
  total,
  cliente,
  onElegirCliente,
  onCerrar,
  onCobrar,
}: {
  total: number;
  cliente: Cliente | null;
  onElegirCliente: (c: Cliente) => void;
  onCerrar: () => void;
  onCobrar: (pagos: Pago[], pagaConEfectivo: number | null) => void;
}) {
  const [montos, setMontos] = useState<Partial<Record<MedioPago, number | null>>>({});
  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  const suma = Object.values(montos).reduce<number>((s, v) => s + (v ?? 0), 0);
  const falta = total - suma;
  const efectivo = montos.efectivo ?? 0;
  const sinEfectivo = suma - efectivo;
  // Si con lo que pone en efectivo se pasa del total, lo que sobra es vuelto (no se guarda como pago).
  const vuelto = falta < 0 && efectivo > 0 && sinEfectivo < total ? Math.min(-falta, efectivo) : 0;
  const pagos: Pago[] = MEDIOS.map((m) => ({ medio: m.id, monto: m.id === 'efectivo' ? efectivo - vuelto : (montos[m.id] ?? 0) })).filter((p) => p.monto > 0);
  const completar = (m: MedioPago) => setMontos((x) => ({ ...x, [m]: (x[m] ?? 0) + Math.max(0, falta) }));
  const fia = (montos.fiado ?? 0) > 0;
  const cuadra = falta === 0 || vuelto > 0;
  const listo = cuadra && pagos.length > 0 && !(fia && !cliente);
  const pendiente = falta > 0 ? 'falta' : vuelto > 0 ? 'vuelto' : falta < 0 ? 'sobra' : 'ok';
  return (
    <Modal titulo="Pagar con dos medios" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) onCobrar(pagos, efectivo > 0 ? efectivo : null);
        }}
      >
        <p className="texto-suave">
          Total <strong className="importe">{formatPesos(total)}</strong>. Por ejemplo, una parte en efectivo y el resto con Mercado Pago, o una parte fiada.
        </p>
        <div className="dividir">
          {MEDIOS.map((m, i) => (
            <div key={m.id} className="dividir-fila">
              <span className="dividir-medio">
                <Icono nombre={ICONO_MEDIO[m.id]} tam={18} /> {m.id === 'fiado' ? 'Fiado' : m.nombre}
              </span>
              <CampoPesos valor={montos[m.id] ?? null} onCambio={(v) => setMontos((x) => ({ ...x, [m.id]: v }))} autoFocus={i === 0} ariaLabel={`Monto en ${m.nombre}`} />
              <button type="button" className="boton boton-chico" tabIndex={-1} onClick={() => completar(m.id)} disabled={falta <= 0}>
                El resto
              </button>
            </div>
          ))}
        </div>
        {fia && (
          <div className="dividir-cliente">
            {cliente ? (
              <span>
                Se le anota a <strong>{cliente.nombre}</strong>
              </span>
            ) : (
              <span className="texto-aviso">Falta elegir a quién se le anota.</span>
            )}
            <button type="button" className="boton boton-chico" onClick={() => setEligiendoCliente(true)}>
              {cliente ? 'Cambiar' : 'Elegir cliente'}
            </button>
          </div>
        )}
        <div className={`vuelto ${pendiente === 'falta' ? 'vuelto-pendiente' : pendiente === 'sobra' ? 'vuelto-falta' : pendiente === 'ok' ? 'vuelto-ok' : ''}`}>
          <span>{pendiente === 'falta' ? 'Falta' : pendiente === 'vuelto' ? 'Vuelto' : pendiente === 'sobra' ? 'Sobra' : 'Completo'}</span>
          {pendiente === 'ok' ? (
            <strong>
              <Icono nombre="check" tam={20} /> Listo
            </strong>
          ) : (
            <strong className="importe">{formatPesos(pendiente === 'vuelto' ? vuelto : Math.abs(falta))}</strong>
          )}
        </div>
        {pendiente === 'sobra' && <p className="texto-suave">Sobra plata que no es efectivo: bajá alguno de los montos.</p>}
        <button className="boton boton-primario boton-rojo boton-grande" type="submit" disabled={!listo}>
          {fia && !cliente ? 'Elegí el cliente para cobrar' : `Cobrar ${formatPesos(total)}`}
        </button>
      </form>
      {eligiendoCliente && (
        <ElegirCliente
          onCerrar={() => setEligiendoCliente(false)}
          onElegir={(c) => {
            onElegirCliente(c);
            setEligiendoCliente(false);
          }}
        />
      )}
    </Modal>
  );
}
