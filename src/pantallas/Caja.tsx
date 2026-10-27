import { useSesion } from '../ui/sesion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agregarItem,
  calcularVuelto,
  cambiarCantidad,
  carritoVacio,
  esCodigo,
  interpretarEntrada,
  itemDeProducto,
  itemMontoLibre,
  pagosSugeridos,
  quitarItem,
  subtotal,
  totalCarrito,
  unidades,
  type Carrito,
} from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { saldoCliente } from '../dominio/fiado';
import { MEDIOS, nombreMedio, type Cliente, type MedioPago, type Producto } from '../dominio/tipos';
import { db } from '../datos/db';
import {
  abrirTurno,
  anularVenta,
  buscarPorCodigo,
  controlarLimite,
  guardarCliente,
  guardarProducto,
  leerAjuste,
  registrarVenta,
  turnoAbierto,
} from '../datos/operaciones';
import { CampoPesos, errorATexto, Icono, Modal, useAvisar, type NombreIcono } from '../ui/componentes';
import { Escaner } from '../ui/Escaner';
import { pitido, useConsulta, useUnaVez } from '../ui/hooks';
import { usePedirDueño } from '../ui/permisos';

// El carrito y las ventas en espera sobreviven a cambiar de pantalla (y a recargar).
function useGuardado<T>(llave: string, inicial: T) {
  const [valor, setValor] = useState<T>(() => {
    try {
      const crudo = sessionStorage.getItem(llave);
      return crudo ? (JSON.parse(crudo) as T) : inicial;
    } catch {
      return inicial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(llave, JSON.stringify(valor));
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
}

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
  const [enCurso, unaVez] = useUnaVez();
  const { sesion } = useSesion();
  useEffect(() => {
    if (sesion) setCajero(sesion.nombre);
    else leerAjuste(db, 'cajero', '').then((c) => setCajero(String(c)));
  }, [sesion]);
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
  const [entrada, setEntrada] = useState('');
  const [resaltado, setResaltado] = useState(0);
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [pagaCon, setPagaCon] = useState<number | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [modal, setModal] = useState<
    null | { tipo: 'libre' } | { tipo: 'nuevo'; codigo: string; cantidad: number } | { tipo: 'camara' } | { tipo: 'cliente' }
  >(null);
  const [cobrando, setCobrando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);

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
      setCarrito((c) => agregarItem(c, itemDeProducto(p, cantidad)));
      if (buscador.current) buscador.current.value = '';
      setEntrada('');
      setResaltado(0);
      setPagaCon(null);
      pitido('ok');
      enfocar();
    },
    [enfocar],
  );

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
    avisar({ texto: `No encontré "${q}".`, tipo: 'error' });
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
    setCarrito(carritoVacio);
    limpiarCobro();
    setConfirmarCancelar(false);
    enfocar();
  }, [carrito, confirmarCancelar, enfocar, setCarrito]);

  const cobrar = useCallback(async () => {
    if (cobrando || carrito.items.length === 0) return;
    if (medio === 'fiado' && !cliente) {
      setModal({ tipo: 'cliente' });
      return;
    }
    if (medio === 'efectivo' && pagaCon !== null && pagaCon < total) {
      pitido('error');
      avisar({ texto: `Faltan ${formatPesos(total - pagaCon)}: con eso no alcanza.`, tipo: 'error' });
      return;
    }
    setCobrando(true);
    try {
      if (medio === 'fiado' && cliente?.id !== undefined) {
        const aviso = await controlarLimite(db, cliente.id, total);
        if (aviso) avisar({ texto: aviso, tipo: 'info' });
      }
      const venta = await registrarVenta(db, {
        items: carrito.items,
        medio,
        pagaCon: medio === 'efectivo' ? pagaCon : null,
        clienteId: medio === 'fiado' ? (cliente?.id ?? null) : null,
      }, sesion?.usuario);
      pitido('ok');
      const detalle =
        medio === 'efectivo' && venta.vuelto > 0
          ? `Cobrado ${formatPesos(venta.total)} · Vuelto ${formatPesos(venta.vuelto)}`
          : medio === 'fiado'
            ? `Anotado ${formatPesos(venta.total)} a ${cliente?.nombre}`
            : `Cobrado ${formatPesos(venta.total)} con ${nombreMedio(medio)}`;
      avisar({ texto: detalle, tipo: 'ok' });
      setUltima({ id: venta.id!, total: venta.total, medio, hora: Date.now() });
      setCarrito(carritoVacio);
      limpiarCobro();
    } catch (e) {
      pitido('error');
      avisar({ texto: errorATexto(e), tipo: 'error' });
    } finally {
      setCobrando(false);
      enfocar();
    }
  }, [cobrando, carrito, medio, cliente, pagaCon, total, avisar, enfocar, setCarrito, setUltima, sesion]);

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
  const acciones = useRef({ cobrar, ponerEnEspera });
  acciones.current = { cobrar, ponerEnEspera };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        buscador.current?.focus();
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
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  procesarEntrada();
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
                        <small className={p.stock <= p.stockMinimo && p.stockMinimo > 0 ? 'texto-alerta' : ''}>
                          {p.codigo || 'sin código'} · quedan {p.stock}
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
          Tip: <kbd>3*</kbd> antes del código suma 3 · <kbd>F4</kbd> monto libre · <kbd>F8</kbd> espera · <kbd>F12</kbd> cobrar
        </p>

        {rapidos.length > 0 && (
          <div className="rapidos" aria-label="Productos rápidos">
            {rapidos.map((p) => (
              <button key={p.id} type="button" className="rapido" onClick={() => agregar(p, 1)}>
                <span className="rapido-nombre">{p.nombre}</span>
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
                const quedan = prod ? prod.stock - it.cantidad : null;
                return (
                  <li key={`${it.productoId ?? 'libre'}-${i}`} className="renglon">
                    <div className="renglon-nombre">
                      <strong>{it.nombre}</strong>
                      <small className={quedan !== null && prod && prod.stockMinimo > 0 && quedan <= prod.stockMinimo ? 'texto-alerta' : ''}>
                        {formatPesos(it.precioUnitario)} c/u
                        {quedan !== null && prod && prod.stockMinimo > 0 && quedan <= prod.stockMinimo ? ` · quedan ${Math.max(quedan, 0)}: reponer` : ''}
                      </small>
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
        <div className="total">
          <span>Total a cobrar</span>
          <strong className="importe">{formatPesos(total)}</strong>
          <small>
            {unidades(carrito)} {unidades(carrito) === 1 ? 'producto' : 'productos'}
          </small>
        </div>

        <div className="tarjeta cobro">
          <h2 className="titulo-chico">Medio de pago</h2>
          <div className="medios">
            {MEDIOS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`medio ${medio === m.id ? 'activo' : ''} ${m.id === 'fiado' ? 'medio-ancho' : ''}`}
                aria-pressed={medio === m.id}
                onClick={() => {
                  setMedio(m.id);
                  if (m.id === 'fiado' && !cliente) setModal({ tipo: 'cliente' });
                }}
              >
                <Icono nombre={ICONO_MEDIO[m.id]} tam={18} />
                <span>{m.id === 'fiado' ? (cliente ? `Fiado: ${cliente.nombre}` : 'Fiado (anotar a un cliente)') : m.nombre}</span>
              </button>
            ))}
          </div>

          {medio === 'efectivo' && (
            <>
              <h2 className="titulo-chico">Paga con</h2>
              <CampoPesos valor={pagaCon} onCambio={setPagaCon} grande placeholder="Justo" />
              {sugeridos.length > 0 && (
                <div className="sugeridos">
                  {sugeridos.map((s) => (
                    <button key={s} type="button" className={`chip ${pagaCon === s ? 'activo' : ''}`} onClick={() => setPagaCon(s)}>
                      {s === total ? 'Justo' : formatPesos(s)}
                    </button>
                  ))}
                </div>
              )}
              <div className={`vuelto ${vuelto === null ? 'vuelto-falta' : ''}`}>
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

        <button type="button" className="boton boton-primario boton-cobrar" onClick={cobrar} disabled={carrito.items.length === 0 || cobrando}>
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
            {confirmarCancelar ? '¿Seguro? Tocá de nuevo' : 'Cancelar venta'}
          </button>
        </div>
        {ultima && (
          <div className="ultima-venta">
            <span>
              <small className="texto-suave">Última venta</small>
              <strong className="importe">
                {formatPesos(ultima.total)} · {nombreMedio(ultima.medio)}
              </strong>
            </span>
            <button type="button" className="boton boton-chico boton-texto-peligro" onClick={anularUltima}>
              <Icono nombre="deshacer" tam={16} /> Anular
            </button>
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
        <button type="button" className="boton boton-primario" onClick={() => document.querySelector('.caja-derecha')?.scrollIntoView({ behavior: 'smooth' })} disabled={carrito.items.length === 0}>
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
  return (
    <Modal titulo="Monto libre" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (monto && monto > 0) onAgregar(monto, desc);
        }}
      >
        <p className="texto-suave">Para algo que no está cargado: una fotocopia, una recarga, un producto suelto.</p>
        <CampoPesos etiqueta="Monto" valor={monto} onCambio={setMonto} autoFocus grande />
        <label className="campo">
          <span className="campo-etiqueta">Qué es (opcional)</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Varios" />
        </label>
        <button className="boton boton-primario boton-grande" type="submit" disabled={!monto || monto <= 0}>
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
      return clientes
        .map((c) => ({ c, saldo: saldoCliente(movs.filter((m) => m.clienteId === c.id)) }))
        .sort((a, b) => a.c.nombre.localeCompare(b.c.nombre));
    },
    [],
    [] as { c: Cliente; saldo: number }[],
  );
  const filtrados = datos.filter((d) => normalizar(d.c.nombre).includes(normalizar(q.trim())));
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
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Buscá o escribí un nombre nuevo"
          aria-label="Buscar cliente"
          onKeyDown={(e) => {
            // Con el buscador vacío Enter no hace nada: así no se anota fiado a cualquiera.
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!q.trim()) return;
              if (filtrados[0]) onElegir(filtrados[0].c);
              else crear();
            }
          }}
        />
        <ul className="lista-clientes">
          {filtrados.slice(0, 8).map(({ c, saldo }) => (
            <li key={c.id}>
              <button type="button" onClick={() => onElegir(c)}>
                <span>{c.nombre}</span>
                <span className={saldo > 0 ? 'texto-alerta importe' : 'texto-suave importe'}>{saldo > 0 ? `debe ${formatPesos(saldo)}` : 'al día'}</span>
              </button>
            </li>
          ))}
        </ul>
        {q.trim() && !filtrados.some((d) => normalizar(d.c.nombre) === normalizar(q.trim())) && (
          <button type="button" className="boton" onClick={crear}>
            <Icono nombre="mas" tam={18} /> Crear cliente "{q.trim()}"
          </button>
        )}
      </div>
    </Modal>
  );
}
