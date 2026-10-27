import { useEffect, useState } from 'react';
import { DENOMINACIONES, resumirTurno, textoCierre, totalConteo, type ResumenTurno } from '../dominio/caja';
import { carritoVacio, pagosDeVenta, totalCarrito, type Carrito } from '../dominio/carrito';
import { describirItems, totalDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { nombreMedio, type Cliente, type MovimientoCaja, type Turno, type Venta } from '../dominio/tipos';
import { imprimirTicket, leerAjustesTicket, TICKET_INICIAL } from '../ui/ticket';
import { db } from '../datos/db';
import { anularVenta, cerrarTurno, registrarMovimientoCaja, turnoAbierto, type MovimientoManual } from '../datos/operaciones';
import { CampoPesos, copiarTexto, Desplegable, errorATexto, fechaCorta, hora, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { leerGuardado, LLAVE_CARRITO, LLAVE_ESPERA, resumenEspera, useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño, usePedirDueño } from '../ui/permisos';
import { useSesion } from '../ui/sesion';
import { DevolverVenta } from './Devolver';

interface Resultado {
  diferencia: number;
  contado: number;
  esperado: number;
  vendido: number;
  ventas: number;
  /** Para compartir el resumen. */
  texto: string;
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
  const [abierto, setAbierto] = useState<number | null>(null);
  const dueño = useEsDueño();
  if (datos === null) return null;
  return (
    <div className="pagina">
      {datos ? (
        <CierreAbierto datos={datos} onCerrado={setResultado} irACaja={irACaja} />
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
          <p className="texto-suave">Para devolver o reimprimir el ticket de una venta de otro día, abrí ese cierre.</p>
          <ul>
            {historial.map((t) => {
              const dif = (t.contado ?? 0) - (t.esperado ?? 0);
              return (
                <li key={t.id} className={abierto === t.id ? 'historial-abierto' : ''}>
                  <button type="button" className="historial-fila" aria-expanded={abierto === t.id} onClick={() => setAbierto(abierto === t.id ? null : t.id!)}>
                    <span>
                      {fechaCorta(t.apertura)} a {hora(t.cierre!)} · {t.cajero}
                      {t.nota && <small className="texto-suave"> · {t.nota}</small>}
                    </span>
                    {dueño ? (
                      <span className={`importe ${dif < 0 ? 'texto-alerta' : dif > 0 ? 'texto-aviso' : ''}`}>
                        {dif === 0 ? 'Justo' : dif < 0 ? `Faltaron ${formatPesos(-dif)}` : `Sobraron ${formatPesos(dif)}`}
                      </span>
                    ) : (
                      <span className="texto-suave">Cerrada</span>
                    )}
                    <span className="desplegable-indicador texto-suave">
                      {abierto === t.id ? 'Ocultar' : 'Ver ventas'} <Icono nombre="abrir" tam={16} />
                    </span>
                  </button>
                  {abierto === t.id && <VentasDeCierre turnoId={t.id!} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// Ventas que quedaron armadas en la caja sin cobrar (el navegador las guarda aunque se cambie de pantalla).
function ventasSinCobrar(): string | null {
  const espera = resumenEspera(leerGuardado<unknown>(LLAVE_ESPERA, []));
  const guardado = leerGuardado<Partial<Carrito>>(LLAVE_CARRITO, carritoVacio);
  const carrito: Carrito = Array.isArray(guardado?.items) ? { items: guardado.items } : carritoVacio;
  if (espera.cantidad === 0 && carrito.items.length === 0) return null;
  const partes = [espera.cantidad > 0 && `${espera.texto.charAt(0).toLowerCase()}${espera.texto.slice(1)} (${formatPesos(espera.total)})`, carrito.items.length > 0 && `una venta sin cobrar (${formatPesos(totalCarrito(carrito))})`].filter(Boolean);
  return `Hay ${partes.join(' y ')}.`;
}

// Se vuelve a mirar al volver a la pestaña o cuando otra pestaña cobra o deja algo en espera.
function useVentasSinCobrar(): string | null {
  const [texto, setTexto] = useState(ventasSinCobrar);
  useEffect(() => {
    const revisar = () => setTexto(ventasSinCobrar());
    window.addEventListener('focus', revisar);
    window.addEventListener('storage', revisar);
    document.addEventListener('visibilitychange', revisar);
    return () => {
      window.removeEventListener('focus', revisar);
      window.removeEventListener('storage', revisar);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, []);
  return texto;
}

function CierreAbierto({ datos, onCerrado, irACaja }: { datos: Datos; onCerrado: (r: Resultado) => void; irACaja: () => void }) {
  const avisar = useAvisar();
  const { turno, ventas, movimientos, resumen } = datos;
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [nota, setNota] = useState('');
  const [movimiento, setMovimiento] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [cerrando, unaVez] = useUnaVez();
  const { sesion } = useSesion();
  // El empleado cuenta a ciegas: si viera cuánto debería haber, podría acomodar el número.
  const dueño = useEsDueño();
  const contado = totalConteo(conteo);
  const contoAlgo = Object.values(conteo).some((v) => v > 0);
  const diferencia = contado - resumen.efectivoEsperado;
  const fiadoCobrado = Object.values(resumen.cobrosFiado).reduce((a, b) => a + b, 0);
  const sinCobrar = useVentasSinCobrar();
  const textoCerrar = !confirmar
    ? 'Cerrar turno'
    : sinCobrar && !contoAlgo
      ? 'Hay ventas sin cobrar y no contaste nada. ¿Cerrar igual?'
      : sinCobrar
        ? 'Hay ventas sin cobrar. ¿Cerrar igual?'
        : !contoAlgo
          ? 'No contaste nada. ¿Cerrar igual?'
          : `Sí, cerrar · contaste ${formatPesos(contado)}`;

  const cerrar = () => {
    if (!confirmar) {
      setConfirmar(true);
      return;
    }
    unaVez(async () => {
    try {
      onCerrado({
        diferencia,
        contado,
        esperado: resumen.efectivoEsperado,
        vendido: resumen.vendidoNeto,
        ventas: resumen.cantidadVentas,
        texto: textoCierre({ ...turno, cierre: Date.now() }, resumen, contoAlgo ? contado : null),
      });
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
      {sinCobrar && (
        <div className="aviso-tarjeta aviso-ambar" role="status">
          <span>
            <strong>{sinCobrar}</strong> Cobralas o cancelalas antes de cerrar.
          </span>
          <button type="button" className="boton boton-chico" onClick={irACaja}>
            Ir a la caja
          </button>
        </div>
      )}
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
              {resumen.devoluciones > 0 && (
                <div>
                  <dt>Devoluciones en efectivo</dt>
                  <dd className="importe">− {formatPesos(resumen.devoluciones)}</dd>
                </div>
              )}
              {dueño && (
                <div className="cuentas-total">
                  <dt>Debería haber</dt>
                  <dd className="importe">{formatPesos(resumen.efectivoEsperado)}</dd>
                </div>
              )}
              {contoAlgo && (
                <div className="cuentas-total">
                  <dt>Contaste</dt>
                  <dd className="importe">{formatPesos(contado)}</dd>
                </div>
              )}
            </dl>
            {!dueño && <p className="texto-suave">La diferencia se ve al confirmar el cierre.</p>}
            {movimientos.length > 0 && (
              <ul className="movimientos">
                {movimientos.map((m) => (
                  <li key={m.id}>
                    <span>
                      {hora(m.fecha)} ·{' '}
                      {m.tipo === 'devolucion' ? m.motivo : `${m.tipo === 'retiro' ? 'Retiro' : m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}${m.motivo ? `: ${m.motivo}` : ''}`}
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
              {resumen.devuelto > 0 && (
                <>
                  <div>
                    <dt>Cobrado en total</dt>
                    <dd className="importe">{formatPesos(resumen.totalVendido)}</dd>
                  </div>
                  <div>
                    <dt>Devuelto de esas ventas</dt>
                    <dd className="importe">− {formatPesos(resumen.devuelto)}</dd>
                  </div>
                </>
              )}
              <div className="cuentas-total">
                <dt>Total vendido</dt>
                <dd className="importe">{formatPesos(resumen.vendidoNeto)}</dd>
              </div>
              {fiadoCobrado > 0 && (
                <div>
                  <dt>Fiado cobrado (de otros días)</dt>
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
                  {conteo[String(d)] ? <span className="importe texto-suave">{formatPesos(d * conteo[String(d)]!)}</span> : <span className="billete-vacio">—</span>}
                </label>
              ))}
              <div className="billete">
                <span>Monedas</span>
                <CampoPesos valor={conteo['monedas'] || null} onCambio={(v) => setConteo({ ...conteo, monedas: Math.max(0, v ?? 0) })} ariaLabel="Monedas y otros" />
                <span />
              </div>
            </div>
          </section>
          {/* Queda a la vista mientras se cuentan los billetes, aunque la lista sea larga. */}
          <div className="cierre-pie">
            <div className="billetes-total">
              <span>Total contado</span>
              <strong className="importe">{formatPesos(contado)}</strong>
            </div>
            {contoAlgo && dueño && (
              <div className={`diferencia ${diferencia === 0 ? 'diferencia-justa' : diferencia < 0 ? 'diferencia-falta' : 'diferencia-sobra'}`}>
                <strong>{diferencia === 0 ? 'Da justo' : diferencia < 0 ? `Faltan ${formatPesos(-diferencia)}` : `Sobran ${formatPesos(diferencia)}`}</strong>
                {diferencia !== 0 && <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Anotá el motivo (opcional)" aria-label="Motivo de la diferencia" />}
              </div>
            )}
            <button type="button" className={`boton boton-grande ${confirmar ? 'boton-peligro' : 'boton-primario'}`} onClick={cerrar} disabled={cerrando}>
              {textoCerrar}
            </button>
            <button type="button" className="boton boton-texto boton-retiro" onClick={() => setMovimiento(true)}>
              <Icono nombre="billetera" tam={16} /> Anotar un retiro o gasto
            </button>
          </div>
        </aside>
      </div>
      {movimiento && <NuevoMovimiento onCerrar={() => setMovimiento(false)} />}
    </>
  );
}

function ResultadoCierre({ r, irACaja }: { r: Resultado; irACaja: () => void }) {
  const avisar = useAvisar();
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
      <div className="botonera botonera-centrada">
        <button type="button" className="boton boton-primario" onClick={irACaja}>
          Abrir un turno nuevo
        </button>
        <a className="boton" href={`https://wa.me/?text=${encodeURIComponent(r.texto)}`} target="_blank" rel="noreferrer">
          <Icono nombre="whatsapp" tam={18} /> Mandar por WhatsApp
        </a>
        <button
          type="button"
          className="boton"
          onClick={async () => avisar((await copiarTexto(r.texto)) ? { texto: 'Resumen copiado.', tipo: 'ok' } : { texto: 'No se pudo copiar.', tipo: 'error' })}
        >
          <Icono nombre="copiar" tam={18} /> Copiar
        </button>
      </div>
    </section>
  );
}

function VentasDelTurno({ ventas, soloDevolver = false }: { ventas: Venta[]; soloDevolver?: boolean }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const [anulando, setAnulando] = useState<number | null>(null);
  const [devolviendo, setDevolviendo] = useState<Venta | null>(null);
  const [abierta, setAbierta] = useState(!!soloDevolver);
  const clientes = useConsulta(async () => new Map((await db.clientes.toArray()).map((c) => [c.id!, c])), [], new Map<number, Cliente>());
  const ticket = useConsulta(() => leerAjustesTicket(db), [], TICKET_INICIAL);
  const ordenadas = [...ventas].sort((a, b) => b.fecha - a.fecha);
  if (ventas.length === 0) return soloDevolver ? <p className="texto-suave">No hubo ventas en ese turno.</p> : null;
  const lista = (
        <ul className="ventas-turno">
          {ordenadas.map((v) => {
            const devuelto = totalDevuelto(v);
            const cliente = v.clienteId !== null ? clientes.get(v.clienteId)?.nombre : undefined;
            return (
              <li key={v.id} className={v.anulada ? 'anulada' : ''}>
                <span>
                  <strong>{hora(v.fecha)}</strong> · {pagosDeVenta(v).map((p) => (p.medio === 'fiado' && cliente ? `Fiado a ${cliente}` : nombreMedio(p.medio))).join(' + ')}
                  {devuelto > 0 && <span className="insignia insignia-aviso">Devuelto {formatPesos(devuelto)}</span>}
                  <small className="texto-suave"> · {describirItems(v.items)}</small>
                </span>
                <span className="importe">{formatPesos(v.total)}</span>
                {v.anulada ? (
                  <span className="texto-suave">Anulada</span>
                ) : (
                  <span className="botonera botonera-compacta">
                    <button type="button" className="boton boton-chico" onClick={() => imprimirTicket(v, ticket)} aria-label="Reimprimir el ticket" title="Reimprimir el ticket">
                      <Icono nombre="ticket" tam={16} />
                    </button>
                    {devuelto < v.total && (
                      <button type="button" className="boton boton-chico" onClick={() => setDevolviendo(v)}>
                        Devolver
                      </button>
                    )}
                    {devuelto === 0 && !soloDevolver && (
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
                        {anulando === v.id ? 'Sí, anular' : 'Anular'}
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
  );
  if (soloDevolver) {
    return (
      <>
        {lista}
        {devolviendo && <DevolverVenta venta={devolviendo} onCerrar={() => setDevolviendo(null)} />}
      </>
    );
  }
  return (
    <section className="tarjeta">
      <Desplegable abierto={abierta} titulo={`Ventas del turno (${ventas.length})`} texto={abierta ? 'Ocultar' : 'Ver, devolver o anular'} onClick={() => setAbierta(!abierta)} />
      {abierta && lista}
      {devolviendo && <DevolverVenta venta={devolviendo} onCerrar={() => setDevolviendo(null)} />}
    </section>
  );
}

/** Las ventas de un cierre anterior: sólo para devolver o reimprimir (anular ya no se puede). */
function VentasDeCierre({ turnoId }: { turnoId: number }) {
  const ventas = useConsulta(() => db.ventas.where('turnoId').equals(turnoId).toArray(), [turnoId], null as Venta[] | null);
  if (ventas === null) return <p className="texto-suave">Cargando…</p>;
  return <VentasDelTurno ventas={ventas} soloDevolver />;
}

export function NuevoMovimiento({ onCerrar }: { onCerrar: () => void }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const { sesion } = useSesion();
  const [tipo, setTipo] = useState<MovimientoManual | 'mercaderia'>('mercaderia');
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
        <div className="segmentos" role="group" aria-label="Tipo">
          {(
            [
              ['mercaderia', 'Mercadería'],
              ['gasto', 'Gasto'],
              ['retiro', 'Retiro'],
              ['ingreso', 'Ingreso'],
            ] as const
          ).map(([id, texto]) => (
            <button
              key={id}
              type="button"
              className={tipo === id ? 'activo' : ''}
              aria-pressed={tipo === id}
              onClick={() => {
                setTipo(id);
                // Lo que se escriba después va al monto, no al botón.
                document.getElementById('monto-movimiento')?.focus();
              }}
            >
              {texto}
            </button>
          ))}
        </div>
        <p className="texto-suave">
          {tipo === 'mercaderia'
            ? 'Lo que le pagaste a un proveedor con plata de la caja. No cuenta como gasto del local: ya está en el costo. Si además querés sumar el stock, hacelo desde Productos → "Llegó mercadería": ahí se anota el gasto solo, no lo cargues dos veces.'
            : tipo === 'gasto'
              ? 'Luz, limpieza, delivery, sueldos: gastos del local pagados de la caja.'
              : tipo === 'retiro'
                ? 'Plata que sacás de la caja (para el banco, para vos).'
                : 'Cambio que ponés en la caja.'}
        </p>
        <CampoPesos id="monto-movimiento" etiqueta="Monto" valor={monto} onCambio={setMonto} autoFocus grande />
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
