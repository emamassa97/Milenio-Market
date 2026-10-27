import { useMemo, useState } from 'react';
import { formatPesos } from '../dominio/dinero';
import { deudaDesde, saldoCliente } from '../dominio/fiado';
import { MEDIOS, nombreMedio, type Cliente, type MedioPago, type MovimientoFiado } from '../dominio/tipos';
import { db } from '../datos/db';
import { guardarCliente, registrarPagoFiado } from '../datos/operaciones';
import { CampoPesos, errorATexto, fechaCorta, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';

interface Fila {
  cliente: Cliente;
  movimientos: MovimientoFiado[];
  saldo: number;
  desde: number | null;
}

function dias(desde: number) {
  return Math.floor((Date.now() - desde) / 86400000);
}

function normalizar(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function PantallaClientes() {
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
  const [modal, setModal] = useState<null | { tipo: 'cliente'; cliente?: Cliente } | { tipo: 'pago'; fila: Fila }>(null);
  const visibles = useMemo(() => filas.filter((f) => normalizar(f.cliente.nombre).includes(normalizar(q.trim()))), [filas, q]);
  const total = filas.reduce((s, f) => s + Math.max(0, f.saldo), 0);
  const detalle = filas.find((f) => f.cliente.id === elegido) ?? null;

  return (
    <div className="pagina">
      <div className="pagina-cabecera">
        <div>
          <h1>Clientes y fiado</h1>
          <p className="texto-suave">
            Te deben <strong className="texto-alerta">{formatPesos(total)}</strong> entre {filas.filter((f) => f.saldo > 0).length} clientes
          </p>
        </div>
        <button type="button" className="boton boton-primario" onClick={() => setModal({ tipo: 'cliente' })}>
          <Icono nombre="mas" tam={18} /> Nuevo cliente
        </button>
      </div>

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
                      <small className="texto-suave">{f.saldo > 0 && f.desde ? `debe hace ${dias(f.desde)} días` : 'al día'}</small>
                    </span>
                    <span className={`importe ${f.saldo > 0 ? 'texto-alerta' : 'texto-suave'}`}>{formatPesos(f.saldo)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="tarjeta detalle-cliente">
            {detalle ? (
              <>
                <div className="pagina-cabecera">
                  <div>
                    <h2>{detalle.cliente.nombre}</h2>
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
                  <span>Debe</span>
                  <strong className={`importe ${detalle.saldo > 0 ? 'texto-alerta' : ''}`}>{formatPesos(detalle.saldo)}</strong>
                </div>
                <div className="botonera">
                  <button type="button" className="boton boton-primario" disabled={detalle.saldo <= 0} onClick={() => setModal({ tipo: 'pago', fila: detalle })}>
                    Registrar pago
                  </button>
                  {detalle.saldo > 0 && (
                    <a
                      className="boton"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://wa.me/${detalle.cliente.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(
                        `Hola ${detalle.cliente.nombre}! Te escribo de Milenio Market. Te quedó un saldo de ${formatPesos(detalle.saldo)}. Cuando puedas pasá. Gracias!`,
                      )}`}
                    >
                      <Icono nombre="whatsapp" tam={18} /> Recordarle por WhatsApp
                    </a>
                  )}
                </div>
                <ul className="movimientos-fiado">
                  {detalle.movimientos.map((m) => (
                    <li key={m.id} className={m.anulado ? 'anulada' : ''}>
                      <span>
                        {fechaCorta(m.fecha)} · {m.tipo === 'compra' ? 'Compra' : `Pagó (${nombreMedio(m.medio ?? 'efectivo')})`}
                        {m.anulado && ' · anulada'}
                        {m.nota && <small className="texto-suave"> · {m.nota}</small>}
                      </span>
                      <span className={`importe ${m.tipo === 'pago' ? 'texto-positivo' : ''}`}>
                        {m.tipo === 'pago' ? '−' : '+'} {formatPesos(m.monto)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Vacio titulo="Elegí un cliente para ver su cuenta" icono="usuario" />
            )}
          </section>
        </div>
      )}

      {modal?.tipo === 'cliente' && <EditarCliente cliente={modal.cliente} onCerrar={() => setModal(null)} onGuardado={(id) => setElegido(id)} />}
      {modal?.tipo === 'pago' && <RegistrarPago fila={modal.fila} onCerrar={() => setModal(null)} />}
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

function RegistrarPago({ fila, onCerrar }: { fila: Fila; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [monto, setMonto] = useState<number | null>(fila.saldo);
  const [medio, setMedio] = useState<Exclude<MedioPago, 'fiado'>>('efectivo');
  const [enCurso, unaVez] = useUnaVez();
  return (
    <Modal titulo={`Pago de ${fila.cliente.nombre}`} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
          try {
            await registrarPagoFiado(db, fila.cliente.id!, monto ?? 0, medio);
            const resto = fila.saldo - (monto ?? 0);
            avisar({ texto: resto > 0 ? `Anotado. Le quedan ${formatPesos(resto)}.` : 'Anotado. ¡Quedó al día!', tipo: 'ok' });
            onCerrar();
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
          });
        }}
      >
        <p>
          Debe <strong>{formatPesos(fila.saldo)}</strong>.
        </p>
        <CampoPesos etiqueta="¿Cuánto paga?" valor={monto} onCambio={setMonto} autoFocus grande />
        <div className="medios">
          {MEDIOS.filter((m) => m.id !== 'fiado').map((m) => (
            <button key={m.id} type="button" className={`medio ${medio === m.id ? 'activo' : ''}`} aria-pressed={medio === m.id} onClick={() => setMedio(m.id as Exclude<MedioPago, 'fiado'>)}>
              {m.nombre}
            </button>
          ))}
        </div>
        {monto !== null && monto > fila.saldo && <p className="texto-alerta">Paga más de lo que debe: le va a quedar saldo a favor.</p>}
        <button className="boton boton-primario boton-grande" type="submit" disabled={!monto || monto <= 0 || enCurso}>
          Registrar pago
        </button>
      </form>
    </Modal>
  );
}
