// Lo que se escribe (o lo que escribe el lector de códigos) en los campos del sistema.

/** Un código de barras leído por el lector: sólo dígitos, de 8 a 14. Sirve para detectarlo en campos que no son el buscador. */
export function codigoEscaneado(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  return /^\d{8,14}$/.test(digitos) && digitos.length === texto.trim().length ? digitos : null;
}

/** "250" son gramos; "0,5" o "1.2" son kilos (nadie pesa medio gramo). */
export function gramosDeTexto(texto: string): number {
  const t = texto.trim().replace(',', '.');
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(/[.,]/.test(texto) ? n * 1000 : n);
}

/** Cantidad que llegó: unidades enteras ("1.200" son 1200), o kilos con coma o punto para lo que se vende por peso. */
export function cantidadDeTexto(texto: string, porPeso: boolean): number {
  if (porPeso) return Math.round((Number(texto.trim().replace(',', '.')) || 0) * 1000) / 1000;
  return Number(texto.replace(/\D/g, '')) || 0;
}

/**
 * Número argentino para wa.me: código de país 549 y sin el 0 ni el 15.
 * "341 555-1234" → 5493415551234; "011 15 5555 1234" → 5491155551234.
 */
export function telefonoWhatsApp(telefono: string): string | null {
  let d = telefono.replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) d = d.slice(2);
  d = d.replace(/^0/, '');
  // Área + número son 10 dígitos; con el 15 en el medio son 12.
  const conQuince = d.length === 12 ? d.match(/^(\d{2,4})15(\d{6,8})$/) : null;
  if (conQuince) d = conQuince[1]! + conQuince[2]!;
  return `549${d}`;
}
