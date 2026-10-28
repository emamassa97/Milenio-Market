import { useEffect, useState } from 'react';
import { BotonAyuda } from '../ui/Ayuda';
import { cobrosDeMedio, DENOMINACIONES, diferenciaConApp, resumirTurno, textoCierre, totalConteo, type ResumenTurno } from '../dominio/caja';
import { carritoVacio, pagosDeVenta, totalCarrito, type Carrito } from '../dominio/carrito';
import { describirItems, totalDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { normalizarTexto } from '../dominio/entrada';
import { nombreMedio, type Cliente, type MovimientoCaja, type Turno, type Venta } from '../dominio/tipos';
import { imprimirTicket, leerAjustesTicket, TICKET_INICIAL } from '../ui/ticket';
import { db } from '../datos/db';
import { anularVenta, cerrarTurno, pasarTurno, registrarMovimientoCaja, resumenDeTurno, turnoAbierto, type MovimientoManual } from '../datos/operaciones';
import { leerUsuarios, type Usuario } from '../datos/usuarios';
import { CampoCantidad, CampoPesos, copiarTexto, Desplegable, errorATexto, fechaCorta, hora, ICONO_MEDIO, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { leerGuardado, LLAVE_CARRITO, LLAVE_ESPERA, resumenEspera, useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño, usePedirDueño } from '../ui/permisos';
import { useSesion } from '../ui/sesion';
import { DevolverVenta } from './Devolver';

interface Resultado {
  /** null: se cerró sin contar. */
  diferencia: number | null;
  contado: number | null;
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
              const dif = t.contado === null ? null : t.contado - (t.esperado ?? 0);
              return (
                <li key={t.id} className={abierto === t.id ? 'historial-abierto' : ''}>
                  <button type="button" className="historial-fila" aria-expanded={abierto === t.id} onClick={() => setAbierto(abierto === t.id ? null : t.id!)}>
                    <span>
                      {fechaCorta(t.apertura)} a {hora(t.cierre!)} · {t.cajero}
                      {t.nota && <small className="texto-suave"> · {t.nota}</small>}
                    </span>
                    {dueño ? (
                      <span className={`importe ${dif === null ? 'texto-suave' : dif < 0 ? 'texto-alerta' : dif > 0 ? 'texto-aviso' : ''}`}>
                        {dif === null ? 'Sin contar' : dif === 0 ? 'Justo' : dif < 0 ? `Faltaron ${formatPesos(-dif)}` : `Sobraron ${formatPesos(dif)}`}
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
      <BuscarVentas />
    </div>
  );
}

// Encontrar una venta de cualquier día por producto o por importe exacto (ticket, devolución).
function BuscarVentas() {
  const [q, setQ] = useState('');
  // Se busca recién cuando se deja de tipear un momento: recorre las ventas de la más nueva a la más vieja.
  const [t, setT] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setT(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);
  const resultados = useConsulta(
    async () => {
      if (t.length < 2) return [] as Venta[];
      const monto = /^\$?\s*[\d.]+$/.test(t) ? Number(t.replace(/\D/g, '')) : 0;
      const nq = normalizarTexto(t);
      const encontradas: Venta[] = [];
      // De la más nueva a la más vieja; con las últimas 30 que coinciden alcanza.
      await db.ventas
        .orderBy('fecha')
        .reverse()
        .until(() => encontradas.length >= 30)
        .each((v) => {
          if (monto > 0 ? v.total === monto : v.items.some((i) => normalizarTexto(i.nombre).includes(nq))) encontradas.push(v);
        });
      return encontradas;
    },
    [t],
    [] as Venta[],
  );
  return (
    <section className="tarjeta historial buscar-ventas">
      <h2 className="titulo-chico">Buscar una venta</h2>
      <p className="texto-suave">Por producto o por importe exacto, de cualquier día: para reimprimir el ticket o devolver algo.</p>
      <div className="buscador-campo buscador-chico">
        <Icono nombre="buscar" tam={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: coca o 3450" aria-label="Buscar una venta" />
      </div>
      {t.length >= 2 && (resultados.length === 0 ? <p className="texto-suave">No encontré ventas con «{t}».</p> : <VentasDelTurno ventas={resultados} soloDevolver conFecha />)}
    </section>
  );
}

// Ventas que quedaron armadas en la caja sin cobrar (el navegador las guarda aunque se cambie de pantalla).
function ventasSinCobrar(): string | null {
  const espera = resumenEspera(leerGuardado<unknown>(LLAVE_ESPERA, []));
  const guardado = leerGuardado<Partial<Carrito>>(LLAVE_CARRITO, carritoVacio);
  const carrito: Carrito = Array.isArray(guardado?.items)
    ? { items: guardado.items, ...(typeof guardado.descuento === 'number' ? { descuento: guardado.descuento } : {}) }
    : carritoVacio;
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

function CierreAbierto({ datos, onCerrado, irACaja }: { datos: Datos; onCerrado: (r: Resultado | null) => void; irACaja: () => void }) {
  const avisar = useAvisar();
  const { turno, ventas, movimientos, resumen } = datos;
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [nota, setNota] = useState('');
  const [movimiento, setMovimiento] = useState(false);
  const [pasar, setPasar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  // Para "pasarle la caja a otro" hace falta que haya otra persona cargada.
  const usuarios = useConsulta(() => leerUsuarios(db), [], [] as Usuario[]);
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

  // La confirmación se apaga sola a los 6 s y en cuanto se toca el conteo: si corrige un billete, no queda el "Sí, cerrar" prendido.
  useEffect(() => {
    if (!confirmar) return;
    const t = window.setTimeout(() => setConfirmar(false), 6000);
    return () => window.clearTimeout(t);
  }, [confirmar]);
  useEffect(() => setConfirmar(false), [conteo]);

  const cerrar = () => {
    if (!confirmar) {
      setConfirmar(true);
      return;
    }
    unaVez(async () => {
    try {
      onCerrado({
        diferencia: contoAlgo ? diferencia : null,
        contado: contoAlgo ? contado : null,
        esperado: resumen.efectivoEsperado,
        vendido: resumen.vendidoNeto,
        ventas: resumen.cantidadVentas,
        texto: textoCierre({ ...turno, cierre: Date.now() }, resumen, contoAlgo ? contado : null),
      });
      await cerrarTurno(db, conteo, nota, sesion?.usuario);
    } catch (e) {
      // El resultado se había mostrado por adelantado para que no parpadee "caja cerrada"; si falló, se saca.
      onCerrado(null);
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
    });
  };

  return (
    <>
      <div className="pagina-cabecera">
        <div>
          <h1>
            Cierre de caja <BotonAyuda tema="cerrar" que="cómo cerrar la caja" />
          </h1>
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
              {/* Cierre a ciegas: el empleado no ve las cuentas (con ellas se saca lo que debería haber). */}
              {dueño ? (
                <>
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
                </>
              ) : (
                <p className="texto-suave">Contá los billetes y monedas de la caja y anotalos abajo. El dueño ve si coincide con lo vendido.</p>
              )}
              {dueño && (
                <div className="cuentas-total">
                  <dt>Debería haber</dt>
                  <dd className={`importe ${resumen.efectivoEsperado < 0 ? 'texto-alerta' : ''}`}>{formatPesos(resumen.efectivoEsperado)}</dd>
                </div>
              )}
              {dueño && resumen.efectivoEsperado < 0 && (
                <p className="texto-alerta">Salió más plata de la que entró: revisá los retiros y gastos anotados, alguno puede estar de más.</p>
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

          <ControlMercadoPago turno={turno} ventas={ventas} resumen={resumen} />
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
                  <CampoCantidad
                    valor={conteo[String(d)] || 0}
                    vacioEnCero
                    onCambio={(n) => setConteo((c) => ({ ...c, [String(d)]: n }))}
                    ariaLabel={`Cantidad de billetes de ${formatPesos(d)}`}
                  />
                  {conteo[String(d)] ? <span className="importe texto-suave">{formatPesos(d * conteo[String(d)]!)}</span> : <span className="billete-vacio">—</span>}
                </label>
              ))}
              <div className="billete">
                <span>Monedas</span>
                <CampoPesos valor={conteo['monedas'] || null} onCambio={(v) => setConteo({ ...conteo, monedas: Math.max(0, v ?? 0) })} ariaLabel="Monedas y otros" maximo={1_000_000} />
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
                {diferencia !== 0 && <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo de la diferencia" />}
              </div>
            )}
            <button type="button" className={`boton boton-grande ${confirmar ? 'boton-peligro' : 'boton-primario'}`} onClick={cerrar} disabled={cerrando}>
              {textoCerrar}
            </button>
            <button type="button" className="boton boton-texto boton-retiro" onClick={() => setMovimiento(true)}>
              <Icono nombre="billetera" tam={16} /> Anotar un retiro o gasto
            </button>
            {usuarios.some((u) => u.usuario !== sesion?.usuario) && (
              <button type="button" className="boton boton-texto boton-retiro" onClick={() => setPasar(true)} title="Cambio de turno: se cierra esta caja y se abre la siguiente con lo contado">
                <Icono nombre="usuario" tam={16} /> Cerrar y pasarle la caja a otro
              </button>
            )}
          </div>
          {/* En el celular el pie de arriba no puede quedar pegado (son cinco cosas): esta barra sí, como la de cobro. */}
          <div className="cierre-pie-movil" role="status">
            <div>
              <small>{confirmar && textoCerrar.endsWith('?') ? textoCerrar : contoAlgo && dueño ?(diferencia === 0 ? 'Da justo' : diferencia < 0 ? `Faltan ${formatPesos(-diferencia)}` : `Sobran ${formatPesos(diferencia)}`) : 'Contaste'}</small>
              <strong className="importe">{formatPesos(contado)}</strong>
            </div>
            <button type="button" className={`boton ${confirmar ? 'boton-peligro' : 'boton-primario'}`} onClick={cerrar} disabled={cerrando}>
              {confirmar ? 'Sí, cerrar' : 'Cerrar turno'}
            </button>
          </div>
        </aside>
      </div>
      {movimiento && <NuevoMovimiento onCerrar={() => setMovimiento(false)} />}
      {pasar && (
        <PasarCaja
          turno={turno}
          usuarios={usuarios}
          conteo={conteo}
          nota={nota}
          contado={contoAlgo ? contado : null}
          esperado={resumen.efectivoEsperado}
          sinCobrar={sinCobrar}
          onCerrar={() => setPasar(false)}
          onHecho={irACaja}
        />
      )}
    </>
  );
}

/**
 * Cambio de turno en un paso: se cierra la caja con lo contado y se abre la siguiente enseguida, con ese mismo
 * efectivo como cambio y a nombre de quien sigue, sin volver a tipear nada.
 */
function PasarCaja({
  turno,
  usuarios,
  conteo,
  nota,
  contado,
  esperado,
  sinCobrar,
  onCerrar,
  onHecho,
}: {
  turno: Turno;
  usuarios: Usuario[];
  conteo: Record<string, number>;
  nota: string;
  contado: number | null;
  esperado: number;
  sinCobrar: string | null;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const avisar = useAvisar();
  const { sesion, cambiar } = useSesion();
  const dueño = useEsDueño();
  const otros = usuarios.filter((u) => u.usuario !== sesion?.usuario);
  const [quien, setQuien] = useState(otros[0]?.usuario ?? '');
  // El empleado cuenta a ciegas: si no contó, el cambio de la caja nueva es lo que debería haber, pero no se le muestra.
  const aCiegas = !dueño && contado === null;
  // Arranca con lo que quedó en la caja: lo contado o, sin conteo, lo que debería haber.
  const [fondo, setFondo] = useState<number | null>(Math.max(0, contado ?? esperado));
  // Con ventas sin cobrar se pide un segundo toque, igual que al cerrar.
  const [confirmar, setConfirmar] = useState(false);
  const [enCurso, unaVez] = useUnaVez();
  const elegido = usuarios.find((u) => u.usuario === quien);
  return (
    <Modal titulo="Pasar la caja" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (!elegido) return;
          if (sinCobrar && !confirmar) {
            setConfirmar(true);
            return;
          }
          unaVez(async () => {
            try {
              const arranca = aCiegas ? Math.max(0, esperado) : (fondo ?? 0);
              const cerrado = await pasarTurno(db, conteo, nota, sesion?.usuario, elegido, arranca);
              const dif = cerrado.contado !== null && cerrado.esperado !== null ? cerrado.contado - cerrado.esperado : null;
              // La diferencia sólo se le dice al dueño: el empleado cuenta a ciegas.
              const comoCerro = dif === null ? ' sin contar' : !dueño ? '' : dif === 0 ? ' (dio justo)' : dif > 0 ? ` (sobraron ${formatPesos(dif)})` : ` (faltaron ${formatPesos(-dif)})`;
              avisar({
                texto: `Caja de ${turno.cajero} cerrada${comoCerro}. Abierta para ${elegido.nombre}${aCiegas ? '' : ` con ${formatPesos(arranca)}`}: que entre con su clave.`,
                tipo: 'ok',
              });
              // La última venta era del turno que se cerró: no es de quien sigue.
              try {
                localStorage.removeItem('milenio.ultima');
              } catch {
                /* nada */
              }
              onCerrar();
              onHecho();
              // La caja nueva es de quien sigue: entra con su usuario (ya escrito) para que las ventas queden a su nombre.
              cambiar(elegido.usuario);
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <p className="texto-suave">
          Se cierra la caja de {turno.cajero} {contado === null ? 'sin contar' : `con los ${formatPesos(contado)} contados`} y se abre una nueva enseguida
          {aCiegas ? ', con el cambio que tendría que haber quedado' : ', sin volver a tipear el cambio'}. Después entra {elegido ? elegido.nombre : 'quien sigue'} con su clave.
        </p>
        {sinCobrar && (
          <p className="texto-alerta" role="alert">
            <strong>{sinCobrar}</strong> Si pasás la caja igual, se cobran en la caja de {elegido?.nombre ?? 'quien sigue'}.
          </p>
        )}
        <label className="campo">
          <span className="campo-etiqueta">¿Quién sigue?</span>
          <select value={quien} onChange={(e) => setQuien(e.target.value)}>
            {otros.map((u) => (
              <option key={u.usuario} value={u.usuario}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
        {!aCiegas && <CampoPesos etiqueta="Cambio con el que arranca" valor={fondo} onCambio={setFondo} grande />}
        <button
          type="submit"
          className={`boton boton-grande ${confirmar ? 'boton-peligro' : 'boton-primario'}`}
          disabled={!elegido || enCurso || (!aCiegas && (fondo === null || fondo < 0))}
        >
          {confirmar ? `Sí, cerrar igual y abrir para ${elegido?.nombre ?? ''}` : elegido ? `Cerrar y abrir para ${elegido.nombre}` : 'Cerrar y abrir'}
        </button>
      </form>
    </Modal>
  );
}

function ResultadoCierre({ r, irACaja }: { r: Resultado; irACaja: () => void }) {
  const avisar = useAvisar();
  const tono = r.diferencia === null ? 'sin-contar' : r.diferencia === 0 ? 'justo' : r.diferencia < 0 ? 'falta' : 'sobra';
  return (
    <section className={`tarjeta resultado-cierre resultado-${tono}`}>
      <span className="resultado-icono">
        <Icono nombre={r.diferencia === 0 || r.diferencia === null ? 'check' : 'alerta'} tam={30} />
      </span>
      <h1>
        {r.diferencia === null ? 'Caja cerrada sin contar' : r.diferencia === 0 ? 'Caja cerrada: dio justo' : r.diferencia < 0 ? `Faltaron ${formatPesos(-r.diferencia)}` : `Sobraron ${formatPesos(r.diferencia)}`}
      </h1>
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
          <dd className="importe">{r.contado === null ? 'Sin contar' : formatPesos(r.contado)}</dd>
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

function VentasDelTurno({ ventas, soloDevolver = false, conFecha = false }: { ventas: Venta[]; soloDevolver?: boolean; conFecha?: boolean }) {
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
                  <strong>{conFecha ? fechaCorta(v.fecha) : hora(v.fecha)}</strong> · {pagosDeVenta(v).map((p) => (p.medio === 'fiado' && cliente ? `Fiado a ${cliente}` : nombreMedio(p.medio))).join(' + ')}
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
  const dueño = useEsDueño();
  // Lo que debería haber en la caja ahora: sacar más que eso casi siempre es un cero de más.
  const enCaja = useConsulta(
    async () => {
      const t = await turnoAbierto(db);
      return t ? (await resumenDeTurno(db, t)).resumen.efectivoEsperado : null;
    },
    [],
    null as number | null,
  );
  const [confirmarPasado, setConfirmarPasado] = useState(false);
  const sePasa = tipo !== 'ingreso' && enCaja !== null && monto !== null && monto > enCaja;
  useEffect(() => setConfirmarPasado(false), [monto, tipo]);
  return (
    <Modal titulo="Retiro, gasto o ingreso" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (sePasa && !confirmarPasado) {
            setConfirmarPasado(true);
            return;
          }
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
        {sePasa && (
          <p className="texto-alerta" role="alert">
            {dueño ? `En la caja debería haber ${formatPesos(Math.max(0, enCaja))}: con eso queda en negativo.` : 'Es más de lo que hay en la caja.'} Si está bien, anotalo igual.
          </p>
        )}
        <button type="submit" className={`boton boton-grande ${sePasa && confirmarPasado ? 'boton-peligro' : 'boton-primario'}`} disabled={!monto || monto <= 0 || enCurso}>
          {sePasa && confirmarPasado ? 'Sí, anotar igual' : sePasa ? '¿Anotar igual?' : 'Anotar'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Lo cobrado por Mercado Pago contra lo que dice la app: el efectivo se cuenta, Mercado Pago se compara.
 * No se guarda: es una cuenta para hacer en el momento, con la app abierta en el celular.
 */
function ControlMercadoPago({ turno, ventas, resumen }: { turno: Turno; ventas: Venta[]; resumen: ResumenTurno }) {
  const [enLaApp, setEnLaApp] = useState<number | null>(null);
  const [verCobros, setVerCobros] = useState(false);
  const cobros = cobrosDeMedio(ventas, 'mercadopago');
  const deFiado = resumen.cobrosFiado.mercadopago;
  const anotado = resumen.porMedio.mercadopago + deFiado;
  if (anotado === 0) return null;
  const resultado = enLaApp === null ? null : diferenciaConApp(anotado, enLaApp);
  return (
    <section className="tarjeta control-mp">
      <h2 className="titulo-chico">
        <Icono nombre={ICONO_MEDIO.mercadopago} tam={20} /> Controlar Mercado Pago
      </h2>
      <p className="texto-suave">
        En este turno se anotaron <strong className="texto-normal importe">{formatPesos(anotado)}</strong> por Mercado Pago ({cobros.length}{' '}
        {cobros.length === 1 ? 'cobro' : 'cobros'}
        {deFiado > 0 && ` y ${formatPesos(deFiado)} de fiado cobrado`}). En la app, mirá la actividad de hoy desde las {hora(turno.apertura)} y poné el total.
      </p>
      <CampoPesos etiqueta="¿Cuánto dice la app de Mercado Pago?" valor={enLaApp} onCambio={setEnLaApp} maximo={50_000_000} />
      {resultado && (
        <p className={`control-mp-resultado ${resultado.diferencia === 0 ? 'control-mp-justo' : 'control-mp-distinto'}`} role="status">
          <Icono nombre={resultado.diferencia === 0 ? 'check' : 'alerta'} tam={18} />
          <span>
            {resultado.diferencia !== 0 && (
              <strong>
                {resultado.diferencia > 0 ? `Hay ${formatPesos(resultado.diferencia)} de más en la app. ` : `Faltan ${formatPesos(-resultado.diferencia)} en la app. `}
              </strong>
            )}
            {resultado.texto}
          </span>
        </p>
      )}
      {cobros.length > 0 && (
        <>
          <Desplegable abierto={verCobros} titulo="Los cobros uno por uno" texto={verCobros ? 'Ocultar' : 'Ver'} onClick={() => setVerCobros(!verCobros)} />
          {verCobros && (
            <ul className="movimientos">
              {cobros.map((c, i) => (
                <li key={`${c.ventaId}-${i}`}>
                  <span>
                    {hora(c.fecha)}
                    {c.dividido ? ' · parte de un pago dividido' : ''}
                  </span>
                  <span className="importe">{formatPesos(c.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
