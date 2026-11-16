import { useEffect, useMemo, useRef, useState } from 'react';
import { BotonAyuda } from '../ui/Ayuda';
import {
  cambioDePrecio,
  cantidadDeCompra,
  claveProveedor,
  cuentasDeProveedores,
  estadoDeCompras,
  fechaDeTexto,
  reconocer,
  textoDeFecha,
  variacion,
  type Certeza,
  type CuentaProveedor,
  type FacturaLeida,
} from '../dominio/compras';
import { esCombo } from '../dominio/combos';
import { formatPesos } from '../dominio/dinero';
import { codigoEscaneado, mapaPorCodigo, normalizarTexto as normalizar } from '../dominio/entrada';
import { margen, precioParaMargen, type Redondeo } from '../dominio/precios';
import { MEDIOS_PROVEEDOR, nombreMedioProveedor, type Compra, type MedioPagoProveedor, type PagoProveedor, type Producto } from '../dominio/tipos';
import { db } from '../datos/db';
import { aliasDeCompras, anularCompra, anularPagoProveedor, faltaEnCaja, nombresDeProveedores, registrarCompra, registrarPagoProveedor } from '../datos/compras';
import { achicarFoto, leerFotosDeFactura } from '../datos/lecturaFactura';
import { guardarAjuste, leerAjuste, turnoAbierto } from '../datos/operaciones';
import { CampoPesos, errorATexto, Icono, Modal, sinCortes, useAvisar, Vacio, type NombreIcono } from '../ui/componentes';
import { pitido, useBajando, useConsulta, useUnaVez } from '../ui/hooks';
import { useSesion } from '../ui/sesion';
import { LLAVE_COMPRA_NUEVA } from '../ui/compraNueva';


const textoCantidad = (n: number, porPeso?: boolean) => (porPeso ? `${n.toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg` : n.toLocaleString('es-AR'));
const fechaLarga = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

function inicioDeMes(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function nombreComprobante(c: Pick<Compra, 'comprobante' | 'numero'>): string {
  const partes = [c.comprobante, c.numero].filter(Boolean);
  return partes.length > 0 ? partes.join(' ') : 'Compra sin número';
}

// ======================================================================
// Pantalla
// ======================================================================

export function PantallaCompras() {
  const avisar = useAvisar();
  const bajando = useBajando();
  const datos = useConsulta(
    async () => {
      const [compras, pagos, productos] = await Promise.all([db.compras.toArray(), db.pagosProveedor.toArray(), db.productos.toArray()]);
      return { compras, pagos, productos };
    },
    [],
    { compras: [] as Compra[], pagos: [] as PagoProveedor[], productos: [] as Producto[] },
  );
  const cuentas = useMemo(
    () => cuentasDeProveedores(datos.compras, datos.pagos, datos.productos.map((p) => p.proveedor ?? '').filter(Boolean)),
    [datos],
  );
  const [elegido, setElegido] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editor, setEditor] = useState<null | { fotos?: File[]; proveedor?: string }>(null);
  const [pagar, setPagar] = useState<null | { cuenta: CuentaProveedor; compra?: Compra }>(null);
  const foto = useRef<HTMLInputElement>(null);

  // "Llegó mercadería" desde Productos o la Caja abre directo una compra nueva.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(LLAVE_COMPRA_NUEVA)) {
        sessionStorage.removeItem(LLAVE_COMPRA_NUEVA);
        setEditor({});
      }
    } catch {
      /* nada */
    }
  }, []);

  const conMovimientos = cuentas.filter((c) => c.compras.length > 0 || c.pagos.length > 0);
  const visibles = useMemo(() => {
    const t = normalizar(q.trim());
    return (t ? cuentas : conMovimientos.length > 0 ? conMovimientos : cuentas).filter((c) => normalizar(c.nombre).includes(t));
  }, [cuentas, conMovimientos, q]);
  const elegida = cuentas.find((c) => c.clave === elegido) ?? (elegido === null ? (visibles[0] ?? null) : null);
  const deuda = cuentas.reduce((s, c) => s + Math.max(0, c.saldo), 0);
  const deudores = cuentas.filter((c) => c.saldo > 0).length;
  const mes = inicioDeMes();
  const delMes = datos.compras.filter((c) => !c.anulada && c.fecha >= mes);
  const compradoMes = delMes.reduce((s, c) => s + c.total, 0);
  const preciosMes = new Set(delMes.flatMap((c) => c.renglones.filter((r) => !r.nuevo && r.precioAnterior > 0 && r.precio !== r.precioAnterior).map((r) => r.productoId))).size;

  const refDetalle = useRef<HTMLElement>(null);
  useEffect(() => {
    if (elegido !== null && window.matchMedia('(max-width: 900px)').matches) refDetalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [elegido]);

  if (editor) {
    return (
      <EditorCompra
        fotosIniciales={editor.fotos}
        proveedorInicial={editor.proveedor}
        productos={datos.productos}
        onCerrar={(compra) => {
          setEditor(null);
          if (compra) setElegido(claveProveedor(compra.proveedor));
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  const abrirFoto = () => foto.current?.click();
  const inputFoto = (
    <input
      ref={foto}
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      hidden
      onChange={(e) => {
        const archivos = [...(e.target.files ?? [])].slice(0, 4);
        e.target.value = '';
        if (archivos.length > 0) setEditor({ fotos: archivos });
      }}
    />
  );

  return (
    <div className="pagina">
      {inputFoto}
      <div className="pagina-cabecera">
        <div>
          <h1>
            Compras <BotonAyuda tema="compras" que="cómo cargar una factura" />
          </h1>
          <p className="texto-suave">
            {deudores === 0 ? (
              conMovimientos.length > 0 ? 'Estás al día con todos los proveedores.' : 'Facturas y remitos de tus proveedores: stock, costos y precios de una.'
            ) : (
              <>
                Le debés <strong className="texto-normal">{formatPesos(deuda)}</strong> {deudores === 1 ? 'a un proveedor' : `a ${deudores} proveedores`}
              </>
            )}
          </p>
        </div>
        <div className="botonera solo-pc">
          <button type="button" className="boton" onClick={() => setEditor({})}>
            <Icono nombre="lapiz" tam={18} /> Cargar a mano
          </button>
          <button type="button" className="boton boton-rojo" onClick={abrirFoto}>
            <Icono nombre="foto" tam={18} /> Sacar foto a la factura
          </button>
        </div>
      </div>
      <button type="button" className={`fab ${bajando ? 'fab-oculto' : ''}`} onClick={abrirFoto} aria-label="Sacar foto a la factura" title="Sacar foto a la factura">
        <Icono nombre="foto" tam={26} />
      </button>
      <button type="button" className="boton solo-movil compras-a-mano" onClick={() => setEditor({})}>
        <Icono nombre="lapiz" tam={18} /> Cargar una compra a mano
      </button>

      {datos.compras.length === 0 && datos.pagos.length === 0 ? (
        <section className="tarjeta compras-bienvenida">
          <div className="compras-bienvenida-texto">
            <span className="compras-bienvenida-icono">
              <Icono nombre="factura" tam={30} />
            </span>
            <h2>Cargá la primera factura de un proveedor</h2>
            <p className="texto-suave">Sacale una foto: el sistema lee los productos, suma el stock, actualiza los costos y te muestra qué precios conviene subir antes de guardar.</p>
            <ol className="compras-pasos">
              <li>
                <Icono nombre="foto" tam={18} /> Foto o carga a mano
              </li>
              <li>
                <Icono nombre="check" tam={18} /> Revisás lo que leyó
              </li>
              <li>
                <Icono nombre="sube" tam={18} /> Elegís los precios nuevos
              </li>
              <li>
                <Icono nombre="billetera" tam={18} /> Pagada o a deber
              </li>
            </ol>
            <div className="botonera">
              <button type="button" className="boton boton-rojo" onClick={abrirFoto}>
                <Icono nombre="foto" tam={18} /> Sacar foto a la factura
              </button>
              <button type="button" className="boton" onClick={() => setEditor({})}>
                Cargar a mano
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="compras-numeros">
            <div className="tarjeta compras-numero">
              <span className="texto-suave">Comprado este mes</span>
              <strong className="importe">{formatPesos(compradoMes)}</strong>
              <small className="texto-suave">{delMes.length === 1 ? '1 compra' : `${delMes.length} compras`}</small>
            </div>
            <div className={`tarjeta compras-numero ${deuda > 0 ? 'compras-numero-aviso' : ''}`}>
              <span className="texto-suave">Le debés a proveedores</span>
              <strong className="importe">{formatPesos(deuda)}</strong>
              <small className="texto-suave">{deudores === 0 ? 'al día' : deudores === 1 ? '1 proveedor' : `${deudores} proveedores`}</small>
            </div>
            <div className="tarjeta compras-numero">
              <span className="texto-suave">Precios cambiados este mes</span>
              <strong className="importe">{preciosMes}</strong>
              <small className="texto-suave">por costos nuevos</small>
            </div>
          </div>
          <div className="clientes compras">
            <section className="tarjeta lista-deudores">
              <div className="buscador-campo buscador-chico">
                <Icono nombre="buscar" tam={18} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor" aria-label="Buscar proveedor" />
              </div>
              <ul>
                {visibles.map((c) => (
                  <li key={c.clave}>
                    <button type="button" className={elegida?.clave === c.clave ? 'activo' : ''} onClick={() => setElegido(c.clave)}>
                      <span>
                        <strong>{c.nombre}</strong>
                        <small className="texto-suave">
                          {c.ultima ? `última compra ${fechaLarga(c.compras[0]?.fecha ?? c.ultima)}` : 'sin compras cargadas'}
                        </small>
                      </span>
                      <span className="compras-saldo-fila">
                        <strong className={`importe ${c.saldo > 0 ? '' : c.saldo < 0 ? 'texto-positivo' : 'texto-suave'}`}>{formatPesos(Math.abs(c.saldo))}</strong>
                        <small className={c.saldo > 0 ? 'texto-aviso' : 'texto-suave'}>{c.saldo > 0 ? 'le debés' : c.saldo < 0 ? 'a favor' : 'al día'}</small>
                      </span>
                    </button>
                  </li>
                ))}
                {visibles.length === 0 && <li className="texto-suave compras-sin-resultado">No hay proveedores con ese nombre.</li>}
              </ul>
            </section>
            <section className="tarjeta detalle-cliente" ref={refDetalle}>
              {elegida ? (
                <DetalleProveedor
                  cuenta={elegida}
                  productos={datos.productos}
                  onPagar={(compra) => setPagar({ cuenta: elegida, compra })}
                  onCargar={() => setEditor({ proveedor: elegida.nombre })}
                  onAvisar={avisar}
                />
              ) : (
                <Vacio titulo="Elegí un proveedor" icono="camion">
                  <p className="texto-suave">Vas a ver sus facturas, lo que le pagaste y cuánto le debés.</p>
                </Vacio>
              )}
            </section>
          </div>
        </>
      )}
      {pagar && <PagarProveedor cuenta={pagar.cuenta} compra={pagar.compra} onCerrar={() => setPagar(null)} />}
    </div>
  );
}

// ======================================================================
// Cuenta de un proveedor
// ======================================================================

function DetalleProveedor({
  cuenta,
  productos,
  onPagar,
  onCargar,
  onAvisar,
}: {
  cuenta: CuentaProveedor;
  productos: Producto[];
  onPagar: (compra?: Compra) => void;
  onCargar: () => void;
  onAvisar: ReturnType<typeof useAvisar>;
}) {
  const { sesion } = useSesion();
  const estados = useMemo(() => estadoDeCompras(cuenta), [cuenta]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [, unaVez] = useUnaVez();
  const porId = useMemo(() => new Map(productos.map((p) => [p.id!, p])), [productos]);
  type Mov = { tipo: 'compra'; fecha: number; compra: Compra } | { tipo: 'pago'; fecha: number; pago: PagoProveedor };
  const movimientos: Mov[] = [
    ...cuenta.compras.map((compra) => ({ tipo: 'compra' as const, fecha: compra.fecha, compra })),
    ...cuenta.pagos.map((pago) => ({ tipo: 'pago' as const, fecha: pago.fecha, pago })),
  ].sort((a, b) => b.fecha - a.fecha);

  const anular = (clave: string, accion: () => Promise<void>) => {
    if (anulando !== clave) return setAnulando(clave);
    unaVez(async () => {
      try {
        await accion();
      } catch (e) {
        onAvisar({ texto: errorATexto(e), tipo: 'error' });
      }
      setAnulando(null);
    });
  };

  return (
    <>
      <div className="pagina-cabecera cabecera-cliente">
        <div>
          <h2 title={cuenta.nombre}>{cuenta.nombre}</h2>
          <p className="texto-suave">
            {((n) => (n === 1 ? '1 compra' : `${n} compras`))(cuenta.compras.filter((c) => !c.anulada).length)} · comprado {formatPesos(cuenta.comprado)} · pagado {formatPesos(cuenta.pagado)}
          </p>
        </div>
      </div>
      <div className="saldo-cliente">
        <span>
          Saldo{' '}
          <span className={`insignia ${cuenta.saldo > 0 ? 'insignia-aviso' : 'insignia-promo'}`}>{cuenta.saldo > 0 ? 'Le debés' : cuenta.saldo < 0 ? 'A tu favor' : 'Al día'}</span>
        </span>
        <strong className={`importe ${cuenta.saldo < 0 ? 'texto-positivo' : ''}`}>{formatPesos(Math.abs(cuenta.saldo))}</strong>
      </div>
      <div className="botonera">
        <button type="button" className="boton boton-primario" onClick={() => onPagar()}>
          <Icono nombre="billetera" tam={18} /> {cuenta.saldo > 0 ? 'Registrar pago' : 'Pagar a cuenta'}
        </button>
        <button type="button" className="boton" onClick={onCargar}>
          <Icono nombre="mas" tam={18} /> Cargar factura de {cuenta.nombre.length > 18 ? 'este proveedor' : cuenta.nombre}
        </button>
      </div>
      {movimientos.length === 0 ? (
        <p className="texto-suave">Todavía no hay compras ni pagos con este proveedor. Está en la lista porque algún producto lo tiene como proveedor.</p>
      ) : (
        <ul className="compras-historial">
          {movimientos.map((m) => {
            if (m.tipo === 'pago') {
              const p = m.pago;
              const clave = `p${p.id}`;
              return (
                <li key={clave} className={`compras-mov compras-mov-pago ${p.anulado ? 'compras-anulada' : ''}`}>
                  <span className="compras-mov-icono compras-mov-icono-pago">
                    <Icono nombre={p.medio === 'caja' || p.medio === 'efectivo' ? 'efectivo' : p.medio === 'mercadopago' ? 'qr' : 'transferencia'} tam={18} />
                  </span>
                  <span className="compras-mov-texto">
                    <strong>Pago · {nombreMedioProveedor(p.medio)}</strong>
                    <small className="texto-suave">
                      {fechaLarga(p.fecha)}
                      {p.usuario && ` · ${p.usuario}`}
                      {p.anulado && ' · anulado'}
                      {p.nota && ` · ${p.nota}`}
                    </small>
                  </span>
                  <strong className="importe texto-positivo">−{formatPesos(p.monto)}</strong>
                  {!p.anulado && (
                    <button
                      type="button"
                      className={`boton boton-chico ${anulando === clave ? 'boton-peligro' : 'boton-texto'}`}
                      onClick={() =>
                        anular(clave, async () => {
                          const r = await anularPagoProveedor(db, p.id!, sesion?.usuario);
                          onAvisar({
                            texto:
                              r === 'volvio-a-la-caja'
                                ? 'Pago anulado: la plata vuelve a la caja.'
                                : r === 'caja-cerrada'
                                  ? 'Pago anulado. Salió de una caja ya cerrada: ese cierre queda como estaba.'
                                  : 'Pago anulado: vuelve a figurar la deuda.',
                            tipo: 'info',
                          });
                        })
                      }
                    >
                      {anulando === clave ? '¿Anular?' : 'Anular'}
                    </button>
                  )}
                </li>
              );
            }
            const c = m.compra;
            const estado = estados.get(c.id!);
            const clave = `c${c.id}`;
            const cambios = c.renglones.filter((r) => !r.nuevo && r.precioAnterior > 0 && r.precio !== r.precioAnterior).length;
            const sube = c.renglones.filter((r) => r.costo > r.costoAnterior && r.costoAnterior > 0).length;
            const unidades = c.renglones.reduce((s, r) => s + r.cantidad, 0);
            const abiertaEsta = abierta === c.id;
            return (
              <li key={clave} className={`compras-mov ${c.anulada ? 'compras-anulada' : ''}`}>
                <span className="compras-mov-icono">
                  <Icono nombre="factura" tam={18} />
                </span>
                <button type="button" className="compras-mov-texto compras-mov-abrir" aria-expanded={abiertaEsta} onClick={() => setAbierta(abiertaEsta ? null : c.id!)}>
                  <strong>
                    {nombreComprobante(c)} {c.conFoto && <span className="insignia" title="Cargada con foto"><Icono nombre="foto" tam={12} /> foto</span>}
                  </strong>
                  <small className="texto-suave">
                    {fechaLarga(c.fecha)} · {c.renglones.length === 1 ? '1 producto' : `${c.renglones.length} productos`} · {unidades.toLocaleString('es-AR')} u.
                    {cambios > 0 && ` · ${cambios === 1 ? '1 precio cambiado' : `${cambios} precios cambiados`}`}
                    {sube > 0 && cambios === 0 && ` · ${sube} costos subieron`}
                  </small>
                </button>
                <span className="compras-mov-monto">
                  <strong className="importe">{formatPesos(c.total)}</strong>
                  {c.anulada ? (
                    <span className="insignia">Anulada</span>
                  ) : estado && estado.debe > 0 ? (
                    <span className="insignia insignia-aviso">Debés {formatPesos(estado.debe)}</span>
                  ) : (
                    <span className="insignia insignia-promo">Pagada</span>
                  )}
                </span>
                {abiertaEsta && (
                  <div className="compras-detalle">
                    <table className="compras-tabla">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th className="numero">Cant.</th>
                          <th className="numero">Costo</th>
                          <th className="numero">Precio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.renglones.map((r, i) => {
                          const p = porId.get(r.productoId);
                          return (
                            <tr key={i}>
                              <td>
                                {sinCortes(p?.nombre ?? r.nombre)}
                                {r.descripcion && <small className="texto-suave compras-descripcion">Factura: {r.descripcion}</small>}
                              </td>
                              <td className="numero">{textoCantidad(r.cantidad, p?.porPeso)}</td>
                              <td className="numero">
                                <CambioDe antes={r.costoAnterior} despues={r.costo} malo />
                              </td>
                              <td className="numero">
                                <CambioDe antes={r.precioAnterior} despues={r.precio} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {c.nota && <p className="texto-suave">Nota: {c.nota}</p>}
                    <p className="texto-suave">
                      Cargada {new Date(c.creada).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                      {c.usuario && ` por ${c.usuario}`}
                      {c.anulada && ` · anulada${c.anuladaPor ? ` por ${c.anuladaPor}` : ''}`}
                    </p>
                    {!c.anulada && (
                      <div className="botonera">
                        {estado && estado.debe > 0 && (
                          <button type="button" className="boton boton-chico boton-primario" onClick={() => onPagar(c)}>
                            Pagar esta factura ({formatPesos(estado.debe)})
                          </button>
                        )}
                        <button
                          type="button"
                          className={`boton boton-chico ${anulando === clave ? 'boton-peligro' : ''}`}
                          onClick={() =>
                            anular(clave, async () => {
                              const r = await anularCompra(db, c.id!, sesion?.usuario);
                              onAvisar({
                                texto: `Compra anulada: se restó el stock${r.preciosVueltos > 0 ? ` y ${r.preciosVueltos === 1 ? 'volvió 1 precio' : `volvieron ${r.preciosVueltos} precios`} al de antes` : ''}.${
                                  cuenta.pagado > 0 ? ` Lo que ya le pagaste a ${cuenta.nombre} se descuenta de lo que le debas.` : ''
                                }`,
                                tipo: 'info',
                              });
                            })
                          }
                        >
                          {anulando === clave ? 'Sí, anular la compra' : 'Anular compra'}
                        </button>
                        {anulando === clave && <small className="texto-suave">Resta el stock que sumó. Los costos y precios vuelven si nadie los cambió después.</small>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** "$ 850 → $ 920 ▲8 %". Con `malo`, que suba se pinta como alerta (un costo); si no, neutro (un precio). */
function CambioDe({ antes, despues, malo = false }: { antes: number; despues: number; malo?: boolean }) {
  if (antes === despues || antes <= 0) return <span className="importe">{formatPesos(despues)}</span>;
  const v = variacion(antes, despues);
  return (
    <span className="compras-cambio">
      <s className="texto-suave importe">{formatPesos(antes)}</s>
      <strong className="importe">{formatPesos(despues)}</strong>
      {v !== null && <small className={despues > antes ? (malo ? 'texto-alerta' : 'texto-aviso') : 'texto-positivo'}>{v > 0 ? `▲${v}` : `▼${-v}`} %</small>}
    </span>
  );
}

// ======================================================================
// Pagar a un proveedor
// ======================================================================

function ElegirMedio({ medio, onElegir, hayCaja }: { medio: MedioPagoProveedor; onElegir: (m: MedioPagoProveedor) => void; hayCaja: boolean }) {
  const iconos: Record<MedioPagoProveedor, NombreIcono> = { caja: 'caja', efectivo: 'efectivo', transferencia: 'transferencia', mercadopago: 'qr', cheque: 'ticket' };
  return (
    <div className="compras-medios" role="radiogroup" aria-label="Cómo le pagaste">
      {MEDIOS_PROVEEDOR.map((m) => {
        const deshabilitado = m.id === 'caja' && !hayCaja;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={medio === m.id}
            className={`compras-medio ${medio === m.id ? 'activo' : ''}`}
            disabled={deshabilitado}
            title={deshabilitado ? 'La caja está cerrada' : m.detalle}
            onClick={() => onElegir(m.id)}
          >
            <Icono nombre={iconos[m.id]} tam={18} />
            <span>{m.nombre}</span>
            {deshabilitado && <small>caja cerrada</small>}
          </button>
        );
      })}
    </div>
  );
}

function PagarProveedor({ cuenta, compra, onCerrar }: { cuenta: CuentaProveedor; compra?: Compra; onCerrar: () => void }) {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  const turno = useConsulta(() => turnoAbierto(db), [], undefined as Awaited<ReturnType<typeof turnoAbierto>>);
  const deCompra = compra ? (estadoDeCompras(cuenta).get(compra.id!)?.debe ?? 0) : null;
  const [monto, setMonto] = useState<number | null>(deCompra ?? (cuenta.saldo > 0 ? cuenta.saldo : null));
  const [medio, setMedio] = useState<MedioPagoProveedor>('transferencia');
  const [nota, setNota] = useState('');
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [enCurso, unaVez] = useUnaVez();
  useEffect(() => setConfirmar(null), [monto, medio]);
  return (
    <Modal titulo={compra ? `Pagar ${nombreComprobante(compra)}` : `Pagarle a ${cuenta.nombre}`} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (!monto) return avisar({ texto: 'Poné cuánto le pagaste.', tipo: 'error' });
          unaVez(async () => {
            try {
              if (medio === 'caja' && confirmar === null) {
                const falta = await faltaEnCaja(db, monto);
                if (falta !== null) return setConfirmar(falta);
              }
              await registrarPagoProveedor(db, { proveedor: cuenta.nombre, monto, medio, compraId: compra?.id ?? null, nota }, sesion?.usuario);
              const queda = cuenta.saldo - monto;
              avisar({
                texto: `Pago de ${formatPesos(monto)} anotado${medio === 'caja' ? ' (salió de la caja)' : ''}. ${queda > 0 ? `Le seguís debiendo ${formatPesos(queda)}.` : queda < 0 ? `Te quedan ${formatPesos(-queda)} a favor.` : 'Quedás al día.'}`,
                tipo: 'ok',
              });
              onCerrar();
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <div className="compras-pago-resumen">
          <span className="texto-suave">{compra ? 'Falta pagar de esta factura' : cuenta.saldo >= 0 ? 'Le debés' : 'Tenés a favor'}</span>
          <strong className="importe">{formatPesos(Math.abs(deCompra ?? cuenta.saldo))}</strong>
        </div>
        <CampoPesos etiqueta="Cuánto le pagás" valor={monto} onCambio={setMonto} autoFocus maximo={100_000_000} />
        {cuenta.saldo > 0 && !compra && (
          <div className="chips">
            <button type="button" className={`chip ${monto === cuenta.saldo ? 'activo' : ''}`} onClick={() => setMonto(cuenta.saldo)}>
              Todo ({formatPesos(cuenta.saldo)})
            </button>
            {cuenta.saldo >= 20_000 && (
              <button type="button" className={`chip ${monto === Math.round(cuenta.saldo / 2) ? 'activo' : ''}`} onClick={() => setMonto(Math.round(cuenta.saldo / 2))}>
                La mitad
              </button>
            )}
          </div>
        )}
        <span className="campo-etiqueta">Cómo le pagaste</span>
        <ElegirMedio medio={medio} onElegir={setMedio} hayCaja={!!turno} />
        <label className="campo">
          <span className="campo-etiqueta">Nota (opcional)</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: transferencia del Galicia" maxLength={200} />
        </label>
        <div className="modal-pie">
          {confirmar !== null && (
            <p className="texto-alerta" role="alert">
              En la caja debería haber {formatPesos(confirmar)}: con este pago queda en negativo. Si está bien, anotalo igual.
            </p>
          )}
          <button type="submit" className={`boton boton-grande ${confirmar !== null ? 'boton-peligro' : 'boton-primario'}`} disabled={enCurso || !monto}>
            {confirmar !== null ? 'Sí, anotar igual' : `Anotar pago${monto ? ` de ${formatPesos(monto)}` : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ======================================================================
// Cargar una compra
// ======================================================================

interface RenglonEditor {
  clave: string;
  producto: Producto | null;
  /** Producto nuevo que se da de alta con esta compra. */
  nuevo: { nombre: string; codigo: string; categoria: string } | null;
  /** Lo que decía la factura (si vino de una foto). */
  descripcion?: string;
  codigoFactura?: string;
  certeza?: Certeza;
  opciones: Producto[];
  cantidad: string;
  costo: number | null;
  /** Paso 2: aplicar el precio sugerido (null: lo que convenga por defecto) y el precio escrito a mano. */
  aplicar: boolean | null;
  precioManual: number | null;
}

let contador = 0;
const nuevaClave = () => `r${Date.now()}-${++contador}`;

function renglonDe(p: Producto): RenglonEditor {
  return { clave: nuevaClave(), producto: p, nuevo: null, opciones: [], cantidad: '', costo: p.costo > 0 ? p.costo : null, aplicar: null, precioManual: null };
}

/** "COCA COLA 2.25LT" → "Coca Cola 2.25lt": para el nombre de un producto nuevo. */
function nombrePropio(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s(])([a-záéíóúñü])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

const ETIQUETA_CERTEZA: Record<Certeza, { texto: string; clase: string }> = {
  codigo: { texto: 'Por código', clase: 'insignia-promo' },
  aprendido: { texto: 'Como la otra vez', clase: 'insignia-promo' },
  seguro: { texto: 'Reconocido', clase: 'insignia-promo' },
  dudoso: { texto: '¿Es éste?', clase: 'insignia-aviso' },
  ninguno: { texto: 'Elegí el producto', clase: 'insignia-alerta' },
};

const COMPROBANTES = ['Factura A', 'Factura B', 'Factura C', 'Remito', 'Ticket', 'Otro'];

function EditorCompra({
  fotosIniciales,
  proveedorInicial,
  productos: todos,
  onCerrar,
}: {
  fotosIniciales?: File[];
  proveedorInicial?: string;
  productos: Producto[];
  onCerrar: (compra?: Compra) => void;
}) {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  const productos = useMemo(() => todos.filter((p) => !esCombo(p)), [todos]);
  const porCodigo = useMemo(() => mapaPorCodigo(productos), [productos]);
  // null mientras carga: la foto que vino de la pantalla anterior se lee recién con esto a mano.
  const conocidos = useConsulta(async () => ({ proveedores: await nombresDeProveedores(db), alias: await aliasDeCompras(db) }), [], null as null | { proveedores: string[]; alias: Record<string, number> });
  const proveedores = conocidos?.proveedores ?? [];
  const alias = conocidos?.alias ?? {};
  // La lectura termina segundos después: usa lo último que hay (productos, alias), no lo de cuando empezó.
  const ultimo = useRef({ proveedores, alias, productos, porCodigo });
  ultimo.current = { proveedores, alias, productos, porCodigo };
  const turno = useConsulta(() => turnoAbierto(db), [], undefined as Awaited<ReturnType<typeof turnoAbierto>>);
  const ajustes = useConsulta(
    async () => ({ redondeo: await leerAjuste<Redondeo>(db, 'compras.redondeo', 50), margen: await leerAjuste<number>(db, 'compras.margen', 35) }),
    [],
    null as null | { redondeo: Redondeo; margen: number },
  );

  const [paso, setPaso] = useState<1 | 2>(1);
  const [proveedor, setProveedor] = useState(proveedorInicial ?? '');
  const [fecha, setFecha] = useState(textoDeFecha(Date.now()));
  const [comprobante, setComprobante] = useState('');
  const [numero, setNumero] = useState('');
  const [nota, setNota] = useState('');
  const [renglones, setRenglones] = useState<RenglonEditor[]>([]);
  const [fotos, setFotos] = useState<string[]>([]);
  const [lectura, setLectura] = useState<{ estado: 'leyendo' } | { estado: 'error'; texto: string } | { estado: 'leida'; factura: FacturaLeida } | null>(null);
  const [verFoto, setVerFoto] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [redondeo, setRedondeo] = useState<Redondeo>(50);
  const [margenGeneral, setMargenGeneral] = useState(35);
  useEffect(() => {
    if (!ajustes) return;
    setRedondeo(ajustes.redondeo);
    setMargenGeneral(ajustes.margen);
  }, [ajustes]);
  const [totalFactura, setTotalFactura] = useState<number | null>(null);
  const [modoPago, setModoPago] = useState<'toda' | 'parte' | 'debe'>('toda');
  const [medio, setMedio] = useState<MedioPagoProveedor | null>(null);
  const [montoParte, setMontoParte] = useState<number | null>(null);
  const [confirmarCaja, setConfirmarCaja] = useState<number | null>(null);
  const [enCurso, unaVez] = useUnaVez();
  const buscador = useRef<HTMLInputElement>(null);
  const masFotos = useRef<HTMLInputElement>(null);
  const medioElegido: MedioPagoProveedor = medio ?? (turno ? 'caja' : 'transferencia');

  // ---------- Foto ----------
  const leerFotos = async (archivos: File[]) => {
    setLectura({ estado: 'leyendo' });
    try {
      const nuevas = await Promise.all(archivos.slice(0, 4).map((a) => achicarFoto(a)));
      const todas = [...fotos, ...nuevas].slice(0, 4);
      setFotos(todas);
      const { factura } = await leerFotosDeFactura(db, todas, ultimo.current.proveedores);
      aplicarLectura(factura);
      setLectura({ estado: 'leida', factura });
      pitido('ok');
    } catch (e) {
      setLectura({ estado: 'error', texto: errorATexto(e) });
      pitido('error');
    }
  };
  const yaLeyo = useRef(false);
  useEffect(() => {
    if (yaLeyo.current || !fotosIniciales?.length || !conocidos) return;
    yaLeyo.current = true;
    void leerFotos(fotosIniciales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conocidos]);

  const aplicarLectura = (f: FacturaLeida) => {
    const { proveedores, alias, productos, porCodigo } = ultimo.current;
    // El proveedor que ya existe se escribe igual que siempre (así la cuenta no se parte en dos).
    let prov = proveedor.trim();
    if (!prov && f.proveedor) {
      const clave = claveProveedor(f.proveedor);
      const conocido = proveedores.find((p) => {
        const k = claveProveedor(p);
        return k === clave || (k.length >= 4 && clave.includes(k)) || (clave.length >= 4 && k.includes(clave));
      });
      prov = conocido ?? nombrePropio(f.proveedor);
      setProveedor(prov);
    }
    if (f.fecha && fechaDeTexto(f.fecha)) setFecha(f.fecha);
    if (f.comprobante && !comprobante) setComprobante(COMPROBANTES.find((c) => normalizar(c) === normalizar(f.comprobante)) ?? f.comprobante);
    if (f.numero && !numero) setNumero(f.numero);
    if (f.total) setTotalFactura(f.total);
    const leidos = f.renglones.map((r): RenglonEditor => {
      const rec = reconocer(r, prov, productos, porCodigo, alias);
      return {
        clave: nuevaClave(),
        producto: rec.producto,
        nuevo: null,
        descripcion: r.descripcion,
        codigoFactura: r.codigo,
        certeza: rec.certeza,
        opciones: rec.opciones,
        cantidad: String(r.cantidad).replace('.', ','),
        costo: r.costo > 0 ? r.costo : (rec.producto?.costo ?? null) || null,
        aplicar: null,
        precioManual: null,
      };
    });
    setRenglones((actuales) => [...actuales, ...leidos]);
  };

  // ---------- Renglones ----------
  const cambiar = (clave: string, cambios: Partial<RenglonEditor>) => setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));
  const sacar = (clave: string) => setRenglones((rs) => rs.filter((r) => r.clave !== clave));
  const sumar = (p: Producto) => {
    setRenglones((rs) => (rs.some((r) => r.producto?.id === p.id && !r.descripcion) ? rs : [...rs, renglonDe(p)]));
    if (!proveedor.trim() && p.proveedor?.trim()) setProveedor(p.proveedor.trim());
    setQ('');
    buscador.current?.focus();
  };
  const sumarNuevo = (nombre: string, codigo = '') => {
    setRenglones((rs) => [...rs, { clave: nuevaClave(), producto: null, nuevo: { nombre: nombrePropio(nombre), codigo, categoria: '' }, opciones: [], cantidad: '', costo: null, aplicar: null, precioManual: null }]);
    setQ('');
  };
  const encontrados = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    return productos.filter((p) => p.codigo === q.trim() || normalizar(p.nombre).includes(t)).slice(0, 6);
  }, [q, productos]);
  const escaneo = (texto: string): boolean => {
    const codigo = codigoEscaneado(texto);
    if (!codigo) return false;
    const p = porCodigo.get(codigo);
    if (p) {
      sumar(p);
      pitido('ok');
    } else {
      pitido('error');
      sumarNuevo('', codigo);
      avisar({ texto: `El código ${codigo} no está cargado: escribí el nombre en el renglón nuevo.`, tipo: 'info' });
    }
    return true;
  };

  const cantidadDe = (r: RenglonEditor) => cantidadDeCompra(r.cantidad, !!r.producto?.porPeso);
  const sinElegir = renglones.filter((r) => !r.producto && !r.nuevo);
  const sinNombre = renglones.filter((r) => r.nuevo && !r.nuevo.nombre.trim());
  const sinCantidad = renglones.filter((r) => (r.producto || r.nuevo) && !cantidadDe(r));
  const suma = renglones.reduce((s, r) => s + Math.round((cantidadDe(r) ?? 0) * (r.costo ?? 0)), 0);
  const leida = lectura?.estado === 'leida' ? lectura.factura : null;
  const totalLeido = leida?.total ?? null;
  const diferencia = totalLeido !== null && suma > 0 ? totalLeido - suma : null;
  const listoPaso1 = renglones.length > 0 && sinElegir.length === 0 && sinNombre.length === 0 && sinCantidad.length === 0 && proveedor.trim() !== '' && !!fechaDeTexto(fecha);
  const faltaPaso1 =
    renglones.length === 0
      ? 'Sumá al menos un producto'
      : sinElegir.length > 0
        ? `Elegí ${sinElegir.length === 1 ? 'el producto que falta' : `los ${sinElegir.length} productos que faltan`}`
        : sinNombre.length > 0
          ? 'Poné el nombre del producto nuevo'
          : sinCantidad.length > 0
            ? `Poné la cantidad de ${sinCantidad.length === 1 ? '1 renglón' : `${sinCantidad.length} renglones`}`
            : !proveedor.trim()
              ? 'Poné el proveedor'
              : !fechaDeTexto(fecha)
                ? 'Revisá la fecha'
                : '';

  // ---------- Precios (paso 2) ----------
  // Sólo los renglones con producto elegido (o nuevo): mientras se carga puede haber alguno sin elegir.
  const precios = renglones.filter((r) => r.producto || r.nuevo).map((r) => {
    const costo = r.costo ?? 0;
    if (r.nuevo) {
      const sugerido = costo > 0 ? precioParaMargen(costo, margenGeneral, redondeo) : 0;
      const final = r.precioManual ?? sugerido;
      return { r, cambio: null, sugerido, final, aplica: true, margenFinal: margen(final, costo) };
    }
    const p = r.producto!;
    const cambio = cambioDePrecio(p, costo, margenGeneral, redondeo);
    const aplicaPorDefecto = cambio.sugerido !== null && cambio.costo === 'sube';
    const aplica = cambio.sugerido !== null && (r.aplicar ?? aplicaPorDefecto);
    const final = aplica ? (r.precioManual ?? cambio.sugerido!) : p.precio;
    return { r, cambio, sugerido: cambio.sugerido, final, aplica, margenFinal: margen(final, costo > 0 ? costo : p.costo) };
  });
  const conCambio = precios.filter((x) => x.r.nuevo || x.sugerido !== null);
  const sinCambio = precios.filter((x) => !x.r.nuevo && x.sugerido === null);
  const subidas = precios.filter((x) => !x.r.nuevo && x.aplica && x.final !== x.r.producto!.precio).length;
  const nuevosSinPrecio = precios.filter((x) => x.r.nuevo && !(x.final > 0));
  const total = totalFactura ?? suma;
  const montoPagado = modoPago === 'toda' ? total : modoPago === 'parte' ? (montoParte ?? 0) : 0;
  useEffect(() => setConfirmarCaja(null), [montoPagado, medioElegido, modoPago]);

  const guardar = () =>
    unaVez(async () => {
      try {
        if (nuevosSinPrecio.length > 0) throw new Error(`Poné a cuánto vas a vender "${nuevosSinPrecio[0]!.r.nuevo!.nombre}".`);
        if (modoPago === 'parte' && !(montoParte && montoParte > 0)) throw new Error('Poné cuánto le pagaste.');
        if (modoPago !== 'debe' && medioElegido === 'caja' && confirmarCaja === null) {
          const falta = await faltaEnCaja(db, montoPagado);
          if (falta !== null) return setConfirmarCaja(falta);
        }
        const compra = await registrarCompra(
          db,
          {
            proveedor,
            fecha: fechaDeTexto(fecha)!,
            comprobante,
            numero,
            nota,
            conFoto: fotos.length > 0 && !!leida,
            total,
            pago: modoPago === 'debe' || montoPagado <= 0 ? null : { monto: montoPagado, medio: medioElegido },
            renglones: precios.map(({ r, final, aplica }) => ({
              ...(r.producto ? { productoId: r.producto.id! } : { nuevo: r.nuevo! }),
              cantidad: cantidadDe(r) ?? 0,
              costo: r.costo ?? 0,
              ...(r.nuevo || (aplica && r.producto && final !== r.producto.precio) ? { precio: final } : {}),
              ...(r.descripcion ? { descripcion: r.descripcion } : {}),
            })),
          },
          sesion?.usuario,
        );
        await guardarAjuste(db, 'compras.redondeo', redondeo);
        await guardarAjuste(db, 'compras.margen', margenGeneral);
        const unidades = compra.renglones.reduce((s, r) => s + r.cantidad, 0);
        const debe = compra.total - montoPagado;
        avisar({
          texto: `Compra guardada: +${unidades.toLocaleString('es-AR')} al stock${subidas > 0 ? `, ${subidas === 1 ? '1 precio nuevo' : `${subidas} precios nuevos`}` : ''}${
            debe > 0 ? `. Le debés ${formatPesos(debe)} a ${compra.proveedor}` : ''
          }.`,
          tipo: 'ok',
        });
        onCerrar(compra);
      } catch (e) {
        avisar({ texto: errorATexto(e), tipo: 'error' });
      }
    });

  const algoCargado = renglones.length > 0 || fotos.length > 0;
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  const salir = () => {
    if (algoCargado && !confirmarSalir) return setConfirmarSalir(true);
    onCerrar();
  };

  const pasos = (
    <ol className="compras-pasos-editor" aria-label="Pasos">
      <li className={paso === 1 ? 'activo' : 'hecho'}>
        <span>{paso === 1 ? 1 : <Icono nombre="check" tam={14} />}</span> Productos
      </li>
      <li className={paso === 2 ? 'activo' : ''}>
        <span>2</span> Precios y pago
      </li>
    </ol>
  );

  return (
    <div className="pagina compras-editor">
      <input
        ref={masFotos}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const archivos = [...(e.target.files ?? [])];
          e.target.value = '';
          if (archivos.length > 0) void leerFotos(archivos);
        }}
      />
      <div className="compras-editor-cabecera">
        <button type="button" className="boton boton-chico" onClick={paso === 2 ? () => setPaso(1) : salir}>
          <Icono nombre="volver" tam={16} /> {paso === 2 ? 'Volver a productos' : confirmarSalir ? '¿Salir sin guardar?' : 'Volver'}
        </button>
        <h1>
          Nueva compra <BotonAyuda tema="compras" que="cómo cargar una factura" />
        </h1>
        {pasos}
      </div>
      {confirmarSalir && paso === 1 && (
        <p className="compras-aviso compras-aviso-alerta" role="alert">
          Lo cargado se pierde. <button type="button" className="enlace" onClick={() => onCerrar()}>Salir igual</button> ·{' '}
          <button type="button" className="enlace" onClick={() => setConfirmarSalir(false)}>Seguir cargando</button>
        </p>
      )}

      {paso === 1 && (
        <>
          <div className="compras-editor-grilla">
            <section className="tarjeta compras-comprobante">
              <h2 className="titulo-chico">Comprobante</h2>
              <label className="campo">
                <span className="campo-etiqueta">Proveedor</span>
                <input list="compras-proveedores" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej.: Distribuidora Arcor" maxLength={80} />
                <datalist id="compras-proveedores">
                  {proveedores.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <div className="fila-campos">
                <label className="campo">
                  <span className="campo-etiqueta">Fecha</span>
                  <input type="date" value={fecha} max={textoDeFecha(Date.now() + 86_400_000)} onChange={(e) => setFecha(e.target.value)} />
                </label>
                <label className="campo">
                  <span className="campo-etiqueta">Tipo</span>
                  <select value={comprobante} onChange={(e) => setComprobante(e.target.value)}>
                    <option value="">—</option>
                    {[...new Set([...COMPROBANTES, ...(comprobante ? [comprobante] : [])])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="campo">
                <span className="campo-etiqueta">Número (opcional)</span>
                <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej.: 0003-00012345" maxLength={30} />
              </label>
            </section>

            <section className={`tarjeta compras-foto ${lectura?.estado === 'leyendo' ? 'compras-foto-leyendo' : ''}`}>
              {fotos.length === 0 && !lectura ? (
                <button type="button" className="compras-foto-vacia" onClick={() => masFotos.current?.click()}>
                  <span className="compras-foto-icono">
                    <Icono nombre="foto" tam={28} />
                  </span>
                  <strong>Sacale una foto a la factura</strong>
                  <small className="texto-suave">Leo el proveedor, la fecha y cada producto con su costo. Vos revisás antes de guardar.</small>
                </button>
              ) : (
                <>
                  <div className="compras-miniaturas">
                    {fotos.map((f, i) => (
                      <button key={i} type="button" className="compras-miniatura" onClick={() => setVerFoto(f)} aria-label={`Ver la foto ${i + 1}`}>
                        <img src={f} alt="" />
                      </button>
                    ))}
                    {fotos.length < 4 && lectura?.estado !== 'leyendo' && (
                      <button type="button" className="compras-miniatura compras-miniatura-mas" onClick={() => masFotos.current?.click()} title="Otra página de la misma factura">
                        <Icono nombre="mas" tam={20} />
                        <small>Otra hoja</small>
                      </button>
                    )}
                  </div>
                  {lectura?.estado === 'leyendo' && (
                    <div className="compras-leyendo" role="status">
                      <span className="compras-leyendo-barra" aria-hidden="true" />
                      <strong>
                        <Icono nombre="chispa" tam={16} /> Leyendo la factura…
                      </strong>
                      <small className="texto-suave">Tarda unos segundos. Mientras, podés completar el comprobante.</small>
                    </div>
                  )}
                  {lectura?.estado === 'error' && (
                    <div className="compras-aviso compras-aviso-alerta" role="alert">
                      <strong>{lectura.texto}</strong>
                      <div className="botonera">
                        <button type="button" className="boton boton-chico" onClick={() => masFotos.current?.click()}>
                          <Icono nombre="foto" tam={16} /> Probar con otra foto
                        </button>
                        <button type="button" className="boton boton-chico boton-texto" onClick={() => buscador.current?.focus()}>
                          Cargar a mano
                        </button>
                      </div>
                    </div>
                  )}
                  {leida && (
                    <ResumenLectura renglones={renglones} factura={leida} />
                  )}
                </>
              )}
            </section>
          </div>

          <section className="tarjeta compras-renglones">
            <div className="compras-renglones-cabecera">
              <h2 className="titulo-chico">Productos {renglones.length > 0 && <span className="texto-suave">({renglones.length})</span>}</h2>
              <div className="buscador-campo buscador-chico compras-buscador">
                <Icono nombre="buscar" tam={18} />
                <input
                  ref={buscador}
                  value={q}
                  autoFocus={!fotosIniciales?.length}
                  onChange={(e) => {
                    if (escaneo(e.target.value)) return setQ('');
                    setQ(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (escaneo(q)) return setQ('');
                    if (encontrados[0]) sumar(encontrados[0]);
                    else if (q.trim().length >= 2) sumarNuevo(q.trim());
                  }}
                  placeholder="Escaneá o buscá un producto para sumarlo"
                  aria-label="Buscar producto para sumar a la compra"
                />
                {q.trim().length >= 2 && (
                  <ul className="resultados">
                    {encontrados.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => sumar(p)}>
                          <span>
                            <strong>{p.nombre}</strong>
                            <small>
                              hay {textoCantidad(p.stock, p.porPeso)} · costo {p.costo > 0 ? formatPesos(p.costo) : 'sin cargar'}
                            </small>
                          </span>
                          <span className="importe">{formatPesos(p.precio)}</span>
                        </button>
                      </li>
                    ))}
                    <li>
                      <button type="button" onClick={() => sumarNuevo(q.trim())}>
                        <span>
                          <strong>
                            <Icono nombre="mas" tam={14} /> Crear "{q.trim()}"
                          </strong>
                          <small>Producto nuevo: se da de alta con esta compra</small>
                        </span>
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            </div>
            {renglones.length === 0 ? (
              <p className="texto-suave compras-renglones-vacio">
                {lectura?.estado === 'leyendo' ? 'Los productos aparecen acá cuando termine de leer la foto.' : 'Escaneá cada producto que llegó, o sacale una foto a la factura y se cargan solos.'}
              </p>
            ) : (
              <>
                <div className="compras-fila compras-fila-titulos" aria-hidden="true">
                  <span>Producto</span>
                  <span>Cantidad</span>
                  <span>Costo c/u</span>
                  <span>Subtotal</span>
                  <span />
                </div>
                <ul className="compras-lista">
                  {renglones.map((r) => (
                    <FilaRenglon
                      key={r.clave}
                      r={r}
                      productos={productos}
                      onCambiar={(c) => cambiar(r.clave, c)}
                      onSacar={() => sacar(r.clave)}
                      cantidad={cantidadDe(r)}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="compras-pie">
            <div className="compras-pie-total">
              <span className="texto-suave">Suma de los renglones</span>
              <strong className="importe">{formatPesos(suma)}</strong>
              {diferencia !== null && Math.abs(diferencia) > Math.max(10, totalLeido! * 0.005) && (
                <small className="texto-aviso">
                  La factura dice {formatPesos(totalLeido!)} ({diferencia > 0 ? 'faltan' : 'sobran'} {formatPesos(Math.abs(diferencia))})
                </small>
              )}
              {diferencia !== null && Math.abs(diferencia) <= Math.max(10, totalLeido! * 0.005) && (
                <small className="texto-positivo">
                  <Icono nombre="check" tam={14} /> Coincide con el total de la factura
                </small>
              )}
            </div>
            <div className="compras-pie-accion">
              {!listoPaso1 && faltaPaso1 && <small className="texto-suave">{faltaPaso1}</small>}
              <button
                type="button"
                className="boton boton-primario boton-grande"
                disabled={!listoPaso1 || lectura?.estado === 'leyendo'}
                onClick={() => {
                  setPaso(2);
                  setConfirmarSalir(false);
                  if (totalFactura === null && totalLeido !== null) setTotalFactura(totalLeido);
                  window.scrollTo(0, 0);
                }}
              >
                Revisar precios <Icono nombre="flecha" tam={18} />
              </button>
            </div>
          </div>
        </>
      )}

      {paso === 2 && (
        <>
          <section className="tarjeta compras-precios">
            <div className="compras-precios-cabecera">
              <div>
                <h2 className="titulo-chico">Precios de venta</h2>
                <p className="texto-suave">
                  {conCambio.length === 0
                    ? 'Ningún costo cambió: los precios quedan como están.'
                    : 'Con el costo nuevo, éste es el precio que mantiene lo que ganás con cada producto. Destildá lo que no quieras cambiar.'}
                </p>
              </div>
              <div className="compras-precios-opciones">
                <span className="campo-etiqueta">Redondear a</span>
                <div className="segmentos" role="radiogroup" aria-label="Redondear precios a">
                  {([10, 50, 100] as Redondeo[]).map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={redondeo === n} className={redondeo === n ? 'activo' : ''} onClick={() => setRedondeo(n)}>
                      ${n}
                    </button>
                  ))}
                </div>
                <label className="compras-margen" title="Para productos nuevos o sin costo cargado">
                  <span className="campo-etiqueta">Ganancia si no tenía costo</span>
                  <span className="compras-margen-campo">
                    <input
                      inputMode="numeric"
                      value={margenGeneral}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2));
                        setMargenGeneral(Number.isFinite(n) ? n : 0);
                      }}
                      aria-label="Ganancia para productos sin costo, en porcentaje"
                    />
                    %
                  </span>
                </label>
              </div>
            </div>
            {conCambio.length > 0 && (
              <ul className="compras-lista-precios">
                {conCambio.map(({ r, cambio, sugerido, final, aplica, margenFinal }) => {
                  const p = r.producto;
                  const nombre = p?.nombre ?? r.nuevo!.nombre;
                  const costo = r.costo ?? 0;
                  const vCosto = p ? variacion(p.costo, costo) : null;
                  const cant = cantidadDe(r) ?? 0;
                  return (
                    <li key={r.clave} className={`compras-precio ${aplica ? 'compras-precio-aplica' : ''}`}>
                      {p ? (
                        <input type="checkbox" checked={aplica} onChange={(e) => cambiar(r.clave, { aplicar: e.target.checked })} aria-label={`Cambiar el precio de ${nombre}`} />
                      ) : (
                        <span className="insignia insignia-promo compras-nuevo">Nuevo</span>
                      )}
                      <span className="compras-precio-nombre">
                        <strong>{sinCortes(nombre)}</strong>
                        <small className="texto-suave">
                          {p ? (
                            <>
                              Stock {textoCantidad(p.stock, p.porPeso)} → <strong className="texto-normal">{textoCantidad(p.stock + cant, p.porPeso)}</strong>
                            </>
                          ) : (
                            <>Entran {textoCantidad(cant)}</>
                          )}
                        </small>
                      </span>
                      <span className="compras-precio-costo">
                        <small className="texto-suave">Costo</small>
                        {p && p.costo > 0 && p.costo !== costo ? (
                          <span className="compras-cambio">
                            <s className="texto-suave importe">{formatPesos(p.costo)}</s>
                            <strong className="importe">{formatPesos(costo)}</strong>
                            {vCosto !== null && <small className={vCosto > 0 ? 'texto-alerta' : 'texto-positivo'}>{vCosto > 0 ? `▲${vCosto}` : `▼${-vCosto}`} %</small>}
                          </span>
                        ) : (
                          <strong className="importe">{formatPesos(costo)}</strong>
                        )}
                      </span>
                      <span className="compras-precio-venta">
                        <small className="texto-suave">{p ? `Precio (hoy ${formatPesos(p.precio)})` : 'Precio de venta'}</small>
                        <CampoPesos
                          valor={aplica ? final : (sugerido ?? null)}
                          ariaLabel={`Precio nuevo de ${nombre}`}
                          onCambio={(v) => cambiar(r.clave, { precioManual: v, ...(p ? { aplicar: true } : {}) })}
                        />
                      </span>
                      <span className="compras-precio-margen">
                        <small className="texto-suave">Ganás</small>
                        <strong className={margenFinal !== null && margenFinal < 10 ? 'texto-alerta' : ''}>{margenFinal === null ? '—' : `${margenFinal} %`}</strong>
                        {p && cambio && !aplica && cambio.margenAntes !== null && cambio.margenSinTocar !== null && cambio.margenSinTocar < cambio.margenAntes && (
                          <small className="texto-aviso">antes {cambio.margenAntes} %</small>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {sinCambio.length > 0 && (
              <details className="compras-sin-cambio">
                <summary>
                  {sinCambio.length === 1 ? '1 producto' : `${sinCambio.length} productos`} con el mismo precio (el costo no cambió o ya alcanza)
                </summary>
                <ul>
                  {sinCambio.map(({ r }) => {
                    const p = r.producto!;
                    const cant = cantidadDe(r) ?? 0;
                    return (
                      <li key={r.clave}>
                        <span>{sinCortes(p.nombre)}</span>
                        <small className="texto-suave">
                          stock {textoCantidad(p.stock, p.porPeso)} → {textoCantidad(p.stock + cant, p.porPeso)} · {formatPesos(p.precio)}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </section>

          <section className="tarjeta compras-pago">
            <h2 className="titulo-chico">Pago a {proveedor.trim()}</h2>
            <div className="fila-campos">
              <CampoPesos etiqueta="Total de la factura" valor={total} onCambio={(v) => setTotalFactura(v)} maximo={100_000_000} />
            </div>
            {totalFactura !== null && totalFactura !== suma && (
              <small className="texto-suave compras-nota-total">
                Los renglones suman {formatPesos(suma)}: la diferencia ({formatPesos(Math.abs(totalFactura - suma))}) puede ser un descuento, un flete o percepciones.{' '}
                <button type="button" className="enlace" onClick={() => setTotalFactura(null)}>
                  Usar la suma
                </button>
              </small>
            )}
            <div className="segmentos compras-modo" role="radiogroup" aria-label="¿La pagaste?">
              {(
                [
                  ['toda', 'La pagué toda'],
                  ['parte', 'Pagué una parte'],
                  ['debe', 'Queda a deber'],
                ] as const
              ).map(([id, texto]) => (
                <button key={id} type="button" role="radio" aria-checked={modoPago === id} className={modoPago === id ? 'activo' : ''} onClick={() => setModoPago(id)}>
                  {texto}
                </button>
              ))}
            </div>
            {modoPago === 'parte' && <CampoPesos etiqueta="Cuánto le pagaste" valor={montoParte} onCambio={setMontoParte} maximo={100_000_000} autoFocus />}
            {modoPago !== 'debe' && (
              <>
                <span className="campo-etiqueta">Cómo le pagaste</span>
                <ElegirMedio medio={medioElegido} onElegir={setMedio} hayCaja={!!turno} />
              </>
            )}
            <label className="campo">
              <span className="campo-etiqueta">Nota (opcional)</span>
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: faltaron 2 cajas, las traen el jueves" maxLength={300} />
            </label>
          </section>

          <div className="compras-pie compras-pie-final">
            <ul className="compras-resumen">
              <li>
                <Icono nombre="productos" tam={18} /> Suma <strong>{renglones.reduce((s, r) => s + (cantidadDe(r) ?? 0), 0).toLocaleString('es-AR')}</strong> al stock en {renglones.length === 1 ? '1 producto' : `${renglones.length} productos`}
                {renglones.some((r) => r.nuevo) && ` (${renglones.filter((r) => r.nuevo).length} nuevos)`}
              </li>
              <li>
                <Icono nombre="sube" tam={18} /> {subidas === 0 ? 'No cambia ningún precio' : <>Cambia <strong>{subidas === 1 ? '1 precio' : `${subidas} precios`}</strong></>}
              </li>
              <li>
                <Icono nombre="billetera" tam={18} />{' '}
                {total - montoPagado > 0 ? (
                  <>
                    Le vas a deber <strong className="texto-aviso">{formatPesos(total - montoPagado)}</strong>
                  </>
                ) : (
                  <>
                    Pagada{montoPagado > 0 && medioElegido === 'caja' ? ' con plata de la caja' : ''} · <strong>{formatPesos(total)}</strong>
                  </>
                )}
              </li>
            </ul>
            <div className="compras-pie-accion">
              {confirmarCaja !== null && (
                <p className="texto-alerta" role="alert">
                  En la caja debería haber {formatPesos(confirmarCaja)}: con este pago queda en negativo. Si está bien, guardala igual.
                </p>
              )}
              <button type="button" className={`boton boton-grande ${confirmarCaja !== null ? 'boton-peligro' : 'boton-rojo'}`} disabled={enCurso} onClick={guardar}>
                {confirmarCaja !== null ? 'Sí, guardar igual' : 'Guardar compra'} <Icono nombre="check" tam={18} />
              </button>
            </div>
          </div>
        </>
      )}
      {verFoto && (
        <Modal titulo="Foto de la factura" onCerrar={() => setVerFoto(null)} ancho="ancho">
          <img src={verFoto} alt="Foto de la factura" className="compras-foto-grande" />
        </Modal>
      )}
    </div>
  );
}

function ResumenLectura({ renglones, factura }: { renglones: RenglonEditor[]; factura: FacturaLeida }) {
  const deFoto = renglones.filter((r) => r.descripcion);
  const listos = deFoto.filter((r) => r.producto && (r.certeza === 'codigo' || r.certeza === 'aprendido' || r.certeza === 'seguro')).length;
  const revisar = deFoto.filter((r) => r.producto && r.certeza === 'dudoso').length;
  const elegir = deFoto.filter((r) => !r.producto && !r.nuevo).length;
  return (
    <div className="compras-leida">
      <strong>
        <Icono nombre="chispa" tam={16} /> Leí {factura.renglones.length === 1 ? '1 renglón' : `${factura.renglones.length} renglones`}
        {factura.total ? ` · total ${formatPesos(factura.total)}` : ''}
      </strong>
      <div className="compras-leida-cuentas">
        <span className="insignia insignia-promo">{listos} reconocidos</span>
        {revisar > 0 && <span className="insignia insignia-aviso">{revisar} para revisar</span>}
        {elegir > 0 && <span className="insignia insignia-alerta">{elegir} para elegir</span>}
      </div>
      <small className="texto-suave">Revisá cantidades y costos: la foto puede tener errores.</small>
    </div>
  );
}

function FilaRenglon({
  r,
  productos,
  cantidad,
  onCambiar,
  onSacar,
}: {
  r: RenglonEditor;
  productos: Producto[];
  cantidad: number | null;
  onCambiar: (c: Partial<RenglonEditor>) => void;
  onSacar: () => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState('');
  const encontrados = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    return productos.filter((p) => normalizar(p.nombre).includes(t) || p.codigo === q.trim()).slice(0, 6);
  }, [q, productos]);
  const elegir = (p: Producto) => {
    onCambiar({ producto: p, nuevo: null, certeza: 'seguro', costo: r.costo ?? (p.costo > 0 ? p.costo : null), opciones: [] });
    setBuscando(false);
    setQ('');
  };
  const subtotal = cantidad && r.costo ? Math.round(cantidad * r.costo) : null;
  const sinProducto = !r.producto && !r.nuevo;
  const etiqueta = r.certeza && r.producto ? ETIQUETA_CERTEZA[r.certeza] : null;
  const nombre = r.producto?.nombre ?? r.nuevo?.nombre ?? '';

  return (
    <li className={`compras-fila ${sinProducto ? 'compras-fila-falta' : r.certeza === 'dudoso' ? 'compras-fila-dudosa' : ''}`}>
      <div className="compras-fila-producto">
        {r.descripcion && (
          <small className="compras-descripcion texto-suave" title="Lo que dice la factura">
            <Icono nombre="factura" tam={12} /> {r.descripcion}
          </small>
        )}
        {r.producto && !buscando && (
          <span className="compras-fila-elegido">
            <strong>{sinCortes(r.producto.nombre)}</strong>
            {etiqueta && <span className={`insignia ${etiqueta.clase}`}>{etiqueta.texto}</span>}
            <button type="button" className="enlace texto-suave" onClick={() => setBuscando(true)}>
              cambiar
            </button>
          </span>
        )}
        {r.producto && !buscando && (
          <small className="texto-suave">
            hay {textoCantidad(r.producto.stock, r.producto.porPeso)} · costo actual {r.producto.costo > 0 ? formatPesos(r.producto.costo) : 'sin cargar'}
          </small>
        )}
        {r.nuevo && !buscando && (
          <span className="compras-fila-nuevo">
            <span className="insignia insignia-promo">Nuevo</span>
            <input value={r.nuevo.nombre} onChange={(e) => onCambiar({ nuevo: { ...r.nuevo!, nombre: e.target.value } })} placeholder="Nombre del producto" aria-label="Nombre del producto nuevo" maxLength={80} autoFocus={!r.nuevo.nombre} />
            <button type="button" className="enlace texto-suave" onClick={() => setBuscando(true)}>
              ya lo tengo
            </button>
          </span>
        )}
        {(sinProducto || buscando) && (
          <div className="compras-elegir">
            {r.opciones.length > 0 && (
              <div className="chips">
                {r.opciones.slice(0, 3).map((p) => (
                  <button key={p.id} type="button" className="chip chip-chico" onClick={() => elegir(p)}>
                    {sinCortes(p.nombre)}
                  </button>
                ))}
              </div>
            )}
            <div className="buscador-campo buscador-chico">
              <Icono nombre="buscar" tam={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tus productos" aria-label={`Elegir producto para ${r.descripcion ?? 'el renglón'}`} autoFocus={buscando} />
              {encontrados.length > 0 && (
                <ul className="resultados">
                  {encontrados.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => elegir(p)}>
                        <span>
                          <strong>{p.nombre}</strong>
                          <small>costo {p.costo > 0 ? formatPesos(p.costo) : 'sin cargar'}</small>
                        </span>
                        <span className="importe">{formatPesos(p.precio)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="botonera">
              <button
                type="button"
                className="boton boton-chico"
                onClick={() => {
                  onCambiar({ producto: null, nuevo: { nombre: nombrePropio(q.trim() || r.descripcion || ''), codigo: r.codigoFactura && r.codigoFactura.length >= 8 ? r.codigoFactura : '', categoria: '' } });
                  setBuscando(false);
                }}
              >
                <Icono nombre="mas" tam={14} /> Es un producto nuevo
              </button>
              {buscando && (
                <button type="button" className="boton boton-chico boton-texto" onClick={() => setBuscando(false)}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <label className="compras-fila-cantidad">
        <span className="solo-movil-bloque campo-etiqueta">{r.producto?.porPeso ? 'Kilos' : 'Cantidad'}</span>
        <input
          inputMode="text"
          value={r.cantidad}
          onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/[^\d,.xX×* ]/g, '').slice(0, 9) })}
          placeholder={r.producto?.porPeso ? '2,5' : '24 o 2x12'}
          aria-label={`Cantidad de ${nombre || 'este renglón'}`}
          aria-invalid={r.cantidad !== '' && !cantidad ? true : undefined}
        />
        {/x|×|\*/i.test(r.cantidad) && cantidad && <small className="texto-suave">= {cantidad.toLocaleString('es-AR')} u.</small>}
      </label>
      <div className="compras-fila-costo">
        <span className="solo-movil-bloque campo-etiqueta">Costo c/u</span>
        <CampoPesos valor={r.costo} onCambio={(v) => onCambiar({ costo: v })} ariaLabel={`Costo de ${nombre || 'este renglón'}`} />
      </div>
      <div className="compras-fila-subtotal">
        <span className="solo-movil-bloque campo-etiqueta">Subtotal</span>
        <CampoPesos
          valor={subtotal}
          maximo={100_000_000}
          ariaLabel={`Subtotal de ${nombre || 'este renglón'}`}
          onCambio={(v) => {
            // El subtotal de la factura manda: el costo por unidad sale de dividir.
            if (v && cantidad) onCambiar({ costo: Math.round(v / cantidad) });
          }}
        />
      </div>
      <button type="button" className="boton-icono compras-fila-sacar" aria-label={`Sacar ${nombre || 'este renglón'}`} onClick={onSacar}>
        <Icono nombre="basura" tam={18} />
      </button>
    </li>
  );
}
