// Tipos de los datos que se guardan en el equipo.
// Regla: un campo nuevo siempre es opcional o tiene valor por defecto,
// para que lo ya guardado se siga leyendo igual.

/** Los importes se guardan en pesos enteros (sin centavos). */
export type Pesos = number;

export type MedioPago = 'efectivo' | 'mercadopago' | 'tarjeta' | 'transferencia' | 'fiado';

export const MEDIOS: { id: MedioPago; nombre: string }[] = [
  { id: 'efectivo', nombre: 'Efectivo' },
  { id: 'mercadopago', nombre: 'Mercado Pago' },
  { id: 'tarjeta', nombre: 'Tarjeta' },
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
  /** A quién se le compra, para armar el pedido por proveedor. */
  proveedor?: string;
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

/** Parte de una venta que volvió: el cliente devolvió o cambió algo ya cobrado. */
export interface Devolucion {
  fecha: number;
  /** Caja abierta cuando se devolvió: la plata sale de ahí. */
  turnoId: number;
  /** Renglón de `items` y cuántas unidades volvieron. */
  items: { indice: number; cantidad: number }[];
  monto: Pesos;
  /** Cómo se devolvió la plata. 'fiado' se descuenta de la cuenta del cliente. */
  medio: MedioPago;
  motivo: string;
  usuario?: string;
}

export interface Venta {
  id?: number;
  fecha: number;
  turnoId: number;
  cajero: string;
  items: ItemVenta[];
  /** Lo cobrado: los renglones menos el descuento. */
  total: Pesos;
  /** Descuento sobre toda la venta ("dejámelo en 3.000"). Si no está, no hubo. */
  descuento?: Pesos;
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
  /** Lo que se devolvió después de cobrar. `total` sigue siendo lo cobrado. */
  devoluciones?: Devolucion[];
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

/** 'devolucion' es plata que vuelve al cliente por una venta ya cobrada; la anota el sistema, no se carga a mano. */
export type TipoMovimientoCaja = 'retiro' | 'gasto' | 'ingreso' | 'devolucion';

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
  /** Devolución: de qué venta salió la plata. */
  ventaId?: number;
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
  /** Cómo pagó (sólo en pagos). Un pago sin medio es una devolución que se descontó de la cuenta. */
  medio: MedioPago | null;
  nota: string;
  anulado: boolean;
  /** Usuario que anuló el pago. */
  anuladoPor?: string;
}

/** Algo que pasó en la caja y conviene que el dueño vea, como una venta cancelada antes de cobrar. */
/** Cosas que el dueño quiere ver después: una venta cancelada antes de cobrar, una devolución. */
export interface Evento {
  id?: number;
  fecha: number;
  tipo: 'cancelacion' | 'devolucion';
  turnoId: number | null;
  monto: Pesos;
  detalle: string;
  usuario?: string;
}
