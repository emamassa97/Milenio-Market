import { useState } from 'react';
import { DENOMINACIONES, resumirTurno, totalConteo, type ResumenTurno } from '../dominio/caja';
import { pagosDeVenta } from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { nombreMedio, type MovimientoCaja, type TipoMovimientoCaja, type Turno, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { anularVenta, cerrarTurno, registrarMovimientoCaja, turnoAbierto } from '../datos/operaciones';
import { CampoPesos, errorATexto, fechaCorta, hora, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { usePedirDueño } from '../ui/permisos';
import { useSesion } from '../ui/sesion';

interface Resultado {
  diferencia: number;
  contado: number;
  esperado: number;
  vendido: number;
  ventas: number;
}

interface Datos {
  turno: Turno;
  ventas: Venta[];
  movimientos: MovimientoCaja[];
  resumen: ResumenTurno;
}

export function PantallaCierre({ irACaja }: { irACaja: () => void }) {
  const datos = useConsulta(
    async (): Promise<Datos | undefined | null> => {
      const turno = await turnoAbierto(db);
      if (!turno) return undefined;
      const [ventas, movimientos, pagos] = await Promise.all([
        db.ventas.where('turnoId').equals(turno.id!).toArray(),
        db.movimientosCaja.where('turnoId').equals(turno.id!).toArray(),
        db.movimientosFiado.where('turnoId').equals(turno.id!).toArray(),
      ]);
      return { turno, ventas, movimientos, resumen: resumirTurno(turno.fondoInicial, ventas, movimientos, pagos) };
    },
    [],
    null,
  );
  const historial = useConsulta(
    async () => (await db.turnos.orderBy('apertura').reverse().limit(15).toArray()).filter((t) => t.cierre !== null),
    [],
    [] as Turno[],
  );

  const [resultado, setResultado] = useState<Resultado | null>(null);
  if (datos === null) return null;
  return (
    <div className="pagina">
      {datos ? (
        <CierreAbierto datos={datos} onCerrado={setResultado} />
      ) : resultado ? (
        <ResultadoCierre r={resultado} irACaja={irACaja} />
      ) : (
        <Vacio titulo="La caja está cerrada" icono="caja">
          <button type="button" className="boton boton-primario" onClick={irACaja}>
            Abrir la caja
          </button>
        </Vacio>
      )}
      {historial.length > 0 && (
        <section className="tarjeta historial">
          <h2 className="titulo-chico">Cierres anteriores</h2>
          <ul>
            {historial.map((t) => {
              const dif = (t.contado ?? 0) - (t.esperado ?? 0);
              return (
                <li key={t.id}>
                  <span>
                    {fechaCorta(t.apertura)} a {hora(t.cierre!)} · {t.cajero}
                    {t.nota && <small className="texto-suave"> · {t.nota}</small>}
                  </span>
                  <span className={`importe ${dif < 0 ? 'texto-alerta' : dif > 0 ? 'texto-positivo' : ''}`}>
                    {dif === 0 ? 'Justo' : dif < 0 ? `Faltaron ${formatPesos(-dif)}` : `Sobraron ${formatPesos(dif)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function CierreAbierto({ datos, onCerrado }: { datos: Datos; onCerrado: (r: Resultado) => void }) {
  const avisar = useAvisar();
  const { turno, ventas, movimientos, resumen } = datos;
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [nota, setNota] = useState('');
  const [movimiento, setMovimiento] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [cerrando, unaVez] = useUnaVez();
  const { sesion } = useSesion();
  const contado = totalConteo(conteo);
  const contoAlgo = Object.values(conteo).some((v) => v > 0);
  const diferencia = contado - resumen.efectivoEsperado;
  const fiadoCobrado = Object.values(resumen.cobrosFiado).reduce((a, b) => a + b, 0);

  const cerrar = () => {
    if (!confirmar) {
      setConfirmar(true);
      return;
    }
    unaVez(async () => {
    try {
      onCerrado({ diferencia, contado, esperado: resumen.efectivoEsperado, vendido: resumen.totalVendido, ventas: resumen.cantidadVentas });
      await cerrarTurno(db, conteo, nota, sesion?.usuario);
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
    });
  };

  return (
    <>
      <div className="pagina-cabecera">
        <div>
          <h1>Cierre de caja</h1>
          <p className="texto-suave">
            Abierta a las {hora(turno.apertura)} por {turno.cajero} · {resumen.cantidadVentas} ventas
          </p>
        </div>
      </div>
      <div className="cierre">
        <div className="cierre-izquierda">
          <section className="tarjeta">
            <h2 className="titulo-chico">Efectivo en la caja</h2>
            <dl className="cuentas">
              <div>
                <dt>Cambio inicial</dt>
                <dd className="importe">{formatPesos(turno.fondoInicial)}</dd>
              </div>
              <div>
                <dt>Ventas en efectivo</dt>
                <dd className="importe">+ {formatPesos(resumen.porMedio.efectivo)}</dd>
              </div>
              {resumen.cobrosFiado.efectivo > 0 && (
                <div>
                  <dt>Fiado cobrado en efectivo</dt>
                  <dd className="importe">+ {formatPesos(resumen.cobrosFiado.efectivo)}</dd>
                </div>
              )}
              {resumen.ingresos > 0 && (
                <div>
                  <dt>Ingresos</dt>
                  <dd className="importe">+ {formatPesos(resumen.ingresos)}</dd>
                </div>
              )}
              <div>
                <dt>Retiros y gastos</dt>
                <dd className="importe">− {formatPesos(resumen.retiros + resumen.gastos)}</dd>
              </div>
              <div className="cuentas-total">
                <dt>Debería haber</dt>
                <dd className="importe">{formatPesos(resumen.efectivoEsperado)}</dd>
              </div>
              {contoAlgo && (
                <div className="cuentas-total">
                  <dt>Contaste</dt>
                  <dd className="importe">{formatPesos(contado)}</dd>
                </div>
              )}
            </dl>
            {contoAlgo && (
              <div className={`diferencia ${diferencia === 0 ? 'diferencia-justa' : diferencia < 0 ? 'diferencia-falta' : 'diferencia-sobra'}`}>
                <strong>{diferencia === 0 ? 'Da justo' : diferencia < 0 ? `Faltan ${formatPesos(-diferencia)}` : `Sobran ${formatPesos(diferencia)}`}</strong>
                {diferencia !== 0 && <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Anotá el motivo (opcional)" aria-label="Motivo de la diferencia" />}
              </div>
            )}
            {movimientos.length > 0 && (
              <ul className="movimientos">
                {movimientos.map((m) => (
                  <li key={m.id}>
                    <span>
                      {hora(m.fecha)} · {m.tipo === 'retiro' ? 'Retiro' : m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}
                      {m.motivo && `: ${m.motivo}`}
                    </span>
                    <span className="importe">
                      {m.tipo === 'ingreso' ? '+' : '−'} {formatPesos(m.monto)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tarjeta">
            <h2 className="titulo-chico">Todo lo vendido en el turno</h2>
            <dl className="cuentas">
              {(['efectivo', 'mercadopago', 'tarjeta', 'transferencia', 'fiado'] as const).map((m) => (
                <div key={m}>
                  <dt>{m === 'fiado' ? 'Fiado (a cobrar)' : nombreMedio(m)}</dt>
                  <dd className="importe">{formatPesos(resumen.porMedio[m])}</dd>
                </div>
              ))}
              <div className="cuentas-total">
                <dt>Total vendido</dt>
                <dd className="importe">{formatPesos(resumen.totalVendido)}</dd>
              </div>
              {fiadoCobrado > 0 && (
                <div>
                  <dt>Además, cobraste fiado viejo</dt>
                  <dd className="importe texto-positivo">{formatPesos(fiadoCobrado)}</dd>
                </div>
              )}
            </dl>
          </section>

          <VentasDelTurno ventas={ventas} />
        </div>

        <aside className="cierre-derecha">
          <section className="tarjeta">
            <h2 className="titulo-chico">Contá los billetes</h2>
            <p className="texto-suave">Poné cuántos hay de cada uno y la cuenta se hace sola.</p>
            <div className="billetes">
              {DENOMINACIONES.map((d) => (
                <label key={d} className="billete">
                  <span className="importe">{formatPesos(d)}</span>
                  <input
                    inputMode="numeric"
                    value={conteo[String(d)] || ''}
                    placeholder="0"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setConteo({ ...conteo, [String(d)]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    aria-label={`Cantidad de billetes de ${formatPesos(d)}`}
                  />
                  <span className="importe texto-suave">{formatPesos(d * (conteo[String(d)] ?? 0))}</span>
                </label>
              ))}
              <div className="billete">
                <span>Monedas y otros</span>
                <CampoPesos valor={conteo['monedas'] || null} onCambio={(v) => setConteo({ ...conteo, monedas: Math.max(0, v ?? 0) })} />
                <span />
              </div>
            </div>
            <div className="billetes-total">
              <span>Total contado</span>
              <strong className="importe">{formatPesos(contado)}</strong>
            </div>
          </section>
          <button type="button" className={`boton boton-grande ${confirmar ? 'boton-peligro' : 'boton-primario'}`} onClick={cerrar} disabled={cerrando}>
            {confirmar ? (contoAlgo ? 'Confirmar cierre' : 'No contaste nada. ¿Cerrar igual?') : 'Cerrar turno'}
          </button>
          <button type="button" className="boton" onClick={() => setMovimiento(true)}>
            Anotar un retiro o gasto
          </button>
        </aside>
      </div>
      {movimiento && <NuevoMovimiento onCerrar={() => setMovimiento(false)} />}
    </>
  );
}

function ResultadoCierre({ r, irACaja }: { r: Resultado; irACaja: () => void }) {
  const tono = r.diferencia === 0 ? 'justo' : r.diferencia < 0 ? 'falta' : 'sobra';
  return (
    <section className={`tarjeta resultado-cierre resultado-${tono}`}>
      <span className="resultado-icono">
        <Icono nombre={r.diferencia === 0 ? 'check' : 'alerta'} tam={30} />
      </span>
      <h1>{r.diferencia === 0 ? 'Caja cerrada: dio justo' : r.diferencia < 0 ? `Faltaron ${formatPesos(-r.diferencia)}` : `Sobraron ${formatPesos(r.diferencia)}`}</h1>
      <dl className="resultado-cifras">
        <div>
          <dt>Vendiste</dt>
          <dd className="importe">{formatPesos(r.vendido)}</dd>
        </div>
        <div>
          <dt>Ventas</dt>
          <dd className="importe">{r.ventas}</dd>
        </div>
        <div>
          <dt>Debía haber</dt>
          <dd className="importe">{formatPesos(r.esperado)}</dd>
        </div>
        <div>
          <dt>Contaste</dt>
          <dd className="importe">{formatPesos(r.contado)}</dd>
        </div>
      </dl>
      <button type="button" className="boton boton-primario" onClick={irACaja}>
        Abrir un turno nuevo
      </button>
    </section>
  );
}

function VentasDelTurno({ ventas }: { ventas: Venta[] }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const [anulando, setAnulando] = useState<number | null>(null);
  const [abierta, setAbierta] = useState(false);
  const ordenadas = [...ventas].sort((a, b) => b.fecha - a.fecha);
  if (ventas.length === 0) return null;
  return (
    <section className="tarjeta">
      <button type="button" className="desplegable" aria-expanded={abierta} onClick={() => setAbierta(!abierta)}>
        <span className="titulo-chico">Ventas del turno ({ventas.length})</span>
        <span className="texto-suave">{abierta ? 'Ocultar' : 'Ver y anular'}</span>
      </button>
      {abierta && (
        <ul className="ventas-turno">
          {ordenadas.map((v) => (
            <li key={v.id} className={v.anulada ? 'anulada' : ''}>
              <span>
                <strong>{hora(v.fecha)}</strong> · {pagosDeVenta(v).map((p) => nombreMedio(p.medio)).join(' + ')}
                <small className="texto-suave"> · {v.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ')}</small>
              </span>
              <span className="importe">{formatPesos(v.total)}</span>
              {v.anulada ? (
                <span className="texto-suave">Anulada</span>
              ) : (
                <button
                  type="button"
                  className={`boton boton-chico ${anulando === v.id ? 'boton-peligro' : 'boton-texto-peligro'}`}
                  onClick={async () => {
                    if (anulando !== v.id) return setAnulando(v.id!);
                    const quien = await pedirDueño('Anular una venta');
                    if (!quien) return setAnulando(null);
                    try {
                      await anularVenta(db, v.id!, quien);
                      avisar({ texto: 'Venta anulada. El stock volvió.', tipo: 'info' });
                    } catch (e) {
                      avisar({ texto: errorATexto(e), tipo: 'error' });
                    }
                    setAnulando(null);
                  }}
                >
                  {anulando === v.id ? '¿Seguro?' : 'Anular'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NuevoMovimiento({ onCerrar }: { onCerrar: () => void }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const { sesion } = useSesion();
  const [tipo, setTipo] = useState<TipoMovimientoCaja | 'mercaderia'>('mercaderia');
  const [monto, setMonto] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  return (
    <Modal titulo="Retiro, gasto o ingreso" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
            // Retiros y gastos sacan plata de la caja: para un empleado los autoriza el dueño.
            const real = tipo === 'mercaderia' ? 'gasto' : tipo;
            const quien = real !== 'ingreso' ? await pedirDueño(real === 'retiro' ? 'Sacar plata de la caja' : 'Pagar un gasto con plata de la caja') : sesion?.usuario;
            if (real !== 'ingreso' && !quien) return;
            try {
              await registrarMovimientoCaja(db, real, monto ?? 0, motivo, quien ?? undefined, tipo === 'mercaderia');
              avisar({ texto: 'Anotado.', tipo: 'ok' });
              onCerrar();
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <div className="chips" role="group" aria-label="Tipo">
          {(
            [
              ['mercaderia', 'Pago a proveedor'],
              ['gasto', 'Gasto del local'],
              ['retiro', 'Retiro'],
              ['ingreso', 'Ingreso de cambio'],
            ] as const
          ).map(([id, texto]) => (
            <button key={id} type="button" className={`chip ${tipo === id ? 'activo' : ''}`} aria-pressed={tipo === id} onClick={() => setTipo(id)}>
              {texto}
            </button>
          ))}
        </div>
        <CampoPesos etiqueta="Monto" valor={monto} onCambio={setMonto} autoFocus grande />
        <label className="campo">
          <span className="campo-etiqueta">Motivo</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'mercaderia' ? 'Ej.: Distribuidora Coca-Cola' : tipo === 'gasto' ? 'Ej.: Luz, limpieza, delivery' : tipo === 'retiro' ? 'Ej.: Me llevo para el banco' : 'Ej.: Cambio del banco'} />
        </label>
        <button type="submit" className="boton boton-primario boton-grande" disabled={!monto || monto <= 0 || enCurso}>
          Anotar
        </button>
      </form>
    </Modal>
  );
}
