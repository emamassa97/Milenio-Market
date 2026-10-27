import { useEffect, useMemo, useRef, useState } from 'react';
import { exportarCsv, importarCsv, type ResultadoImportacion } from '../dominio/csv';
import { formatPesos } from '../dominio/dinero';
import { cantidadDeTexto, codigoEscaneado, normalizarTexto as normalizar } from '../dominio/entrada';
import { aplicarAumento, margen, precioParaMargen, type Redondeo } from '../dominio/precios';
import type { Producto } from '../dominio/tipos';
import { diasParaVencer } from '../dominio/reportes';
import { db } from '../datos/db';
import {
  ajustarStock,
  aumentoMasivo,
  borrarProducto,
  buscarPorCodigo,
  cargarPlanilla,
  guardarProducto,
  ingresarMercaderia,
  type DatosProducto,
} from '../datos/operaciones';
import { CampoPesos, copiarTexto, descargarArchivo, Desplegable, errorATexto, Icono, Modal, sinCortes, useAvisar, Vacio } from '../ui/componentes';
import { Escaner } from '../ui/Escaner';
import { pitido, useConsulta, useUnaVez } from '../ui/hooks';
import { useEsDueño } from '../ui/permisos';
import { useSesion } from '../ui/sesion';

type Filtro = 'todos' | 'reponer' | 'vencen' | 'promos' | 'rapidos' | 'sinCodigo' | 'sinCosto';

const FILTROS: { id: Filtro; nombre: string }[] = [
  { id: 'todos', nombre: 'Todos' },
  { id: 'reponer', nombre: 'Para reponer' },
  { id: 'vencen', nombre: 'Por vencer' },
  { id: 'promos', nombre: 'Con promo' },
  { id: 'rapidos', nombre: 'Rápidos' },
  { id: 'sinCodigo', nombre: 'Sin código' },
  { id: 'sinCosto', nombre: 'Sin costo' },
];

const necesitaReponer = (p: Producto) => p.stockMinimo > 0 && p.stock <= p.stockMinimo;
const vencePronto = (p: Producto) => !!p.vence && diasParaVencer(p.vence) <= 15;
const textoStock = (p: Producto) => (p.porPeso ? `${p.stock.toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg` : String(p.stock));

export function PantallaProductos() {
  const avisar = useAvisar();
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const [q, setQ] = useState('');
  // El panel de inicio puede mandar acá con un filtro puesto ("para reponer", "por vencer").
  const [filtro, setFiltro] = useState<Filtro>(() => {
    try {
      const f = sessionStorage.getItem('milenio.filtroProductos');
      return f === 'reponer' || f === 'vencen' ? f : 'todos';
    } catch {
      return 'todos';
    }
  });
  useEffect(() => {
    // Se usa una sola vez: la próxima entrada a Productos arranca en "Todos".
    try {
      sessionStorage.removeItem('milenio.filtroProductos');
    } catch {
      /* sin sessionStorage no hay nada que borrar */
    }
  }, []);
  const [categoria, setCategoria] = useState('');
  const [modal, setModal] = useState<
    | null
    | { tipo: 'editar'; producto?: Producto }
    | { tipo: 'aumento' }
    | { tipo: 'planilla' }
    | { tipo: 'stock'; producto: Producto }
    | { tipo: 'pedido' }
    | { tipo: 'compra' }
  >(null);
  const [menuAcciones, setMenuAcciones] = useState(false);

  const categorias = useMemo(
    () => [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [productos],
  );
  const proveedores = useMemo(
    () => [...new Set(productos.map((p) => p.proveedor?.trim() ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [productos],
  );

  const visibles = useMemo(() => {
    const palabras = normalizar(q.trim()).split(/\s+/).filter(Boolean);
    return productos
      .filter((p) => {
        if (categoria && p.categoria !== categoria) return false;
        if (filtro === 'reponer' && !necesitaReponer(p)) return false;
        if (filtro === 'rapidos' && !p.rapido) return false;
        if (filtro === 'vencen' && !vencePronto(p)) return false;
        if (filtro === 'promos' && !p.promo) return false;
        if (filtro === 'sinCodigo' && p.codigo) return false;
        if (filtro === 'sinCosto' && p.costo > 0) return false;
        const texto = normalizar(`${p.nombre} ${p.codigo} ${p.categoria}`);
        return palabras.every((w) => texto.includes(w));
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [productos, q, filtro, categoria]);

  const cuantosReponer = productos.filter(necesitaReponer).length;

  const alternarRapido = async (p: Producto) => {
    try {
      const { id, creado: _c, actualizado: _a, ...datos } = p;
      await guardarProducto(db, { ...datos, rapido: !p.rapido }, id, p.stock);
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
  };

  // Las acciones secundarias: botones en PC, una hoja desde "Más" en el celular.
  const acciones = [
    { id: 'compra', texto: 'Llegó mercadería', icono: 'camion', deshabilitado: productos.length === 0 },
    { id: 'pedido', texto: 'Pedido al proveedor', icono: 'whatsapp', deshabilitado: productos.length === 0 },
    { id: 'aumento', texto: 'Aumentar precios', icono: 'porcentaje', deshabilitado: productos.length === 0 },
    { id: 'planilla', texto: 'Planilla Excel', icono: 'subir', deshabilitado: false },
  ] as const;

  return (
    <div className="pagina">
      <div className="pagina-cabecera">
        <div>
          <h1>Productos</h1>
          <p className="texto-suave">
            {productos.length} cargados
            {cuantosReponer > 0 && (
              <>
                {' · '}
                <button type="button" className="enlace texto-aviso" onClick={() => setFiltro('reponer')}>
                  {cuantosReponer} para reponer
                </button>
              </>
            )}
          </p>
        </div>
        <div className="botonera solo-pc">
          {acciones.map((a) => (
            <button key={a.id} type="button" className="boton" onClick={() => setModal({ tipo: a.id })} disabled={a.deshabilitado}>
              <Icono nombre={a.icono} tam={18} /> {a.texto}
            </button>
          ))}
          <button type="button" className="boton boton-primario" onClick={() => setModal({ tipo: 'editar' })}>
            <Icono nombre="mas" tam={18} /> Nuevo producto
          </button>
        </div>
        <div className="botonera solo-movil">
          <button type="button" className="boton boton-chico" onClick={() => setModal({ tipo: 'compra' })} disabled={productos.length === 0}>
            <Icono nombre="camion" tam={18} /> Llegó mercadería
          </button>
          <button type="button" className="boton boton-chico" aria-expanded={menuAcciones} onClick={() => setMenuAcciones(true)}>
            <Icono nombre="menu" tam={18} /> Más acciones
          </button>
        </div>
      </div>
      <button type="button" className="fab" onClick={() => setModal({ tipo: 'editar' })} aria-label="Nuevo producto" title="Nuevo producto">
        <Icono nombre="mas" tam={26} />
      </button>
      {menuAcciones && (
        <>
          <button type="button" className="hoja-fondo" aria-label="Cerrar" onClick={() => setMenuAcciones(false)} />
          <div className="hoja" role="menu">
            {acciones.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                disabled={a.deshabilitado}
                onClick={() => {
                  setMenuAcciones(false);
                  setModal({ tipo: a.id });
                }}
              >
                <Icono nombre={a.icono} tam={22} /> {a.texto}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="filtros">
        <div className="buscador-campo buscador-chico">
          <Icono nombre="buscar" tam={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar producto" />
        </div>
        <div className="chips" role="group" aria-label="Filtro">
          {categorias.length > 0 && (
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className={`chip ${filtro === f.id ? 'activo' : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.nombre}
            </button>
          ))}
        </div>
      </div>

      {productos.length === 0 ? (
        <Vacio titulo="Todavía no hay productos" icono="productos">
          <p className="texto-suave">Cargalos uno por uno, con una planilla de Excel, o directamente escaneando en la caja: si el código no existe, el sistema te pide el nombre y el precio.</p>
        </Vacio>
      ) : visibles.length === 0 ? (
        <Vacio titulo="No hay productos con ese filtro" icono="buscar" />
      ) : (
        <div className="tarjeta tabla-productos">
          <div className="tabla-encabezado" aria-hidden="true">
            <span>Producto</span>
            <span>Precio</span>
            <span>Costo</span>
            <span>Margen</span>
            <span>Stock</span>
            <span />
          </div>
          <ul>
            {visibles.map((p) => {
              const m = margen(p.precio, p.costo);
              return (
                <li key={p.id} className="fila-producto">
                  <div className="fila-producto-nombre">
                    <strong>{sinCortes(p.nombre)}</strong>
                    <small>
                      {p.categoria || 'Sin categoría'}
                      <span className="codigo"> · {p.codigo || 'sin código'}</span>
                    </small>
                    {(p.porPeso || p.promo || p.vence) && (
                      <span className="insignias">
                        {p.porPeso && <span className="insignia">Por kilo</span>}
                        {p.promo && (
                          <span className="insignia insignia-promo">
                            {p.promo.cantidad} x {formatPesos(p.promo.precio)}
                          </span>
                        )}
                        {p.vence && <Vencimiento vence={p.vence} />}
                      </span>
                    )}
                  </div>
                  <span className="importe fila-precio">{formatPesos(p.precio)}</span>
                  <span className="importe fila-costo texto-suave">{p.costo > 0 ? formatPesos(p.costo) : '—'}</span>
                  <span className="fila-margen">{m !== null && p.costo > 0 ? `${m}%` : ''}</span>
                  <button type="button" className={`stock ${p.stock <= 0 ? 'stock-cero' : necesitaReponer(p) ? 'stock-bajo' : ''}`} onClick={() => setModal({ tipo: 'stock', producto: p })} aria-label={`Stock de ${p.nombre}: ${p.stock}. Sumar o corregir`}>
                    {textoStock(p)}
                  </button>
                  <div className="fila-acciones">
                    <button type="button" className={`boton-icono ${p.rapido ? 'estrella-activa' : ''}`} onClick={() => alternarRapido(p)} aria-pressed={p.rapido} aria-label={p.rapido ? `Sacar ${p.nombre} de rápidos` : `Poner ${p.nombre} en rápidos`} title="Botón rápido en la caja">
                      <Icono nombre="estrella" tam={20} />
                    </button>
                    <button type="button" className="boton-icono" onClick={() => setModal({ tipo: 'editar', producto: p })} aria-label={`Editar ${p.nombre}`}>
                      <Icono nombre="lapiz" tam={20} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {modal?.tipo === 'editar' && <EditarProducto producto={modal.producto} categorias={categorias} proveedores={proveedores} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'aumento' && <AumentoPrecios productos={productos} visibles={visibles} categorias={categorias} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'planilla' && <Planilla productos={productos} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'stock' && <SumarStock producto={modal.producto} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'compra' && <IngresoMercaderia productos={productos} proveedores={proveedores} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'pedido' && <PedidoProveedor productos={productos} onCerrar={() => setModal(null)} />}
    </div>
  );
}

function EditarProducto({ producto, categorias, proveedores, onCerrar }: { producto?: Producto; categorias: string[]; proveedores: string[]; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [d, setD] = useState<DatosProducto>(
    producto
      ? {
          codigo: producto.codigo,
          nombre: producto.nombre,
          precio: producto.precio,
          costo: producto.costo,
          stock: producto.stock,
          stockMinimo: producto.stockMinimo,
          categoria: producto.categoria,
          rapido: producto.rapido,
          porPeso: producto.porPeso ?? false,
          promo: producto.promo ?? null,
          vence: producto.vence ?? null,
          proveedor: producto.proveedor ?? '',
        }
      : { codigo: '', nombre: '', precio: 0, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, porPeso: false, promo: null, vence: null, proveedor: '' },
  );
  const [precio, setPrecio] = useState<number | null>(producto ? producto.precio : null);
  const [costo, setCosto] = useState<number | null>(producto && producto.costo > 0 ? producto.costo : null);
  const [stockTexto, setStockTexto] = useState(producto ? String(producto.stock).replace('.', ',') : '0');
  const [promoCant, setPromoCant] = useState(producto?.promo ? String(producto.promo.cantidad) : '');
  const [promoPrecio, setPromoPrecio] = useState<number | null>(producto?.promo?.precio ?? null);
  const [masOpciones, setMasOpciones] = useState(!!(producto?.porPeso || producto?.promo || producto?.vence));
  const [camara, setCamara] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [enCurso, unaVez] = useUnaVez();
  const m = margen(precio ?? 0, costo ?? 0);

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    unaVez(async () => {
      try {
        const cant = Number(promoCant) || 0;
        const promo = cant > 1 && promoPrecio ? { cantidad: cant, precio: promoPrecio } : null;
        const stock = Number(stockTexto.replace(',', '.')) || 0;
        await guardarProducto(db, { ...d, stock, promo, precio: precio ?? 0, costo: costo ?? 0 }, producto?.id, producto?.stock);
        avisar({ texto: producto ? 'Cambios guardados.' : `"${d.nombre.trim()}" cargado.`, tipo: 'ok' });
        onCerrar();
      } catch (err) {
        avisar({ texto: errorATexto(err), tipo: 'error' });
      }
    });
  };

  const borrar = async () => {
    if (!producto?.id) return;
    if (!confirmarBorrar) return setConfirmarBorrar(true);
    await borrarProducto(db, producto.id);
    avisar({ texto: `"${producto.nombre}" borrado. Las ventas viejas lo siguen mostrando.`, tipo: 'info' });
    onCerrar();
  };

  return (
    <Modal titulo={producto ? 'Editar producto' : 'Nuevo producto'} onCerrar={onCerrar}>
      <form className="formulario" onSubmit={guardar}>
        <label className="campo">
          <span className="campo-etiqueta">Nombre</span>
          <input value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} autoFocus={!producto} placeholder="Ej.: Coca-Cola 500 ml" />
        </label>
        <label className="campo">
          <span className="campo-etiqueta">Código de barras</span>
          <div className="campo-con-boton">
            <input
              value={d.codigo}
              onChange={(e) => setD({ ...d, codigo: e.target.value.trim() })}
              placeholder="Pasalo por el lector"
              inputMode="numeric"
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
            <button type="button" className="boton boton-cuadrado" onClick={() => setCamara(true)} aria-label="Leer código con la cámara">
              <Icono nombre="camara" />
            </button>
          </div>
        </label>
        <div className="fila-campos">
          <CampoPesos etiqueta={d.porPeso ? 'Precio por kilo' : 'Precio de venta'} valor={precio} onCambio={setPrecio} />
          <CampoPesos etiqueta={d.porPeso ? 'Costo por kilo (opcional)' : 'Costo (opcional)'} valor={costo} onCambio={setCosto} />
        </div>
        {m !== null && <p className="texto-suave">Ganás {formatPesos((precio ?? 0) - (costo ?? 0))} por {d.porPeso ? 'kilo' : 'unidad'} ({m}% del precio).</p>}
        <div className="fila-campos">
          <label className="campo">
            <span className="campo-etiqueta">{d.porPeso ? 'Stock (kilos)' : 'Stock actual'}</span>
            <input inputMode="decimal" value={stockTexto} onChange={(e) => setStockTexto(e.target.value.replace(d.porPeso ? /[^\d,.-]/g : /[^\d-]/g, ''))} />
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Avisar cuando queden</span>
            <input inputMode="numeric" value={d.stockMinimo} onChange={(e) => setD({ ...d, stockMinimo: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </label>
        </div>
        <div className="fila-campos">
          <label className="campo">
            <span className="campo-etiqueta">Categoría</span>
            <input list="categorias" value={d.categoria} onChange={(e) => setD({ ...d, categoria: e.target.value })} placeholder="Ej.: Bebidas, Golosinas" />
            <datalist id="categorias">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Proveedor (opcional)</span>
            <input list="proveedores" value={d.proveedor ?? ''} onChange={(e) => setD({ ...d, proveedor: e.target.value })} placeholder="Para armar el pedido" />
            <datalist id="proveedores">
              {proveedores.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="casilla">
          <input type="checkbox" checked={d.rapido} onChange={(e) => setD({ ...d, rapido: e.target.checked })} />
          <span>Botón rápido en la caja (para lo que más sale)</span>
        </label>
        <Desplegable abierto={masOpciones} titulo="Venta por peso, promo y vencimiento" onClick={() => setMasOpciones(!masOpciones)} />
        {masOpciones && (
          <div className="formulario opciones-producto">
            <label className="casilla">
              <input type="checkbox" checked={!!d.porPeso} onChange={(e) => setD({ ...d, porPeso: e.target.checked })} />
              <span>Se vende por peso (fiambre, queso, golosinas sueltas): en la caja pide los gramos</span>
            </label>
            <div className="fila-campos">
              <label className="campo">
                <span className="campo-etiqueta">Promo: llevando</span>
                <input inputMode="numeric" value={promoCant} onChange={(e) => setPromoCant(e.target.value.replace(/\D/g, ''))} placeholder="Ej.: 2" disabled={!!d.porPeso} />
              </label>
              <CampoPesos etiqueta="pagan en total" valor={promoPrecio} onCambio={setPromoPrecio} placeholder="Ej.: 1500" />
            </div>
            {Number(promoCant) > 1 && promoPrecio !== null && precio !== null && promoPrecio >= precio * Number(promoCant) && (
              <p className="texto-alerta">Con ese precio la promo no tiene descuento.</p>
            )}
            <label className="campo">
              <span className="campo-etiqueta">Vence (el lote más próximo)</span>
              <input type="date" value={d.vence ?? ''} onChange={(e) => setD({ ...d, vence: e.target.value || null })} />
            </label>
          </div>
        )}
        <div className="botonera botonera-final">
          {producto && (
            <button type="button" className={`boton ${confirmarBorrar ? 'boton-peligro' : 'boton-texto-peligro'}`} onClick={borrar}>
              {confirmarBorrar ? 'Sí, borrar' : 'Borrar'}
            </button>
          )}
          <button type="submit" className="boton boton-primario" disabled={!d.nombre.trim() || precio === null || enCurso}>
            Guardar
          </button>
        </div>
      </form>
      {camara && (
        <Escaner
          onCerrar={() => setCamara(false)}
          onCodigo={async (codigo) => {
            setCamara(false);
            const otro = await buscarPorCodigo(db, codigo);
            if (otro && otro.id !== producto?.id) avisar({ texto: `Ese código ya es de "${otro.nombre}".`, tipo: 'error' });
            else setD((x) => ({ ...x, codigo }));
          }}
        />
      )}
    </Modal>
  );
}

function SumarStock({ producto, onCerrar }: { producto: Producto; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [cantidad, setCantidad] = useState('');
  const n = producto.porPeso
    ? Math.round((Number(cantidad.replace(',', '.').replace(/[^\d.-]/g, '')) || 0) * 1000) / 1000
    : Number(cantidad.replace(/[^\d-]/g, '')) || 0;
  const quedan = Math.round((producto.stock + n) * 1000) / 1000;
  const unidad = producto.porPeso ? ' kg' : '';
  const [enCurso, unaVez] = useUnaVez();
  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (!n) return;
          unaVez(async () => {
            try {
              await ajustarStock(db, producto.id!, n);
              avisar({ texto: `Stock de ${producto.nombre}: ${quedan}${unidad}.`, tipo: 'ok' });
              onCerrar();
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <p>
          Hay <strong>{textoStock(producto)}</strong>. ¿{producto.porPeso ? 'Cuántos kilos' : 'Cuántos'} llegaron? (para restar, poné un menos adelante: -2)
        </p>
        <input inputMode={producto.porPeso ? 'decimal' : 'numeric'} autoFocus value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-label="Cantidad a sumar" placeholder={producto.porPeso ? 'Ej.: 2,5' : 'Ej.: 24'} />
        <div className="sugeridos">
          {[6, 12, 24, 48].map((x) => (
            <button key={x} type="button" className="chip" onClick={() => setCantidad(String(x))}>
              +{x}
            </button>
          ))}
        </div>
        <p className="texto-suave texto-centrado">{n ? `Van a quedar ${quedan}${unidad}.` : `Quedan ${textoStock(producto)}.`}</p>
        <button className="boton boton-primario boton-grande" type="submit" disabled={!n || enCurso || Math.abs(n) > 99999}>
          {!n ? 'Sumar al stock' : n > 0 ? `Sumar ${n}${unidad}` : `Restar ${-n}${unidad}`}
        </button>
      </form>
    </Modal>
  );
}

function AumentoPrecios({
  productos,
  visibles,
  categorias,
  onCerrar,
}: {
  productos: Producto[];
  visibles: Producto[];
  categorias: string[];
  onCerrar: () => void;
}) {
  const avisar = useAvisar();
  const [alcance, setAlcance] = useState<string>(visibles.length < productos.length ? 'visibles' : 'todos');
  const [porcentaje, setPorcentaje] = useState('');
  const [redondeo, setRedondeo] = useState<Redondeo>(10);
  const [costo, setCosto] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const pct = Number(porcentaje.replace(',', '.'));
  const valido = porcentaje.trim() !== '' && Number.isFinite(pct) && pct !== 0 && pct > -100;
  const elegidos =
    alcance === 'todos' ? productos : alcance === 'visibles' ? visibles : productos.filter((p) => p.categoria === alcance);

  return (
    <Modal titulo="Aumentar precios" onCerrar={onCerrar} ancho="ancho">
      <form
        className="formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valido || aplicando) return;
          setAplicando(true);
          try {
            const n = await aumentoMasivo(db, elegidos.map((p) => p.id!), pct, redondeo, costo);
            avisar({ texto: `Listo: ${n} precios ${pct > 0 ? 'aumentados' : 'bajados'} ${Math.abs(pct)}%.`, tipo: 'ok' });
            onCerrar();
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
            setAplicando(false);
          }
        }}
      >
        <div className="fila-campos">
          <label className="campo">
            <span className="campo-etiqueta">¿A qué productos?</span>
            <select value={alcance} onChange={(e) => setAlcance(e.target.value)}>
              <option value="todos">Todos ({productos.length})</option>
              {visibles.length < productos.length && <option value="visibles">Los que estoy viendo ({visibles.length})</option>}
              {categorias.map((c) => (
                <option key={c} value={c}>
                  Categoría {c}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Porcentaje</span>
            <div className="campo-pesos">
              <input inputMode="decimal" autoFocus value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} placeholder="Ej.: 8" />
              <span aria-hidden="true">%</span>
            </div>
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Redondear a</span>
            <select value={redondeo} onChange={(e) => setRedondeo(Number(e.target.value) as Redondeo)}>
              <option value={1}>Sin redondeo</option>
              <option value={10}>$ 10</option>
              <option value={50}>$ 50</option>
              <option value={100}>$ 100</option>
            </select>
          </label>
        </div>
        <label className="casilla">
          <input type="checkbox" checked={costo} onChange={(e) => setCosto(e.target.checked)} />
          <span>Subir también el costo, para que la ganancia no quede mal calculada</span>
        </label>
        {valido && (
          <div className="vista-previa">
            <p className="titulo-chico">Así quedan ({elegidos.length} productos)</p>
            <ul>
              {elegidos.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <span>{p.nombre}</span>
                  <span className="importe">
                    <s className="texto-suave">{formatPesos(p.precio)}</s> → <strong>{formatPesos(aplicarAumento(p.precio, pct, redondeo))}</strong>
                  </span>
                </li>
              ))}
            </ul>
            {elegidos.length > 6 && <p className="texto-suave">y {elegidos.length - 6} más.</p>}
          </div>
        )}
        {!valido && <p className="texto-suave texto-centrado">Poné el porcentaje para ver cómo quedan los precios.</p>}
        <button className="boton boton-primario boton-grande" type="submit" disabled={!valido || elegidos.length === 0 || aplicando}>
          {valido ? `${pct > 0 ? 'Aumentar' : 'Bajar'} ${Math.abs(pct)}% a ${elegidos.length} productos` : 'Aplicar a los precios'}
        </button>
      </form>
    </Modal>
  );
}

function Planilla({ productos, onCerrar }: { productos: Producto[]; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const codigos = new Set(productos.map((p) => p.codigo).filter(Boolean));
  const actualiza = resultado?.filas.filter((f) => f.codigo && codigos.has(f.codigo)).length ?? 0;

  const descargar = () => {
    const filas = [...productos]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, costo: p.costo, stock: p.stock, categoria: p.categoria, proveedor: p.proveedor ?? '' }));
    descargarArchivo(`productos-milenio-${new Date().toISOString().slice(0, 10)}.csv`, exportarCsv(filas), 'text/csv;charset=utf-8');
  };

  return (
    <Modal titulo="Planilla de Excel" onCerrar={onCerrar} ancho="ancho">
      <div className="formulario">
        <div className="dos-columnas">
          <div>
            <h3>Bajar la lista</h3>
            <p className="texto-suave">Para revisarla en Excel o mandársela a alguien.</p>
            <button type="button" className="boton" onClick={descargar} disabled={productos.length === 0}>
              <Icono nombre="descargar" tam={18} /> Descargar planilla
            </button>
          </div>
          <div>
            <h3>Cargar una lista</h3>
            <p className="texto-suave">
              En Excel, <em>Guardar como → CSV</em>. Columnas: <strong>nombre</strong> y <strong>precio</strong> (obligatorias), y si querés código, costo, stock, categoría y proveedor. Si el código ya existe, se actualiza el precio y no se toca el stock.
            </p>
            <label className="boton">
              <Icono nombre="subir" tam={18} /> Elegir planilla CSV
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={async (e) => {
                  const archivo = e.target.files?.[0];
                  if (!archivo) return;
                  setResultado(importarCsv(await archivo.text()));
                }}
              />
            </label>
          </div>
        </div>
        {resultado && (
          <div className="vista-previa">
            <p>
              <strong>{resultado.filas.length - actualiza}</strong> productos nuevos y <strong>{actualiza}</strong> que se actualizan.
            </p>
            {resultado.errores.length > 0 && (
              <details open={resultado.filas.length === 0}>
                <summary className="texto-alerta">{resultado.errores.length} filas no se pueden leer (no se cargan)</summary>
                <ul>
                  {resultado.errores.slice(0, 20).map((er) => (
                    <li key={er}>{er}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              type="button"
              className="boton boton-primario boton-grande"
              disabled={resultado.filas.length === 0 || aplicando}
              onClick={async () => {
                setAplicando(true);
                try {
                  const r = await cargarPlanilla(db, resultado.filas);
                  avisar({ texto: `Listo: ${r.nuevos} nuevos y ${r.actualizados} actualizados.`, tipo: 'ok' });
                  onCerrar();
                } catch (err) {
                  avisar({ texto: errorATexto(err), tipo: 'error' });
                  setAplicando(false);
                }
              }}
            >
              Cargar {resultado.filas.length} productos
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const SIN_PROVEEDOR = 'Sin proveedor';
const proveedorDe = (p: Producto) => p.proveedor?.trim() || SIN_PROVEEDOR;

/** Cuánto pedir: lo que falta para tener el doble del mínimo, en cajas de 6 (los kilos, enteros). */
function cantidadSugerida(p: Producto): number {
  const falta = Math.max(1, p.stockMinimo * 2 - p.stock);
  return p.porPeso ? Math.ceil(falta) : Math.ceil(falta / 6) * 6;
}

function PedidoProveedor({ productos, onCerrar }: { productos: Producto[]; onCerrar: () => void }) {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  // Arranca con lo que está por debajo del mínimo; se puede agregar cualquier otro producto.
  const [ids, setIds] = useState<number[]>(() => productos.filter(necesitaReponer).map((p) => p.id!));
  const [cantidades, setCantidades] = useState<Record<number, number>>(() =>
    Object.fromEntries(productos.filter(necesitaReponer).map((p) => [p.id!, cantidadSugerida(p)])),
  );
  const [q, setQ] = useState('');
  const buscador = useRef<HTMLInputElement>(null);
  const elegidos = useMemo(() => ids.map((id) => productos.find((p) => p.id === id)).filter((p): p is Producto => !!p), [ids, productos]);
  // Un pedido por proveedor: cada uno recibe sólo lo suyo.
  const grupos = useMemo(() => {
    const m = new Map<string, Producto[]>();
    for (const p of elegidos) {
      const k = proveedorDe(p);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === SIN_PROVEEDOR ? 1 : b === SIN_PROVEEDOR ? -1 : a.localeCompare(b)));
  }, [elegidos]);
  const [elegido, setGrupo] = useState<string | null>(null);
  // Si el grupo elegido desapareció (se repuso desde otro equipo), se pasa al primero.
  const grupo = elegido !== null && grupos.some(([k]) => k === elegido) ? elegido : (grupos[0]?.[0] ?? SIN_PROVEEDOR);
  const lista = grupos.find(([k]) => k === grupo)?.[1] ?? [];
  // Primero los del mismo proveedor; los demás, con su proveedor al lado.
  const encontrados = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    return productos
      .filter((p) => !ids.includes(p.id!) && (p.codigo === q.trim() || normalizar(p.nombre).includes(t)))
      .sort((a, b) => Number(proveedorDe(b) === grupo) - Number(proveedorDe(a) === grupo) || a.nombre.localeCompare(b.nombre))
      .slice(0, 6);
  }, [q, productos, ids, grupo]);
  const agregar = (p: Producto) => {
    setIds((x) => [...x, p.id!]);
    setCantidades((c) => ({ ...c, [p.id!]: cantidadSugerida(p) }));
    setGrupo(proveedorDe(p));
    setQ('');
    buscador.current?.focus();
  };
  const sacar = (p: Producto) => setIds((x) => x.filter((id) => id !== p.id));
  const fecha = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  const texto = [
    `Hola${grupo === SIN_PROVEEDOR ? '' : ` ${grupo}`}, te paso el pedido de Milenio Market (${fecha}):`,
    ...lista.filter((p) => (cantidades[p.id!] ?? 0) > 0).map((p) => `• ${cantidades[p.id!]}${p.porPeso ? ' kg de' : ' x'} ${p.nombre}`),
    `Gracias!${sesion ? ` — ${sesion.nombre.split(' ')[0]}` : ''}`,
  ].join('\n');
  const hayQuePedir = lista.some((p) => (cantidades[p.id!] ?? 0) > 0);
  return (
    <Modal titulo="Pedido al proveedor" onCerrar={onCerrar} ancho="ancho">
      <div className="formulario">
        <p className="texto-suave">
          {elegidos.length === 0 ? 'Nada está por debajo del mínimo. Buscá lo que quieras pedir.' : 'Ya está lo que bajó del mínimo. Ajustá las cantidades, agregá lo que falte y mandalo por WhatsApp.'}
        </p>
        {grupos.length > 1 && (
          <div className="chips" role="group" aria-label="Proveedor">
            {grupos.map(([k, ps]) => (
              <button key={k} type="button" className={`chip ${grupo === k ? 'activo' : ''}`} aria-pressed={grupo === k} onClick={() => setGrupo(k)}>
                {k} ({ps.length})
              </button>
            ))}
          </div>
        )}
        {lista.length > 0 && (
          <div className="lista-pedido" role="table" aria-label={`Pedido a ${grupo}`}>
            <div className="lista-pedido-cabecera texto-suave" role="row">
              <span>Producto</span>
              <span>Quedan</span>
              <span>Pedir</span>
              <span />
            </div>
            {lista.map((p) => (
              <div key={p.id} className="lista-pedido-fila" role="row">
                <span className="lista-pedido-nombre">{sinCortes(p.nombre)}</span>
                <span className={`lista-pedido-quedan ${necesitaReponer(p) ? 'texto-aviso' : ''}`}>
                  {textoStock(p)}
                  {p.stockMinimo > 0 && <small className="texto-suave">mín. {p.stockMinimo}</small>}
                </span>
                <input
                  inputMode="numeric"
                  aria-label={`Cantidad a pedir de ${p.nombre}`}
                  value={cantidades[p.id!] ?? 0}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setCantidades({ ...cantidades, [p.id!]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                />
                <button type="button" className="boton-icono" aria-label={`Sacar ${p.nombre} del pedido`} onClick={() => sacar(p)}>
                  <Icono nombre="basura" tam={18} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="buscador-campo buscador-chico ingreso-buscador">
          <Icono nombre="buscar" tam={18} />
          <input
            ref={buscador}
            value={q}
            autoFocus={elegidos.length === 0}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (encontrados[0]) agregar(encontrados[0]);
              }
            }}
            placeholder={grupo === SIN_PROVEEDOR || grupos.length === 0 || window.innerWidth < 600 ? 'Agregar otro producto' : `Agregar otro producto de ${grupo}`}
            aria-label="Agregar producto al pedido"
          />
          {encontrados.length > 0 && (
            <ul className="resultados">
              {encontrados.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => agregar(p)}>
                    <span>
                      <strong>{p.nombre}</strong>
                      <small>
                        quedan {textoStock(p)}
                        {proveedorDe(p) !== grupo && ` · ${proveedorDe(p)}`}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="botonera botonera-final">
          <button
            type="button"
            className="boton"
            disabled={!hayQuePedir}
            onClick={async () => avisar((await copiarTexto(texto)) ? { texto: 'Pedido copiado.', tipo: 'ok' } : { texto: 'No se pudo copiar.', tipo: 'error' })}
          >
            <Icono nombre="copiar" tam={18} /> Copiar
          </button>
          <a
            className={`boton boton-primario ${hayQuePedir ? '' : 'deshabilitado'}`}
            aria-disabled={!hayQuePedir}
            href={hayQuePedir ? `https://wa.me/?text=${encodeURIComponent(texto)}` : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <Icono nombre="whatsapp" tam={18} /> Mandar por WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}

function Vencimiento({ vence }: { vence: string }) {
  const dias = diasParaVencer(vence);
  const texto = dias < 0 ? 'Vencido' : dias === 0 ? 'Vence hoy' : dias <= 30 ? `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}` : `Vence ${vence.split('-').reverse().join('/')}`;
  return <span className={`insignia ${dias <= 7 ? 'insignia-alerta' : dias <= 15 ? 'insignia-aviso' : ''}`}>{texto}</span>;
}

interface RenglonIngreso {
  p: Producto;
  cantidad: string;
  costo: number | null;
  /** Subir el precio de venta para mantener el margen con el costo nuevo. */
  mantenerMargen: boolean;
}

/**
 * "Llegó mercadería". Con `soloStock` (el empleado desde la caja) sólo se suman cantidades:
 * costos, precios, proveedor y plata de la caja quedan para el dueño.
 */
export function IngresoMercaderia({ productos, proveedores, onCerrar, soloStock = false }: { productos: Producto[]; proveedores: string[]; onCerrar: () => void; soloStock?: boolean }) {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  // Subir precios es cosa del dueño: al empleado se lo proponemos sin marcar.
  const dueño = useEsDueño();
  const [q, setQ] = useState('');
  const [renglones, setRenglones] = useState<RenglonIngreso[]>([]);
  const [proveedor, setProveedor] = useState('');
  // Si el proveedor lo puso el sistema (del primer producto) y después entra uno de otro proveedor, se vacía.
  const [proveedorAuto, setProveedorAuto] = useState(false);
  const [deCaja, setDeCaja] = useState(false);
  const [pagado, setPagado] = useState<number | null>(null);
  const [enCurso, unaVez] = useUnaVez();
  const buscador = useRef<HTMLInputElement>(null);
  const encontrados = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    const ya = new Set(renglones.map((r) => r.p.id));
    return productos.filter((p) => !ya.has(p.id) && (p.codigo === q.trim() || normalizar(p.nombre).includes(t))).slice(0, 6);
  }, [q, productos, renglones]);
  const porCodigo = useMemo(() => new Map(productos.filter((p) => p.codigo).map((p) => [p.codigo, p])), [productos]);
  const sumar = (p: Producto) => {
    setRenglones((r) => (r.some((x) => x.p.id === p.id) ? r : [...r, { p, cantidad: '', costo: p.costo > 0 ? p.costo : null, mantenerMargen: dueño }]));
    setQ('');
    buscador.current?.focus();
    const suyo = p.proveedor?.trim();
    if (!proveedor && suyo) {
      setProveedor(suyo);
      setProveedorAuto(true);
    } else if (proveedorAuto && suyo && suyo !== proveedor) {
      setProveedor('');
      setProveedorAuto(false);
    }
  };
  // Si el costo subió, el precio sugerido conserva el margen que tenía el producto.
  const precioNuevo = (r: RenglonIngreso): number | null => {
    const m = margen(r.p.precio, r.p.costo);
    if (m === null || r.costo === null || r.costo <= r.p.costo) return null;
    const nuevo = precioParaMargen(r.costo, m);
    return nuevo > r.p.precio ? nuevo : null;
  };
  // El lector escribe donde esté el cursor: un código en cualquier campo se toma como escaneo.
  const escaneo = (texto: string): boolean => {
    const codigo = codigoEscaneado(texto);
    if (!codigo) return false;
    const p = porCodigo.get(codigo);
    if (p) sumar(p);
    else {
      pitido('error');
      avisar({ texto: 'Ese código no está cargado. Cargalo primero con "Nuevo producto".', tipo: 'error' });
    }
    return true;
  };
  const cant = (r: { cantidad: string; p: Producto }) => cantidadDeTexto(r.cantidad, !!r.p.porPeso);
  const total = renglones.reduce((s, r) => s + Math.round(cant(r) * (r.costo ?? 0)), 0);
  const montoCaja = pagado ?? total;
  const subidas = renglones.filter((r) => r.mantenerMargen && precioNuevo(r)).length;
  return (
    <Modal titulo="Llegó mercadería" onCerrar={onCerrar} ancho="ancho">
      <form
        className="formulario"
        onKeyDown={(e) => {
          // Enter en un campo no guarda: vuelve al buscador para seguir escaneando. Guardar es con el botón.
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            buscador.current?.focus();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (deCaja && montoCaja <= 0) {
            avisar({ texto: 'Poné cuánto pagaste de la caja (o cargá el costo de cada producto).', tipo: 'error' });
            return;
          }
          unaVez(async () => {
            try {
              const gasto = await ingresarMercaderia(
                db,
                renglones.map((r) => {
                  if (soloStock) return { productoId: r.p.id!, cantidad: cant(r), costo: r.p.costo };
                  const nuevo = r.mantenerMargen ? precioNuevo(r) : null;
                  return { productoId: r.p.id!, cantidad: cant(r), costo: r.costo ?? 0, ...(nuevo ? { precio: nuevo } : {}) };
                }),
                soloStock ? { proveedor: '', pagadoDeCaja: false } : { proveedor, pagadoDeCaja: deCaja, montoPagado: deCaja ? montoCaja : undefined },
                sesion?.usuario,
              );
              avisar({
                texto: soloStock
                  ? 'Stock actualizado.'
                  : `Stock actualizado${subidas > 0 ? ` y ${subidas === 1 ? '1 precio subido' : `${subidas} precios subidos`}` : ''}${deCaja && gasto > 0 ? `. Gasto de ${formatPesos(gasto)} anotado en la caja` : ''}.`,
                tipo: 'ok',
              });
              onCerrar();
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <p className="texto-suave">
          {soloStock ? 'Escaneá o buscá cada producto que llegó y poné cuántos. Se suman al stock; los costos y precios los revisa el dueño.' : 'Escaneá o buscá cada producto que llegó, poné cuántos y el costo nuevo. El stock y el costo se actualizan solos.'}
        </p>
        <div className="buscador-campo buscador-chico ingreso-buscador">
          <Icono nombre="buscar" tam={18} />
          <input
            ref={buscador}
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (escaneo(q)) return;
                if (encontrados[0]) sumar(encontrados[0]);
                else if (q.trim()) {
                  pitido('error');
                  avisar({ texto: `No encontré "${q.trim()}".`, tipo: 'error' });
                }
              }
            }}
            placeholder="Escaneá o escribí el producto"
            aria-label="Buscar producto que llegó"
          />
          {encontrados.length > 0 && (
            <ul className="resultados">
              {encontrados.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => sumar(p)}>
                    <span>
                      <strong>{p.nombre}</strong>
                      <small>hay {textoStock(p)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {renglones.length > 0 && (
          <ul className={`lista-compra ${soloStock ? 'lista-compra-simple' : ''}`}>
            {renglones.map((r, i) => {
              const nuevo = soloStock ? null : precioNuevo(r);
              const m = margen(r.p.precio, r.p.costo);
              const mNuevo = r.costo ? margen(r.p.precio, r.costo) : null;
              return (
              <li key={r.p.id} className={nuevo ? 'lista-compra-con-precio' : ''}>
                <span className="lista-compra-nombre">
                  <strong>{r.p.nombre}</strong>
                  <small className="texto-suave">
                    hay {textoStock(r.p)}
                    {!soloStock && ` · vendés a ${formatPesos(r.p.precio)}`}
                    {!soloStock && m !== null && ` (ganás ${m}%)`}
                  </small>
                </span>
                <label className="campo">
                  <span className="campo-etiqueta">{r.p.porPeso ? 'Kilos' : 'Cantidad'}</span>
                  <input
                    inputMode="decimal"
                    value={r.cantidad}
                    onChange={(e) => {
                      const t = e.target.value;
                      if (escaneo(t)) return;
                      setRenglones((x) => x.map((y, j) => (j === i ? { ...y, cantidad: t.replace(r.p.porPeso ? /[^\d,.]/g : /\D/g, '').slice(0, 7) } : y)));
                    }}
                    placeholder={r.p.porPeso ? 'Ej.: 2,5' : 'Ej.: 24'}
                    aria-label={`Cantidad de ${r.p.nombre}`}
                  />
                </label>
                {!soloStock && (
                  <CampoPesos
                    etiqueta={r.p.porPeso ? 'Costo por kilo' : 'Costo c/u'}
                    valor={r.costo}
                    ariaLabel={`Costo de ${r.p.nombre}`}
                    onCambio={(v) => setRenglones((x) => x.map((y, j) => (j === i ? { ...y, costo: v } : y)))}
                  />
                )}
                <button type="button" className="boton-icono" aria-label={`Sacar ${r.p.nombre}`} onClick={() => setRenglones((x) => x.filter((_, j) => j !== i))}>
                  <Icono nombre="basura" tam={18} />
                </button>
                {nuevo && (
                  <label className="casilla lista-compra-precio">
                    <input type="checkbox" checked={r.mantenerMargen} onChange={(e) => setRenglones((x) => x.map((y, j) => (j === i ? { ...y, mantenerMargen: e.target.checked } : y)))} />
                    <span>
                      Subir el precio de {formatPesos(r.p.precio)} a <strong>{formatPesos(nuevo)}</strong> (para seguir ganando {m}%)
                      {mNuevo !== null && !r.mantenerMargen && <small className="texto-aviso"> · si no, pasás a ganar {mNuevo}%</small>}
                    </span>
                  </label>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {!soloStock && (
        <>
        <div className="fila-campos">
          <label className="campo">
            <span className="campo-etiqueta">Proveedor (opcional)</span>
            <input
              list="proveedores-ingreso"
              value={proveedor}
              onChange={(e) => {
                setProveedor(e.target.value);
                setProveedorAuto(false);
              }}
              placeholder="Ej.: Distribuidora Arcor"
            />
            <datalist id="proveedores-ingreso">
              {proveedores.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <small className="texto-suave">Queda como proveedor de los productos que todavía no tienen uno.</small>
          </label>
        </div>
        <label className="casilla">
          <input type="checkbox" checked={deCaja} onChange={(e) => setDeCaja(e.target.checked)} />
          <span>Lo pagué con plata de la caja (se anota como gasto del turno)</span>
        </label>
        {deCaja && (
          <div className="fila-campos">
            <CampoPesos etiqueta="Cuánto pagaste de la caja" valor={pagado ?? (total || null)} onCambio={setPagado} placeholder={String(total)} />
          </div>
        )}
        <div className="vuelto">
          <span>Total de la compra</span>
          <strong className="importe texto-normal">{formatPesos(total)}</strong>
        </div>
        </>
        )}
        <button type="submit" className="boton boton-primario boton-grande" disabled={enCurso || !renglones.some((r) => cant(r) > 0)}>
          {soloStock ? 'Sumar al stock' : subidas > 0 ? `Guardar ingreso y subir ${subidas === 1 ? '1 precio' : `${subidas} precios`}` : 'Guardar ingreso'}
        </button>
      </form>
    </Modal>
  );
}
