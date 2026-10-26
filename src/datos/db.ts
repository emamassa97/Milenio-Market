import Dexie, { type Table } from 'dexie';
import type { Cliente, MovimientoCaja, MovimientoFiado, Producto, Turno, Venta } from '../dominio/tipos';

export interface Ajuste {
  clave: string;
  valor: unknown;
}

/** Registro de algo borrado, para borrarlo también en la copia de la nube. */
export interface Borrado {
  n?: number;
  tabla: string;
  id: string;
  fecha: number;
}

/** Tablas que se copian a la nube. Cada fila lleva `_v`: cuándo cambió por última vez. */
export const TABLAS_NUBE = ['productos', 'ventas', 'turnos', 'movimientosCaja', 'clientes', 'movimientosFiado', 'ajustes'] as const;
export type TablaNube = (typeof TABLAS_NUBE)[number];

let ultimaMarca = 0;

/** Un número que siempre crece, aunque se guarden muchas filas en el mismo milisegundo. */
export function nuevaMarca(): number {
  ultimaMarca = Math.max(Date.now(), ultimaMarca + 1);
  return ultimaMarca;
}

/**
 * Base de datos del equipo (IndexedDB). Funciona sin internet.
 * Para cambiar la forma de los datos se agrega un `version(n+1)` nuevo;
 * nunca se modifica uno ya publicado.
 */
export class BaseKiosco extends Dexie {
  productos!: Table<Producto, number>;
  ventas!: Table<Venta, number>;
  turnos!: Table<Turno, number>;
  movimientosCaja!: Table<MovimientoCaja, number>;
  clientes!: Table<Cliente, number>;
  movimientosFiado!: Table<MovimientoFiado, number>;
  ajustes!: Table<Ajuste, string>;
  borrados!: Table<Borrado, number>;

  constructor(nombre = 'milenio-market') {
    super(nombre);
    this.version(1).stores({
      productos: '++id, codigo, nombre, categoria',
      ventas: '++id, fecha, turnoId, clienteId',
      turnos: '++id, apertura',
      movimientosCaja: '++id, turnoId',
      clientes: '++id, nombre',
      movimientosFiado: '++id, clienteId, turnoId, ventaId',
      ajustes: 'clave',
    });
    // Versión 2: copia en la nube. Cada fila suma `_v` (marca de cambio) y se
    // anotan los borrados. No cambia ningún dato ya cargado.
    this.version(2)
      .stores({
        productos: '++id, codigo, nombre, categoria, _v',
        ventas: '++id, fecha, turnoId, clienteId, _v',
        turnos: '++id, apertura, _v',
        movimientosCaja: '++id, turnoId, _v',
        clientes: '++id, nombre, _v',
        movimientosFiado: '++id, clienteId, turnoId, ventaId, _v',
        ajustes: 'clave, _v',
        borrados: '++n',
      })
      .upgrade(async (tx) => {
        let n = 0;
        for (const t of TABLAS_NUBE) {
          await tx
            .table(t)
            .toCollection()
            .modify((fila: Record<string, unknown>) => {
              fila._v = ++n;
            });
        }
      });
    for (const t of TABLAS_NUBE) {
      const tabla = this.table(t);
      tabla.hook('creating', (_clave, fila: Record<string, unknown>) => {
        fila._v = nuevaMarca();
      });
      tabla.hook('updating', () => ({ _v: nuevaMarca() }));
    }
  }
}

export const db = new BaseKiosco();
