import Dexie, { type Table } from 'dexie';
import type { Cliente, MovimientoCaja, MovimientoFiado, Producto, Turno, Venta } from '../dominio/tipos';

export interface Ajuste {
  clave: string;
  valor: unknown;
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
  }
}

export const db = new BaseKiosco();
