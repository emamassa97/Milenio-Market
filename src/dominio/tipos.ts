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
  /** Se vende por peso: el precio y el costo son por kilo, y el stock va en kilos. */
  porPeso?: boolean;
  /** Promo por cantidad, ej. 2 por $1.500. */
  promo?: Promo | null;
  /** Fecha de vencimiento más próxima, 'AAAA-MM-DD'. */
  vence?: string | null;
  creado: number;
  actualizado: number;
}

export interface Promo {
  cantidad: number;
  precio: Pesos;
}

export interface Pago {
  medio: MedioPago;
  monto: Pesos;
}

export interface ItemVenta {
  /** null para un monto libre ("Varios"). */
  productoId: number | null;
  codigo: string;
  nombre: string;
  precioUnitario: Pesos;
  costoUnitario: Pesos;
  cantidad: number;
  /** Venta por peso: cuántos gramos. El precio unitario ya es el de esos gramos. */
  gramos?: number;
  promo?: Promo | null;
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
  /** Pago dividido en varios medios. Si no está, se pagó todo con `medio`. */
  pagos?: Pago[];
  clienteId: number | null;
  anulada: boolean;
  anuladaFecha?: number;
  /** Usuario que cobró (el que inició sesión). */
  usuario?: string;
  /** Usuario que anuló la venta. */
  anuladaPor?: string;
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
  /** Usuario que abrió la caja. */
  usuario?: string;
  /** Usuario que cerró la caja. */
  usuarioCierre?: string;
}

export type TipoMovimientoCaja = 'retiro' | 'gasto' | 'ingreso';

export interface MovimientoCaja {
  id?: number;
  turnoId: number;
  fecha: number;
  tipo: TipoMovimientoCaja;
  monto: Pesos;
  motivo: string;
  /** Usuario que hizo el retiro, gasto o ingreso. */
  usuario?: string;
  /** Pago de mercadería: ya está en el costo, no cuenta como gasto del local. */
  mercaderia?: boolean;
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
