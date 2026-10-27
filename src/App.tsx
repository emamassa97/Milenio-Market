import { useEffect, useState } from 'react';
import logo from './assets/logo-rojo.svg';
import { db } from './datos/db';
import { estaVacia } from './datos/copia';
import { cargarEjemplo } from './datos/ejemplo';
import { PantallaAjustes } from './pantallas/Ajustes';
import { PantallaCaja } from './pantallas/Caja';
import { PantallaCierre } from './pantallas/Cierre';
import { PantallaClientes } from './pantallas/Clientes';
import { PantallaProductos } from './pantallas/Productos';
import { PantallaReportes } from './pantallas/Reportes';
import { Icono, ProveedorAvisos } from './ui/componentes';
import { useConexion, useConsulta, useCopiaEnLaNube } from './ui/hooks';
import { leerAjuste, turnoAbierto } from './datos/operaciones';
import { pendientes } from './datos/nube';

const PANTALLAS = [
  { id: 'caja', nombre: 'Caja' },
  { id: 'productos', nombre: 'Productos' },
  { id: 'cierre', nombre: 'Cierre de caja' },
  { id: 'reportes', nombre: 'Reportes' },
  { id: 'clientes', nombre: 'Clientes y fiado' },
] as const;

type IdPantalla = (typeof PANTALLAS)[number]['id'] | 'ajustes';

function leerHash(): IdPantalla {
  const h = window.location.hash.replace('#', '');
  return (PANTALLAS.some((p) => p.id === h) || h === 'ajustes' ? h : 'caja') as IdPantalla;
}

export function App() {
  const [pantalla, setPantalla] = useState<IdPantalla>(leerHash);
  const online = useConexion();
  const turno = useConsulta(() => turnoAbierto(db), [], undefined);
  const nube = useConsulta(
    async () => {
      const clave = await leerAjuste<string>(db, 'nube.clave', '');
      if (!clave) return null;
      return { error: await leerAjuste<string | null>(db, 'nube.error', null), pendientes: await pendientes(db) };
    },
    [],
    null,
  );
  useCopiaEnLaNube(!import.meta.env.VITE_DEMO && nube !== null);

  // Versión de prueba publicada: arranca con productos de ejemplo.
  useEffect(() => {
    if (!import.meta.env.VITE_DEMO) return;
    estaVacia(db)
      .then((vacia) => (vacia ? cargarEjemplo(db) : undefined))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cambio = () => setPantalla(leerHash());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);

  const ir = (id: IdPantalla) => {
    window.location.hash = id;
    setPantalla(id);
  };

  return (
    <ProveedorAvisos>
      <header className="barra">
        <a href="#caja" className="barra-logo" onClick={() => ir('caja')}>
          <img src={logo} alt="Milenio Market" />
        </a>
        <nav className="barra-nav" aria-label="Secciones">
          {PANTALLAS.map((p) => (
            <a key={p.id} href={`#${p.id}`} className={pantalla === p.id ? 'activo' : ''} aria-current={pantalla === p.id ? 'page' : undefined}>
              {p.nombre}
            </a>
          ))}
        </nav>
        <div className="barra-estado">
          <span className={`punto ${online ? 'punto-ok' : 'punto-sin'}`} aria-hidden="true" />
          <span className="barra-estado-texto">
            {online ? 'Conectado' : 'Sin internet: se sigue cobrando'}
            {turno ? ` · ${turno.cajero}` : ''}
          </span>
          {nube && (
            <a href="#ajustes" className="barra-nube" title={nube.error ?? (nube.pendientes ? `${nube.pendientes} cambios por subir` : 'Copia en la nube al día')}>
              <Icono nombre="nube" tam={18} />
              <span className="barra-estado-texto">{nube.error ? 'Nube: revisar' : nube.pendientes ? 'Nube: subiendo' : 'Nube al día'}</span>
              {nube.error && <span className="punto punto-sin" aria-hidden="true" />}
            </a>
          )}
          <a href="#ajustes" className={`boton-icono barra-ajustes ${pantalla === 'ajustes' ? 'activo' : ''}`} aria-label="Ajustes y copia de seguridad">
            <Icono nombre="ajustes" />
          </a>
        </div>
      </header>
      {import.meta.env.VITE_DEMO && (
        <p className="aviso-prueba">
          Versión de prueba con productos de ejemplo. Lo que cargues queda sólo en este navegador. La cámara y las descargas no andan dentro de esta vista previa.
        </p>
      )}
      <main>
        {pantalla === 'caja' && <PantallaCaja />}
        {pantalla === 'productos' && <PantallaProductos />}
        {pantalla === 'cierre' && <PantallaCierre irACaja={() => ir('caja')} />}
        {pantalla === 'reportes' && <PantallaReportes />}
        {pantalla === 'clientes' && <PantallaClientes />}
        {pantalla === 'ajustes' && <PantallaAjustes />}
      </main>
    </ProveedorAvisos>
  );
}
