import { formatoPeso, pagosDeVenta, subtotal } from '../dominio/carrito';
import { itemsNetos, totalDevuelto } from '../dominio/devoluciones';
import { formatPesos } from '../dominio/dinero';
import { nombreMedio, type Venta } from '../dominio/tipos';
import type { BaseKiosco } from '../datos/db';
import { leerAjuste } from '../datos/operaciones';

// Ticket de venta para impresoras térmicas de 58 u 80 mm. No es factura:
// se imprime con el diálogo del navegador desde un iframe aparte, así la
// página del sistema no se toca.

export interface AjustesTicket {
  ancho: 58 | 80;
  encabezado: string;
  pie: string;
  auto: boolean;
}

export const TICKET_INICIAL: AjustesTicket = {
  ancho: 58,
  encabezado: 'Milenio Market',
  pie: '¡Gracias por tu compra!',
  auto: false,
};

export async function leerAjustesTicket(db: BaseKiosco): Promise<AjustesTicket> {
  // Viene de la base (puede venir de una copia o de la nube): se valida cada campo.
  const g = (await leerAjuste<Partial<Record<keyof AjustesTicket, unknown>>>(db, 'ticket', {})) ?? {};
  return {
    ancho: g.ancho === 80 ? 80 : 58,
    encabezado: typeof g.encabezado === 'string' ? g.encabezado.slice(0, 300) : TICKET_INICIAL.encabezado,
    pie: typeof g.pie === 'string' ? g.pie.slice(0, 200) : TICKET_INICIAL.pie,
    auto: g.auto === true,
  };
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function htmlTicket(venta: Venta, a: AjustesTicket): string {
  const fecha = new Date(venta.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  // Reimpreso después de una devolución, el ticket muestra lo que quedó.
  const devuelto = totalDevuelto(venta);
  const renglones = itemsNetos(venta)
    .map((it) => {
      const detalle = it.gramos ? `<div class="sub">${formatoPeso(it.gramos)}${it.cantidad > 1 ? ` x ${Number(it.cantidad)}` : ''}</div>` : it.cantidad > 1 ? `<div class="sub">${Number(it.cantidad)} x ${formatPesos(it.precioUnitario)}</div>` : '';
      const promo = subtotal(it) < it.precioUnitario * it.cantidad ? `<div class="sub">Promo ${Number(it.promo!.cantidad)} x ${formatPesos(it.promo!.precio)}</div>` : '';
      return `<tr><td>${escapar(it.nombre)}${detalle}${promo}</td><td class="der">${formatPesos(subtotal(it))}</td></tr>`;
    })
    .join('');
  const pagos = pagosDeVenta(venta)
    .map((p) => `<tr><td>${escapar(nombreMedio(p.medio))}</td><td class="der">${formatPesos(p.monto)}</td></tr>`)
    .join('');
  const vuelto =
    venta.pagaCon !== null && venta.vuelto > 0
      ? `<tr><td>Pagó con</td><td class="der">${formatPesos(venta.pagaCon)}</td></tr><tr><td>Vuelto</td><td class="der">${formatPesos(venta.vuelto)}</td></tr>`
      : '';
  const encabezado = a.encabezado
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => (i === 0 ? `<div class="nombre">${escapar(l)}</div>` : `<div>${escapar(l)}</div>`))
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
@page { size: ${a.ancho}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm ${a.ancho === 58 ? 2 : 4}mm; width: ${a.ancho}mm; font: ${a.ancho === 58 ? 11 : 12}px/1.3 'Courier New', monospace; color: #000; }
.centro { text-align: center; }
.nombre { font-size: 1.35em; font-weight: 700; }
hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; }
td { vertical-align: top; padding: 1px 0; }
.der { text-align: right; white-space: nowrap; padding-left: 6px; }
.sub { font-size: 0.9em; }
.total td { font-weight: 700; font-size: 1.25em; padding-top: 4px; }
</style></head><body>
<div class="centro">${encabezado}<div>${fecha}</div><div>Venta N° ${venta.id ?? ''}</div></div>
<hr><table>${renglones}</table><hr>
<table><tr class="total"><td>TOTAL</td><td class="der">${formatPesos(venta.total - devuelto)}</td></tr>${devuelto > 0 ? `<tr><td>Cobrado</td><td class="der">${formatPesos(venta.total)}</td></tr><tr><td>Devuelto</td><td class="der">-${formatPesos(devuelto)}</td></tr>` : ''}${pagos}${vuelto}</table>
<hr><div class="centro">${escapar(a.pie)}</div><div class="centro sub">Comprobante no válido como factura</div>
</body></html>`;
}

export function imprimirTicket(venta: Venta, a: AjustesTicket) {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  // Sin scripts: aunque algún texto viniera con HTML, no se ejecuta nada.
  marco.setAttribute('sandbox', 'allow-same-origin allow-modals');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(marco);
  const doc = marco.contentDocument!;
  doc.open();
  doc.write(htmlTicket(venta, a));
  doc.close();
  const imprimir = () => {
    const quitar = () => marco.remove();
    marco.contentWindow?.addEventListener('afterprint', quitar);
    marco.contentWindow?.focus();
    marco.contentWindow?.print();
    window.setTimeout(quitar, 60_000);
  };
  if (doc.readyState === 'complete') window.setTimeout(imprimir, 50);
  else marco.onload = imprimir;
}
