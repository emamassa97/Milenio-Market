// "Llegó mercadería" del dueño abre la carga de compras (factura, costos, precios y pago) en vez del cargador rápido.
// Vive aparte de la pantalla de Compras para que la caja no la baje entera.

export const LLAVE_COMPRA_NUEVA = 'milenio.compras.nueva';

export function pedirCompraNueva() {
  try {
    sessionStorage.setItem(LLAVE_COMPRA_NUEVA, '1');
  } catch {
    /* sin sessionStorage se abre la pantalla igual */
  }
  window.location.hash = 'compras';
}
