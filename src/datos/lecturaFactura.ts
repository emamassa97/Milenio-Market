import { limpiarFacturaLeida, type FacturaLeida } from '../dominio/compras';
import type { BaseKiosco } from './db';
import { ErrorKiosco, leerAjuste } from './operaciones';

// Manda la foto de la factura al servidor, que la lee con un modelo de visión. Desde el celular una foto pesa
// 3-5 MB: se achica acá (1600 px, JPEG) para que suba rápido aun con datos móviles.

const URL_LECTURA = '/api/leer-factura';
const LADO_MAXIMO = 1800;

/** Una foto achicada como data URL JPEG. */
export async function achicarFoto(archivo: Blob): Promise<string> {
  const bitmap = await createImageBitmap(archivo).catch(() => null);
  if (!bitmap) throw new ErrorKiosco('Ese archivo no es una foto que se pueda leer (probá con JPG o PNG).');
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new ErrorKiosco('El navegador no pudo preparar la foto.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();
  return lienzo.toDataURL('image/jpeg', 0.82);
}

export interface ResultadoLectura {
  factura: FacturaLeida;
}

/** Lee una o varias fotos del mismo comprobante. Tira ErrorKiosco con un motivo para mostrar. */
export async function leerFotosDeFactura(db: BaseKiosco, fotos: string[], proveedores: string[], url = URL_LECTURA): Promise<ResultadoLectura> {
  const clave = await leerAjuste<string>(db, 'nube.clave', '');
  if (!clave) throw new ErrorKiosco('Para leer fotos, este equipo tiene que estar conectado a la nube (Ajustes). Mientras tanto, cargala a mano.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ErrorKiosco('Sin internet no se puede leer la foto. Cargala a mano o probá cuando vuelva.');
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': clave },
      body: JSON.stringify({ imagenes: fotos, proveedores }),
    });
  } catch {
    throw new ErrorKiosco('No hubo respuesta del servidor. Revisá internet y probá de nuevo.');
  }
  const cuerpo = (await r.json().catch(() => ({}))) as { factura?: unknown; error?: string; sinIA?: boolean };
  if (!r.ok || !cuerpo.factura) {
    if (r.status === 401) throw new ErrorKiosco('Sólo el dueño puede cargar facturas con foto.');
    throw new ErrorKiosco(cuerpo.error ?? 'No se pudo leer la foto. Cargala a mano.');
  }
  const factura = limpiarFacturaLeida(cuerpo.factura);
  if (factura.renglones.length === 0) throw new ErrorKiosco('No encontré productos en la foto. Probá con otra más derecha, con luz y que se vea entera.');
  return { factura };
}
