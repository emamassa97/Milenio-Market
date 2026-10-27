import { useEffect, useState } from 'react';
import { db } from '../datos/db';
import { estaVacia, exportarTodo, restaurarCopia } from '../datos/copia';
import { borrarTodo, cargarEjemplo } from '../datos/ejemplo';
import { guardarAjuste, leerAjuste } from '../datos/operaciones';
import { descargarArchivo, errorATexto, fechaCorta, Icono, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';
import { pendientes, recuperarDeLaNube, sincronizarAhora } from '../datos/nube';

export function PantallaAjustes() {
  const avisar = useAvisar();
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

  return (
    <div className="pagina pagina-angosta">
      <h1>Ajustes</h1>

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

      <section className="tarjeta formulario">
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
  );
}

function CopiaEnLaNube({ vacia }: { vacia: boolean }) {
  const avisar = useAvisar();
  const [enCurso, unaVez] = useUnaVez();
  const [clave, setClave] = useState('');
  const estado = useConsulta(
    async () => ({
      clave: await leerAjuste<string>(db, 'nube.clave', ''),
      ultima: await leerAjuste<number | null>(db, 'nube.ultima', null),
      error: await leerAjuste<string | null>(db, 'nube.error', null),
      pendientes: await pendientes(db),
    }),
    [],
    { clave: '', ultima: null, error: null, pendientes: 0 },
  );

  const subir = () =>
    unaVez(async () => {
      try {
        const r = await sincronizarAhora(db);
        avisar({ texto: r && r.subidas > 0 ? `Listo: se subieron ${r.subidas} cambios.` : 'La copia en la nube ya estaba al día.', tipo: 'ok' });
      } catch (e) {
        avisar({ texto: errorATexto(e), tipo: 'error' });
      }
    });

  if (import.meta.env.VITE_DEMO) return null;

  return (
    <section className="tarjeta formulario">
      <h2 className="titulo-chico">Copia en la nube</h2>
      {estado.clave ? (
        <>
          <p className="texto-suave estado-nube">
            <span>
              {estado.error
                ? `No se pudo subir: ${estado.error}`
                : estado.pendientes > 0
                  ? `Faltan subir ${estado.pendientes} cambios. Se suben solos cada minuto cuando hay internet.`
                  : 'Todo lo cargado en este equipo ya está copiado en la nube.'}
            </span>
            <span>{estado.ultima ? `Última vez: ${fechaCorta(estado.ultima)}` : 'Todavía no se subió nada.'}</span>
          </p>
          <div className="botonera">
            <button type="button" className="boton boton-primario" disabled={enCurso || !navigator.onLine} onClick={subir}>
              <Icono nombre="nube" tam={18} /> Subir ahora
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
            Con la copia en la nube, cada venta, producto y fiado se guarda también en internet. La caja sigue andando igual sin conexión y sube lo pendiente cuando vuelve. Escribí la clave de la nube una sola vez.
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
                  await guardarAjuste(db, 'nube.clave', clave.trim());
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
