import { useState } from 'react';
import logo from '../assets/logo-rojo.svg';
import { db } from '../datos/db';
import { recuperarDeLaNube } from '../datos/nube';
import { crearUsuario, ingresar, leerUsuarios } from '../datos/usuarios';
import { errorATexto, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { useSesion } from '../ui/sesion';

export function PantallaIngreso() {
  const usuarios = useConsulta(() => leerUsuarios(db), [], null);
  if (usuarios === null) return null;
  return (
    <div className="ingreso">
      <div className="ingreso-marca">
        <img src={logo} alt="Milenio Market" />
        <p>Caja, stock, fiado y cierre de tu kiosco. Anda con o sin internet.</p>
      </div>
      <div className="ingreso-lado">{usuarios.length === 0 ? <PrimerUsuario /> : <Entrar />}</div>
    </div>
  );
}

function Entrar() {
  const { entrar } = useSesion();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  return (
    <form
      className="tarjeta formulario ingreso-tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        unaVez(async () => {
          const u = await ingresar(db, usuario, clave);
          if (u) entrar(u, recordar);
          else {
            setError('Usuario o clave incorrectos.');
            setClave('');
          }
        });
      }}
    >
      <h1>Ingresar</h1>
      <label className="campo">
        <span className="campo-etiqueta">Usuario</span>
        <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Clave</span>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />
      </label>
      <label className="casilla">
        <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
        <span>Recordarme en este equipo</span>
      </label>
      {error && (
        <p className="texto-alerta" role="alert">
          {error}
        </p>
      )}
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
        Entrar
      </button>
    </form>
  );
}

function PrimerUsuario() {
  const avisar = useAvisar();
  const { entrar } = useSesion();
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [claveNube, setClaveNube] = useState('');
  const [recuperar, setRecuperar] = useState(false);
  const [enCurso, unaVez] = useUnaVez();

  if (recuperar) {
    return (
      <form
        className="tarjeta formulario ingreso-tarjeta"
        onSubmit={(e) => {
          e.preventDefault();
          unaVez(async () => {
            try {
              const total = await recuperarDeLaNube(db, claveNube.trim());
              avisar({ texto: `Recuperados ${total} registros. Entrá con tu usuario de siempre.`, tipo: 'ok' });
            } catch (err) {
              avisar({ texto: errorATexto(err), tipo: 'error' });
            }
          });
        }}
      >
        <h1>Recuperar desde la nube</h1>
        <p className="texto-suave">Escribí la clave de la nube que figura en Ajustes de la otra compu. Se traen productos, ventas, clientes y usuarios.</p>
        <label className="campo">
          <span className="campo-etiqueta">Clave de la nube</span>
          <input value={claveNube} onChange={(e) => setClaveNube(e.target.value)} autoComplete="off" required />
        </label>
        <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
          Recuperar
        </button>
        <button type="button" className="boton" onClick={() => setRecuperar(false)}>
          Volver
        </button>
      </form>
    );
  }

  return (
    <form
      className="tarjeta formulario ingreso-tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        if (clave !== repetida) {
          avisar({ texto: 'Las dos claves no coinciden.', tipo: 'error' });
          return;
        }
        unaVez(async () => {
          try {
            entrar(await crearUsuario(db, { usuario, nombre, clave, admin: true }));
            avisar({ texto: '¡Listo! Ya creaste tu usuario.', tipo: 'ok' });
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
        });
      }}
    >
      <h1>Creá tu usuario</h1>
      <p className="texto-suave">Es la primera vez que se usa el sistema en esta compu. Este usuario es el dueño: después puede sumar empleados desde Ajustes.</p>
      <label className="campo">
        <span className="campo-etiqueta">Tu nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Usuario (para entrar)</span>
        <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Clave (mínimo 4)</span>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Repetí la clave</span>
        <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" required />
      </label>
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
        Crear usuario y entrar
      </button>
      <button type="button" className="boton" onClick={() => setRecuperar(true)}>
        ¿Compu nueva? Recuperar desde la nube
      </button>
    </form>
  );
}
