import { useEffect, useMemo, useRef, useState } from 'react';
import { pagosDeVenta } from '../dominio/carrito';
import { describirItems, describirPagos, totalDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { telefonoWhatsApp } from '../dominio/entrada';
import { deudaDesde, saldoCliente } from '../dominio/fiado';
import { MEDIOS, nombreMedio, type Cliente, type MedioPago, type MovimientoFiado, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { anularPagoFiado, anularVenta, guardarCliente, registrarPagoFiado, turnoAbierto } from '../datos/operaciones';
import { CampoPesos, errorATexto, fechaCorta, ICONO_MEDIO, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño, usePedirDueño } from '../ui/permisos';

interface Fila {
  cliente: Cliente;
  movimientos: MovimientoFiado[];
  saldo: number;
  desde: number | null;
}

function desdeCuando(desde: number): string {
  const d = Math.floor((Date.now() - desde) / 86400000);
  return d <= 0 ? 'desde hoy' : d === 1 ? 'desde ayer' : `desde hace ${d} días`;
}

function normalizar(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function PantallaClientes() {
  const avisar = useAvisar();
  const dueño = useEsDueño();
  const pedirDueño = usePedirDueño();
  const turno = useConsulta(() => turnoAbierto(db), [], undefined as Awaited<ReturnType<typeof turnoAbierto>>);
  const [anulando, setAnulando] = useState<number | null>(null);
  const filas = useConsulta(
    async (): Promise<Fila[]> => {
      const [clientes, movs] = await Promise.all([db.clientes.toArray(), db.movimientosFiado.toArray()]);
      return clientes
        .map((cliente) => {
          const movimientos = movs.filter((m) => m.clienteId === cliente.id).sort((a, b) => b.fecha - a.fecha);
          return { cliente, movimientos, saldo: saldoCliente(movimientos), desde: deudaDesde(movimientos) };
        })
        .sort((a, b) => b.saldo - a.saldo || a.cliente.nombre.localeCompare(b.cliente.nombre));
    },
    [],
    [],
  );
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<number | null>(null);
  // Sólo las ventas del cliente abierto: alcanza para mostrar qué llevó en cada compra.
  const ventas = useConsulta(
    async () => new Map(elegido === null ? [] : (await db.ventas.where('clienteId').equals(elegido).toArray()).map((v) => [v.id!, v])),
    [elegido],
    new Map<number, Venta>(),
  );
  const [modal, setModal] = useState<null | { tipo: 'cliente'; cliente?: Cliente } | { tipo: 'pago'; fila: Fila }>(null);
  const visibles = useMemo(() => filas.filter((f) => normalizar(f.cliente.nombre).includes(normalizar(q.trim()))), [filas, q]);
  const total = filas.reduce((s, f) => s + Math.max(0, f.saldo), 0);
  const deudores = filas.filter((f) => f.saldo > 0).length;
  const detalle = filas.find((f) => f.cliente.id === elegido) ?? null;
  const whatsapp = detalle ? telefonoWhatsApp(detalle.cliente.telefono) : null;
  // "Marta (la del 3° B)" → "Marta" para el saludo.
  const nombreCorto = detalle ? detalle.cliente.nombre.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(' ')[0] : '';
  // En el celular la cuenta queda abajo de la lista: al elegir, la traemos a la vista.
  const refDetalle = useRef<HTMLElement>(null);
  useEffect(() => {
    if (elegido !== null && window.matchMedia('(max-width: 900px)').matches) refDetalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [elegido]);

  return (
    <div className="pagina">
      <div className="pagina-cabecera">
        <div>
          <h1>Clientes y fiado</h1>
          <p className="texto-suave">
            {deudores === 0 ? (
              'Nadie debe fiado'
            ) : (
              <>
                Te deben <strong className="texto-normal">{formatPesos(total)}</strong> {deudores === 1 ? 'un cliente' : `entre ${deudores} clientes`}
              </>
            )}
          </p>
        </div>
        <button type="button" className="boton boton-primario solo-pc" onClick={() => setModal({ tipo: 'cliente' })}>
          <Icono nombre="mas" tam={18} /> Nuevo cliente
        </button>
      </div>
      <button type="button" className="fab" onClick={() => setModal({ tipo: 'cliente' })} aria-label="Nuevo cliente" title="Nuevo cliente">
        <Icono nombre="mas" tam={26} />
      </button>

      {filas.length === 0 ? (
        <Vacio titulo="Todavía no hay clientes" icono="clientes">
          <p className="texto-suave">Se crean acá o en la caja, al elegir "Fiado" como medio de pago.</p>
        </Vacio>
      ) : (
        <div className="clientes">
          <section className="tarjeta lista-deudores">
            <div className="buscador-campo buscador-chico">
              <Icono nombre="buscar" tam={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" />
            </div>
            <ul>
              {visibles.map((f) => (
                <li key={f.cliente.id}>
                  <button type="button" className={elegido === f.cliente.id ? 'activo' : ''} onClick={() => setElegido(f.cliente.id!)}>
                    <span>
                      <strong>{f.cliente.nombre}</strong>
                      <small className="texto-suave">{f.saldo > 0 && f.desde ? `debe ${desdeCuando(f.desde)}` : 'al día'}</small>
                    </span>
                    <strong className={`importe ${f.saldo > 0 ? '' : 'texto-suave'}`}>{formatPesos(f.saldo)}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="tarjeta detalle-cliente" ref={refDetalle}>
            {detalle ? (
              <>
                <div className="pagina-cabecera cabecera-cliente">
                  <div>
                    <h2 title={detalle.cliente.nombre}>{detalle.cliente.nombre}</h2>
                    <p className="texto-suave">
                      {detalle.cliente.telefono || 'sin teléfono'}
                      {detalle.cliente.limite > 0 && ` · límite ${formatPesos(detalle.cliente.limite)}`}
                    </p>
                  </div>
                  <button type="button" className="boton-icono" onClick={() => setModal({ tipo: 'cliente', cliente: detalle.cliente })} aria-label="Editar cliente">
                    <Icono nombre="lapiz" />
                  </button>
                </div>
                <div className="saldo-cliente">
                  <span>
                    Saldo <span className={`insignia ${detalle.saldo > 0 ? 'insignia-aviso' : 'insignia-promo'}`}>{detalle.saldo > 0 ? 'Debe' : 'Al día'}</span>
                  </span>
                  <strong className="importe">{formatPesos(detalle.saldo)}</strong>
                </div>
                <div className="botonera">
                  <button type="button" className="boton boton-primario" disabled={detalle.saldo <= 0} onClick={() => setModal({ tipo: 'pago', fila: detalle })}>
                    Registrar pago
                  </button>
                  {detalle.saldo > 0 && whatsapp && (
                    <a
                      className="boton"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                        `Hola ${nombreCorto}! Te escribo de Milenio Market. Te quedó un saldo de ${formatPesos(detalle.saldo)}. Cuando puedas pasá. Gracias!`,
                      )}`}
                    >
                      <Icono nombre="whatsapp" tam={18} /> Recordarle por WhatsApp
                    </a>
                  )}
                  {detalle.saldo > 0 && !whatsapp && (
                    <button type="button" className="boton" onClick={() => setModal({ tipo: 'cliente', cliente: detalle.cliente })}>
                      <Icono nombre="whatsapp" tam={18} /> Cargar WhatsApp
                    </button>
                  )}
                </div>
                <ul className="movimientos-fiado">
                  {detalle.movimientos.map((m) => {
                    const venta = m.ventaId !== null ? ventas.get(m.ventaId) : undefined;
                    const esDevolucion = m.tipo === 'pago' && m.medio === null;
                    const puedeAnularVenta = m.tipo === 'compra' && !m.anulado && venta && !venta.anulada && turno && venta.turnoId === turno.id && !venta.devoluciones?.length;
                    const puedeAnularPago = m.tipo === 'pago' && !esDevolucion && !m.anulado;
                    // Si pagó una parte con otro medio, lo decimos: anular la venta también deshace esa parte.
                    const pagos = venta ? pagosDeVenta(venta) : [];
                    const pagoOtro = pagos.filter((p) => p.medio !== 'fiado').reduce((s, p) => s + p.monto, 0);
                    const comoPago = pagos.length > 1 ? describirPagos(pagos) : '';
                    const anular = async () => {
                      if (anulando !== m.id) return setAnulando(m.id!);
                      const quien = await pedirDueño(m.tipo === 'pago' ? 'Anular un pago de fiado' : 'Anular una venta');
                      if (!quien) return setAnulando(null);
                      try {
                        if (m.tipo === 'pago') await anularPagoFiado(db, m.id!, quien);
                        else await anularVenta(db, m.ventaId!, quien);
                        avisar({
                          texto:
                            m.tipo === 'pago'
                              ? 'Pago anulado: vuelve a deber ese monto.'
                              : pagoOtro > 0
                                ? `Venta anulada. El stock volvió, ya no la debe y hay que devolverle los ${formatPesos(pagoOtro)} que pagó.`
                                : 'Venta anulada. El stock volvió y ya no la debe.',
                          tipo: 'info',
                        });
                      } catch (e) {
                        avisar({ texto: errorATexto(e), tipo: 'error' });
                      }
                      setAnulando(null);
                    };
                    return (
                      <li key={m.id} className={m.anulado ? 'anulada' : ''}>
                        <span className="movimiento-fiado-texto">
                          <span>
                            {fechaCorta(m.fecha)} · {m.tipo === 'compra' ? 'Compra' : esDevolucion ? 'Devolución' : `Pagó (${nombreMedio(m.medio ?? 'efectivo')})`}
                            {m.anulado && ' · anulada'}
                            {m.nota && !esDevolucion && <small className="texto-suave"> · {m.nota}</small>}
                          </span>
                          {m.tipo === 'compra' && venta && (
                            <small className="texto-suave">
                              {describirItems(venta.items)}
                              {comoPago && ` · Pagó ${comoPago}`}
                              {totalDevuelto(venta) > 0 && ` · Devuelto ${formatPesos(totalDevuelto(venta))}`}
                            </small>
                          )}
                          {esDevolucion && m.nota && <small className="texto-suave">{m.nota.replace(/^Devolución: /, '')}</small>}
                        </span>
                        <span className="movimiento-fiado-monto">
                          <span className={`importe ${m.tipo === 'pago' ? 'texto-positivo' : ''}`}>
                            {m.tipo === 'pago' ? '−' : '+'} {formatPesos(m.monto)}
                          </span>
                          {dueño && (puedeAnularPago || puedeAnularVenta) && (
                            <button
                              type="button"
                              className={`boton boton-chico ${anulando === m.id ? 'boton-peligro' : 'boton-texto-peligro'}`}
                              onClick={anular}
                              title={m.tipo === 'compra' ? 'Deshace la venta entera: vuelve el stock y se borra de la cuenta' : 'Vuelve a deber este monto'}
                            >
                              {anulando === m.id ? (m.tipo === 'compra' ? 'Sí, anular la venta' : 'Sí, anular') : m.tipo === 'compra' ? 'Anular la venta' : 'Anular'}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <Vacio titulo="Elegí un cliente para ver su cuenta" icono="usuario" />
            )}
          </section>
        </div>
      )}

      {modal?.tipo === 'cliente' && <EditarCliente cliente={modal.cliente} onCerrar={() => setModal(null)} onGuardado={(id) => setElegido(id)} />}
      {modal?.tipo === 'pago' && <RegistrarPago cliente={modal.fila.cliente} saldo={modal.fila.saldo} onCerrar={() => setModal(null)} />}
    </div>
  );
}

function EditarCliente({ cliente, onCerrar, onGuardado }: { cliente?: Cliente; onCerrar: () => void; onGuardado: (id: number) => void }) {
  const avisar = useAvisar();
  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [limite, setLimite] = useState<number | null>(cliente?.limite || null);
  const [enCurso, unaVez] = useUnaVez();
  return (
    <Modal titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
          try {
            const id = await guardarCliente(db, { nombre, telefono, limite: limite ?? 0 }, cliente?.id);
            onGuardado(id);
            onCerrar();
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
          });
        }}
      >
        <label className="campo">
          <span className="campo-etiqueta">Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej.: Marta (la del 3° B)" />
        </label>
        <label className="campo">
          <span className="campo-etiqueta">WhatsApp (opcional)</span>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="Ej.: 341 555-1234" />
        </label>
        <CampoPesos etiqueta="Hasta cuánto le fiás (opcional)" valor={limite} onCambio={setLimite} placeholder="Sin límite" />
        <button className="boton boton-primario boton-grande" type="submit" disabled={!nombre.trim() || enCurso}>
          Guardar
        </button>
      </form>
    </Modal>
  );
}

/** Un cliente paga (todo o parte de) lo que debe. Se usa acá y desde la caja ("Cobrar un fiado"). */
export function RegistrarPago({ cliente, saldo, onCerrar }: { cliente: Cliente; saldo: number; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [monto, setMonto] = useState<number | null>(saldo > 0 ? saldo : null);
  const [medio, setMedio] = useState<Exclude<MedioPago, 'fiado'>>('efectivo');
  const [enCurso, unaVez] = useUnaVez();
  return (
    <Modal titulo={`Pago de ${cliente.nombre}`} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
          try {
            await registrarPagoFiado(db, cliente.id!, monto ?? 0, medio);
            const resto = saldo - (monto ?? 0);
            avisar({ texto: resto > 0 ? `Anotado. Le quedan ${formatPesos(resto)}.` : 'Anotado. ¡Quedó al día!', tipo: 'ok' });
            onCerrar();
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
          });
        }}
      >
        <p>{saldo > 0 ? <>Debe <strong>{formatPesos(saldo)}</strong>.</> : 'Está al día: lo que pague le queda a favor.'}</p>
        <CampoPesos etiqueta="¿Cuánto paga?" valor={monto} onCambio={setMonto} autoFocus grande />
        <div className="medios">
          {MEDIOS.filter((m) => m.id !== 'fiado').map((m) => (
            <button key={m.id} type="button" className={`medio ${medio === m.id ? 'activo' : ''}`} aria-pressed={medio === m.id} onClick={() => setMedio(m.id as Exclude<MedioPago, 'fiado'>)}>
              <Icono nombre={ICONO_MEDIO[m.id]} tam={18} /> {m.nombre}
            </button>
          ))}
        </div>
        {monto !== null && monto > saldo && <p className="texto-alerta">Paga más de lo que debe: le va a quedar saldo a favor.</p>}
        <button className="boton boton-primario boton-grande" type="submit" disabled={!monto || monto <= 0 || enCurso}>
          Registrar pago
        </button>
      </form>
    </Modal>
  );
}
