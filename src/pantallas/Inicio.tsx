import { useMemo, useState } from 'react';
import { esGastoDelLocal, resumirTurno } from '../dominio/caja';
import { totalNeto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { saldoCliente } from '../dominio/fiado';
import { paraReponer, porVencer, resumirVentas } from '../dominio/reportes';
import type { Evento, MovimientoCaja, Producto, Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { cajasDeOtrosEquipos, leerAjuste, turnoAbierto } from '../datos/operaciones';
import { hora, Icono, sinCortes } from '../ui/componentes';
import { useConsulta, useEstadoNube } from '../ui/hooks';
import { AVISO_SIN_ACTIVAR } from '../datos/nube';
import { useSesion } from '../ui/sesion';

// Panel del dueño: en una mirada, cómo viene el día y qué hay que atender.

const DIA = 86_400_000;

function inicioDelDia(offset = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

function saludo(): string {
  const h = new Date().getHours();
  return h >= 6 && h < 13 ? 'Buen día' : h >= 13 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

function fechaLarga(): string {
  const t = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function variacion(hoy: number, antes: number): { texto: string; tono: 'sube' | 'baja' | 'igual' } | null {
  if (antes <= 0) return null;
  const pct = Math.round(((hoy - antes) / antes) * 100);
  if (pct === 0) return { texto: 'igual', tono: 'igual' };
  return { texto: `${pct > 0 ? '+' : ''}${pct}%`, tono: pct > 0 ? 'sube' : 'baja' };
}

export function PantallaInicio({ ir }: { ir: (id: 'caja' | 'productos' | 'cierre' | 'clientes' | 'reportes' | 'ajustes') => void }) {
  const { sesion } = useSesion();
  const hace7 = inicioDelDia(-6);
  const ventas = useConsulta(() => db.ventas.where('fecha').aboveOrEqual(inicioDelDia(-7)).toArray(), [], [] as Venta[]);
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const gastosHoy = useConsulta(
    async () =>
      (await db.movimientosCaja.filter((m: MovimientoCaja) => m.fecha >= inicioDelDia() && esGastoDelLocal(m)).toArray())
        .reduce((s, m) => s + m.monto, 0),
    [],
    0,
  );
  // Control del dueño: ventas que se armaron y se cancelaron antes de cobrar.
  const canceladas = useConsulta(
    async () => {
      const evs = (await db.eventos.where('fecha').aboveOrEqual(inicioDelDia()).toArray()).filter((e: Evento) => e.tipo === 'cancelacion');
      const porUsuario = new Map<string, number>();
      for (const e of evs) porUsuario.set(e.usuario ?? 'sin usuario', (porUsuario.get(e.usuario ?? 'sin usuario') ?? 0) + 1);
      return {
        cantidad: evs.length,
        monto: evs.reduce((s, e) => s + e.monto, 0),
        porUsuario: [...porUsuario.entries()].sort((a, b) => b[1] - a[1]),
        lista: evs.sort((a, b) => b.fecha - a.fecha),
      };
    },
    [],
    { cantidad: 0, monto: 0, porUsuario: [] as [string, number][], lista: [] as Evento[] },
  );
  const [verCanceladas, setVerCanceladas] = useState(false);
  // La nube que no sube es una advertencia de perder datos: va en "Para atender", no sólo en el chip del menú.
  const nube = useEstadoNube();
  // Sin copia en la nube, que no pasen más de 7 días sin bajar una copia (si ya hubo algún turno).
  const copia = useConsulta<{ dias: number | null } | null>(
    async () => {
      const [ultima, claveNube, turnos] = await Promise.all([leerAjuste<number | null>(db, 'ultimaCopia', null), leerAjuste<string>(db, 'nube.clave', ''), db.turnos.count()]);
      if (claveNube || turnos === 0) return null;
      const dias = ultima ? Math.floor((Date.now() - ultima) / DIA) : null;
      return dias === null || dias > 7 ? { dias } : null;
    },
    [],
    null,
  );
  // Productos abre ya filtrado con lo que se tocó acá.
  const irAProductos = (filtro: 'reponer' | 'vencen') => {
    try {
      sessionStorage.setItem('milenio.filtroProductos', filtro);
    } catch {
      /* sin sessionStorage igual abre Productos */
    }
    ir('productos');
  };
  // Plata devuelta hoy, aunque la venta sea de otro día (se descuenta del día de esa venta).
  const devueltoHoy = useConsulta(
    async () =>
      (await db.eventos.where('fecha').aboveOrEqual(inicioDelDia()).toArray()).filter((e: Evento) => e.tipo === 'devolucion').reduce((s, e) => s + e.monto, 0),
    [],
    0,
  );
  const caja = useConsulta(
    async () => {
      // La de este equipo; si no tiene, la que está abierta en otro (el dueño mira la PC desde el celular).
      const propia = await turnoAbierto(db);
      const t = propia ?? (await cajasDeOtrosEquipos(db)).sort((a, b) => b.apertura - a.apertura)[0];
      if (!t) return null;
      const [vs, movs, pagos] = await Promise.all([
        db.ventas.where('turnoId').equals(t.id!).toArray(),
        db.movimientosCaja.where('turnoId').equals(t.id!).toArray(),
        db.movimientosFiado.where('turnoId').equals(t.id!).toArray(),
      ]);
      return { turno: t, ajena: !propia, resumen: resumirTurno(t.fondoInicial, vs, movs, pagos) };
    },
    [],
    null,
  );
  const fiado = useConsulta(
    async () => {
      const movs = await db.movimientosFiado.toArray();
      const porCliente = new Map<number, typeof movs>();
      for (const m of movs) {
        let lista = porCliente.get(m.clienteId);
        if (!lista) porCliente.set(m.clienteId, (lista = []));
        lista.push(m);
      }
      let total = 0;
      let deudores = 0;
      for (const lista of porCliente.values()) {
        const s = saldoCliente(lista);
        if (s > 0) {
          total += s;
          deudores++;
        }
      }
      return { total, deudores };
    },
    [],
    { total: 0, deudores: 0 },
  );

  const hoy = inicioDelDia();
  const r = useMemo(() => resumirVentas(ventas.filter((v) => v.fecha >= hoy)), [ventas, hoy]);
  const ayer = useMemo(() => {
    // Ayer hasta esta misma hora, para comparar parejo.
    const corte = Date.now() - DIA;
    return resumirVentas(ventas.filter((v) => v.fecha >= hoy - DIA && v.fecha < corte));
  }, [ventas, hoy]);
  const dias = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const desde = hace7 + i * DIA;
      const total = ventas.filter((v) => !v.anulada && v.fecha >= desde && v.fecha < desde + DIA).reduce((s, v) => s + totalNeto(v), 0);
      const fecha = new Date(desde);
      return { total, etiqueta: i === 6 ? 'Hoy' : fecha.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', ''), hoy: i === 6 };
    });
  }, [ventas, hace7]);
  const maxDia = Math.max(...dias.map((d) => d.total), 1);
  const semanaVacia = dias.every((d) => d.total === 0);
  const reponer = useMemo(() => paraReponer(productos), [productos]);
  const vencen = useMemo(() => porVencer(productos, 15), [productos]);
  const cambio = variacion(r.total, ayer.total);
  const top = r.productos.slice(0, 5);
  const maxTop = Math.max(...top.map((p) => p.total), 1);

  return (
    <div className="pagina inicio">
      <div className="inicio-cabecera">
        <div>
          <p className="texto-suave">
            {saludo()}
            {sesion ? `, ${sesion.nombre.split(' ')[0]}` : ''}. {fechaLarga()}
          </p>
          <h1 className="inicio-total">
            <span className="importe">{formatPesos(r.total)}</span>
            <small>vendido hoy</small>
          </h1>
          {cambio && (
            <p className={`variacion variacion-${cambio.tono}`}>
              <Icono nombre={cambio.tono === 'baja' ? 'baja' : 'sube'} tam={16} /> {cambio.texto} contra ayer a esta hora
            </p>
          )}
        </div>
        <button type="button" className="boton boton-primario solo-pc" onClick={() => ir('caja')}>
          <Icono nombre="caja" tam={18} /> Ir a la caja
        </button>
      </div>

      <div className="indicadores indicadores-4">
        <div className="tarjeta indicador">
          <span>Ventas</span>
          <strong className="importe">{r.cantidad}</strong>
          <small className="texto-suave">Ticket promedio {formatPesos(r.promedio)}</small>
        </div>
        <div className="tarjeta indicador">
          <span>Ganancia estimada</span>
          <strong className="importe texto-positivo">{formatPesos(r.ganancia)}</strong>
          <small className="texto-suave">{r.ventasSinCosto > 0 ? `${formatPesos(r.ventasSinCosto)} vendidos sin costo cargado` : 'Con el costo de cada producto'}</small>
        </div>
        <div className="tarjeta indicador">
          <span>Gastos de hoy</span>
          <strong className="importe">{formatPesos(gastosHoy)}</strong>
          <small className="texto-suave">Sin contar mercadería</small>
        </div>
        <div className="tarjeta indicador">
          <span>Fiado sin cobrar</span>
          <strong className="importe">{formatPesos(fiado.total)}</strong>
          <small className="texto-suave">{fiado.deudores === 0 ? 'Nadie debe' : fiado.deudores === 1 ? '1 cliente debe' : `${fiado.deudores} clientes deben`}</small>
        </div>
      </div>

      <div className="inicio-grilla">
        <section className="tarjeta">
          <div className="seccion-cabecera">
            <h2 className="titulo-chico">Últimos 7 días</h2>
            <button type="button" className="boton boton-chico" onClick={() => ir('reportes')}>
              Ver reportes
            </button>
          </div>
          {semanaVacia ? (
            // Sin ventas, siete rayitas grises no dicen nada: un estado vacío como el de la caja.
            <div className="semana-vacia">
              <span className="vacio-icono">
                <Icono nombre="reportes" tam={26} />
              </span>
              <p className="vacio-titulo">Cuando vendas, acá ves la semana</p>
              <p className="texto-suave">Las ventas de cada día, para comparar con la anterior.</p>
            </div>
          ) : (
            <ol className="semana" aria-label="Ventas por día">
              {dias.map((d) => (
                <li key={d.etiqueta + d.total} className={d.hoy ? 'semana-hoy' : ''}>
                  <span className="semana-monto importe">{d.total > 0 ? formatPesos(d.total) : ''}</span>
                  <span className="semana-barra" style={{ height: `${Math.max(2, (d.total / maxDia) * 100)}%` }} />
                  <span className="semana-dia">{d.etiqueta}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-chico">La caja ahora</h2>
          {caja ? (
            <dl className="cuentas">
              <div>
                <dt>Abierta por</dt>
                <dd>
                  {caja.turno.cajero} a las {hora(caja.turno.apertura)}
                  {caja.ajena && <span className="texto-suave"> · en otro equipo</span>}
                </dd>
              </div>
              <div>
                <dt>Ventas del turno</dt>
                <dd className="importe">{formatPesos(caja.resumen.vendidoNeto)}</dd>
              </div>
              {caja.resumen.devuelto > 0 && (
                <div>
                  <dt className="texto-suave">Ya descontados {formatPesos(caja.resumen.devuelto)} devueltos</dt>
                  <dd />
                </div>
              )}
              <div className="cuentas-total">
                <dt>Efectivo que debería haber</dt>
                <dd className="importe">{formatPesos(caja.resumen.efectivoEsperado)}</dd>
              </div>
            </dl>
          ) : (
            <p className="texto-suave inicio-vacio">La caja está cerrada.</p>
          )}
          <button type="button" className="boton boton-chico inicio-accion" onClick={() => ir(caja && !caja.ajena ? 'cierre' : 'caja')}>
            {caja && !caja.ajena ? 'Ir al cierre' : 'Abrir la caja'}
          </button>
        </section>

        <section className="tarjeta">
          <h2 className="titulo-chico">Lo que más salió hoy</h2>
          {top.length === 0 ? (
            <p className="texto-suave inicio-vacio">Todavía no hay ventas hoy.</p>
          ) : (
            <ol className="top">
              {top.map((p) => (
                <li key={p.clave}>
                  <span className="top-nombre">{sinCortes(p.nombre)}</span>
                  <span className="top-barra">
                    <span style={{ width: `${(p.total / maxTop) * 100}%` }} />
                  </span>
                  <span className="importe">{formatPesos(p.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-chico">Para atender</h2>
          <ul className="alertas">
            <li>
              <button type="button" onClick={() => irAProductos('reponer')} disabled={reponer.length === 0}>
                <span className={`alerta-icono ${reponer.length ? 'alerta-aviso' : 'alerta-ok'}`}>
                  <Icono nombre={reponer.length ? 'alerta' : 'check'} tam={18} />
                </span>
                <span>
                  <strong>{reponer.length ? `${reponer.length} ${reponer.length === 1 ? 'producto' : 'productos'} para reponer` : 'Stock al día'}</strong>
                  {reponer.length > 0 && <small>{reponer.slice(0, 3).map((p) => p.nombre).join(', ')}</small>}
                </span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => irAProductos('vencen')} disabled={vencen.length === 0}>
                <span className={`alerta-icono ${vencen.length ? 'alerta-peligro' : 'alerta-ok'}`}>
                  <Icono nombre={vencen.length ? 'vence' : 'check'} tam={18} />
                </span>
                <span>
                  <strong>{vencen.length ? `${vencen.length} por vencer en 15 días` : 'Nada por vencer'}</strong>
                  {vencen.length > 0 && (
                    <small>
                      {vencen
                        .slice(0, 3)
                        .map((p) => `${p.nombre} (${p.faltan < 0 ? 'vencido' : p.faltan === 0 ? 'hoy' : `${p.faltan} d`})`)
                        .join(', ')}
                    </small>
                  )}
                </span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => ir('clientes')} disabled={fiado.deudores === 0}>
                <span className={`alerta-icono ${fiado.deudores ? 'alerta-aviso' : 'alerta-ok'}`}>
                  <Icono nombre={fiado.deudores ? 'clientes' : 'check'} tam={18} />
                </span>
                <span>
                  <strong>{fiado.deudores ? `Cobrar fiado: ${formatPesos(fiado.total)}` : 'Nadie debe fiado'}</strong>
                  {fiado.deudores > 0 && <small>Mandales el saldo por WhatsApp desde Clientes</small>}
                </span>
              </button>
            </li>
            {canceladas.cantidad > 0 && (
              <li>
                <button type="button" onClick={() => setVerCanceladas((v) => !v)} aria-expanded={verCanceladas}>
                  <span className={`alerta-icono ${canceladas.cantidad >= 3 ? 'alerta-aviso' : 'alerta-neutra'}`}>
                    <Icono nombre="deshacer" tam={18} />
                  </span>
                  <span>
                    <strong>
                      {canceladas.cantidad} {canceladas.cantidad === 1 ? 'venta cancelada' : 'ventas canceladas'} antes de cobrar
                    </strong>
                    <small>
                      {[
                        `${formatPesos(canceladas.monto)} sin cobrar`,
                        canceladas.porUsuario.length > 1 && canceladas.porUsuario.map(([u, c]) => `${u}: ${c}`).join(', '),
                        verCanceladas ? 'Ocultar' : 'Ver cuáles',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </button>
                {verCanceladas && (
                  <ul className="canceladas-detalle">
                    {canceladas.lista.map((e) => (
                      <li key={e.id}>
                        <span>
                          {hora(e.fecha)}
                          {e.usuario && ` · ${e.usuario}`}
                        </span>
                        <span className="canceladas-detalle-items">{e.detalle || 'sin detalle'}</span>
                        <span className="importe">{formatPesos(e.monto)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
            {nube.aviso && (
              <li>
                <button type="button" onClick={() => ir('ajustes')}>
                  <span className="alerta-icono alerta-aviso">
                    <Icono nombre="nube-no" tam={18} />
                  </span>
                  <span>
                    <strong>{nube.aviso === AVISO_SIN_ACTIVAR ? 'La copia en la nube no está activada en este equipo' : 'La copia en la nube no se está subiendo'}</strong>
                    <small>{nube.aviso} Revisalo en Ajustes</small>
                  </span>
                </button>
              </li>
            )}
            {copia && (
              <li>
                <button type="button" onClick={() => ir('ajustes')}>
                  <span className="alerta-icono alerta-aviso">
                    <Icono nombre="descargar" tam={18} />
                  </span>
                  <span>
                    <strong>{copia.dias === null ? 'Todavía no bajaste ninguna copia de seguridad' : `Hace ${copia.dias} días que no bajás una copia de seguridad`}</strong>
                    <small>Si la compu se rompe, con la copia recuperás todo. Se descarga desde Ajustes</small>
                  </span>
                </button>
              </li>
            )}
            {devueltoHoy > 0 && (
              <li>
                <button type="button" onClick={() => ir('cierre')}>
                  <span className="alerta-icono alerta-neutra">
                    <Icono nombre="devolver" tam={18} />
                  </span>
                  <span>
                    <strong>Devoluciones de hoy: {formatPesos(devueltoHoy)}</strong>
                    <small>Se descuentan del día en que se hizo cada venta. El detalle está en el cierre</small>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
