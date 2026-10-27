import { useSesion } from '../ui/sesion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agregarItem,
  aplicarDescuento,
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
  sumaCarrito,
  totalCarrito,
  unidades,
  type Carrito,
} from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { codigoEscaneado, gramosDeTexto, normalizarTexto as normalizar } from '../dominio/entrada';
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
import { CampoCantidad, CampoPesos, cuando, errorATexto, ICONO_MEDIO, Icono, Modal, sinCortes, useAvisar } from '../ui/componentes';
import { Escaner } from '../ui/Escaner';
import { leerGuardado, LLAVE_CARRITO, LLAVE_ESPERA, LLAVE_ULTIMA, pitido, resumenEspera, useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño, usePedirDueño } from '../ui/permisos';
import { NuevoMovimiento } from './Cierre';
import { RegistrarPago } from './Clientes';
import { DevolverVenta } from './Devolver';
import { IngresoMercaderia } from './Productos';

// El carrito y las ventas en espera sobreviven a cambiar de pantalla, a recargar y a cerrar el navegador.
function useGuardado<T>(llave: string, inicial: T) {
  const [valor, setValor] = useState<T>(() => leerGuardado(llave, inicial));
  useEffect(() => {
    try {
      localStorage.setItem(llave, JSON.stringify(valor));
    } catch {
      /* sin almacenamiento: queda en memoria */
    }
  }, [llave, valor]);
  return [valor, setValor] as const;
}

interface UltimaVenta {
  id: number;
  total: number;
  medio: MedioPago;
  hora: number;
  dividido?: boolean;
  vuelto?: number;
  cliente?: string;
  /** Parte fiada de un pago dividido. */
  fiado?: number;
  /** Lo que ya se devolvió de esta venta. */
  devuelto?: number;
  /** Un pago de fiado cobrado desde la caja (no es una venta): `total` es lo que pagó. */
  pagoFiado?: boolean;
  /** Lo que le queda por pagar después de ese pago. */
  queda?: number;
}

// Tope para que un código leído por el lector en un campo de plata no se cobre como monto.
const MONTO_MAXIMO = 1_000_000;

// Teclas de función para elegir el medio sin mouse (F3 lleva a "Paga con").
const TECLA_DE: Record<MedioPago, string> = { efectivo: 'F5', mercadopago: 'F6', tarjeta: 'F7', transferencia: 'F9', fiado: 'F10' };
const TECLA_MEDIO: Record<string, MedioPago> = Object.fromEntries(Object.entries(TECLA_DE).map(([m, t]) => [t, m as MedioPago]));

// Para que entre en un botón del celular: "Marta (la del 3°)" → "Marta".
const primerNombre = (n: string) => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || n;

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
        // La última venta de la caja anterior no se muestra como si fuera de hoy.
        try {
          localStorage.removeItem('milenio.ultima');
        } catch {
          /* sin almacenamiento */
        }
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
        {sugerido && fondo === sugerido.monto && <p className="texto-suave abrir-caja-pista">Es lo que quedó al cerrar {cuando(sugerido.fecha)}. Si contaste otra cosa, corregilo.</p>}
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
  const [carrito, setCarrito] = useGuardado<Carrito>(LLAVE_CARRITO, carritoVacio);
  const [espera, setEspera] = useGuardado<Espera[]>(LLAVE_ESPERA, []);
  const [ultima, setUltima] = useGuardado<UltimaVenta | null>(LLAVE_ULTIMA, null);
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
    | { tipo: 'limite'; aviso: string; pagos?: Pago[]; pagaCon: number | null }
    | { tipo: 'movimiento' }
    | { tipo: 'mercaderia' }
    | { tipo: 'cobrarFiado' }
    | { tipo: 'pagoFiado'; cliente: Cliente; saldo: number }
    | { tipo: 'descuento' }
    | { tipo: 'precio'; producto: Producto | null }
    | { tipo: 'cobro' }
  >(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const dueño = useEsDueño();
  const [cobrando, setCobrando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  // Después de cobrar, el vuelto queda grande en pantalla hasta que arranca la próxima venta.
  const [cobrado, setCobrado] = useState<UltimaVenta | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const cobrandoRef = useRef(false);
  const carritoRef = useRef(carrito);
  carritoRef.current = carrito;
  const modalRef = useRef(modal);
  modalRef.current = modal;
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

  // En PC el foco vuelve al buscador para seguir escaneando; en el celular abriría el teclado y subiría la página.
  const enfocar = useCallback(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    window.setTimeout(() => buscador.current?.focus(), 0);
  }, []);

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
      // Se vende igual, pero se avisa (una vez, al pasarse): el stock del sistema puede estar mal y conviene saberlo.
      // Un producto sin stock ni mínimo cargados no se sigue, así que no avisa.
      const enCarrito = carritoRef.current.items.filter((i) => i.productoId === p.id).reduce((n, i) => n + i.cantidad, 0);
      if ((p.stock > 0 || p.stockMinimo > 0) && p.stock - enCarrito - cantidad < 0 && p.stock - enCarrito >= 0) {
        avisar({ texto: `Ojo: en el sistema ${p.stock === 1 ? 'queda 1' : `quedan ${p.stock}`} de ${p.nombre}.`, tipo: 'info' });
      }
      setCarrito((c) => agregarItem(c, itemDeProducto(p, cantidad)));
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
    const { cantidad, busqueda: q, consulta } = interpretarEntrada(texto);
    if (!q) {
      if (consulta) {
        setEntrada('');
        setModal({ tipo: 'precio', producto: null });
      }
      return;
    }
    const p = porCodigo.get(q);
    // "?coca": sólo mirar el precio, sin cargarlo.
    if (consulta) {
      const elegido = p ?? resultados[resaltado];
      setEntrada('');
      if (elegido) return setModal({ tipo: 'precio', producto: elegido });
      pitido('error');
      ultimoError.current = Date.now();
      avisar({ texto: `No encontré "${q}".`, tipo: 'error' });
      return;
    }
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

  // Con el buscador vacío, Supr (o "-") saca lo último que se pasó: una unidad, o el renglón si era la última.
  // El último agregado está primero en la lista (agregarItem lo pone adelante).
  const corregirUltimo = () => {
    const i = 0;
    const it = carrito.items[i];
    if (!it) return;
    if (it.cantidad <= 1 || it.gramos) setCarrito((c) => quitarItem(c, i));
    else setCarrito((c) => cambiarCantidad(c, i, it.cantidad - 1));
    setPagaCon(null);
  };

  const ponerEnEspera = useCallback(() => {
    if (carrito.items.length === 0) return;
    setEspera((l) => [...l, { id: Date.now(), carrito, hora: Date.now() }]);
    setCarrito(carritoVacio);
    limpiarCobro();
    // En el celular la barra de abajo ya dice "Una venta en espera · Retomar".
    if (!window.matchMedia('(max-width: 900px)').matches) avisar({ texto: 'Venta en espera. Podés atender a otro.', tipo: 'info' });
    enfocar();
  }, [carrito, avisar, enfocar, setCarrito, setEspera]);

  const retomar = (e: Espera) => {
    descuentoQuitadoAdrede.current = true;
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

  const cobrar = useCallback(async (pagos?: Pago[], pagaConDividido: number | null = null, sinControlLimite = false) => {
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
    if (fiado > 0 && cliente?.id !== undefined && !sinControlLimite) {
      // Pasarse del límite lo decide el dueño, antes de anotar: si está él, se le pregunta; si no, pide su clave.
      const aviso = await controlarLimite(db, cliente.id, fiado);
      if (aviso) {
        if (dueño) {
          setModal({ tipo: 'limite', aviso, pagos, pagaCon: pagaConDividido });
          return;
        }
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
        ...(carrito.descuento ? { descuento: carrito.descuento } : {}),
      }, sesion?.usuario);
      pitido('ok');
      const dividido = !!pagos && pagos.length > 1;
      // El resultado queda a la vista sin aviso flotante: en PC en la tarjeta verde, en el celular en la barra de abajo.
      setModal((m) => (m?.tipo === 'cobro' ? null : m));
      const resumen: UltimaVenta = { id: venta.id!, total: venta.total, medio: venta.medio, hora: Date.now(), dividido, vuelto: venta.vuelto, cliente: cliente?.nombre, ...(fiado > 0 ? { fiado } : {}) };
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
  }, [cobrando, carrito, medio, cliente, pagaCon, total, avisar, enfocar, setCarrito, setUltima, sesion, ticket, pedirDueño, dueño]);

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
      // En la PC el cursor va a "Paga con"; en el celular no, porque abriría el teclado encima de los chips.
      if (m === 'efectivo' && window.matchMedia('(pointer: fine)').matches) {
        window.setTimeout(() => document.getElementById(modalRef.current?.tipo === 'cobro' ? 'paga-con-hoja' : 'paga-con')?.focus(), 0);
      }
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

  // Anular es delicado: siempre dos toques, también para el dueño.
  const anularUltima = async () => {
    if (!ultima) return;
    if (!confirmarAnular) {
      setConfirmarAnular(true);
      window.setTimeout(() => setConfirmarAnular(false), 3000);
      return;
    }
    setConfirmarAnular(false);
    const quien = await pedirDueño('Anular una venta');
    if (!quien) return enfocar();
    try {
      await anularVenta(db, ultima.id, quien);
      setUltima(null);
      setCobrado(null);
      avisar({ texto: `Venta de ${formatPesos(ultima.total)} anulada. El stock volvió.`, tipo: 'info' });
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
    enfocar();
  };

  // La tira de "Última venta": abajo del panel de cobro en PC y arriba del todo en el celular.
  const tiraUltima = ultima ? (
    <div className="ultima-venta">
      <span>
        <small className="texto-suave">Última venta</small>
        <strong className="importe">
          {formatPesos(ultima.total)} · {ultima.dividido ? 'Pago dividido' : nombreMedio(ultima.medio)}
          {ultima.devuelto ? <span className="insignia insignia-aviso">{ultima.devuelto >= ultima.total ? 'Devuelta entera' : `Devuelto ${formatPesos(ultima.devuelto)}`}</span> : null}
        </strong>
      </span>
      <span className="botonera">
        <button type="button" className="boton boton-chico" onClick={ticketUltima}>
          <Icono nombre="ticket" tam={16} /> Ticket
        </button>
        {(ultima.devuelto ?? 0) < ultima.total && (
          <button type="button" className="boton boton-chico" onClick={devolverUltima} title="El cliente devuelve o cambia algo">
            <Icono nombre="devolver" tam={16} /> Devolver
          </button>
        )}
        {!ultima.devuelto && (
          <button type="button" className={`boton boton-chico ${confirmarAnular ? 'boton-peligro' : 'boton-texto-peligro'}`} onClick={anularUltima}>
            {confirmarAnular ? 'Sí, anular' : <><Icono nombre="deshacer" tam={16} /> Anular</>}
          </button>
        )}
      </span>
    </div>
  ) : (
    <div className="ultima-venta ultima-venta-vacia">
      <span>
        <small className="texto-suave">Última venta</small>
        <strong className="texto-suave">Todavía no hay ventas en este turno</strong>
      </span>
    </div>
  );

  // Teclas rápidas y lector USB cuando el foco no está en un campo.
  // Se leen por referencia para usar siempre el estado más nuevo.
  const acciones = useRef({ cobrar, ponerEnEspera, elegirMedio });
  acciones.current = { cobrar, ponerEnEspera, elegirMedio };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // Ninguna F recarga ni abre cosas del navegador mientras se cobra (F11, pantalla completa, sí se deja), ni con un modal abierto.
      if (/^F([1-9]|10|12)$/.test(e.key)) e.preventDefault();
      const medioTecla = TECLA_MEDIO[e.key];
      if (document.querySelector('dialog[open]')) {
        // Con "¿A quién se lo anotás?" abierto, F5 a F9 cambian de idea: cierran y eligen ese medio.
        if (medioTecla && medioTecla !== 'fiado' && modalRef.current?.tipo === 'cliente') {
          setModal(null);
          acciones.current.elegirMedio(medioTecla);
        }
        return;
      }
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

  // Si el descuento se fue solo (la venta quedó más chica que el descuento), se avisa: sacarlo adrede no avisa.
  const descuentoPrevio = useRef(carrito.descuento);
  const descuentoQuitadoAdrede = useRef(false);
  useEffect(() => {
    const antes = descuentoPrevio.current;
    descuentoPrevio.current = carrito.descuento;
    const adrede = descuentoQuitadoAdrede.current;
    descuentoQuitadoAdrede.current = false;
    if (antes && !carrito.descuento && carrito.items.length > 0 && !adrede) {
      avisar({ texto: `Se sacó el descuento de ${formatPesos(antes)}: era más que lo que queda en la venta.`, tipo: 'error' });
    }
  }, [carrito, avisar]);

  // Si el empleado hizo un descuento de hasta el 10 % y después saca productos, el mismo descuento puede pasar el tope: se saca y se avisa.
  // El que autorizó el dueño viaja con el carrito (sobrevive a la espera y a recargar), así no se pide la clave dos veces.
  useEffect(() => {
    const d = carrito.descuento ?? 0;
    if (!d || dueño || carrito.descuentoAutorizado) return;
    if (d > sumaCarrito(carrito) * 0.1) {
      descuentoQuitadoAdrede.current = true;
      setCarrito((c) => aplicarDescuento(c, 0));
      avisar({ texto: `Se sacó el descuento de ${formatPesos(d)}: con menos productos pasa el 10 %, y eso lo autoriza el dueño.`, tipo: 'error' });
    }
  }, [carrito, dueño, setCarrito, avisar]);

  // La última venta y las otras cosas del mostrador (cobrar un fiado, retiro, mercadería): en PC alta van a la derecha; en pantallas bajas, a la izquierda.
  const pieCaja = (
    <>
      {/* Siempre ocupa su lugar, así el botón de cobrar no se mueve con la primera venta. */}
      <div className="solo-pc">{tiraUltima}</div>
      <div className="botonera botonera-centrada acciones-caja">
        <button type="button" className="boton boton-texto boton-retiro" onClick={() => setModal({ tipo: 'cobrarFiado' })} title="Alguien viene a pagar lo que debe">
          <Icono nombre="clientes" tam={16} /> Cobrar un fiado
        </button>
        <button type="button" className="boton boton-texto boton-retiro" onClick={() => setModal({ tipo: 'movimiento' })}>
          <Icono nombre="billetera" tam={16} /> Anotar un retiro o gasto
        </button>
        {/* El empleado recibe el reparto sin salir de la caja: sólo suma stock; el dueño ve el ingreso completo. */}
        <button type="button" className="boton boton-texto boton-retiro" onClick={() => setModal({ tipo: 'mercaderia' })} disabled={productos.length === 0}>
          <Icono nombre="camion" tam={16} /> Llegó mercadería
        </button>
      </div>
    </>
  );

  // El panel de medio de pago y vuelto: en PC va en la columna de la derecha; en el celular, también en la hoja "Cómo paga".
  const panelCobro = (enHoja = false) => {
    // En la hoja del celular el campo lleva otro id: el panel de la derecha sigue en la página, aunque tapado.
    const idPagaCon = enHoja ? 'paga-con-hoja' : 'paga-con';
    return (
        <div className="tarjeta cobro">
          <div className="cobro-cabecera">
            <h2 className="titulo-chico">Medio de pago</h2>
            <button type="button" className="boton boton-chico boton-dividir" onClick={() => setModal({ tipo: 'dividir' })} disabled={carrito.items.length === 0}>
              <Icono nombre="dividir" tam={15} /> Dividir pago
            </button>
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
                <span className="medio-nombre" title={m.id === 'fiado' && cliente ? cliente.nombre : undefined}>
                  {m.id === 'fiado' ? (cliente ? `Fiado: ${primerNombre(cliente.nombre)}` : 'Fiado (anotar a un cliente)') : m.nombre}
                </span>
                <kbd>{TECLA_DE[m.id]}</kbd>
              </button>
            ))}
          </div>

          {medio === 'efectivo' && (
            <>
              <div className="paga-con">
                <label className="titulo-chico" htmlFor={idPagaCon}>
                  Paga con <kbd>F3</kbd>
                </label>
                {/* Los billetes van antes del campo: un toque y listo; el campo es para cuando paga con otra cosa. */}
                {sugeridos.length > 0 && (
                  <div className="sugeridos">
                    {sugeridos.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`chip ${pagaCon === s ? 'activo' : ''} ${s !== total && s % 1000 !== 0 ? 'chip-redondo' : ''}`}
                        title={s === total ? undefined : `Vuelto ${formatPesos(s - total)}`}
                        onClick={() => {
                          setPagaCon(s);
                          enfocar();
                        }}
                      >
                        {s === total ? 'Justo' : formatPesos(s)}
                        {s !== total && s % 1000 !== 0 && <small>vuelto {formatPesos(s - total)}</small>}
                      </button>
                    ))}
                  </div>
                )}
                <CampoPesos
                  id={idPagaCon}
                  valor={pagaCon}
                  onCambio={setPagaCon}
                  onEscaneo={escaneoEnCampo}
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
    );
  };

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
                    const desdeAgregado = Date.now() - ultimoAgregado.current;
                    // Algunos lectores mandan dos Enter, y después de un "no encontré" el Enter es un reintento: ninguno cobra.
                    if (desdeAgregado <= 400 || Date.now() - ultimoError.current <= 1500) return;
                    // En efectivo y sin "paga con", el primer Enter va a "Paga con" (aunque el cliente haya tardado en sacar la billetera),
                    // así no se cobra sin vuelto por reflejo. Ahí, Enter cobra justo o se escribe con cuánto paga. F12 cobra directo igual.
                    if (medio === 'efectivo' && pagaCon === null && window.matchMedia('(pointer: fine)').matches) {
                      document.getElementById('paga-con')?.focus();
                      return;
                    }
                    cobrar();
                    return;
                  }
                  procesarEntrada();
                } else if (vacio && (e.key === 'Delete' || e.key === '-')) {
                  e.preventDefault();
                  corregirUltimo();
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
          <button type="button" className="boton boton-precio" onClick={() => setModal({ tipo: 'precio', producto: null })} title="Consultar un precio sin cargarlo en la venta (o escribí ? antes del producto)" aria-label="¿Cuánto sale? Consultar un precio">
            <Icono nombre="promo" tam={18} /> <span className="solo-pc">¿Cuánto sale?</span>
          </button>
        </div>
        <p className="ayuda-teclas">
          <span><kbd>3*</kbd> antes del código suma 3</span>
          <span><kbd>?</kbd> antes del producto consulta el precio</span>
          <span><kbd>Supr</kbd> saca lo último que pasaste</span>
          <span><kbd>F4</kbd> monto libre</span>
          <span><kbd>F8</kbd> en espera</span>
          <span><kbd>Enter</kbd> con el buscador vacío va a "Paga con"; otro <kbd>Enter</kbd> cobra justo</span>
        </p>
        {/* En el celular la última venta va arriba: devolver o reimprimir sin bajar hasta el fondo. */}
        {carrito.items.length === 0 && ultima && <div className="ultima-venta-arriba">{tiraUltima}</div>}

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
              {/* En el celular, las otras cosas que pasan en el mostrador sin tener que bajar hasta el fondo. */}
              <div className="acciones-vacia solo-movil-bloque">
                <button type="button" className="boton boton-chico" onClick={() => setModal({ tipo: 'cobrarFiado' })}>
                  <Icono nombre="clientes" tam={16} /> Cobrar un fiado
                </button>
                <button type="button" className="boton boton-chico" onClick={() => setModal({ tipo: 'movimiento' })}>
                  <Icono nombre="billetera" tam={16} /> Retiro o gasto
                </button>
              </div>
            </div>
          ) : (
            <>
            <div className="lista-venta-cabecera">
              <h2 className="titulo-chico">Venta actual</h2>
              <span className="texto-suave">
                {unidades(carrito)} {unidades(carrito) === 1 ? 'producto' : 'productos'}
              </span>
              <button type="button" className="boton boton-chico boton-texto boton-descuento" onClick={() => setModal({ tipo: 'descuento' })} title="Redondear o hacer un descuento sobre toda la venta">
                <Icono nombre="porcentaje" tam={15} /> {carrito.descuento ? `Descuento ${formatPesos(carrito.descuento)}` : 'Descuento'}
              </button>
            </div>
            <ul>
              {carrito.items.map((it, i) => {
                const prod = it.productoId !== null ? productos.find((p) => p.id === it.productoId) : undefined;
                // Sólo se mira el stock de lo que se sigue (tiene stock o mínimo cargado).
                const seguido = prod !== undefined && (prod.stock > 0 || prod.stockMinimo > 0);
                const quedan = prod && seguido ? Math.round((prod.stock - stockQueUsa(it)) * 1000) / 1000 : null;
                const negativo = quedan !== null && quedan < 0;
                const bajo = !negativo && quedan !== null && prod !== undefined && prod.stockMinimo > 0 && quedan <= prod.stockMinimo;
                return (
                  <li key={`${it.productoId ?? 'libre'}-${i}`} className="renglon">
                    <div className="renglon-nombre">
                      <strong>{sinCortes(it.nombre)}</strong>
                      <small className={negativo ? 'texto-alerta' : bajo ? 'texto-aviso' : ''}>
                        {it.gramos ? `${formatoPeso(it.gramos)} por peso` : `${formatPesos(it.precioUnitario)} c/u`}
                        {negativo ? ' · stock mal cargado: corregilo en Productos' : bajo ? ` · ${quedan === 0 ? 'sin stock' : quedan === 1 ? 'queda 1' : `quedan ${quedan}`}: reponer` : ''}
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
                      <CampoCantidad
                        ariaLabel={`Cantidad de ${it.nombre}`}
                        valor={it.cantidad}
                        minimo={1}
                        enVivo={false}
                        onCambio={(n) => setCarrito((c) => cambiarCantidad(c, i, n))}
                        onEscaneo={escaneoEnCampo}
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
            {carrito.descuento ? (
              <div className="renglon-descuento">
                <span>
                  Descuento <small className="texto-suave">sobre {formatPesos(sumaCarrito(carrito))}</small>
                </span>
                <button
                  type="button"
                  className="boton-icono boton-quitar"
                  aria-label="Sacar el descuento"
                  onClick={() => {
                    descuentoQuitadoAdrede.current = true;
                    setCarrito((c) => aplicarDescuento(c, 0));
                  }}
                >
                  <Icono nombre="basura" tam={18} />
                </button>
                <span className="importe renglon-subtotal">−{formatPesos(carrito.descuento)}</span>
              </div>
            ) : null}
          </>
          )}
        </div>

      <div className="caja-pie caja-pie-izquierda">{pieCaja}</div>
      </section>

      <aside className="caja-derecha" aria-label="Cobro">
        {cobrado && carrito.items.length === 0 ? (
          <div className="total total-cobrado" role="status">
            <span>
              {cobrado.pagoFiado
                ? `Fiado cobrado a ${cobrado.cliente ?? ''} con ${nombreMedio(cobrado.medio)}`
                : cobrado.vuelto && cobrado.vuelto > 0
                  ? `Cobrado ${formatPesos(cobrado.total)} · Vuelto`
                  : cobrado.medio === 'fiado'
                    ? `Anotado a ${cobrado.cliente ?? 'fiado'}`
                    : `Cobrado ${cobrado.dividido ? 'en 2 pagos' : `con ${nombreMedio(cobrado.medio)}`}`}
            </span>
            <strong className="importe">{formatPesos(cobrado.vuelto && cobrado.vuelto > 0 ? cobrado.vuelto : cobrado.total)}</strong>
            {cobrado.pagoFiado && <small>{cobrado.queda && cobrado.queda > 0 ? `Le quedan ${formatPesos(cobrado.queda)}` : 'Quedó al día'}</small>}
            {cobrado.fiado && cobrado.fiado > 0 && (
              <small>
                {formatPesos(cobrado.fiado)} anotados a {cobrado.cliente}
              </small>
            )}
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
              {carrito.descuento ? ` · ${formatPesos(sumaCarrito(carrito))} menos ${formatPesos(carrito.descuento)} de descuento` : ''}
            </small>
          </div>
        )}

        {panelCobro()}

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
        {/* En pantallas bajas (1366×768) esto pasa a la columna izquierda, donde sobra lugar; acá quedaría bajo el borde. */}
        <div className="caja-pie caja-pie-derecha">{pieCaja}</div>
      </aside>

      {carrito.items.length > 0 ? (
        // En el celular se cobra desde acá, con el medio que esté elegido; el botón del medio abre la hoja para cambiarlo o poner con cuánto paga.
        <div className="barra-cobro-movil">
          <div>
            <small>
              {medio === 'fiado' ? (cliente ? `Fiado a ${primerNombre(cliente.nombre)}` : 'Fiado') : nombreMedio(medio)}
              {medio === 'efectivo' && pagaCon !== null && vuelto !== null ? ` · paga con ${formatPesos(pagaCon)}, vuelto ${formatPesos(vuelto)}` : ''}
            </small>
            <strong className="importe">{formatPesos(total)}</strong>
          </div>
          <button type="button" className="boton boton-chico boton-cuadrado" onClick={() => setModal({ tipo: 'cobro' })} aria-label="Cambiar el medio de pago o poner con cuánto paga" title="Medio de pago y vuelto">
            <Icono nombre={ICONO_MEDIO[medio]} tam={20} />
          </button>
          <button type="button" className="boton boton-primario boton-rojo" onClick={() => cobrar()} disabled={cobrando}>
            {medio === 'fiado' ? (cliente ? `Anotar a ${primerNombre(cliente.nombre)}` : 'Anotar fiado') : 'Cobrar'}
          </button>
        </div>
      ) : cobrado ? (
        // En el celular el vuelto se queda a la vista hasta que arranca la próxima venta.
        <div className="barra-cobro-movil barra-cobrado" role="status">
          <div>
            <small>
              {cobrado.pagoFiado
                ? `Fiado cobrado a ${primerNombre(cobrado.cliente ?? '')}${cobrado.queda && cobrado.queda > 0 ? ` · le quedan ${formatPesos(cobrado.queda)}` : ' · al día'}`
                : cobrado.vuelto && cobrado.vuelto > 0
                  ? `Cobrado ${formatPesos(cobrado.total)} · Vuelto`
                  : cobrado.medio === 'fiado'
                    ? `Anotado a ${primerNombre(cobrado.cliente ?? 'fiado')}`
                    : 'Cobrado'}
              {cobrado.dividido && cobrado.fiado ? ` · ${formatPesos(cobrado.fiado)} a ${primerNombre(cobrado.cliente ?? '')}` : ''}
            </small>
            <strong className="importe">{formatPesos(cobrado.vuelto && cobrado.vuelto > 0 ? cobrado.vuelto : cobrado.total)}</strong>
          </div>
          <button type="button" className="boton" onClick={() => setCobrado(null)}>
            Siguiente
          </button>
        </div>
      ) : espera.length > 0 ? (
        <div className="barra-cobro-movil barra-espera" role="status">
          <div>
            <small>{resumenEspera(espera).texto}</small>
            <strong className="importe">{formatPesos(resumenEspera(espera).total)}</strong>
          </div>
          <button type="button" className="boton" onClick={() => retomar(espera[0]!)}>
            <Icono nombre="pausa" tam={16} /> Retomar
          </button>
        </div>
      ) : null}

      {modal?.tipo === 'cobro' && (
        // La hoja del celular: medio de pago, con cuánto paga y el botón de cobrar, sin bajar hasta el panel.
        <Modal titulo="Cómo paga" onCerrar={() => setModal(null)}>
          <div className="formulario cobro-hoja">
            {panelCobro(true)}
            <button type="button" className="boton boton-primario boton-rojo boton-grande" onClick={() => cobrar()} disabled={carrito.items.length === 0 || cobrando}>
              {medio === 'fiado' ? (cliente ? `Anotar ${formatPesos(total)} a ${primerNombre(cliente.nombre)}` : 'Anotar fiado') : `Cobrar ${formatPesos(total)}`}
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setModal(null);
                ponerEnEspera();
              }}
              disabled={carrito.items.length === 0}
            >
              <Icono nombre="pausa" tam={16} /> Dejar en espera
            </button>
          </div>
        </Modal>
      )}
      {modal?.tipo === 'cobrarFiado' && (
        <ElegirCliente
          titulo="¿Quién viene a pagar su fiado?"
          deudoresPrimero
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onElegir={(c, saldo) => setModal({ tipo: 'pagoFiado', cliente: c, saldo })}
        />
      )}
      {modal?.tipo === 'pagoFiado' && (
        <RegistrarPago
          cliente={modal.cliente}
          saldo={modal.saldo}
          onHecho={({ monto, medio: m, resto }) =>
            setCobrado({ id: 0, total: monto, medio: m, hora: Date.now(), cliente: modal.cliente.nombre, pagoFiado: true, queda: Math.max(0, resto) })
          }
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
        />
      )}
      {modal?.tipo === 'descuento' && (
        <Descuento
          suma={sumaCarrito(carrito)}
          actual={carrito.descuento ?? 0}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onAplicar={(d, autorizado) => {
            descuentoQuitadoAdrede.current = true;
            setCarrito((c) => aplicarDescuento(c, d, autorizado));
            setPagaCon(null);
            setModal(null);
            enfocar();
          }}
        />
      )}
      {modal?.tipo === 'precio' && (
        <ConsultaPrecio
          inicial={modal.producto}
          productos={productos}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
          onAgregar={(p) => {
            setModal(null);
            agregar(p, 1);
          }}
        />
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
          onEscaneo={(codigo) => {
            setModal(null);
            escaneoEnCampo(codigo);
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
          onHecho={(monto) => {
            // La venta sigue siendo la última, con lo devuelto marcado; el "cobrado" grande ya no vale.
            setUltima((u) => (u && u.id === modal.venta.id ? { ...u, devuelto: (u.devuelto ?? 0) + monto } : u));
            setCobrado(null);
          }}
        />
      )}
      {modal?.tipo === 'limite' && (
        <Modal
          titulo="Pasa el límite de fiado"
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
        >
          <div className="formulario">
            <p>{modal.aviso}</p>
            <div className="botonera botonera-final">
              <button
                type="button"
                className="boton"
                onClick={() => {
                  setModal(null);
                  avisar({ texto: `No se anotó: ${cliente?.nombre} supera su límite de fiado.`, tipo: 'info' });
                  enfocar();
                }}
              >
                No anotar
              </button>
              <button
                type="button"
                className="boton boton-primario"
                autoFocus
                onClick={() => {
                  const m = modal;
                  setModal(null);
                  cobrar(m.pagos, m.pagaCon, true);
                }}
              >
                Fiar igual
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.tipo === 'mercaderia' && (
        <IngresoMercaderia
          productos={productos}
          proveedores={[...new Set(productos.map((p) => p.proveedor?.trim()).filter((x): x is string => !!x))].sort()}
          soloStock={!dueño}
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
        />
      )}
      {modal?.tipo === 'movimiento' && (
        <NuevoMovimiento
          onCerrar={() => {
            setModal(null);
            enfocar();
          }}
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

/** Redondear o descontar sobre toda la venta: "son 3.150, dejámelo en 3.000". */
function Descuento({
  suma,
  actual,
  onCerrar,
  onAplicar,
}: {
  suma: number;
  actual: number;
  onCerrar: () => void;
  // "autorizado": lo aplicó el dueño, o un empleado con la clave del dueño.
  onAplicar: (descuento: number, autorizado: boolean) => void;
}) {
  const dueño = useEsDueño();
  const pedirDueño = usePedirDueño();
  const [modo, setModo] = useState<'total' | 'pesos' | 'porcentaje'>('total');
  const [total, setTotal] = useState<number | null>(actual > 0 ? suma - actual : null);
  const [pesos, setPesos] = useState<number | null>(actual > 0 ? actual : null);
  const [porcentaje, setPorcentaje] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  const descuento =
    modo === 'total' ? (total === null ? 0 : suma - total) : modo === 'pesos' ? (pesos ?? 0) : Math.round((suma * Math.min(100, Number(porcentaje) || 0)) / 100);
  const valido = descuento > 0 && descuento < suma;
  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    unaVez(async () => {
      // Hasta un 10 % lo decide el empleado; más, el dueño.
      let autorizado = dueño;
      if (!dueño && descuento > suma * 0.1) {
        const quien = await pedirDueño(`Hacer un descuento de ${formatPesos(descuento)} (${Math.round((descuento / suma) * 100)} %)`);
        if (!quien) return;
        autorizado = true;
      }
      onAplicar(descuento, autorizado);
    });
  };
  return (
    <Modal titulo="Descuento o redondeo" onCerrar={onCerrar}>
      <form className="formulario" onSubmit={aplicar}>
        <p className="texto-suave">
          La venta suma <strong className="importe texto-normal">{formatPesos(suma)}</strong>. El descuento queda en el ticket y en los reportes.
        </p>
        <div className="segmentos" role="group" aria-label="Cómo descontar">
          {(
            [
              ['total', 'Dejarlo en'],
              ['pesos', 'Descontar $'],
              ['porcentaje', 'Descontar %'],
            ] as const
          ).map(([id, texto]) => (
            <button
              key={id}
              type="button"
              className={modo === id ? 'activo' : ''}
              aria-pressed={modo === id}
              onClick={() => {
                setModo(id);
                document.getElementById('campo-descuento')?.focus();
              }}
            >
              {texto}
            </button>
          ))}
        </div>
        {modo === 'total' && <CampoPesos id="campo-descuento" etiqueta="Cobrar en total" valor={total} onCambio={setTotal} autoFocus grande />}
        {modo === 'pesos' && <CampoPesos id="campo-descuento" etiqueta="Descontar" valor={pesos} onCambio={setPesos} autoFocus grande />}
        {modo === 'porcentaje' && (
          <label className="campo">
            <span className="campo-etiqueta">Descontar</span>
            <div className="campo-pesos campo-pesos-grande">
              <input id="campo-descuento" inputMode="numeric" autoFocus value={porcentaje} onChange={(e) => setPorcentaje(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="10" />
              <span aria-hidden="true">%</span>
            </div>
          </label>
        )}
        {descuento >= suma && descuento > 0 && <p className="texto-alerta">Así la venta queda en cero: no se puede.</p>}
        <div className={`vuelto ${valido ? '' : 'vuelto-cero'}`}>
          <span>{valido ? `Descuento −${formatPesos(descuento)} · se cobra` : 'Se cobra'}</span>
          <strong className="importe">{formatPesos(valido ? suma - descuento : suma)}</strong>
        </div>
        {!dueño && valido && descuento > suma * 0.1 && <p className="texto-suave">Más del 10 %: pide la clave del dueño.</p>}
        <div className="modal-pie">
          <button className="boton boton-primario boton-grande" type="submit" disabled={!valido || enCurso}>
            {valido ? `Aplicar descuento de ${formatPesos(descuento)}` : 'Aplicar descuento'}
          </button>
          {actual > 0 && (
            <button type="button" className="boton boton-texto" onClick={() => onAplicar(0, false)}>
              Sacar el descuento de {formatPesos(actual)}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** "¿Cuánto sale?": mirar el precio (y el stock) de algo sin sumarlo a la venta. El lector funciona acá adentro. */
function ConsultaPrecio({ inicial, productos, onCerrar, onAgregar }: { inicial: Producto | null; productos: Producto[]; onCerrar: () => void; onAgregar: (p: Producto) => void }) {
  const [producto, setProducto] = useState<Producto | null>(inicial);
  const [q, setQ] = useState('');
  const porCodigo = useMemo(() => new Map(productos.filter((p) => p.codigo).map((p) => [p.codigo, p])), [productos]);
  const resultados = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2 || esCodigo(t)) return [];
    const palabras = t.split(/\s+/);
    return productos.filter((p) => palabras.every((w) => normalizar(`${p.nombre} ${p.codigo} ${p.categoria}`).includes(w))).slice(0, 6);
  }, [q, productos]);
  const elegir = (p: Producto) => {
    setProducto(p);
    setQ('');
    pitido('ok');
  };
  const buscar = () => {
    const t = q.trim();
    const p = porCodigo.get(codigoEscaneado(t) ?? t) ?? resultados[0];
    if (p) elegir(p);
    else pitido('error');
  };
  return (
    <Modal titulo="¿Cuánto sale?" onCerrar={onCerrar}>
      <div className="formulario consulta-precio">
        <div className="buscador-campo buscador-chico">
          <Icono nombre="buscar" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Escaneá o escribí el producto"
            aria-label="Producto a consultar"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (q.trim()) buscar();
              else if (producto) onAgregar(producto);
            }}
          />
        </div>
        {q.trim() && resultados.length > 0 && (
          <ul className="lista-clientes" aria-label="Productos encontrados">
            {resultados.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => elegir(p)}>
                  <span>{p.nombre}</span>
                  <span className="importe">{formatPesos(p.precio)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {producto ? (
          <div className="precio-consultado" role="status">
            <strong>{producto.nombre}</strong>
            <span className="importe precio-grande">
              {formatPesos(producto.precio)}
              {producto.porPeso ? <small> el kilo</small> : null}
            </span>
            {producto.promo && producto.promo.cantidad > 1 && (
              <span className="promo-etiqueta">
                <Icono nombre="promo" tam={13} /> Promo {producto.promo.cantidad} x {formatPesos(producto.promo.precio)}
              </span>
            )}
            <small className="texto-suave">
              {producto.stock <= 0 ? 'Sin stock en el sistema' : producto.stock === 1 ? 'Queda 1' : `Quedan ${producto.stock}`}
              {producto.codigo ? ` · ${producto.codigo}` : ''}
            </small>
          </div>
        ) : (
          <p className="texto-suave">Para decir un precio sin cargarlo. Nada se suma a la venta hasta que toques "Agregar".</p>
        )}
        <div className="botonera botonera-final">
          <button type="button" className="boton" onClick={onCerrar}>
            Cerrar
          </button>
          <button type="button" className="boton boton-primario" disabled={!producto} onClick={() => producto && onAgregar(producto)}>
            Agregar a la venta
          </button>
        </div>
      </div>
    </Modal>
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

function ElegirCliente({
  onCerrar,
  onElegir,
  titulo = '¿A quién se lo anotás?',
  deudoresPrimero = false,
}: {
  onCerrar: () => void;
  onElegir: (c: Cliente, saldo: number) => void;
  titulo?: string;
  /** Para cobrar: los que deben van arriba, del que más debe al que menos. */
  deudoresPrimero?: boolean;
}) {
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
        .sort((a, b) => (deudoresPrimero && a.saldo !== b.saldo ? b.saldo - a.saldo : a.c.nombre.localeCompare(b.c.nombre)));
    },
    [deudoresPrimero],
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
        if (c) onElegir(c, 0);
      } catch (e) {
        avisar({ texto: errorATexto(e), tipo: 'error' });
      }
    });
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
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
            // Si no hay nadie que se llame así, Enter lo crea.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = Math.min(filtrados.length, 8);
              setResaltado((r) => (e.key === 'ArrowDown' ? Math.min(r + 1, n - 1) : Math.max(r - 1, 0)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (!q.trim()) return;
              const elegido = resaltado >= 0 ? filtrados[resaltado] : exacto ?? (filtrados.length === 1 ? filtrados[0] : undefined);
              if (elegido) onElegir(elegido.c, elegido.saldo);
              else if (filtrados.length === 0) crear();
            }
          }}
        />
        <ul className="lista-clientes">
          {filtrados.slice(0, 8).map(({ c, saldo }, i) => (
            <li key={c.id}>
              <button type="button" className={i === resaltado ? 'resaltado' : ''} onClick={() => onElegir(c, saldo)}>
                <span>{c.nombre}</span>
                <span className={saldo > 0 ? 'texto-alerta importe' : 'texto-suave importe'}>{saldo > 0 ? `debe ${formatPesos(saldo)}` : 'al día'}</span>
              </button>
            </li>
          ))}
        </ul>
        {q.trim() && !exacto && (
          <button type="button" className="boton" onClick={crear}>
            <Icono nombre="mas" tam={18} /> Crear cliente "{q.trim()}"{filtrados.length === 0 ? <kbd>Enter</kbd> : null}
          </button>
        )}
      </div>
    </Modal>
  );
}

function PedirPeso({
  producto,
  onCerrar,
  onAgregar,
  onEscaneo,
}: {
  producto: Producto;
  onCerrar: () => void;
  onAgregar: (gramos: number) => void;
  /** El lector pasó un código con el cursor en los gramos: se suma ese producto y el peso queda para después. */
  onEscaneo: (codigo: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const gramos = gramosDeTexto(texto);
  const precio = Math.round((producto.precio * gramos) / 1000);
  const codigo = codigoEscaneado(texto);
  // Más de 50 kg no es un peso de mostrador: casi siempre es el lector.
  const demasiado = !codigo && gramos > 50_000;
  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (codigo) {
            onEscaneo(codigo);
            return;
          }
          if (gramos > 0 && !demasiado) onAgregar(gramos);
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
        {codigo ? (
          <p className="texto-alerta">Eso fue el lector, no un peso: con Enter se suma ese producto y el {producto.nombre.toLowerCase()} queda para después.</p>
        ) : demasiado ? (
          <p className="texto-alerta">Son {formatoPeso(gramos)}: eso no es un peso de mostrador. Revisá los gramos.</p>
        ) : (
          gramos > 3000 && <p className="texto-aviso">Son {formatoPeso(gramos)}: fijate que esté bien antes de agregar.</p>
        )}
        <button className="boton boton-primario boton-grande" type="submit" disabled={(gramos <= 0 && !codigo) || demasiado}>
          {codigo ? 'Sumar lo que pasó el lector' : gramos > 0 ? `Agregar ${formatoPeso(gramos)}: ${formatPesos(precio)}` : 'Agregar'}
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
  // Casi siempre es efectivo + Mercado Pago (o + fiado): los otros medios se agregan con un toque.
  const [visibles, setVisibles] = useState<MedioPago[]>(() => (cliente ? ['efectivo', 'mercadopago', 'fiado'] : ['efectivo', 'mercadopago']));
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
  const ocultos = MEDIOS.filter((m) => !visibles.includes(m.id));
  return (
    <Modal titulo="Dividir el pago" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) onCobrar(pagos, efectivo > 0 ? efectivo : null);
        }}
      >
        <p className="texto-suave">
          Repartí los <strong className="importe texto-normal">{formatPesos(total)}</strong> entre los medios.
        </p>
        <div className="dividir">
          {MEDIOS.filter((m) => visibles.includes(m.id)).map((m, i) => (
            <div key={m.id} className="dividir-fila">
              <span className="dividir-medio">
                <Icono nombre={ICONO_MEDIO[m.id]} tam={18} /> {m.id === 'fiado' ? (cliente ? `Fiado a ${primerNombre(cliente.nombre)}` : 'Fiado') : m.nombre}
              </span>
              <CampoPesos valor={montos[m.id] ?? null} onCambio={(v) => setMontos((x) => ({ ...x, [m.id]: v }))} autoFocus={i === 0} ariaLabel={`Monto en ${m.nombre}`} />
              <button type="button" className="boton boton-chico" tabIndex={-1} onClick={() => completar(m.id)} disabled={falta <= 0}>
                El resto
              </button>
            </div>
          ))}
        </div>
        {ocultos.length > 0 && (
          <div className="chips dividir-chips">
            {ocultos.map((m) => (
              <button key={m.id} type="button" className="chip" onClick={() => setVisibles((v) => [...v, m.id])}>
                + {m.nombre}
              </button>
            ))}
          </div>
        )}
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
        <div className="modal-pie">
          {fia && !cliente && <p className="texto-suave texto-centrado">Falta elegir a quién se le anota el fiado.</p>}
          <button className="boton boton-primario boton-rojo boton-grande" type="submit" disabled={!listo}>
            Cobrar {formatPesos(total)}
          </button>
        </div>
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
