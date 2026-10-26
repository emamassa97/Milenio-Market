import { useEffect, useState } from 'react';
import { db } from '../datos/db';
import { estaVacia, exportarTodo, restaurarCopia } from '../datos/copia';
import { borrarTodo, cargarEjemplo } from '../datos/ejemplo';
import { guardarAjuste, leerAjuste } from '../datos/operaciones';
import { descargarArchivo, errorATexto, fechaCorta, Icono, useAvisar } from '../ui/componentes';
import { useConsulta, useUnaVez } from '../ui/hooks';

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
          {ultimaCopia ? ` Última copia: ${fechaCorta(ultimaCopia)}.` : ' Todavía no hiciste ninguna.'}
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
