import { useState } from 'react';
import { formatoPeso, pagosDeVenta } from '../dominio/carrito';
import { cantidadDevuelta, fiadoDisponible, montoDevolucion, type RenglonDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { MEDIOS, nombreMedio, type MedioPago, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { devolverProductos, turnoAbierto } from '../datos/operaciones';
import { errorATexto, fechaCorta, ICONO_MEDIO, Icono, Modal, sinCortes, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { usePedirDueño } from '../ui/permisos';
import { useSesion } from '../ui/sesion';

const MOTIVOS = ['Vencido', 'Cambio', 'Se arrepintió', 'Vino fallado'];

/**
 * El cliente devuelve o cambia algo de una venta ya cobrada. Se marca qué
 * vuelve y cómo se le devuelve la plata; para un cambio, después se cobra el
 * producto nuevo como una venta normal.
 */
export function DevolverVenta({ venta, onCerrar, onHecho }: { venta: Venta; onCerrar: () => void; onHecho?: (monto: number) => void }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const { sesion } = useSesion();
  const turno = useConsulta(() => turnoAbierto(db), [], undefined as Awaited<ReturnType<typeof turnoAbierto>>);
  const pagos = pagosDeVenta(venta);
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  // La plata vuelve por donde entró: si pagó con un solo medio, ese queda elegido.
  const [medio, setMedio] = useState<MedioPago>(pagos.length === 1 ? pagos[0]!.medio : venta.medio === 'fiado' ? 'fiado' : 'efectivo');
  const [motivo, setMotivo] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  const renglones: RenglonDevuelto[] = Object.entries(cantidades).map(([i, c]) => ({ indice: Number(i), cantidad: c })).filter((r) => r.cantidad > 0);
  const monto = montoDevolucion(venta, renglones);
  const quedan = (i: number) => venta.items[i]!.cantidad - cantidadDevuelta(venta, i);
  const poner = (i: number, c: number) => setCantidades((x) => ({ ...x, [i]: Math.max(0, Math.min(quedan(i), c)) }));
  // "Descontar de su cuenta" sólo hasta lo que se fió en esta venta; lo pagado con otro medio vuelve por ese medio.
  const enCuenta = fiadoDisponible(venta);
  const medios = MEDIOS.filter((m) => m.id !== 'fiado' || enCuenta > 0);
  const pasaDeCuenta = medio === 'fiado' && monto > enCuenta;
  // Con una promo, devolver una parte no devuelve el precio suelto: las que quedan pasan a precio sin promo.
  const tocaPromo = renglones.some((r) => {
    const it = venta.items[r.indice];
    return it?.promo && r.cantidad < quedan(r.indice);
  });
  // Una venta del turno abierto la devuelve quien está cobrando; las de otro turno piden al dueño.
  const delTurno = !!turno && venta.turnoId === turno.id;
  const comoPago = pagos.map((p) => `${formatPesos(p.monto)} ${p.medio === 'fiado' ? 'fiado' : nombreMedio(p.medio).toLowerCase()}`).join(' + ');

  return (
    <Modal titulo="Devolver o cambiar" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
            const quien = (delTurno ? sesion?.usuario : await pedirDueño('Devolver plata de una venta de otro día')) ?? undefined;
            if (!delTurno && !quien) return;
            try {
              await devolverProductos(db, venta.id!, renglones, medio, motivo, quien);
              avisar({
                texto:
                  medio === 'efectivo'
                    ? `Devolvé ${formatPesos(monto)} en efectivo. El stock volvió.`
                    : medio === 'fiado'
                      ? `Se descontaron ${formatPesos(monto)} de la cuenta. El stock volvió.`
                      : `Anotado: ${formatPesos(monto)} a devolver por ${nombreMedio(medio)}. El stock volvió.`,
                tipo: 'ok',
              });
              onHecho?.(monto);
              onCerrar();
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <p className="texto-suave">
          Venta del {fechaCorta(venta.fecha)} por {formatPesos(venta.total)}. Pagó {comoPago}.
          <br />
          Marcá qué vuelve; si es un cambio, después cobrá el producto nuevo como siempre.
        </p>
        <ul className="lista-devolver">
          {venta.items.map((it, i) => {
            const disponibles = quedan(i);
            const elegida = cantidades[i] ?? 0;
            return (
              <li key={i} className={disponibles <= 0 ? 'devuelto-todo' : ''}>
                <span className="lista-devolver-nombre">
                  <strong>{sinCortes(it.nombre)}</strong>
                  <small className="texto-suave">
                    {it.gramos ? formatoPeso(it.gramos) : `${it.cantidad} x ${formatPesos(it.precioUnitario)}`}
                    {it.promo && ` · promo ${it.promo.cantidad} x ${formatPesos(it.promo.precio)}`}
                    {disponibles <= 0 ? ' · ya devuelto' : disponibles < it.cantidad ? ` · quedan ${disponibles}` : ''}
                  </small>
                </span>
                {disponibles > 0 && (
                  <span className="cantidad">
                    <button type="button" className="boton-icono" aria-label={`Uno menos de ${it.nombre}`} onClick={() => poner(i, elegida - 1)} disabled={elegida <= 0}>
                      <Icono nombre="menos" tam={18} />
                    </button>
                    <input
                      inputMode="numeric"
                      aria-label={`Cuántos vuelven de ${it.nombre}`}
                      value={elegida}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => poner(i, Number(e.target.value.replace(/\D/g, '')) || 0)}
                    />
                    <button type="button" className="boton-icono" aria-label={`Uno más de ${it.nombre}`} onClick={() => poner(i, elegida + 1)} disabled={elegida >= disponibles}>
                      <Icono nombre="mas" tam={18} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="campo">
          <span className="campo-etiqueta">Cómo se devuelve la plata</span>
          <div className="medios">
            {medios.map((m) => (
              <button key={m.id} type="button" className={`medio ${medio === m.id ? 'activo' : ''}`} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}>
                <Icono nombre={ICONO_MEDIO[m.id]} tam={18} /> {m.id === 'fiado' ? 'Descontar de su cuenta' : m.nombre}
              </button>
            ))}
          </div>
          {medio !== 'efectivo' && medio !== 'fiado' && <p className="texto-suave">El reverso se hace desde la app de {nombreMedio(medio)}; acá sólo queda anotado.</p>}
          {medio === 'fiado' && (
            <p className={pasaDeCuenta ? 'texto-alerta' : 'texto-suave'}>
              {pasaDeCuenta
                ? `En la cuenta quedan ${formatPesos(enCuenta)} de esta venta. Lo que pagó con otro medio, devolvelo por ese medio.`
                : `Se le resta de lo que debe (${formatPesos(enCuenta)} de esta venta están en su cuenta).`}
            </p>
          )}
        </div>
        <div className="campo">
          <span className="campo-etiqueta">Motivo (opcional)</span>
          <div className="chips">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" className={`chip ${motivo === m ? 'activo' : ''}`} aria-pressed={motivo === m} onClick={() => setMotivo(motivo === m ? '' : m)}>
                {m}
              </button>
            ))}
          </div>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="U otro motivo" aria-label="Motivo de la devolución" />
        </div>
        <div className={`vuelto ${monto === 0 ? 'vuelto-cero' : ''}`}>
          <span>
            A devolver
            {tocaPromo && <small className="texto-suave"> · lo que queda pasa a precio sin promo</small>}
          </span>
          <strong className="importe">{formatPesos(monto)}</strong>
        </div>
        <div className="modal-pie">
          <button type="submit" className="boton boton-primario boton-grande" disabled={renglones.length === 0 || enCurso || pasaDeCuenta}>
            {medio === 'efectivo' ? `Devolver ${formatPesos(monto)} en efectivo` : medio === 'fiado' ? `Descontar ${formatPesos(monto)} de la cuenta` : `Anotar devolución de ${formatPesos(monto)}`}
          </button>
          {!delTurno && <p className="texto-suave texto-centrado">Es una venta de otro turno: pide la clave del dueño.</p>}
        </div>
      </form>
    </Modal>
  );
}
