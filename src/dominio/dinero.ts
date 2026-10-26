import type { Pesos } from './tipos';

const formato = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** 1400 -> "$ 1.400"; -500 -> "-$ 500". */
export function formatPesos(monto: Pesos): string {
  const redondo = Math.round(monto);
  const texto = `$ ${formato.format(Math.abs(redondo))}`;
  return redondo < 0 ? `-${texto}` : texto;
}

/**
 * Lee un importe escrito a mano, como lo escribe cualquiera en Argentina:
 * "1400", "1.400", "$ 1.400", "1400,50", "1.400,50". Devuelve pesos enteros
 * (redondea los centavos) o null si no es un número.
 */
export function parsePesos(texto: string): Pesos | null {
  let limpio = texto.replace(/\$/g, '').replace(/\s/g, '').trim();
  if (limpio === '') return null;
  const negativo = limpio.startsWith('-');
  if (negativo) limpio = limpio.slice(1);
  if (!/^[\d.,]+$/.test(limpio)) return null;
  const ultimaComa = limpio.lastIndexOf(',');
  let entero = limpio;
  let decimales = '';
  if (ultimaComa >= 0) {
    entero = limpio.slice(0, ultimaComa);
    decimales = limpio.slice(ultimaComa + 1);
    if (decimales.includes('.')) return null;
  } else {
    // Sin coma: un punto seguido de 1 o 2 cifras al final es decimal ("1400.5"),
    // si no, es separador de miles ("1.400").
    const m = /^(.*)\.(\d{1,2})$/.exec(limpio);
    if (m && !m[1]!.includes('.')) {
      entero = m[1]!;
      decimales = m[2]!;
    }
  }
  entero = entero.replace(/\./g, '');
  if (entero === '' && decimales === '') return null;
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimales)) return null;
  const valor = Number(`${entero || '0'}.${decimales || '0'}`);
  if (!Number.isFinite(valor)) return null;
  const redondo = Math.round(valor);
  return negativo ? -redondo : redondo;
}
