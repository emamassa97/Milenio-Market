import { useMemo } from 'react';
import { resumirTurno } from '../dominio/caja';
import { formatPesos } from '../dominio/dinero';
import { saldoCliente } from '../dominio/fiado';
import { paraReponer, porVencer, resumirVentas } from '../dominio/reportes';
import type { MovimientoCaja, Producto, Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { turnoAbierto } from '../datos/operaciones';
import { hora, Icono } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
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
  return h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

function variacion(hoy: number, antes: number): { texto: string; tono: 'sube' | 'baja' | 'igual' } | null {
  if (antes <= 0) return null;
  const pct = Math.round(((hoy - antes) / antes) * 100);
  if (pct === 0) return { texto: 'igual', tono: 'igual' };
  return { texto: `${pct > 0 ? '+' : ''}${pct}%`, tono: pct > 0 ? 'sube' : 'baja' };
}

export function PantallaInicio({ ir }: { ir: (id: 'caja' | 'productos' | 'cierre' | 'clientes' | 'reportes') => void }) {
  const { sesion } = useSesion();
  const hace7 = inicioDelDia(-6);
  const ventas = useConsulta(() => db.ventas.where('fecha').aboveOrEqual(inicioDelDia(-7)).toArray(), [], [] as Venta[]);
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const gastosHoy = useConsulta(
    async () =>
      (await db.movimientosCaja.filter((m: MovimientoCaja) => m.fecha >= inicioDelDia() && m.tipo === 'gasto' && !m.motivo.startsWith('Mercadería')).toArray())
        .reduce((s, m) => s + m.monto, 0),
    [],
    0,
  );
  const caja = useConsulta(
    async () => {
      const t = await turnoAbierto(db);
      if (!t) return null;
      const [vs, movs, pagos] = await Promise.all([
        db.ventas.where('turnoId').equals(t.id!).toArray(),
        db.movimientosCaja.where('turnoId').equals(t.id!).toArray(),
        db.movimientosFiado.where('turnoId').equals(t.id!).toArray(),
      ]);
      return { turno: t, resumen: resumirTurno(t.fondoInicial, vs, movs, pagos) };
    },
    [],
    null,
  );
  const fiado = useConsulta(
    async () => {
      const movs = await db.movimientosFiado.toArray();
      const porCliente = new Map<number, typeof movs>();
      for (const m of movs) porCliente.set(m.clienteId, [...(porCliente.get(m.clienteId) ?? []), m]);
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
      const total = ventas.filter((v) => !v.anulada && v.fecha >= desde && v.fecha < desde + DIA).reduce((s, v) => s + v.total, 0);
      const fecha = new Date(desde);
      return { total, etiqueta: i === 6 ? 'Hoy' : fecha.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', ''), hoy: i === 6 };
    });
  }, [ventas, hace7]);
  const maxDia = Math.max(...dias.map((d) => d.total), 1);
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
            {sesion ? `, ${sesion.nombre.split(' ')[0]}` : ''}. {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
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
        <button type="button" className="boton boton-primario" onClick={() => ir('caja')}>
          <Icono nombre="caja" tam={18} /> Ir a la caja
        </button>
      </div>

      <div className="indicadores">
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
          <strong className="importe texto-alerta">{formatPesos(fiado.total)}</strong>
          <small className="texto-suave">
            {fiado.deudores} {fiado.deudores === 1 ? 'cliente debe' : 'clientes deben'}
          </small>
        </div>
      </div>

      <div className="inicio-grilla">
        <section className="tarjeta">
          <div className="seccion-cabecera">
            <h2 className="titulo-chico">Últimos 7 días</h2>
            <button type="button" className="enlace texto-suave" onClick={() => ir('reportes')}>
              Ver reportes
            </button>
          </div>
          <ol className="semana" aria-label="Ventas por día">
            {dias.map((d) => (
              <li key={d.etiqueta + d.total} className={d.hoy ? 'semana-hoy' : ''}>
                <span className="semana-monto importe">{d.total > 0 ? formatPesos(d.total) : ''}</span>
                <span className="semana-barra" style={{ height: `${Math.max(2, (d.total / maxDia) * 100)}%` }} />
                <span className="semana-dia">{d.etiqueta}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="tarjeta">
          <h2 className="titulo-chico">La caja ahora</h2>
          {caja ? (
            <dl className="cuentas">
              <div>
                <dt>Abierta por</dt>
                <dd>
                  {caja.turno.cajero} a las {hora(caja.turno.apertura)}
                </dd>
              </div>
              <div>
                <dt>Ventas del turno</dt>
                <dd className="importe">{formatPesos(caja.resumen.totalVendido)}</dd>
              </div>
              <div className="cuentas-total">
                <dt>Efectivo que debería haber</dt>
                <dd className="importe">{formatPesos(caja.resumen.efectivoEsperado)}</dd>
              </div>
            </dl>
          ) : (
            <p className="texto-suave inicio-vacio">La caja está cerrada.</p>
          )}
          <button type="button" className="boton boton-chico inicio-accion" onClick={() => ir(caja ? 'cierre' : 'caja')}>
            {caja ? 'Ir al cierre' : 'Abrir la caja'}
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
                  <span className="top-nombre">{p.nombre}</span>
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
              <button type="button" onClick={() => ir('productos')} disabled={reponer.length === 0}>
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
              <button type="button" onClick={() => ir('productos')} disabled={vencen.length === 0}>
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
          </ul>
        </section>
      </div>
    </div>
  );
}
