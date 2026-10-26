// Tipos de los datos que se guardan en el equipo.
// Regla: un campo nuevo siempre es opcional o tiene valor por defecto,
// para que lo ya guardado se siga leyendo igual.

/** Los importes se guardan en pesos enteros (sin centavos). */
export type Pesos = number;

export type MedioPago = 'efectivo' | 'mercadopago' | 'tarjeta' | 'transferencia' | 'fiado';

export const MEDIOS: { id: MedioPago; nombre: string }[] = [
  { id: 'efectivo', nombre: 'Efectivo' },
  { id: 'mercadopago', nombre: 'Mercado Pago' },
  { id: 'tarjeta', nombre: 'Débito / crédito' },
  { id: 'transferencia', nombre: 'Transferencia' },
  { id: 'fiado', nombre: 'Fiado' },
];

export function nombreMedio(medio: MedioPago): string {
  return MEDIOS.find((m) => m.id === medio)?.nombre ?? medio;
}

export interface Producto {
  id?: number;
  codigo: string;
  nombre: string;
  precio: Pesos;
  costo: Pesos;
  stock: number;
  stockMinimo: number;
  categoria: string;
  /** Aparece como botón grande en la caja. */
  rapido: boolean;
  creado: number;
  actualizado: number;
}

export interface ItemVenta {
  /** null para un monto libre ("Varios"). */
  productoId: number | null;
  codigo: string;
  nombre: string;
  precioUnitario: Pesos;
  costoUnitario: Pesos;
  cantidad: number;
}

export interface Venta {
  id?: number;
  fecha: number;
  turnoId: number;
  cajero: string;
  items: ItemVenta[];
  total: Pesos;
  medio: MedioPago;
  pagaCon: Pesos | null;
  vuelto: Pesos;
  clienteId: number | null;
  anulada: boolean;
  anuladaFecha?: number;
}

export interface Turno {
  id?: number;
  apertura: number;
  cierre: number | null;
  cajero: string;
  fondoInicial: Pesos;
  /** Cuántos billetes de cada uno se contaron al cerrar. */
  conteo: Record<string, number> | null;
  contado: Pesos | null;
  esperado: Pesos | null;
  nota: string;
}

export type TipoMovimientoCaja = 'retiro' | 'gasto' | 'ingreso';

export interface MovimientoCaja {
  id?: number;
  turnoId: number;
  fecha: number;
  tipo: TipoMovimientoCaja;
  monto: Pesos;
  motivo: string;
}

export interface Cliente {
  id?: number;
  nombre: string;
  telefono: string;
  /** 0 = sin límite. */
  limite: Pesos;
  creado: number;
}

export interface MovimientoFiado {
  id?: number;
  clienteId: number;
  fecha: number;
  tipo: 'compra' | 'pago';
  monto: Pesos;
  ventaId: number | null;
  turnoId: number | null;
  /** Cómo pagó (sólo en pagos). */
  medio: MedioPago | null;
  nota: string;
  anulado: boolean;
}
