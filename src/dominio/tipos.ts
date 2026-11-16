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
  /** Otros códigos del mismo producto (el mismo alfajor con otra caja, otro proveedor). */
  codigosAlt?: string[];
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
  /**
   * Combo: al venderlo se descuenta el stock de cada producto que lo forma (ej. 1 Fernet + 2 Coca),
   * no el del combo. Vacío o sin cargar: es un producto común.
   */
  componentes?: Componente[] | null;
  creado: number;
  actualizado: number;
}

/** Un producto que forma parte de un combo, y cuántas unidades lleva cada combo. */
export interface Componente {
  productoId: number;
  cantidad: number;
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
  /** Combo: lo que llevaba cada unidad al venderse. Anular o devolver repone justo eso, aunque después cambie el combo. */
  componentes?: Componente[];
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
  /** La venta armada en la caja de la que salió: la misma no se cobra dos veces (por ejemplo, desde dos pestañas). */
  idCarrito?: string;
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
  /** Número de equipo (en la nube) donde está esta caja: cada compu o celular tiene la suya. */
  equipo?: number;
  /** Cuándo un equipo se quedó con esta caja abierta (gana el más reciente). */
  reclamo?: number;
  /**
   * Hasta dónde vio el cierre: el último id de cada equipo (ventas, movimientos de caja y de fiado).
   * Lo de esta caja que llegue después (otro equipo sin internet) "llegó tarde" y se cuenta en la caja siguiente.
   */
  vistas?: VistasCierre;
  /** Lo que llegó tarde de cajas anteriores y se contó en ésta ('v:id', 'c:id', 'f:id'). */
  absorbidos?: string[];
}

/** Por equipo, el último id visto. */
export type VistoPorEquipo = Record<string, number>;
export interface VistasCierre {
  v: VistoPorEquipo;
  c: VistoPorEquipo;
  f: VistoPorEquipo;
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
  /** En una devolución, la venta (para buscar lo devuelto por fecha sin recorrer todas las ventas). */
  ventaId?: number;
}

// ---------- Compras a proveedores ----------

/** Un renglón de la factura o remito del proveedor, como quedó guardado. */
export interface RenglonCompraGuardado {
  productoId: number;
  /** Copia del nombre al cargarla: el historial se lee igual aunque después se renombre o se borre el producto. */
  nombre: string;
  cantidad: number;
  /** Costo por unidad (o por kilo) de esta compra. */
  costo: Pesos;
  /** Cómo estaban antes de esta compra: para mostrar qué cambió y para deshacerla. */
  costoAnterior: Pesos;
  precioAnterior: Pesos;
  /** Precio de venta después de la compra (igual al anterior si no se cambió). */
  precio: Pesos;
  /** Lo que decía la factura, si se leyó de una foto: así la próxima vez se reconoce solo. */
  descripcion?: string;
  /** El producto se dio de alta con esta compra. */
  nuevo?: true;
}

/** Una factura o remito de un proveedor: sumó stock y puede haber cambiado costos y precios. */
export interface Compra {
  id?: number;
  /** Fecha del comprobante (al mediodía de ese día). */
  fecha: number;
  /** Cuándo se cargó en el sistema. */
  creada: number;
  proveedor: string;
  /** 'Factura', 'Remito'… y su número, como figuran en el papel. Opcionales. */
  comprobante?: string;
  numero?: string;
  renglones: RenglonCompraGuardado[];
  /** Lo que hay que pagarle al proveedor por esta compra. */
  total: Pesos;
  nota?: string;
  /** Se cargó leyendo una foto de la factura. */
  conFoto?: boolean;
  usuario?: string;
  anulada?: boolean;
  anuladaFecha?: number;
  anuladaPor?: string;
}

export type MedioPagoProveedor = 'caja' | 'efectivo' | 'transferencia' | 'mercadopago' | 'cheque';

export const MEDIOS_PROVEEDOR: { id: MedioPagoProveedor; nombre: string; detalle: string }[] = [
  { id: 'caja', nombre: 'Efectivo de la caja', detalle: 'Sale de la caja abierta: se anota solo en el cierre.' },
  { id: 'transferencia', nombre: 'Transferencia', detalle: 'Desde el banco o la billetera.' },
  { id: 'mercadopago', nombre: 'Mercado Pago', detalle: 'Desde la cuenta de Mercado Pago.' },
  { id: 'efectivo', nombre: 'Efectivo de afuera', detalle: 'Plata que no estaba en la caja.' },
  { id: 'cheque', nombre: 'Cheque', detalle: 'Propio o de terceros.' },
];

export function nombreMedioProveedor(medio: MedioPagoProveedor): string {
  return MEDIOS_PROVEEDOR.find((m) => m.id === medio)?.nombre ?? medio;
}

/** Plata que se le dio a un proveedor: al recibir la mercadería o después, a cuenta. */
export interface PagoProveedor {
  id?: number;
  fecha: number;
  proveedor: string;
  monto: Pesos;
  medio: MedioPagoProveedor;
  /** La compra que se pagó (null: a cuenta, para lo que se le deba). */
  compraId: number | null;
  /** Pagado con plata de la caja: la caja y el gasto que se anotó ahí. */
  turnoId?: number;
  movimientoCajaId?: number;
  nota: string;
  usuario?: string;
  anulado: boolean;
  anuladoPor?: string;
}
