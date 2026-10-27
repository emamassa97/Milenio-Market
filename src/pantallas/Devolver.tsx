import { useRef, useState } from 'react';
import { formatoPeso, pagosDeVenta } from '../dominio/carrito';
import { cantidadDevuelta, describirPagos, fiadoDisponible, montoDevolucion, type RenglonDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { codigoEscaneado } from '../dominio/entrada';
import { MEDIOS, nombreMedio, type MedioPago, type Venta } from '../dominio/tipos';
import { db } from '../datos/db';
import { devolverProductos, turnoAbierto } from '../datos/operaciones';
import { CampoCantidad, errorATexto, fechaCorta, ICONO_MEDIO, Icono, Modal, sinCortes, useAvisar } from '../ui/componentes';
import { pitido, useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño, usePedirDueño } from '../ui/permisos';
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
  const dueño = useEsDueño();
  const { sesion } = useSesion();
  // 'cargando' hasta saber si hay caja abierta: mientras tanto no se puede confirmar.
  const turno = useConsulta(async () => (await turnoAbierto(db)) ?? null, [], 'cargando' as Awaited<ReturnType<typeof turnoAbierto>> | null | 'cargando');
  const cargando = turno === 'cargando';
  const pagos = pagosDeVenta(venta);
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  // "Descontar de su cuenta" sólo hasta lo que se fió en esta venta; lo pagado con otro medio vuelve por ese medio.
  const enCuenta = fiadoDisponible(venta);
  // La plata vuelve por donde entró: el primer medio que no sea fiado; si fue todo fiado, de la cuenta.
  const [medio, setMedio] = useState<MedioPago>(() => {
    const entrada = pagos.find((p) => p.medio !== 'fiado')?.medio ?? 'fiado';
    return entrada === 'fiado' && enCuenta <= 0 ? 'efectivo' : entrada;
  });
  const [motivo, setMotivo] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  const renglones: RenglonDevuelto[] = Object.entries(cantidades).map(([i, c]) => ({ indice: Number(i), cantidad: c })).filter((r) => r.cantidad > 0);
  const monto = montoDevolucion(venta, renglones);
  const quedan = (i: number) => venta.items[i]!.cantidad - cantidadDevuelta(venta, i);
  const poner = (i: number, c: number) => setCantidades((x) => ({ ...x, [i]: Math.max(0, Math.min(quedan(i), c)) }));
  const form = useRef<HTMLFormElement>(null);
  // El lector tipea donde está el cursor: después de cada pasada (o de tocar + / −, o de un Enter) el cursor vuelve a una cantidad,
  // así se puede seguir escaneando. En el celular no: abriría el teclado.
  const enfocarCantidad = (i: number) => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    window.setTimeout(() => {
      const campos = form.current?.querySelectorAll<HTMLInputElement>('input[aria-label^="Cuántos vuelven"]');
      (campos?.[i] ?? campos?.[0])?.focus();
    }, 30);
  };
  const visibles = (i: number) => venta.items.slice(0, i).filter((_, idx) => quedan(idx) > 0).length;
  // Con el modal abierto se escanea lo que traen: cada pasada marca uno más de ese renglón.
  const marcar = (codigo: string): boolean => {
    // Lo que no es un código de barras no es del lector: el campo lo trata como cantidad ("Como mucho N").
    if (!codigoEscaneado(codigo)) return false;
    const i = venta.items.findIndex((it, idx) => it.codigo === codigo && quedan(idx) > (cantidades[idx] ?? 0));
    if (i < 0) {
      pitido('error');
      avisar({ texto: venta.items.some((it) => it.codigo === codigo) ? 'Ese producto ya está marcado entero.' : 'Ese producto no está en esta venta.', tipo: 'error' });
      enfocarCantidad(0);
      return true;
    }
    pitido('ok');
    setCantidades((x) => ({ ...x, [i]: (x[i] ?? 0) + 1 }));
    enfocarCantidad(visibles(i));
    return true;
  };
  const medios = MEDIOS.filter((m) => m.id !== 'fiado' || enCuenta > 0);
  const pasaDeCuenta = medio === 'fiado' && monto > enCuenta;
  // Con una promo, devolver una parte no devuelve el precio suelto: las que quedan pasan a precio sin promo.
  const tocaPromo = renglones.some((r) => {
    const it = venta.items[r.indice];
    return it?.promo && r.cantidad < quedan(r.indice);
  });
  // Una venta del turno abierto la devuelve quien está cobrando; las de otro turno piden al dueño.
  const delTurno = !cargando && !!turno && venta.turnoId === turno.id;
  const comoPago = describirPagos(pagos);

  return (
    <Modal titulo="Devolver o cambiar" onCerrar={onCerrar}>
      <form
        ref={form}
        className="formulario"
        onKeyDown={(e) => {
          // Enter en una cantidad la confirma (el campo suelta el foco): el cursor vuelve ahí para la próxima pasada del lector.
          const campo = e.target as HTMLInputElement;
          // Si lo que hay en el campo es un código de barras, fue el lector: marcar() ya lleva el cursor al renglón que corresponde.
          if (e.key !== 'Enter' || !campo.matches('input[aria-label^="Cuántos vuelven"]') || codigoEscaneado(campo.value)) return;
          const campos = [...(form.current?.querySelectorAll<HTMLInputElement>('input[aria-label^="Cuántos vuelven"]') ?? [])];
          enfocarCantidad(Math.max(0, campos.indexOf(campo)));
        }}
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
          Marcá qué vuelve (o pasá por el lector lo que te traen); si es un cambio, después cobrá el producto nuevo como siempre.
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
                    <button type="button" className="boton-icono" aria-label={`Uno menos de ${it.nombre}`} onClick={() => { poner(i, elegida - 1); enfocarCantidad(visibles(i)); }} disabled={elegida <= 0}>
                      <Icono nombre="menos" tam={18} />
                    </button>
                    <CampoCantidad ariaLabel={`Cuántos vuelven de ${it.nombre}`} valor={elegida} max={disponibles} enVivo={false} onCambio={(n) => poner(i, n)} onEscaneo={marcar} />
                    <button type="button" className="boton-icono" aria-label={`Uno más de ${it.nombre}`} onClick={() => { poner(i, elegida + 1); enfocarCantidad(visibles(i)); }} disabled={elegida >= disponibles}>
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
              <button key={m.id} type="button" className={`medio ${medio === m.id ? 'activo' : ''} ${m.id === 'fiado' ? 'medio-ancho' : ''}`} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}>
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
            {!!venta.descuento && monto > 0 && <small className="texto-suave"> · con el descuento de la venta</small>}
          </span>
          <strong className="importe">{formatPesos(monto)}</strong>
        </div>
        <div className="modal-pie">
          <button type="submit" className="boton boton-primario boton-grande" disabled={renglones.length === 0 || enCurso || pasaDeCuenta || cargando}>
            {renglones.length === 0
              ? 'Marcá qué vuelve'
              : medio === 'efectivo'
                ? `Devolver ${formatPesos(monto)} en efectivo`
                : medio === 'fiado'
                  ? `Descontar ${formatPesos(monto)} de la cuenta`
                  : `Anotar devolución de ${formatPesos(monto)}`}
          </button>
          {!cargando && !delTurno && !dueño && <p className="texto-suave texto-centrado">Es una venta de otro turno: pide la clave del dueño.</p>}
        </div>
      </form>
    </Modal>
  );
}
