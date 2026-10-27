import { useEffect, useState } from 'react';
import logo from './assets/logo-oscuro.svg';
import { db } from './datos/db';
import { estaVacia } from './datos/copia';
import { cargarEjemplo } from './datos/ejemplo';
import { PantallaAjustes } from './pantallas/Ajustes';
import { PantallaCaja } from './pantallas/Caja';
import { PantallaCierre } from './pantallas/Cierre';
import { PantallaClientes } from './pantallas/Clientes';
import { PantallaProductos } from './pantallas/Productos';
import { PantallaReportes } from './pantallas/Reportes';
import { PantallaInicio } from './pantallas/Inicio';
import { Icono, ProveedorAvisos, type NombreIcono } from './ui/componentes';
import { ProveedorPermisos, useEsDueño } from './ui/permisos';
import logoBolsa from './assets/logo-bolsa.svg';
import { PantallaIngreso } from './pantallas/Ingreso';
import { ProveedorSesion, useSesion } from './ui/sesion';
import { useConexion, useCopiaEnLaNube, useEstadoNube } from './ui/hooks';
import { revalidarSesion } from './datos/usuarios';
import { turnoAbierto } from './datos/operaciones';

const PANTALLAS = [
  { id: 'caja', nombre: 'Caja', corto: 'Caja', icono: 'caja', dueño: false },
  { id: 'inicio', nombre: 'Panel del día', corto: 'Panel', icono: 'inicio', dueño: true },
  { id: 'productos', nombre: 'Productos', corto: 'Productos', icono: 'productos', dueño: true },
  { id: 'cierre', nombre: 'Cierre de caja', corto: 'Cierre', icono: 'cierre', dueño: false },
  { id: 'clientes', nombre: 'Clientes y fiado', corto: 'Fiado', icono: 'clientes', dueño: true },
  { id: 'reportes', nombre: 'Reportes', corto: 'Reportes', icono: 'reportes', dueño: true },
  { id: 'ajustes', nombre: 'Ajustes', corto: 'Ajustes', icono: 'ajustes', dueño: false },
] as const satisfies readonly { id: string; nombre: string; corto: string; icono: NombreIcono; dueño: boolean }[];

type IdPantalla = (typeof PANTALLAS)[number]['id'];

function leerHash(): IdPantalla {
  const h = window.location.hash.replace('#', '');
  return PANTALLAS.find((p) => p.id === h)?.id ?? 'caja';
}

export function App() {
  return (
    <ProveedorSesion>
      <ProveedorAvisos>
        <ProveedorPermisos>
          <Contenido />
        </ProveedorPermisos>
      </ProveedorAvisos>
    </ProveedorSesion>
  );
}

function Contenido() {
  const { sesion } = useSesion();
  if (!import.meta.env.VITE_DEMO && !sesion) return <PantallaIngreso />;
  return <Sistema />;
}

function Sistema() {
  const { sesion, salir, entrar } = useSesion();
  const dueño = useEsDueño();
  const [hash, setHash] = useState<IdPantalla>(leerHash);
  const [menuMas, setMenuMas] = useState(false);
  const online = useConexion();
  const estado = useEstadoNube();
  const nube = estado.activa || estado.sinActivar ? { error: estado.sinActivar ? 'Nube sin activar' : estado.error, aviso: estado.aviso, pendientes: estado.pendientes } : null;
  useCopiaEnLaNube(!import.meta.env.VITE_DEMO);

  // Si borraron al usuario o le sacaron el permiso de dueño, se corta la sesión.
  useEffect(() => {
    if (!sesion) return;
    const revisar = () =>
      revalidarSesion(db, sesion.usuario)
        .then((u) => {
          if (!u) salir();
          else if (u.admin !== sesion.admin || u.nombre !== sesion.nombre) entrar(u);
        })
        .catch(() => {});
    revisar();
    window.addEventListener('focus', revisar);
    return () => window.removeEventListener('focus', revisar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion?.usuario, sesion?.admin, sesion?.nombre]);

  // Versión de prueba publicada: arranca con productos de ejemplo.
  useEffect(() => {
    if (!import.meta.env.VITE_DEMO) return;
    estaVacia(db)
      .then((vacia) => (vacia ? cargarEjemplo(db) : undefined))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cambio = () => {
      setHash(leerHash());
      setMenuMas(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);

  const visibles = PANTALLAS.filter((p) => dueño || !p.dueño);
  // Un empleado que entra por un enlace a Reportes cae en la caja.
  const pantalla: IdPantalla = visibles.some((p) => p.id === hash) ? hash : 'caja';
  const actual = PANTALLAS.find((p) => p.id === pantalla)!;

  const ir = (id: IdPantalla) => {
    window.location.hash = id;
    setHash(id);
  };

  // Sin enlace, el dueño arranca en el panel cuando la caja está cerrada; con la caja abierta, en la caja.
  useEffect(() => {
    if (window.location.hash || !dueño) return;
    turnoAbierto(db)
      .then((t) => {
        if (!t && !window.location.hash) ir('inicio');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // En el celular entran cuatro pestañas; el resto, los estados y "Salir" van en "Más".
  const pestañas = visibles.slice(0, 4);
  const enMas = visibles.slice(4);

  const estadoNube = nube && (
    <a href="#ajustes" className={`estado-chip ${nube.error ? 'estado-chip-aviso' : ''}`} title={nube.aviso ?? (nube.pendientes ? `${nube.pendientes} cambios por subir` : 'Copia en la nube al día')}>
      <Icono nombre={nube.error ? 'nube-no' : 'nube'} tam={16} />
      <span>{nube.error === 'Nube sin activar' ? 'Nube sin activar' : nube.error ? 'Nube: revisar' : nube.pendientes ? 'Subiendo a la nube' : 'Nube al día'}</span>
    </a>
  );
  const estadoRed = (
    <span className={`estado-chip ${online ? '' : 'estado-chip-aviso'}`} title={online ? 'Hay internet' : 'Sin internet: se sigue cobrando y se sube después'}>
      <Icono nombre={online ? 'wifi' : 'wifi-no'} tam={16} />
      <span>{online ? 'Con internet' : 'Sin internet'}</span>
    </span>
  );

  return (
    <div className="marco">
      <aside className="lateral" aria-label="Menú">
        <a href="#caja" className="lateral-logo" onClick={() => ir('caja')}>
          <img src={logo} alt="Milenio Market" />
        </a>
        <nav className="lateral-nav" aria-label="Secciones">
          {visibles.map((p) => (
            <a key={p.id} href={`#${p.id}`} className={pantalla === p.id ? 'activo' : ''} aria-current={pantalla === p.id ? 'page' : undefined}>
              <Icono nombre={p.icono} tam={20} />
              <span>{p.nombre}</span>
            </a>
          ))}
        </nav>
        <div className="lateral-pie">
          <div className="lateral-estados">
            {estadoRed}
            {estadoNube}
          </div>
          {sesion && (
            <div className="lateral-usuario">
              <span className="avatar" aria-hidden="true">
                {sesion.nombre.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="lateral-usuario-nombre">
                <strong>{sesion.nombre}</strong>
                <small>{sesion.admin ? 'Dueño' : 'Empleado'}</small>
              </span>
              <button type="button" className="boton-icono" onClick={salir} aria-label="Salir" title="Salir">
                <Icono nombre="salir" tam={20} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <header className="cabecera-movil">
        <img src={logoBolsa} alt="Milenio Market" className="cabecera-movil-logo" />
        <strong className="cabecera-movil-titulo">{actual.nombre}</strong>
        <span className={`punto-red ${online ? '' : 'punto-red-sin'}`} title={online ? 'Con internet' : 'Sin internet: se sigue cobrando'} />
        {sesion && (
          <span className="avatar" title={`${sesion.nombre} (${sesion.admin ? 'dueño' : 'empleado'})`} aria-label={`Atiende ${sesion.nombre}`}>
            {sesion.nombre.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </header>

      <div className="contenido">
        {import.meta.env.VITE_DEMO && (
          <p className="aviso-prueba">
            Versión de prueba con productos de ejemplo. Lo que cargues queda sólo en este navegador.
          </p>
        )}
        {!online && <p className="aviso-sin-red">Sin internet. Seguí cobrando normal: todo queda guardado y se sube a la nube cuando vuelva.</p>}
        <main>
          {pantalla === 'caja' && <PantallaCaja />}
          {pantalla === 'inicio' && <PantallaInicio ir={ir} />}
          {pantalla === 'productos' && <PantallaProductos />}
          {pantalla === 'cierre' && <PantallaCierre irACaja={() => ir('caja')} />}
          {pantalla === 'reportes' && <PantallaReportes />}
          {pantalla === 'clientes' && <PantallaClientes />}
          {pantalla === 'ajustes' && <PantallaAjustes />}
        </main>
      </div>

      <nav className="pestañas" aria-label="Secciones">
        {pestañas.map((p) => (
          <a key={p.id} href={`#${p.id}`} className={pantalla === p.id ? 'activo' : ''} aria-current={pantalla === p.id ? 'page' : undefined}>
            <Icono nombre={p.icono} tam={22} />
            <span>{p.corto}</span>
          </a>
        ))}
        <button type="button" className={enMas.some((p) => p.id === pantalla) ? 'activo' : ''} aria-expanded={menuMas} onClick={() => setMenuMas(!menuMas)}>
          <Icono nombre="menu" tam={22} />
          <span>Más</span>
        </button>
      </nav>
      {menuMas && (
        <>
          <button type="button" className="hoja-fondo" aria-label="Cerrar menú" onClick={() => setMenuMas(false)} />
          <div className="hoja" role="menu">
            {enMas.map((p) => (
              <a key={p.id} role="menuitem" href={`#${p.id}`} className={pantalla === p.id ? 'activo' : ''}>
                <Icono nombre={p.icono} tam={22} />
                {p.nombre}
              </a>
            ))}
            {sesion && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuMas(false);
                  salir();
                }}
              >
                <Icono nombre="salir" tam={22} />
                Salir
                <small className="texto-suave">{sesion.nombre}</small>
              </button>
            )}
            <div className="hoja-estados">
              {estadoRed}
              {estadoNube}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
