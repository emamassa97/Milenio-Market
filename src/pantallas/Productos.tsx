import { useMemo, useState } from 'react';
import { exportarCsv, importarCsv, type ResultadoImportacion } from '../dominio/csv';
import { formatPesos } from '../dominio/dinero';
import { aplicarAumento, margen, type Redondeo } from '../dominio/precios';
import type { Producto } from '../dominio/tipos';
import { db } from '../datos/db';
import {
  ajustarStock,
  aumentoMasivo,
  borrarProducto,
  buscarPorCodigo,
  cargarPlanilla,
  guardarProducto,
  type DatosProducto,
} from '../datos/operaciones';
import { CampoPesos, descargarArchivo, errorATexto, Icono, Modal, useAvisar, Vacio } from '../ui/componentes';
import { Escaner } from '../ui/Escaner';
import { useConsulta } from '../ui/hooks';

type Filtro = 'todos' | 'reponer' | 'rapidos' | 'sinCodigo' | 'sinCosto';

const FILTROS: { id: Filtro; nombre: string }[] = [
  { id: 'todos', nombre: 'Todos' },
  { id: 'reponer', nombre: 'Para reponer' },
  { id: 'rapidos', nombre: 'Rápidos' },
  { id: 'sinCodigo', nombre: 'Sin código' },
  { id: 'sinCosto', nombre: 'Sin costo' },
];

function normalizar(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const necesitaReponer = (p: Producto) => p.stockMinimo > 0 && p.stock <= p.stockMinimo;

export function PantallaProductos() {
  const avisar = useAvisar();
  const productos = useConsulta(() => db.productos.toArray(), [], [] as Producto[]);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [categoria, setCategoria] = useState('');
  const [modal, setModal] = useState<
    | null
    | { tipo: 'editar'; producto?: Producto }
    | { tipo: 'aumento' }
    | { tipo: 'planilla' }
    | { tipo: 'stock'; producto: Producto }
    | { tipo: 'pedido' }
  >(null);

  const categorias = useMemo(
    () => [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [productos],
  );

  const visibles = useMemo(() => {
    const palabras = normalizar(q.trim()).split(/\s+/).filter(Boolean);
    return productos
      .filter((p) => {
        if (categoria && p.categoria !== categoria) return false;
        if (filtro === 'reponer' && !necesitaReponer(p)) return false;
        if (filtro === 'rapidos' && !p.rapido) return false;
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
      await guardarProducto(db, { ...datos, rapido: !p.rapido }, id);
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
  };

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
                <button type="button" className="enlace texto-alerta" onClick={() => setFiltro('reponer')}>
                  {cuantosReponer} para reponer
                </button>
              </>
            )}
          </p>
        </div>
        <div className="botonera">
          <button type="button" className="boton" onClick={() => setModal({ tipo: 'pedido' })} disabled={cuantosReponer === 0}>
            <Icono nombre="whatsapp" tam={18} /> Pedido al proveedor
          </button>
          <button type="button" className="boton" onClick={() => setModal({ tipo: 'aumento' })} disabled={productos.length === 0}>
            <Icono nombre="porcentaje" tam={18} /> Aumentar precios
          </button>
          <button type="button" className="boton" onClick={() => setModal({ tipo: 'planilla' })}>
            <Icono nombre="subir" tam={18} /> Planilla Excel
          </button>
          <button type="button" className="boton boton-primario" onClick={() => setModal({ tipo: 'editar' })}>
            <Icono nombre="mas" tam={18} /> Nuevo producto
          </button>
        </div>
      </div>

      <div className="filtros">
        <div className="buscador-campo buscador-chico">
          <Icono nombre="buscar" tam={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar producto" />
        </div>
        <div className="chips" role="group" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className={`chip ${filtro === f.id ? 'activo' : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.nombre}
            </button>
          ))}
        </div>
        {categorias.length > 0 && (
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {productos.length === 0 ? (
        <Vacio titulo="Todavía no hay productos">
          <p className="texto-suave">Cargalos uno por uno, con una planilla de Excel, o directamente escaneando en la caja: si el código no existe, el sistema te pide el nombre y el precio.</p>
        </Vacio>
      ) : visibles.length === 0 ? (
        <Vacio titulo="No hay productos con ese filtro" />
      ) : (
        <div className="tarjeta tabla-productos">
          <div className="tabla-encabezado" aria-hidden="true">
            <span>Producto</span>
            <span>Precio</span>
            <span>Costo</span>
            <span>Stock</span>
            <span />
          </div>
          <ul>
            {visibles.map((p) => {
              const m = margen(p.precio, p.costo);
              return (
                <li key={p.id} className="fila-producto">
                  <div className="fila-producto-nombre">
                    <strong>{p.nombre}</strong>
                    <small>
                      {p.codigo || 'sin código'}
                      {p.categoria ? ` · ${p.categoria}` : ''}
                    </small>
                  </div>
                  <span className="importe fila-precio">{formatPesos(p.precio)}</span>
                  <span className="fila-costo texto-suave">
                    {p.costo > 0 ? (
                      <>
                        {formatPesos(p.costo)} <small>({m}%)</small>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                  <button type="button" className={`stock ${p.stock <= 0 ? 'stock-cero' : necesitaReponer(p) ? 'stock-bajo' : ''}`} onClick={() => setModal({ tipo: 'stock', producto: p })} aria-label={`Stock de ${p.nombre}: ${p.stock}. Sumar o corregir`}>
                    {p.stock}
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

      {modal?.tipo === 'editar' && <EditarProducto producto={modal.producto} categorias={categorias} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'aumento' && <AumentoPrecios productos={productos} visibles={visibles} categorias={categorias} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'planilla' && <Planilla productos={productos} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'stock' && <SumarStock producto={modal.producto} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'pedido' && <PedidoProveedor productos={productos.filter(necesitaReponer)} onCerrar={() => setModal(null)} />}
    </div>
  );
}

function EditarProducto({ producto, categorias, onCerrar }: { producto?: Producto; categorias: string[]; onCerrar: () => void }) {
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
        }
      : { codigo: '', nombre: '', precio: 0, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false },
  );
  const [precio, setPrecio] = useState<number | null>(producto ? producto.precio : null);
  const [costo, setCosto] = useState<number | null>(producto && producto.costo > 0 ? producto.costo : null);
  const [camara, setCamara] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const m = margen(precio ?? 0, costo ?? 0);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await guardarProducto(db, { ...d, precio: precio ?? 0, costo: costo ?? 0 }, producto?.id);
      avisar({ texto: producto ? 'Cambios guardados.' : `"${d.nombre.trim()}" cargado.`, tipo: 'ok' });
      onCerrar();
    } catch (err) {
      avisar({ texto: errorATexto(err), tipo: 'error' });
    }
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
          <CampoPesos etiqueta="Precio de venta" valor={precio} onCambio={setPrecio} />
          <CampoPesos etiqueta="Costo (opcional)" valor={costo} onCambio={setCosto} />
        </div>
        {m !== null && <p className="texto-suave">Ganás {formatPesos((precio ?? 0) - (costo ?? 0))} por unidad ({m}% del precio).</p>}
        <div className="fila-campos">
          <label className="campo">
            <span className="campo-etiqueta">Stock actual</span>
            <input inputMode="numeric" value={d.stock} onChange={(e) => setD({ ...d, stock: Number(e.target.value.replace(/[^\d-]/g, '')) || 0 })} />
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Avisar cuando queden</span>
            <input inputMode="numeric" value={d.stockMinimo} onChange={(e) => setD({ ...d, stockMinimo: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </label>
        </div>
        <label className="campo">
          <span className="campo-etiqueta">Categoría</span>
          <input list="categorias" value={d.categoria} onChange={(e) => setD({ ...d, categoria: e.target.value })} placeholder="Ej.: Bebidas, Golosinas, Cigarrillos" />
          <datalist id="categorias">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="casilla">
          <input type="checkbox" checked={d.rapido} onChange={(e) => setD({ ...d, rapido: e.target.checked })} />
          <span>Botón rápido en la caja (para lo que más sale)</span>
        </label>
        <div className="botonera botonera-final">
          {producto && (
            <button type="button" className={`boton ${confirmarBorrar ? 'boton-peligro' : 'boton-texto-peligro'}`} onClick={borrar}>
              {confirmarBorrar ? '¿Seguro? Tocá de nuevo' : 'Borrar'}
            </button>
          )}
          <button type="submit" className="boton boton-primario" disabled={!d.nombre.trim() || precio === null}>
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
  const n = Number(cantidad.replace(/[^\d-]/g, '')) || 0;
  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      <form
        className="formulario"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!n) return;
          try {
            await ajustarStock(db, producto.id!, n);
            avisar({ texto: `Stock de ${producto.nombre}: ${producto.stock + n}.`, tipo: 'ok' });
            onCerrar();
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
        }}
      >
        <p>
          Hay <strong>{producto.stock}</strong>. ¿Cuántos llegaron? (para restar, poné un menos adelante: -2)
        </p>
        <input inputMode="numeric" autoFocus value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-label="Cantidad a sumar" placeholder="Ej.: 24" />
        <div className="sugeridos">
          {[6, 12, 24, 48].map((x) => (
            <button key={x} type="button" className="chip" onClick={() => setCantidad(String(x))}>
              +{x}
            </button>
          ))}
        </div>
        <button className="boton boton-primario boton-grande" type="submit" disabled={!n}>
          {n >= 0 ? `Sumar ${n}` : `Restar ${-n}`} · quedan {producto.stock + n}
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
        <button className="boton boton-primario boton-grande" type="submit" disabled={!valido || elegidos.length === 0 || aplicando}>
          {valido ? `${pct > 0 ? 'Aumentar' : 'Bajar'} ${Math.abs(pct)}% a ${elegidos.length} productos` : 'Poné el porcentaje'}
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
      .map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, costo: p.costo, stock: p.stock, categoria: p.categoria }));
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
              En Excel, <em>Guardar como → CSV</em>. Columnas: <strong>nombre</strong> y <strong>precio</strong> (obligatorias), y si querés código, costo, stock y categoría. Si el código ya existe, se actualiza el precio y no se toca el stock.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Elegir planilla CSV"
              onChange={async (e) => {
                const archivo = e.target.files?.[0];
                if (!archivo) return;
                setResultado(importarCsv(await archivo.text()));
              }}
            />
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

function PedidoProveedor({ productos, onCerrar }: { productos: Producto[]; onCerrar: () => void }) {
  const avisar = useAvisar();
  const [cantidades, setCantidades] = useState<Record<number, number>>(() =>
    Object.fromEntries(productos.map((p) => [p.id!, Math.max(1, p.stockMinimo * 2 - p.stock)])),
  );
  const texto = [
    'Hola, te paso el pedido de Milenio Market:',
    ...productos.filter((p) => (cantidades[p.id!] ?? 0) > 0).map((p) => `• ${cantidades[p.id!]} x ${p.nombre}`),
    'Gracias!',
  ].join('\n');
  return (
    <Modal titulo="Pedido al proveedor" onCerrar={onCerrar} ancho="ancho">
      <div className="formulario">
        <p className="texto-suave">Lo que está por debajo del mínimo. Ajustá las cantidades y mandalo por WhatsApp.</p>
        <ul className="lista-pedido">
          {productos.map((p) => (
            <li key={p.id}>
              <span>
                {p.nombre} <small className="texto-suave">(quedan {p.stock})</small>
              </span>
              <input
                inputMode="numeric"
                aria-label={`Cantidad a pedir de ${p.nombre}`}
                value={cantidades[p.id!] ?? 0}
                onChange={(e) => setCantidades({ ...cantidades, [p.id!]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            </li>
          ))}
        </ul>
        <div className="botonera botonera-final">
          <button
            type="button"
            className="boton"
            onClick={() =>
              navigator.clipboard
                .writeText(texto)
                .then(() => avisar({ texto: 'Pedido copiado.', tipo: 'ok' }))
                .catch(() => avisar({ texto: 'No se pudo copiar.', tipo: 'error' }))
            }
          >
            <Icono nombre="copiar" tam={18} /> Copiar
          </button>
          <a className="boton boton-primario" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
            <Icono nombre="whatsapp" tam={18} /> Mandar por WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}
