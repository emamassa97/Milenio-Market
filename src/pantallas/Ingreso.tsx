import { useEffect, useState } from 'react';
import logo from '../assets/logo-rojo.svg';
import { db } from '../datos/db';
import { recuperarDeLaNube } from '../datos/nube';
import { hayUsuariosEnLaNube, ingresarDondeSea } from '../datos/ingreso';
import { cambiarClaveConLaNube, crearUsuario, empezarDeCero, leerUsuarios, resumenEquipo, type Usuario } from '../datos/usuarios';
import { leerAjuste } from '../datos/operaciones';
import { errorATexto, Icono, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { useSesion, LLAVE_SIGUIENTE } from '../ui/sesion';

export function PantallaIngreso() {
  const usuarios = useConsulta(() => leerUsuarios(db), [], null);
  // Equipo sin usuarios: si la nube ya tiene, se ingresa con ese usuario; si no, se crea el dueño.
  // undefined: preguntando; null: sin internet (no se sabe).
  const [enLaNube, setEnLaNube] = useState<boolean | null | undefined>(undefined);
  const [crear, setCrear] = useState(false);
  const [intento, setIntento] = useState(0);
  const sinUsuarios = usuarios?.length === 0;
  useEffect(() => {
    if (!sinUsuarios) return;
    let vigente = true;
    hayUsuariosEnLaNube().then((hay) => vigente && setEnLaNube(hay));
    return () => {
      vigente = false;
    };
  }, [sinUsuarios, intento]);
  if (usuarios === null || (sinUsuarios && enLaNube === undefined)) return null;
  const lado =
    !sinUsuarios || (enLaNube && !crear) ? (
      <Entrar usuarios={usuarios} crearNuevo={sinUsuarios ? () => setCrear(true) : undefined} />
    ) : (
      <PrimerUsuario
        sinRed={enLaNube === null && !crear}
        reintentar={() => { setEnLaNube(undefined); setIntento((i) => i + 1); }}
        yaTengo={() => { setCrear(false); setEnLaNube(true); }}
      />
    );
  return (
    <div className="ingreso">
      <div className="ingreso-marca">
        <img src={logo} alt="Milenio Market" />
        <p>Caja, stock, fiado y cierre de tu kiosco. Anda con o sin internet.</p>
      </div>
      <div className="ingreso-lado">{lado}</div>
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

function Entrar({ usuarios, crearNuevo }: { usuarios: Usuario[]; crearNuevo?: () => void }) {
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
  // Con muchas claves mal seguidas la nube bloquea un rato: no es lo mismo que una clave mal, y probar de nuevo no sirve.
  const [bloqueadoHasta, setBloqueadoHasta] = useState(0);
  const [, setReloj] = useState(0);
  const bloqueado = bloqueadoHasta > Date.now();
  useEffect(() => {
    if (!bloqueadoHasta) return;
    const t = window.setTimeout(() => setReloj((n) => n + 1), Math.max(0, bloqueadoHasta - Date.now()) + 50);
    return () => window.clearTimeout(t);
  }, [bloqueadoHasta]);
  const [enCurso, unaVez] = useUnaVez();
  // Después de pasar la caja, el título le habla a quien le toca.
  const nombreSugerido = sugerido ? usuarios.find((u) => u.usuario === usuario.trim().toLowerCase())?.nombre.split(' ')[0] : undefined;
  if (olvide) return <OlvideClave usuarios={usuarios} volver={() => setOlvide(false)} crearNuevo={crearNuevo} />;
  return (
    <form
      className="tarjeta formulario ingreso-tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        unaVez(async () => {
          try {
            entrar(await ingresarDondeSea(db, usuario, clave), recordar);
          } catch (err) {
            const texto = errorATexto(err);
            const minutos = /Demasiadas claves.*?(\d+)\s*minutos/i.exec(texto);
            setBloqueadoHasta(minutos ? Date.now() + Number(minutos[1]) * 60_000 : 0);
            setError(texto);
            setClave('');
          }
        });
      }}
    >
      {nombreSugerido ? (
        <>
          <h1>Te toca, {nombreSugerido}</h1>
          <p className="texto-suave">La caja ya está abierta a tu nombre: poné tu clave.</p>
        </>
      ) : (
        <>
          <h1>Ingresar</h1>
          <p className="texto-suave">Tu usuario sirve en cualquier compu o celular.</p>
        </>
      )}
      <label className="campo">
        <span className="campo-etiqueta">Usuario</span>
        <input
          value={usuario}
          onChange={(e) => {
            setUsuario(e.target.value);
            // El bloqueo es de ese usuario: con otro se puede probar.
            setBloqueadoHasta(0);
          }}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus={!sugerido}
          required
        />
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
        <p className={`texto-alerta ${bloqueado ? 'ingreso-bloqueado' : ''}`} role="alert">
          {bloqueado && <Icono nombre="reloj" tam={18} />}
          <span>{error}</span>
        </p>
      )}
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso || bloqueado} aria-busy={enCurso}>
        {enCurso ? 'Entrando…' : bloqueado ? 'Esperá unos minutos' : 'Entrar'}
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
function OlvideClave({ usuarios, volver, crearNuevo }: { usuarios: Usuario[]; volver: () => void; crearNuevo?: () => void }) {
  const avisar = useAvisar();
  const resumen = useConsulta(() => resumenEquipo(db), [], null);
  // La clave de la nube (no la de un empleado): con ella se le pone una clave nueva al dueño.
  const conNube = useConsulta(async () => {
    const c = await leerAjuste<string>(db, 'nube.clave', '');
    return Boolean(c) && !c.startsWith('e.');
  }, [], false);
  const [confirmacion, setConfirmacion] = useState('');
  const [conClaveNube, setConClaveNube] = useState(false);
  const [enCurso, unaVez] = useUnaVez();
  if (resumen === null) return null;
  if (conClaveNube) return <ClaveConLaNube volver={() => setConClaveNube(false)} />;
  if (crearNuevo) {
    // Equipo nuevo: todavía no tiene usuarios ni datos que borrar.
    return (
      <div className="tarjeta formulario ingreso-tarjeta">
        <h1>¿No podés entrar?</h1>
        <p className="texto-suave">
          Tu usuario es el mismo de la otra compu o celular. Si te olvidaste la clave, entrá donde la tengas guardada y cambiala en Ajustes: después sirve en todos lados.
        </p>
        <p className="texto-suave">Si no podés entrar en ningún lado, creá un usuario nuevo en esta compu. Ojo: queda separado del de la otra compu.</p>
        {/* Lo normal es volver a probar; crear otro dueño parte la cuenta en dos, así que no va en rojo. */}
        <button type="button" className="boton boton-primario boton-grande" onClick={volver}>
          Volver a intentar
        </button>
        <button type="button" className="boton" onClick={crearNuevo}>
          Crear un usuario nuevo en esta compu
        </button>
      </div>
    );
  }
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
        Usuarios:{' '}
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
        Si te olvidaste la clave de un empleado, entrá como dueño y cambiala desde Ajustes. Si te olvidaste la del dueño, entrá desde otro equipo donde la tengas guardada y cambiala ahí: sirve en todos lados.
      </p>
      {conNube && (
        <button type="button" className="boton boton-primario boton-grande" onClick={() => setConClaveNube(true)}>
          Cambiar la clave del dueño con la clave de la nube
        </button>
      )}
      <p className="texto-suave">
        Empezar de cero borra todo en esta compu y la desconecta de la nube: los datos de la nube no se tocan, y para volver a verlos hay que entrar con un usuario de la nube.
      </p>
      {resumen.sinSubir > 0 && (
        <p className="texto-alerta" role="alert">
          Ojo: {resumen.sinSubir === 1 ? 'hay 1 cambio' : `hay ${resumen.sinSubir} cambios`} de esta compu que todavía no llegaron a la nube. Conectate a internet antes de seguir, o se pierden.
        </p>
      )}
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
      <button className={`boton boton-grande${conNube ? '' : ' boton-primario'}`} type="submit" disabled={!listo || enCurso}>
        Empezar de cero en esta compu
      </button>
      <button type="button" className="boton" onClick={volver}>
        Volver
      </button>
    </form>
  );
}

/**
 * El dueño se olvidó la clave en todos lados: con la clave de la nube (figura en Ajustes y conviene tenerla
 * anotada; un empleado no la ve) se le pone una clave nueva, que llega sola a todos los equipos.
 */
function ClaveConLaNube({ volver }: { volver: () => void }) {
  const avisar = useAvisar();
  const [claveNube, setClaveNube] = useState('');
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [enCurso, unaVez] = useUnaVez();
  return (
    <form
      className="tarjeta formulario ingreso-tarjeta"
      onSubmit={(e) => {
        e.preventDefault();
        if (clave !== repetida) return setError('Las dos claves no coinciden.');
        unaVez(async () => {
          try {
            await cambiarClaveConLaNube(db, claveNube, usuario, clave);
            avisar({ texto: 'Listo: entrá con la clave nueva. Llega sola a los otros equipos.', tipo: 'ok' });
            volver();
          } catch (err) {
            setError(errorATexto(err));
          }
        });
      }}
    >
      <h1>Clave nueva para el dueño</h1>
      <p className="texto-suave">Escribí la clave de la nube (está en Ajustes → Nube de un equipo donde entraste como dueño).</p>
      <label className="campo">
        <span className="campo-etiqueta">Clave de la nube</span>
        <input value={claveNube} onChange={(e) => setClaveNube(e.target.value)} autoComplete="off" autoCapitalize="none" required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Usuario del dueño</span>
        <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" autoCapitalize="none" required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Clave nueva</span>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" required />
      </label>
      <label className="campo">
        <span className="campo-etiqueta">Repetí la clave nueva</span>
        <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" required />
      </label>
      {error && (
        <p className="texto-alerta" role="alert">
          {error}
        </p>
      )}
      <button className="boton boton-primario boton-grande" type="submit" disabled={enCurso}>
        Cambiar la clave
      </button>
      <button type="button" className="boton" onClick={volver}>
        Volver
      </button>
    </form>
  );
}

function PrimerUsuario({ yaTengo, sinRed = false, reintentar }: { yaTengo: () => void; sinRed?: boolean; reintentar?: () => void }) {
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
            // Sin aviso: la guía de primer uso ya saluda.
            entrar(await crearUsuario(db, { usuario, nombre, clave, admin: true }));
          } catch (err) {
            setErrorAlta(errorATexto(err));
          }
        });
      }}
    >
      <h1>Creá tu usuario</h1>
      {sinRed && (
        <div className="aviso-tarjeta aviso-ambar" role="status">
          <span>Sin internet no se puede ver si ya tenés usuario. Si ya usás el sistema en otra compu o celular, conectate y tocá Reintentar.</span>
          <button type="button" className="boton boton-chico" onClick={reintentar}>
            Reintentar
          </button>
        </div>
      )}
      <p className="texto-suave">Es la primera vez que se usa el sistema. Este usuario es el dueño y sirve en cualquier compu o celular; después puede sumar empleados desde Ajustes.</p>
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
      <button type="button" className="boton" onClick={yaTengo}>
        Ya tengo usuario: ingresar
      </button>
      <button type="button" className="boton-texto" onClick={() => setRecuperar(true)}>
        Recuperar con la clave de la nube
      </button>
    </form>
  );
}
