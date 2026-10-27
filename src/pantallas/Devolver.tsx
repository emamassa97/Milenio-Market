import { useState } from 'react';
import { formatoPeso } from '../dominio/carrito';
import { cantidadDevuelta, fiadoDisponible, montoDevolucion, type RenglonDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { MEDIOS, type MedioPago, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { devolverProductos } from '../datos/operaciones';
import { errorATexto, fechaCorta, Icono, Modal, sinCortes, useAvisar } from '../ui/componentes';
import { useUnaVez } from '../ui/hooks';
import { usePedirDueño } from '../ui/permisos';

/**
 * El cliente devuelve o cambia algo de una venta ya cobrada. Se marca qué
 * vuelve y cómo se le devuelve la plata; para un cambio, después se cobra el
 * producto nuevo como una venta normal.
 */
export function DevolverVenta({ venta, onCerrar, onHecho }: { venta: Venta; onCerrar: () => void; onHecho?: (monto: number) => void }) {
  const avisar = useAvisar();
  const pedirDueño = usePedirDueño();
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const [medio, setMedio] = useState<MedioPago>(venta.medio === 'fiado' ? 'fiado' : 'efectivo');
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

  return (
    <Modal titulo="Devolver o cambiar" onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
            const quien = await pedirDueño('Devolver plata de una venta');
            if (!quien) return;
            try {
              await devolverProductos(db, venta.id!, renglones, medio, motivo, quien);
              avisar({
                texto:
                  medio === 'efectivo'
                    ? `Devolvé ${formatPesos(monto)} en efectivo. El stock volvió.`
                    : medio === 'fiado'
                      ? `Se descontaron ${formatPesos(monto)} de la cuenta. El stock volvió.`
                      : `Anotado: ${formatPesos(monto)} a devolver por ${medios.find((m) => m.id === medio)?.nombre}. El stock volvió.`,
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
          Venta del {fechaCorta(venta.fecha)} por {formatPesos(venta.total)}. Marcá qué vuelve; si es un cambio, después cobrá el producto nuevo como siempre.
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
        <div>
          <span className="campo-etiqueta">Cómo se devuelve la plata</span>
          <div className="medios">
            {medios.map((m) => (
              <button key={m.id} type="button" className={`medio ${medio === m.id ? 'activo' : ''}`} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}>
                {m.id === 'fiado' ? 'Descontar de su cuenta' : m.nombre}
              </button>
            ))}
          </div>
          {medio !== 'efectivo' && medio !== 'fiado' && <p className="texto-suave">El reverso se hace desde la app de {medios.find((m) => m.id === medio)?.nombre}; acá sólo queda anotado.</p>}
          {medio === 'fiado' && (
            <p className={pasaDeCuenta ? 'texto-alerta' : 'texto-suave'}>
              {pasaDeCuenta
                ? `En la cuenta quedan ${formatPesos(enCuenta)} de esta venta. Lo que pagó con otro medio, devolvelo por ese medio.`
                : `Se le resta de lo que debe (${formatPesos(enCuenta)} de esta venta están en su cuenta).`}
            </p>
          )}
        </div>
        <label className="campo">
          <span className="campo-etiqueta">Motivo (opcional)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: Vencido, lo cambió por otro" />
        </label>
        <div className="vuelto">
          <span>A devolver</span>
          <strong className="importe">{formatPesos(monto)}</strong>
        </div>
        <button type="submit" className="boton boton-primario boton-grande" disabled={renglones.length === 0 || enCurso || pasaDeCuenta}>
          {medio === 'efectivo' ? `Devolver ${formatPesos(monto)} en efectivo` : medio === 'fiado' ? `Descontar ${formatPesos(monto)} de la cuenta` : `Anotar devolución de ${formatPesos(monto)}`}
        </button>
      </form>
    </Modal>
  );
}
