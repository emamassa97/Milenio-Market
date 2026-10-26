import { parsePesos } from './dinero';

export interface FilaImportada {
  codigo: string;
  nombre: string;
  precio: number;
  costo: number;
  stock: number;
  categoria: string;
}

export interface ResultadoImportacion {
  filas: FilaImportada[];
  errores: string[];
}

/** Separa una línea CSV respetando comillas. */
function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!;
    if (enComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else actual += c;
    } else if (c === '"' && actual.trim() === '') {
      enComillas = true;
      actual = '';
    }
    else if (c === separador) {
      campos.push(actual);
      actual = '';
    } else actual += c;
  }
  campos.push(actual);
  return campos.map((x) => x.trim());
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

const COLUMNAS: Record<keyof FilaImportada, string[]> = {
  codigo: ['codigo', 'codigodebarras', 'cod', 'ean', 'barras'],
  nombre: ['nombre', 'producto', 'descripcion', 'articulo', 'detalle'],
  precio: ['precio', 'precioventa', 'preciodeventa', 'pventa', 'venta'],
  costo: ['costo', 'preciocosto', 'preciodecosto', 'compra', 'pcosto'],
  stock: ['stock', 'cantidad', 'existencia'],
  categoria: ['categoria', 'rubro', 'familia'],
};

/**
 * Lee una planilla guardada como CSV (desde Excel: "Guardar como CSV").
 * Necesita al menos las columnas nombre y precio; el resto es opcional.
 */
export function importarCsv(texto: string): ResultadoImportacion {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const errores: string[] = [];
  if (lineas.length < 2) return { filas: [], errores: ['La planilla está vacía o no tiene títulos.'] };
  const encabezado = lineas[0]!;
  const separador = (encabezado.match(/;/g)?.length ?? 0) >= (encabezado.match(/,/g)?.length ?? 0) ? ';' : ',';
  const titulos = partirLinea(encabezado, separador).map(normalizar);
  const indice = {} as Record<keyof FilaImportada, number>;
  for (const [campo, nombres] of Object.entries(COLUMNAS) as [keyof FilaImportada, string[]][]) {
    indice[campo] = titulos.findIndex((t) => nombres.includes(t));
  }
  if (indice.nombre < 0 || indice.precio < 0) {
    return { filas: [], errores: ['Faltan las columnas "nombre" y "precio" en la primera fila.'] };
  }
  const filas: FilaImportada[] = [];
  lineas.slice(1).forEach((linea, n) => {
    const c = partirLinea(linea, separador);
    const tomar = (campo: keyof FilaImportada) => (indice[campo] >= 0 ? (c[indice[campo]] ?? '') : '');
    const nombre = tomar('nombre');
    const precio = parsePesos(tomar('precio'));
    const fila = n + 2;
    if (!nombre) {
      errores.push(`Fila ${fila}: no tiene nombre.`);
      return;
    }
    if (precio === null || precio < 0) {
      errores.push(`Fila ${fila} (${nombre}): el precio "${tomar('precio')}" no es un número.`);
      return;
    }
    const codigo = tomar('codigo').replace(/\s/g, '');
    if (codigo && !/^[0-9A-Za-z-]{1,30}$/.test(codigo)) {
      errores.push(
        `Fila ${fila} (${nombre}): el código "${codigo}" no es válido. Si Excel lo mostró como 7,79E+12, poné esa columna como Texto y volvé a guardar.`,
      );
      return;
    }
    const costoTexto = tomar('costo');
    const costo = costoTexto === '' ? 0 : parsePesos(costoTexto);
    if (costo === null || costo < 0) {
      errores.push(`Fila ${fila} (${nombre}): el costo "${costoTexto}" no es válido.`);
      return;
    }
    const stockTexto = tomar('stock');
    const stock = stockTexto === '' ? 0 : parsePesos(stockTexto);
    if (stock === null) {
      errores.push(`Fila ${fila} (${nombre}): el stock "${stockTexto}" no es un número.`);
      return;
    }
    filas.push({ codigo, nombre, precio, costo, stock, categoria: tomar('categoria') });
  });
  return { filas, errores };
}

function campoCsv(valor: string | number): string {
  const texto = String(valor);
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function exportarCsv(filas: FilaImportada[]): string {
  const titulos = 'codigo;nombre;precio;costo;stock;categoria';
  const cuerpo = filas.map((f) =>
    [f.codigo, f.nombre, f.precio, f.costo, f.stock, f.categoria].map(campoCsv).join(';'),
  );
  return '﻿' + [titulos, ...cuerpo].join('\r\n');
}
