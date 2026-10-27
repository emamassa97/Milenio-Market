import { useEffect, useState } from 'react';
import { db } from '../datos/db';
import { estaVacia, exportarTodo, restaurarCopia } from '../datos/copia';
import { borrarTodo, cargarEjemplo } from '../datos/ejemplo';
import { guardarAjuste, leerAjuste } from '../datos/operaciones';
import { copiarTexto, descargarArchivo, errorATexto, fechaCorta, Icono, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { useSesion } from '../ui/sesion';
import { htmlTicket, imprimirTicket, leerAjustesTicket, TICKET_INICIAL, type AjustesTicket } from '../ui/ticket';
import { borrarUsuario, cambiarClave, crearUsuario, leerUsuarios } from '../datos/usuarios';
import { pendientes, recuperarDeLaNube, sincronizarAhora, activarNube } from '../datos/nube';

export function PantallaAjustes() {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  const [cajero, setCajero] = useState('');
  const vacia = useConsulta(() => estaVacia(db), [], false);
  const modoPrueba = useConsulta(() => leerAjuste(db, 'modoPrueba', false), [], false);
  const ultimaCopia = useConsulta(() => leerAjuste<number | null>(db, 'ultimaCopia', null), [], null);
  const cierres = useConsulta(() => db.turnos.filter((t) => t.cierre !== null).count(), [], 0);
  const [confirmacion, setConfirmacion] = useState('');
  const [enCurso, unaVez] = useUnaVez();

  useEffect(() => {
    leerAjuste(db, 'cajero', '').then((c) => setCajero(String(c)));
  }, []);

  const descargarCopia = async () => {
    try {
      const copia = await exportarTodo(db);
      descargarArchivo(`copia-milenio-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(copia), 'application/json');
      await guardarAjuste(db, 'ultimaCopia', Date.now());
      avisar({ texto: 'Copia descargada. Guardala en el Drive o en un pendrive.', tipo: 'ok' });
    } catch (e) {
      avisar({ texto: errorATexto(e), tipo: 'error' });
    }
  };

  // El empleado sólo ve su usuario: una columna. El dueño, dos desde 1200 px (personas y ticket | equipo y copias).
  const soloEmpleado = Boolean(sesion && !sesion.admin);
  return (
    <div className={`pagina ${soloEmpleado ? 'pagina-angosta' : 'pagina-ajustes'}`}>
      <h1>Ajustes</h1>

      <div className="ajustes-columna">
      {sesion ? (
        <Usuarios />
      ) : (
        <section className="tarjeta formulario">
        <h2 className="titulo-chico">Quién atiende</h2>
        <label className="campo">
          <span className="campo-etiqueta">Nombre que aparece al abrir la caja</span>
          <div className="campo-con-boton">
            <input value={cajero} onChange={(e) => setCajero(e.target.value)} placeholder="Tu nombre" />
            <button
              type="button"
              className="boton"
              onClick={async () => {
                await guardarAjuste(db, 'cajero', cajero.trim());
                avisar({ texto: 'Guardado.', tipo: 'ok' });
              }}
            >
              Guardar
            </button>
          </div>
        </label>
      </section>
      )}

      {!soloEmpleado && <AjustesDelTicket />}
      </div>

      {soloEmpleado ? null : (
        <div className="ajustes-columna">
      <section className="tarjeta formulario">
        <h2 className="titulo-chico">Pantalla para el cliente</h2>
        <p className="texto-suave">Un segundo monitor conectado a esta compu, mirando al mostrador: el cliente ve lo que lleva, el total y el vuelto. Abrila con este botón y arrastrá la ventana a ese monitor.</p>
        <div className="botonera">
          <button type="button" className="boton" onClick={() => window.open(`${window.location.pathname}#visor`, 'milenio-visor', 'popup,width=1024,height=640')}>
            <Icono nombre="caja" tam={18} /> Abrir la pantalla para el cliente
          </button>
        </div>
      </section>
      <section className="tarjeta formulario ajustes-copia">
        <h2 className="titulo-chico">Copia de seguridad</h2>
        <p className="texto-suave">
          Todo se guarda en este equipo y funciona sin internet. Descargá una copia cada tanto: si la compu se rompe, con ese archivo recuperás productos, ventas y fiados en otra.
          {ultimaCopia ? ` Última copia: ${fechaCorta(ultimaCopia)}` : ' Todavía no hiciste ninguna.'}
        </p>
        <div className="botonera">
          <button type="button" className="boton boton-primario" onClick={descargarCopia}>
            <Icono nombre="descargar" tam={18} /> Descargar copia
          </button>
          <label className={`boton ${vacia ? '' : 'deshabilitado'}`}>
            <Icono nombre="subir" tam={18} /> Restaurar una copia
            <input
              type="file"
              accept=".json,application/json"
              hidden
              disabled={!vacia}
              onChange={async (e) => {
                const archivo = e.target.files?.[0];
                e.target.value = '';
                if (!archivo) return;
                try {
                  await restaurarCopia(db, JSON.parse(await archivo.text()));
                  avisar({ texto: 'Copia restaurada.', tipo: 'ok' });
                } catch (err) {
                  avisar({ texto: err instanceof SyntaxError ? 'Ese archivo no es una copia válida.' : errorATexto(err), tipo: 'error' });
                }
              }}
            />
          </label>
        </div>
        {!vacia && <p className="texto-suave">Restaurar sólo se puede en un equipo sin datos, para no pisar nada de lo cargado.</p>}
      </section>

      <CopiaEnLaNube vacia={vacia} />

      {(vacia || (modoPrueba && cierres === 0)) && (
        <section className="tarjeta formulario">
          <h2 className="titulo-chico">Probar el sistema</h2>
          {vacia ? (
            <>
              <p className="texto-suave">Carga 22 productos típicos de kiosco y dos clientes, para probar sin cargar nada.</p>
              <button
                type="button"
                className="boton"
                disabled={enCurso}
                onClick={() =>
                  unaVez(async () => {
                    await cargarEjemplo(db);
                    avisar({ texto: 'Listo: productos de ejemplo cargados.', tipo: 'ok' });
                  })
                }
              >
                Cargar productos de ejemplo
              </button>
            </>
          ) : (
            <>
              <p className="texto-suave">
                Estás usando datos de prueba. Para arrancar en serio, borrá todo y empezá de cero. Antes de borrar se descarga una copia. Esta opción desaparece cuando cerrás la primera caja.
              </p>
              <label className="campo">
                <span className="campo-etiqueta">Para confirmar, escribí BORRAR</span>
                <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="off" />
              </label>
              <button
                type="button"
                className="boton boton-peligro"
                disabled={confirmacion.trim().toUpperCase() !== 'BORRAR' || enCurso}
                onClick={() =>
                  unaVez(async () => {
                    try {
                      await descargarCopia();
                      await borrarTodo(db);
                      setConfirmacion('');
                      avisar({ texto: 'Todo borrado. El sistema quedó vacío.', tipo: 'info' });
                    } catch (e) {
                      avisar({ texto: errorATexto(e), tipo: 'error' });
                    }
                  })
                }
              >
                Borrar productos, ventas y clientes
              </button>
            </>
          )}
        </section>
      )}
        </div>
      )}
    </div>
  );
}

function CopiaEnLaNube({ vacia }: { vacia: boolean }) {
  const avisar = useAvisar();
  const [enCurso, unaVez] = useUnaVez();
  const [clave, setClave] = useState('');
  const { sesion } = useSesion();
  const estado = useConsulta(
    async () => ({
      clave: await leerAjuste<string>(db, 'nube.clave', ''),
      equipo: await leerAjuste<number | null>(db, 'nube.n', null),
      ultima: await leerAjuste<number | null>(db, 'nube.ultima', null),
      error: await leerAjuste<string | null>(db, 'nube.error', null),
      pendientes: await pendientes(db),
    }),
    [],
    { clave: '', equipo: null as number | null, ultima: null, error: null, pendientes: 0 },
  );

  const subir = () =>
    unaVez(async () => {
      try {
        const r = await sincronizarAhora(db);
        const cambios = (r?.subidas ?? 0) + (r?.bajadas ?? 0);
        avisar({ texto: cambios > 0 ? `Listo: se subieron ${r!.subidas} y llegaron ${r!.bajadas} cambios.` : 'Este equipo ya estaba al día con la nube.', tipo: 'ok' });
      } catch (e) {
        avisar({ texto: errorATexto(e), tipo: 'error' });
      }
    });

  if (import.meta.env.VITE_DEMO) return null;

  return (
    <section className="tarjeta formulario ajustes-nube">
      <h2 className="titulo-chico">Nube: todos los equipos al día</h2>
      {estado.clave ? (
        <>
          <p className="texto-suave estado-nube">
            <span>
              {estado.error
                ? `No se pudo sincronizar: ${estado.error}`
                : estado.pendientes > 0
                  ? `Faltan subir ${estado.pendientes} cambios. Se suben solos cada medio minuto cuando hay internet.`
                  : 'Este equipo está al día: lo que se carga acá llega a los otros, y lo de los otros llega acá.'}
            </span>
            <span>
              {estado.ultima ? `Última vez: ${fechaCorta(estado.ultima)}` : 'Todavía no se sincronizó.'}
              {estado.equipo !== null && ` · Este es el equipo ${estado.equipo}`}
            </span>
            {sesion?.admin && !estado.clave.startsWith('e.') && (
              <span>
                Clave de la nube: <strong>{estado.clave}</strong>. No hace falta para entrar en otro equipo (alcanza con tu usuario), pero guardala por las dudas.
              </span>
            )}
          </p>
          <div className="botonera">
            <button type="button" className="boton boton-primario" disabled={enCurso || !navigator.onLine} onClick={subir}>
              <Icono nombre="nube" tam={18} /> Sincronizar ahora
            </button>
            <button
              type="button"
              className="boton"
              disabled={enCurso}
              onClick={async () => {
                await guardarAjuste(db, 'nube.clave', '');
                await guardarAjuste(db, 'nube.error', null);
                avisar({ texto: 'Copia en la nube desactivada en este equipo.', tipo: 'info' });
              }}
            >
              Desactivar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="texto-suave">
            Cada venta, producto y fiado se guarda también en internet y llega a todos tus equipos: la PC del mostrador, el celular, otra compu. Cada uno tiene su propia caja y todos ven las mismas ventas, el mismo stock y el mismo fiado. Sin conexión la caja sigue andando y se pone al día cuando vuelve. La primera caja se activa sola; en una compu o celular nuevo, entrá con tu usuario de siempre y se trae todo solo.
          </p>
          <label className="campo">
            <span className="campo-etiqueta">Clave de la nube</span>
            <input value={clave} onChange={(e) => setClave(e.target.value)} type="password" autoComplete="off" />
          </label>
          <div className="botonera">
            <button
              type="button"
              className="boton boton-primario"
              disabled={!clave.trim() || enCurso}
              onClick={() =>
                unaVez(async () => {
                  await activarNube(db, clave.trim());
                  try {
                    const r = await sincronizarAhora(db);
                    setClave('');
                    avisar({ texto: `Copia en la nube activada. Se subieron ${r?.subidas ?? 0} registros.`, tipo: 'ok' });
                  } catch (e) {
                    await guardarAjuste(db, 'nube.clave', '');
                    avisar({ texto: errorATexto(e), tipo: 'error' });
                  }
                })
              }
            >
              Activar
            </button>
            {vacia && (
              <button
                type="button"
                className="boton"
                disabled={!clave.trim() || enCurso}
                onClick={() =>
                  unaVez(async () => {
                    try {
                      const total = await recuperarDeLaNube(db, clave.trim());
                      setClave('');
                      avisar({ texto: `Recuperados ${total} registros desde la nube.`, tipo: 'ok' });
                    } catch (e) {
                      avisar({ texto: errorATexto(e), tipo: 'error' });
                    }
                  })
                }
              >
                <Icono nombre="descargar" tam={18} /> Recuperar desde la nube
              </button>
            )}
          </div>
          {vacia && <p className="texto-suave">¿Compu nueva? Con la misma clave podés traer todo lo que estaba guardado en la nube.</p>}
        </>
      )}
    </section>
  );
}

function Usuarios() {
  const avisar = useAvisar();
  const { sesion } = useSesion();
  const usuarios = useConsulta(() => leerUsuarios(db), [], []);
  const [miClave, setMiClave] = useState('');
  const [nuevo, setNuevo] = useState({ nombre: '', usuario: '', clave: '', admin: false });
  const [enCurso, unaVez] = useUnaVez();
  if (!sesion) return null;

  return (
    <section className="tarjeta formulario">
      <h2 className="titulo-chico">Usuarios</h2>
      <p className="texto-suave">
        Entraste como <strong>{sesion.nombre}</strong> ({sesion.usuario}){sesion.admin ? ', dueño' : ''}.
      </p>
      <label className="campo">
        <span className="campo-etiqueta">Cambiar mi clave</span>
        <div className="campo-con-boton">
          <input type="password" value={miClave} onChange={(e) => setMiClave(e.target.value)} autoComplete="new-password" />
          <button
            type="button"
            className="boton"
            disabled={!miClave || enCurso}
            onClick={() =>
              unaVez(async () => {
                try {
                  await cambiarClave(db, sesion.usuario, miClave);
                  setMiClave('');
                  avisar({ texto: 'Clave cambiada.', tipo: 'ok' });
                } catch (e) {
                  avisar({ texto: errorATexto(e), tipo: 'error' });
                }
              })
            }
          >
            Guardar
          </button>
        </div>
      </label>

      {sesion.admin && (
        <>
          <ul className="lista-usuarios">
            {usuarios.map((u) => (
              <li key={u.usuario}>
                <span>
                  <strong>{u.nombre}</strong> <span className="texto-suave">· {u.usuario}{u.admin ? ' · dueño' : ' · empleado'}</span>
                </span>
                {u.usuario !== sesion.usuario && (
                  <button
                    type="button"
                    className="boton"
                    disabled={enCurso}
                    onClick={() =>
                      unaVez(async () => {
                        try {
                          await borrarUsuario(db, u.usuario);
                          avisar({ texto: `Se borró a ${u.nombre}.`, tipo: 'info' });
                        } catch (e) {
                          avisar({ texto: errorATexto(e), tipo: 'error' });
                        }
                      })
                    }
                  >
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3>Sumar un usuario</h3>
          <div className="grilla-usuario">
            <label className="campo">
              <span className="campo-etiqueta">Nombre</span>
              <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            </label>
            <label className="campo">
              <span className="campo-etiqueta">Usuario</span>
              <input value={nuevo.usuario} onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value })} autoCapitalize="none" autoComplete="off" />
            </label>
            <label className="campo">
              <span className="campo-etiqueta">Clave</span>
              <input type="password" value={nuevo.clave} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })} autoComplete="new-password" />
            </label>
          </div>
          <label className="casilla">
            <input type="checkbox" checked={nuevo.admin} onChange={(e) => setNuevo({ ...nuevo, admin: e.target.checked })} />
            <span>Es dueño (puede entrar a Ajustes y manejar usuarios)</span>
          </label>
          <button
            type="button"
            className="boton boton-primario"
            disabled={!nuevo.usuario || !nuevo.clave || enCurso}
            onClick={() =>
              unaVez(async () => {
                try {
                  const u = await crearUsuario(db, nuevo);
                  setNuevo({ nombre: '', usuario: '', clave: '', admin: false });
                  avisar({ texto: `Listo: ${u.nombre} ya puede entrar.`, tipo: 'ok' });
                } catch (e) {
                  avisar({ texto: errorATexto(e), tipo: 'error' });
                }
              })
            }
          >
            Sumar usuario
          </button>
        </>
      )}
    </section>
  );
}

const VENTA_DE_MUESTRA = {
  id: 1234,
  fecha: Date.now(),
  turnoId: 0,
  cajero: '',
  items: [
    { productoId: 1, codigo: '', nombre: 'Coca-Cola 500 ml', precioUnitario: 1400, costoUnitario: 0, cantidad: 2 },
    { productoId: 2, codigo: '', nombre: 'Alfajor triple', precioUnitario: 1100, costoUnitario: 0, cantidad: 1 },
  ],
  total: 3900,
  medio: 'efectivo' as const,
  pagaCon: 5000,
  vuelto: 1100,
  clienteId: null,
  anulada: false,
};

function AjustesDelTicket() {
  const avisar = useAvisar();
  const [a, setA] = useState<AjustesTicket>(TICKET_INICIAL);
  useEffect(() => {
    leerAjustesTicket(db).then(setA);
  }, []);
  const guardar = async (nuevo: AjustesTicket) => {
    setA(nuevo);
    await guardarAjuste(db, 'ticket', nuevo);
  };
  return (
    <section className="tarjeta formulario ajustes-ticket">
      <h2 className="titulo-chico">Ticket</h2>
      <p className="texto-suave">Para impresoras térmicas. No es factura: es el comprobante para el cliente.</p>
      <div className="ticket-ajustes">
        <div className="formulario">
          <div className="chips" role="group" aria-label="Ancho del papel">
            {([58, 80] as const).map((ancho) => (
              <button key={ancho} type="button" className={`chip ${a.ancho === ancho ? 'activo' : ''}`} aria-pressed={a.ancho === ancho} onClick={() => guardar({ ...a, ancho })}>
                Papel de {ancho} mm
              </button>
            ))}
          </div>
          <label className="campo">
            <span className="campo-etiqueta">Encabezado (nombre, dirección, teléfono)</span>
            <textarea rows={3} value={a.encabezado} onChange={(e) => setA({ ...a, encabezado: e.target.value })} onBlur={() => guardar(a)} />
          </label>
          <label className="campo">
            <span className="campo-etiqueta">Mensaje al pie</span>
            <input value={a.pie} onChange={(e) => setA({ ...a, pie: e.target.value })} onBlur={() => guardar(a)} />
          </label>
          <label className="casilla">
            <input type="checkbox" checked={a.auto} onChange={(e) => guardar({ ...a, auto: e.target.checked })} />
            <span>Imprimir el ticket solo, cada vez que se cobra</span>
          </label>
          {a.auto && (
            <p className="texto-suave ajuste-nota">
              Para que salga sin preguntar, abrí Chrome con el agregado <code>--kiosk-printing</code> (en el acceso directo, al final del campo Destino).{' '}
              <button type="button" className="boton boton-texto boton-chico" onClick={async () => avisar((await copiarTexto('--kiosk-printing')) ? { texto: 'Copiado.', tipo: 'ok' } : { texto: 'No se pudo copiar.', tipo: 'error' })}>
                <Icono nombre="copiar" tam={14} /> Copiar
              </button>
            </p>
          )}
          <div className="botonera">
            <button
              type="button"
              className="boton"
              onClick={async () => {
                await guardar(a);
                imprimirTicket(VENTA_DE_MUESTRA, a);
                avisar({ texto: 'Mandé un ticket de prueba a la impresora.', tipo: 'info' });
              }}
            >
              <Icono nombre="impresora" tam={18} /> Imprimir prueba
            </button>
          </div>
        </div>
        <iframe
          className="ticket-vista"
          // Sin scripts; el mismo origen sólo para medir el alto y que la vista no deje blanco de más.
          sandbox="allow-same-origin"
          title="Vista previa del ticket"
          srcDoc={htmlTicket(VENTA_DE_MUESTRA, a)}
          style={{ width: `${a.ancho * 3.78 + 4}px` }}
          onLoad={(e) => {
            const alto = e.currentTarget.contentDocument?.documentElement.scrollHeight;
            if (alto) e.currentTarget.style.height = `${alto + 4}px`;
          }}
        />
      </div>
    </section>
  );
}
