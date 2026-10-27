import { useEffect, useRef, useState } from 'react';
import logo from '../assets/logo-oscuro.svg';
import { calcularVuelto, carritoVacio, subtotal, totalCarrito, type Carrito } from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import type { MedioPago } from '../dominio/tipos';
import { leerGuardado, LLAVE_CARRITO, LLAVE_PAGA_CON, LLAVE_ULTIMA } from '../ui/hooks';

interface Cobrada {
  total: number;
  hora: number;
  medio?: MedioPago;
  vuelto?: number;
  fiado?: number;
}

// Después de cobrar, el "Gracias" y el vuelto quedan a la vista este rato (o hasta que arranca la próxima venta).
const GRACIAS_MS = 20_000;

// Cuántos renglones entran según el alto de la pantalla: el total siempre se ve entero.
const renglonesQueEntran = () => Math.max(2, Math.min(8, Math.floor((window.innerHeight - 440) / 64)));

/**
 * Pantalla para el cliente (#visor): un segundo monitor conectado a la compu de la caja, mirando al mostrador,
 * con lo que se está cobrando. Sin menú ni sesión: sólo lee la venta que la caja deja en este navegador.
 */
export function Visor() {
  const [carrito, setCarrito] = useState<Carrito>(() => leerGuardado(LLAVE_CARRITO, carritoVacio));
  const [pagaCon, setPagaCon] = useState<number | null>(() => leerGuardado(LLAVE_PAGA_CON, null));
  // Sólo un cobro que pasa con esta pantalla abierta dice "¡Gracias!": dejar una venta en espera no lo repite.
  const [gracias, setGracias] = useState<Cobrada | null>(null);
  const horaUltima = useRef(leerGuardado<Cobrada | null>(LLAVE_ULTIMA, null)?.hora ?? 0);
  const [entran, setEntran] = useState(renglonesQueEntran);
  useEffect(() => {
    let reloj = 0;
    const leer = () => {
      const c = leerGuardado(LLAVE_CARRITO, carritoVacio);
      setCarrito(c);
      setPagaCon(leerGuardado(LLAVE_PAGA_CON, null));
      const u = leerGuardado<Cobrada | null>(LLAVE_ULTIMA, null);
      if (u && u.hora !== horaUltima.current) {
        horaUltima.current = u.hora;
        setGracias(u);
        window.clearTimeout(reloj);
        reloj = window.setTimeout(() => setGracias(null), GRACIAS_MS);
      }
      if (c.items.length > 0) setGracias(null);
    };
    const medir = () => setEntran(renglonesQueEntran());
    window.addEventListener('storage', leer);
    window.addEventListener('resize', medir);
    document.title = 'Milenio Market';
    return () => {
      window.removeEventListener('storage', leer);
      window.removeEventListener('resize', medir);
      window.clearTimeout(reloj);
    };
  }, []);

  const total = totalCarrito(carrito);
  const renglones = carrito.items.slice(0, entran);
  const vuelto = pagaCon !== null && pagaCon >= total ? (calcularVuelto(total, pagaCon) ?? 0) : 0;

  // En espera el logo va grande en el centro; el de la cabecera vuelve con la venta (y con el "¡Gracias!").
  const enEspera = carrito.items.length === 0 && !gracias;
  return (
    <div className="visor">
      {!enEspera && (
        <header className="visor-cabecera">
          <img src={logo} alt="Milenio Market" />
        </header>
      )}
      {carrito.items.length > 0 ? (
        <main className="visor-venta">
          <ul className="visor-lista" aria-label="Lo que lleva">
            {renglones.map((it, i) => (
              <li key={`${it.codigo}-${i}`} className={i === 0 ? 'visor-nuevo' : ''}>
                <span className="visor-cant">{it.gramos ? `${it.gramos} g` : `${it.cantidad} ×`}</span>
                <span className="visor-nombre">{it.nombre}</span>
                <strong className="importe">{formatPesos(subtotal(it))}</strong>
              </li>
            ))}
            {carrito.items.length > renglones.length && <li className="visor-mas">y {carrito.items.length - renglones.length} más</li>}
          </ul>
          {carrito.descuento ? (
            <p className="visor-descuento">
              Descuento <strong className="importe">−{formatPesos(carrito.descuento)}</strong>
            </p>
          ) : null}
          <div className="visor-total" aria-live="polite">
            <span>Total</span>
            <strong className="importe">{formatPesos(total)}</strong>
            {pagaCon !== null && pagaCon > total && (
              <p className="visor-paga">
                Paga con {formatPesos(pagaCon)} · <b>vuelto {formatPesos(vuelto)}</b>
              </p>
            )}
          </div>
        </main>
      ) : gracias ? (
        <main className="visor-gracias" aria-live="polite">
          <strong>¡Gracias!</strong>
          {gracias.medio === 'fiado' ? (
            <p>
              Quedó anotado <span className="importe">{formatPesos(gracias.total)}</span>
            </p>
          ) : gracias.vuelto ? (
            <p>
              Tu vuelto <span className="importe">{formatPesos(gracias.vuelto)}</span>
            </p>
          ) : (
            <p>
              Pagaste <span className="importe">{formatPesos(gracias.total)}</span>
            </p>
          )}
        </main>
      ) : (
        <main className="visor-espera">
          <img className="visor-espera-logo" src={logo} alt="Milenio Market" />
          <strong>Bienvenido</strong>
          <p>Acá vas a ver lo que llevás y el total.</p>
        </main>
      )}
    </div>
  );
}
