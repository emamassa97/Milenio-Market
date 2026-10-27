// Lista de precios para imprimir (A4) y etiquetas para la góndola, a partir de los productos cargados.
// Se imprime con el diálogo del navegador, igual que el ticket: sin scripts, sólo HTML.
import { formatPesos } from '../dominio/dinero';
import type { Producto } from '../dominio/tipos';

export type FormatoLista = 'lista' | 'etiquetas';

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function promoDe(p: Producto): string {
  return p.promo && p.promo.cantidad > 1 ? `${Number(p.promo.cantidad)} x ${formatPesos(p.promo.precio)}` : '';
}

function porCategoria(productos: Producto[]): [string, Producto[]][] {
  const grupos = new Map<string, Producto[]>();
  for (const p of [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const c = p.categoria.trim() || 'Varios';
    const lista = grupos.get(c) ?? [];
    lista.push(p);
    grupos.set(c, lista);
  }
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

const ESTILOS_BASE = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Poppins, Arial, Helvetica, sans-serif; color: #1b1e24; margin: 0; }
`;

/** Lista A4 en dos columnas, por categoría: nombre, promo y precio. */
export function htmlListaPrecios(productos: Producto[], titulo: string, formato: FormatoLista): string {
  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (formato === 'etiquetas') {
    const celdas = [...productos]
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((p) => {
        const promo = promoDe(p);
        return `<div class="etiqueta"><div class="nombre">${escapar(p.nombre)}</div><div class="precio">${formatPesos(p.precio)}</div>${promo ? `<div class="promo">Promo ${promo}</div>` : ''}</div>`;
      })
      .join('');
    return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><title>Etiquetas de precios</title><style>${ESTILOS_BASE}
  @page { margin: 10mm; }
  .hoja { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
  .etiqueta { border: 0.3mm dashed #a3a9b3; height: 34mm; padding: 3mm 3mm 2mm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-inside: avoid; overflow: hidden; }
  .nombre { font-size: 10.5pt; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
  .precio { font-size: 20pt; font-weight: 700; margin-top: 1mm; white-space: nowrap; }
  .promo { font-size: 9pt; color: #e30613; font-weight: 600; margin-top: 0.5mm; }
</style></head><body><div class="hoja">${celdas}</div></body></html>`;
  }
  const grupos = porCategoria(productos)
    .map(
      ([categoria, lista]) =>
        `<section><h2>${escapar(categoria)}</h2><table>${lista
          .map((p) => {
            const promo = promoDe(p);
            return `<tr><td>${escapar(p.nombre)}${promo ? `<small>Promo ${promo}</small>` : ''}</td><td class="precio">${formatPesos(p.precio)}</td></tr>`;
          })
          .join('')}</table></section>`,
    )
    .join('');
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><title>Lista de precios</title><style>${ESTILOS_BASE}
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.6mm solid #e30613; padding-bottom: 2mm; margin-bottom: 4mm; }
  h1 { font-size: 16pt; margin: 0; }
  header span { font-size: 9.5pt; color: #646a75; }
  .columnas { column-count: 2; column-gap: 8mm; }
  section { break-inside: avoid; margin-bottom: 4mm; }
  h2 { font-size: 11pt; margin: 0 0 1mm; padding: 1mm 2mm; background: #1b1e24; color: #fff; border-radius: 1mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  td { padding: 1mm 2mm; border-bottom: 0.2mm solid #e3e5e8; vertical-align: top; }
  td.precio { text-align: right; white-space: nowrap; font-weight: 600; }
  small { display: block; color: #e30613; font-weight: 600; font-size: 8pt; }
  footer { margin-top: 4mm; font-size: 8.5pt; color: #646a75; text-align: center; }
</style></head><body><header><h1>${escapar(titulo)}</h1><span>Lista de precios · ${fecha}</span></header><div class="columnas">${grupos}</div><footer>Precios en pesos, pueden cambiar sin aviso.</footer></body></html>`;
}
