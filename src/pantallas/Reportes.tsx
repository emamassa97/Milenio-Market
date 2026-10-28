import { useMemo, useState } from 'react';
import { BotonAyuda } from '../ui/Ayuda';
import { esGastoDelLocal } from '../dominio/caja';
import { formatPesos } from '../dominio/dinero';
import { saldoCliente } from '../dominio/fiado';
import { masDevueltos, paraReponer, porCajero, resumirVentas, sinMovimiento } from '../dominio/reportes';
import { MEDIOS, type Producto, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { leerUsuarios } from '../datos/usuarios';
import { sinCortes, Vacio } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';

type Periodo = 'hoy' | 'ayer' | '7' | '30' | 'mes' | 'dia';

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 'hoy', nombre: 'Hoy' },
  { id: 'ayer', nombre: 'Ayer' },
  { id: '7', nombre: '7 días' },
  { id: '30', nombre: '30 días' },
  { id: 'mes', nombre: 'Este mes' },
];

/** "2026-10-27" del día de hoy, en la hora local. */
function diaISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "martes 27 de octubre" (o con el año, si no es el de hoy). */
function diaLargo(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const fecha = new Date(a!, m! - 1, d!);
  const texto = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', ...(a !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  // "martes, 27 de octubre" → "Martes 27 de octubre".
  return (texto.charAt(0).toUpperCase() + texto.slice(1)).replace(',', '');
}

function rango(p: Periodo, dia: string): [number, number] {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const inicio = new Date(hoy);
  const fin = new Date(hoy);
  fin.setDate(fin.getDate() + 1);
  if (p === 'dia') {
    // Un día puntual del calendario ("¿cuánto vendí el 12?").
    const [a, m, d] = dia.split('-').map(Number);
    inicio.setFullYear(a!, m! - 1, d!);
    fin.setFullYear(a!, m! - 1, d! + 1);
  } else if (p === 'ayer') {
    inicio.setDate(inicio.getDate() - 1);
    fin.setDate(fin.getDate() - 1);
  } else if (p === '7') inicio.setDate(inicio.getDate() - 6);
  else if (p === '30') inicio.setDate(inicio.getDate() - 29);
  else if (p === 'mes') inicio.setDate(1);
  return [inicio.getTime(), fin.getTime()];
}

export function PantallaReportes() {
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [dia, setDia] = useState(diaISO);
  const [desde, hasta] = rango(periodo, dia);
  const ventas = useConsulta(() => db.ventas.where('fecha').between(desde, hasta, true, false).toArray(), [desde, hasta], [] as Venta[]);
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const gastos = useConsulta(
    async () => (await db.movimientosCaja.filter((m) => esGastoDelLocal(m) && m.fecha >= desde && m.fecha < hasta).toArray()).reduce((s, m) => s + m.monto, 0),
    [desde, hasta],
    0,
  );
  const ventas30 = useConsulta(() => db.ventas.where('fecha').above(Date.now() - 30 * 86400000).toArray(), [], [] as Venta[]);
  const fiadoPendiente = useConsulta(
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

  const r = useMemo(() => resumirVentas(ventas), [ventas]);
  // Quién cobró: sólo vale la pena cuando en el período cobró más de una persona.
  const usuarios = useConsulta(() => leerUsuarios(db), [], [] as { usuario: string; nombre: string }[]);
  const cajeros = useMemo(() => porCajero(ventas, new Map(usuarios.map((u) => [u.usuario, u.nombre]))), [ventas, usuarios]);
  // Las devoluciones se cuentan por el día en que se hicieron, sea de cuándo sea la venta.
  const ventasParaDevoluciones = useConsulta(
    () => db.ventas.filter((v) => !!v.devoluciones?.some((d) => d.fecha >= desde && d.fecha < hasta)).toArray(),
    [desde, hasta],
    [] as Venta[],
  );
  const devueltos = useMemo(() => masDevueltos(ventasParaDevoluciones, desde, hasta), [ventasParaDevoluciones, desde, hasta]);
  const cobradoBruto = Math.max(1, Object.values(r.porMedio).reduce((a, b) => a + b, 0));
  const reponer = useMemo(() => paraReponer(productos), [productos]);
  const quietos = useMemo(() => sinMovimiento(productos, ventas30).slice(0, 10), [productos, ventas30]);
  const maxHora = Math.max(...r.porHora, 1);
  const horasConVentas = r.porHora.map((v, h) => ({ v, h })).filter((x) => x.v > 0);
  const primera = Math.min(horasConVentas[0]?.h ?? 8, 8);
  const ultima = Math.max(horasConVentas[horasConVentas.length - 1]?.h ?? 22, 22);
  const pico = horasConVentas.reduce((a, b) => (b.v > a.v ? b : a), { v: 0, h: -1 });
  const tarjetaDevueltos = devueltos.length > 0 && (
    <section className="tarjeta">
      <h2 className="titulo-chico">Lo que más se devolvió</h2>
      <p className="texto-suave">Si un producto vuelve seguido, conviene revisarlo con el proveedor.</p>
      <ol className="ranking">
        {devueltos.slice(0, 8).map((p) => (
          <li key={p.clave}>
            <span>
              {sinCortes(p.nombre)}
              {p.motivo && <small className="texto-suave"> · {p.motivo}</small>}
            </span>
            <span className="texto-suave">{p.unidades} u.</span>
            <span className="importe">{formatPesos(p.importe)}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div className="pagina">
      <div className="pagina-cabecera">
        <h1>
          Reportes <BotonAyuda tema="reportes" que="cómo leer los reportes" />
        </h1>
        <div className="filtros-periodo">
          <div className="segmentos" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" className={periodo === p.id ? 'activo' : ''} aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}>
                {p.nombre}
              </button>
            ))}
          </div>
          <label className={`filtro-dia ${periodo === 'dia' ? 'activo' : ''}`} title="Un día puntual">
            <input
              type="date"
              // Si no es el filtro que manda, no muestra una fecha que no está filtrando.
              value={periodo === 'dia' ? dia : ''}
              max={diaISO()}
              aria-label="Un día puntual"
              onChange={(e) => {
                if (!e.target.value) return;
                setDia(e.target.value);
                setPeriodo('dia');
              }}
            />
          </label>
        </div>
      </div>
      {periodo === 'dia' && <p className="texto-suave periodo-elegido">{diaLargo(dia)}</p>}

      <div className="indicadores indicadores-4">
        <div className="tarjeta indicador">
          <span>Vendiste</span>
          <strong className="importe">{formatPesos(r.total)}</strong>
          {r.devuelto > 0 && <small className="texto-suave">Ya descontados {formatPesos(r.devuelto)} devueltos de estas ventas</small>}
        </div>
        <div className="tarjeta indicador">
          <span>Ventas</span>
          <strong className="importe">{r.cantidad}</strong>
        </div>
        <div className="tarjeta indicador">
          <span>Ticket promedio</span>
          <strong className="importe">{formatPesos(r.promedio)}</strong>
        </div>
        <div className="tarjeta indicador">
          <span>Ganancia estimada</span>
          <strong className="importe texto-positivo">{formatPesos(r.ganancia)}</strong>
          {r.ventasSinCosto > 0 && <small className="texto-suave">{formatPesos(r.ventasSinCosto)} vendidos sin costo cargado no entran</small>}
        </div>
      </div>
      <div className="indicadores indicadores-3">
        <div className="tarjeta indicador">
          <span>Gastos del local</span>
          <strong className="importe">{formatPesos(gastos)}</strong>
          <small className="texto-suave">Luz, alquiler, sueldos y otros (la mercadería ya está en el costo)</small>
        </div>
        <div className="tarjeta indicador">
          <span>Queda después de gastos</span>
          <strong className={`importe ${r.ganancia - gastos < 0 ? 'texto-alerta' : ''}`}>{formatPesos(r.ganancia - gastos)}</strong>
          <small className="texto-suave">Ganancia estimada menos gastos</small>
        </div>
        <div className="tarjeta indicador">
          <span>Fiado sin cobrar</span>
          <strong className="importe">{formatPesos(fiadoPendiente.total)}</strong>
          <small className="texto-suave">{fiadoPendiente.deudores === 0 ? 'Nadie debe' : fiadoPendiente.deudores === 1 ? '1 cliente debe' : `${fiadoPendiente.deudores} clientes deben`}</small>
        </div>
      </div>

      {r.cantidad === 0 ? (
        <>
          <Vacio titulo={periodo === 'dia' ? `No hubo ventas el ${diaLargo(dia).toLowerCase()}` : 'No hay ventas en este período'} icono="reportes" />
          {tarjetaDevueltos && <div className="reportes">{tarjetaDevueltos}</div>}
        </>
      ) : (
        <div className="reportes reportes-ventas">
          <section className="tarjeta">
            <h2 className="titulo-chico">Cómo te pagaron</h2>
            <ul className="barras">
              {MEDIOS.map((m) => (
                <li key={m.id}>
                  <span>{m.nombre}</span>
                  <div className="barra-medio">
                    <div style={{ width: `${(r.porMedio[m.id] / cobradoBruto) * 100}%` }} />
                  </div>
                  <span className="importe">{formatPesos(r.porMedio[m.id])}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="tarjeta">
            <h2 className="titulo-chico">Ventas por hora</h2>
            {pico.h >= 0 && <p className="texto-suave">La hora que más vendiste: de {pico.h} a {pico.h + 1} h.</p>}
            <div className="horas" role="img" aria-label="Ventas por hora del día">
              {r.porHora.slice(primera, ultima + 1).map((v, i) => (
                <div key={primera + i} className="hora">
                  <div className="hora-barra" style={{ height: `${(v / maxHora) * 100}%` }} title={`${primera + i} h: ${formatPesos(v)}`} />
                  <span>{primera + i}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="tarjeta">
            <h2 className="titulo-chico">Lo que más se vendió</h2>
            <ol className="ranking">
              {r.productos.slice(0, 10).map((p) => (
                <li key={p.clave}>
                  <span>{sinCortes(p.nombre)}</span>
                  <span className="texto-suave">{p.kilos !== undefined ? `${p.kilos.toLocaleString('es-AR')} kg` : `${p.unidades} u.`}</span>
                  <span className="importe">{formatPesos(p.total)}</span>
                </li>
              ))}
            </ol>
          </section>
          {cajeros.length > 1 && (
            <section className="tarjeta">
              <h2 className="titulo-chico">Quién cobró</h2>
              <ol className="ranking">
                {cajeros.map((c) => (
                  <li key={c.nombre}>
                    <span>{sinCortes(c.nombre)}</span>
                    <span className="texto-suave">{c.cantidad === 1 ? '1 venta' : `${c.cantidad} ventas`}</span>
                    <span className="importe">{formatPesos(c.total)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {tarjetaDevueltos}
        </div>
      )}

      <div className="reportes reportes-stock">
        <section className="tarjeta">
          <h2 className="titulo-chico">Para reponer ({reponer.length})</h2>
          {reponer.length === 0 ? (
            <p className="texto-suave">Nada por debajo del mínimo.</p>
          ) : (
            <ul className="ranking">
              {reponer.slice(0, 10).map((p) => (
                <li key={p.id}>
                  <span>{sinCortes(p.nombre)}</span>
                  <span className="texto-aviso">{p.stock === 1 ? 'queda 1' : `quedan ${p.stock}`}</span>
                  <span className="texto-suave">mín. {p.stockMinimo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tarjeta">
          <h2 className="titulo-chico">Sin ventas en 30 días</h2>
          {quietos.length > 0 && <p className="texto-suave">Plata parada, a precio de venta.</p>}
          {quietos.length === 0 ? (
            <p className="texto-suave">Todo lo que tiene stock se vendió.</p>
          ) : (
            <ul className="ranking">
              {quietos.map((p) => (
                <li key={p.id}>
                  <span>{sinCortes(p.nombre)}</span>
                  <span className="texto-suave">{p.stock} en stock</span>
                  <span className="importe">{formatPesos(p.precio * p.stock)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
