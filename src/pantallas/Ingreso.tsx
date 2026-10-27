import { useEffect, useState } from 'react';
import logo from '../assets/logo-rojo.svg';
import { db } from '../datos/db';
import { recuperarDeLaNube } from '../datos/nube';
import { crearUsuario, empezarDeCero, ingresar, leerUsuarios, resumenEquipo, type Usuario } from '../datos/usuarios';
import { errorATexto, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { useSesion, LLAVE_SIGUIENTE } from '../ui/sesion';

export function PantallaIngreso() {
  const usuarios = useConsulta(() => leerUsuarios(db), [], null);
  if (usuarios === null) return null;
  return (
    <div className="ingreso">
      <div className="ingreso-marca">
        <img src={logo} alt="Milenio Market" />
        <p>Caja, stock, fiado y cierre de tu kiosco. Anda con o sin internet.</p>
      </div>
      <div className="ingreso-lado">{usuarios.length === 0 ? <PrimerUsuario /> : <Entrar usuarios={usuarios} />}</div>
    </div>
  );
}

/** Si se le pasó la caja a alguien, el ingreso ya tiene su usuario escrito: sólo falta la clave. */
// Se lee al armar la pantalla y se borra después (en un efecto): leer y borrar juntos fallaba con el modo estricto de React.
function usuarioSiguiente(): string {
  try {
    return sessionStorage.getItem(LLAVE_SIGUIENTE) ?? '';
  } catch {
    return '';
  }
}

function Entrar({ usuarios }: { usuarios: Usuario[] }) {
  const { entrar } = useSesion();
  const [olvide, setOlvide] = useState(false);
  const [usuario, setUsuario] = useState(usuarioSiguiente);
  const [sugerido] = useState(() => usuario !== '');
  useEffect(() => {
    try {
      sessionStorage.removeItem(LLAVE_SIGUIENTE);
    } catch {
      /* nada */
    }
  }, []);
  const [clave, setClave] = useState('');
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  if (olvide) return <OlvideClave usuarios={usuarios} volver={() => setOlvide(false)} />;
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
        <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus={!sugerido} required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Clave</span>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" autoFocus={sugerido} required />
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
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso} aria-busy={enCurso}>
        {enCurso ? 'Entrando…' : 'Entrar'}
      </button>
      <button type="button" className="boton-texto" onClick={() => setOlvide(true)}>
        ¿Te olvidaste el usuario o la clave?
      </button>
    </form>
  );
}

/**
 * Sin servidor no hay mail para recuperar la clave: se muestran los usuarios
 * de este equipo (por si el olvido es el nombre) y, si no hay forma de entrar,
 * se puede empezar de cero en esta compu. Si hay datos cargados, se pide escribir BORRAR.
 */
function OlvideClave({ usuarios, volver }: { usuarios: Usuario[]; volver: () => void }) {
  const avisar = useAvisar();
  const resumen = useConsulta(() => resumenEquipo(db), [], null);
  const [confirmacion, setConfirmacion] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  if (resumen === null) return null;
  const hayDatos = resumen.productos + resumen.ventas + resumen.clientes > 0;
  const listo = !hayDatos || confirmacion.trim().toUpperCase() === 'BORRAR';
  return (
    <form
      className="tarjeta formulario ingreso-tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        if (!listo) return;
        unaVez(async () => {
          try {
            await empezarDeCero(db);
            avisar({ texto: 'Listo: creá tu usuario de nuevo.', tipo: 'ok' });
          } catch (err) {
            avisar({ texto: errorATexto(err), tipo: 'error' });
          }
        });
      }}
    >
      <h1>¿No podés entrar?</h1>
      <p>
        Usuarios de esta compu:{' '}
        {usuarios.map((u, i) => (
          <span key={u.usuario}>
            {i > 0 && ', '}
            <strong>{u.usuario}</strong>
            {u.admin && ' (dueño)'}
          </span>
        ))}
        .
      </p>
      <p className="texto-suave">
        Si te olvidaste la clave de un empleado, entrá como dueño y cambiala desde Ajustes. Si te olvidaste la del dueño, se puede empezar de cero en esta compu y crear un usuario nuevo.
      </p>
      {hayDatos ? (
        <>
          <p className="texto-alerta">
            Se borra todo lo guardado en esta compu: {resumen.productos} productos, {resumen.ventas} ventas y {resumen.clientes} clientes.
          </p>
          <label className="campo">
            <span className="campo-etiqueta">Para confirmar, escribí BORRAR</span>
            <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          </label>
        </>
      ) : (
        <p className="texto-suave">En esta compu no hay productos, ventas ni clientes cargados: no se pierde nada.</p>
      )}
      <button className="boton boton-primario boton-grande" type="submit" disabled={!listo || enCurso}>
        Empezar de cero en esta compu
      </button>
      <button type="button" className="boton" onClick={volver}>
        Volver
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
  const [errorAlta, setErrorAlta] = useState('');
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
        // El error va debajo del botón, donde se está mirando (un aviso flotante caería sobre el panel rojo).
        if (clave !== repetida) {
          setErrorAlta('Las dos claves no coinciden.');
          return;
        }
        unaVez(async () => {
          try {
            entrar(await crearUsuario(db, { usuario, nombre, clave, admin: true }));
            avisar({ texto: '¡Listo! Ya creaste tu usuario.', tipo: 'ok' });
          } catch (err) {
            setErrorAlta(errorATexto(err));
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
      {errorAlta && (
        <p className="texto-alerta" role="alert">
          {errorAlta}
        </p>
      )}
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
        Crear usuario y entrar
      </button>
      <button type="button" className="boton" onClick={() => setRecuperar(true)}>
        ¿Compu nueva? Recuperar desde la nube
      </button>
    </form>
  );
}
