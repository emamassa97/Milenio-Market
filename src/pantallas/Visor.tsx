import { useEffect, useState } from 'react';
import logo from '../assets/logo-oscuro.svg';
import { carritoVacio, subtotal, totalCarrito, type Carrito } from '../dominio/carrito';
import { formatPesos } from '../dominio/dinero';
import { leerGuardado, LLAVE_CARRITO, LLAVE_ULTIMA } from '../ui/hooks';

interface Cobrada {
  total: number;
  hora: number;
  vuelto?: number;
}

// Después de cobrar, el "Gracias" y el vuelto quedan a la vista este rato (o hasta que arranca la próxima venta).
const GRACIAS_MS = 20_000;

/**
 * Pantalla para el cliente (#visor): un monitor o una tablet mirando al mostrador con lo que se está
 * cobrando. Sin menú ni sesión: sólo lee la venta que la caja deja en este navegador.
 */
export function Visor() {
  const [carrito, setCarrito] = useState<Carrito>(() => leerGuardado(LLAVE_CARRITO, carritoVacio));
  const [ultima, setUltima] = useState<Cobrada | null>(() => leerGuardado(LLAVE_ULTIMA, null));
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const leer = () => {
      setCarrito(leerGuardado(LLAVE_CARRITO, carritoVacio));
      setUltima(leerGuardado(LLAVE_ULTIMA, null));
      setAhora(Date.now());
    };
    window.addEventListener('storage', leer);
    const reloj = window.setInterval(() => setAhora(Date.now()), 5_000);
    document.title = 'Milenio Market';
    return () => {
      window.removeEventListener('storage', leer);
      window.clearInterval(reloj);
    };
  }, []);

  const total = totalCarrito(carrito);
  const gracias = carrito.items.length === 0 && ultima && ahora - ultima.hora < GRACIAS_MS ? ultima : null;
  const renglones = carrito.items.slice(0, 6);

  return (
    <div className="visor">
      <header className="visor-cabecera">
        <img src={logo} alt="Milenio Market" />
      </header>
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
          </div>
        </main>
      ) : gracias ? (
        <main className="visor-gracias" aria-live="polite">
          <strong>¡Gracias!</strong>
          {gracias.vuelto ? (
            <p>
              Tu vuelto <span className="importe">{formatPesos(gracias.vuelto)}</span>
            </p>
          ) : (
            <p>
              Cobrado <span className="importe">{formatPesos(gracias.total)}</span>
            </p>
          )}
        </main>
      ) : (
        <main className="visor-espera">
          <strong>Bienvenido</strong>
          <p>Acá vas a ver lo que llevás y el total.</p>
        </main>
      )}
    </div>
  );
}
