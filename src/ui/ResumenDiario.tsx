import { useState } from 'react';
import { formatPesos } from '../dominio/dinero';
import { diaDelResumen, estadoCierre, textoResumen, type ResumenDiario } from '../dominio/resumenDiario';
import { enlaceWhatsApp, mandaSolo, type ConfigResumen } from '../datos/resumenDiario';
import { telefonoWhatsApp } from '../dominio/entrada';
import { copiarTexto, ICONO_MEDIO, Icono, sinCortes, useAvisar } from './componentes';

// El resumen del día, para mirarlo de un vistazo y mandarlo por WhatsApp (al cerrar la caja y desde el Panel).

const MAX_REPONER = 8;

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export type EstadoEnvio = { tipo: 'mandando' } | { tipo: 'enviado' } | { tipo: 'error'; motivo: string } | null;

export function ResumenVisual({ r }: { r: ResumenDiario }) {
  const estado = estadoCierre(r);
  const maxTop = Math.max(...r.top.map((p) => p.total), 1);
  const dia = diaDelResumen(r.apertura);
  return (
    <article className="resumen" aria-label={`Resumen del ${dia}`}>
      <header className="resumen-cabecera">
        <div>
          <p className="resumen-local">{r.local}</p>
          <h2>Resumen del {dia}</h2>
          <p className="resumen-horario">
            {r.abierta ? `Abierta desde las ${hhmm(r.apertura)} · hasta ahora (${hhmm(r.hasta)})` : `De ${hhmm(r.apertura)} a ${hhmm(r.hasta)}`} · abrió {r.abrio}
            {r.cerro && r.cerro !== r.abrio ? `, cerró ${r.cerro}` : ''}
          </p>
        </div>
        <span className={`resumen-estado resumen-estado-${estado.tono}`}>
          <Icono nombre={estado.tono === 'justo' ? 'check' : estado.tono === 'abierta' ? 'reloj' : estado.tono === 'sin-contar' ? 'cierre' : 'alerta'} tam={16} />
          {estado.texto}
        </span>
      </header>

      <div className="resumen-cifras">
        <div className="resumen-cifra resumen-cifra-grande">
          <span>Vendido</span>
          <strong className="importe">{formatPesos(r.vendido)}</strong>
          <small>
            {r.ventas} {r.ventas === 1 ? 'venta' : 'ventas'}
            {r.ventas > 0 && ` · promedio ${formatPesos(r.promedio)}`}
          </small>
          {r.comparacion && (
            <small className={`variacion variacion-${r.comparacion.pct > 0 ? 'sube' : r.comparacion.pct < 0 ? 'baja' : 'igual'}`}>
              <Icono nombre={r.comparacion.pct < 0 ? 'baja' : 'sube'} tam={14} /> {r.comparacion.pct > 0 ? '+' : ''}
              {r.comparacion.pct}% contra el {r.comparacion.dia} pasado
            </small>
          )}
        </div>
        <div className="resumen-cifra">
          <span>Ganancia estimada</span>
          <strong className="importe texto-positivo">{formatPesos(r.ganancia)}</strong>
          <small>{r.margen !== null ? `${r.margen}% de lo vendido` : 'Cargá los costos para verla'}</small>
        </div>
        <div className="resumen-cifra">
          <span>Efectivo</span>
          <strong className={`importe ${estado.tono === 'falta' ? 'texto-alerta' : estado.tono === 'sobra' ? 'texto-aviso' : ''}`}>
            {r.efectivo.contado !== null ? formatPesos(r.efectivo.contado) : formatPesos(r.efectivo.esperado)}
          </strong>
          <small>{r.efectivo.contado !== null ? `Contado · debía haber ${formatPesos(r.efectivo.esperado)}` : r.abierta ? 'Debería haber ahora' : 'Debía haber (no se contó)'}</small>
        </div>
      </div>

      {r.alertas.length > 0 && (
        <ul className="resumen-alertas">
          {r.alertas.map((a) => (
            <li key={a}>
              <Icono nombre="alerta" tam={16} /> {a}
            </li>
          ))}
        </ul>
      )}

      {r.medios.length > 0 && (
        <section className="resumen-bloque">
          <h3>Cómo pagaron</h3>
          <div className="resumen-medios-barra" aria-hidden="true">
            {r.medios.map((m) => (
              <span key={m.id} className={`medio-${m.id}`} style={{ flexGrow: Math.max(m.monto, 1) }} />
            ))}
          </div>
          <ul className="resumen-medios">
            {r.medios.map((m) => (
              <li key={m.id}>
                <span className={`resumen-punto medio-${m.id}`} />
                <Icono nombre={ICONO_MEDIO[m.id]} tam={16} />
                <span>{m.nombre}</span>
                <span className="importe">{formatPesos(m.monto)}</span>
                <small className="texto-suave">{m.pct}%</small>
              </li>
            ))}
          </ul>
          {r.fiadoCobrado > 0 && <p className="texto-suave resumen-nota">Además se cobraron {formatPesos(r.fiadoCobrado)} de fiado.</p>}
        </section>
      )}

      <div className="resumen-grilla">
        <section className="resumen-bloque">
          <h3>Lo más vendido</h3>
          {r.top.length === 0 ? (
            <p className="texto-suave">Todavía no hay ventas.</p>
          ) : (
            <ol className="resumen-top">
              {r.top.map((p, i) => (
                <li key={p.nombre}>
                  <span className="resumen-puesto">{i + 1}</span>
                  <span className="resumen-top-nombre">
                    {sinCortes(p.nombre)}
                    <small className="texto-suave"> · {p.cantidad}</small>
                    <span className="resumen-top-barra">
                      <span style={{ width: `${(p.total / maxTop) * 100}%` }} />
                    </span>
                  </span>
                  <span className="importe">{formatPesos(p.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="resumen-bloque">
          <h3>
            Para reponer {r.reponer.length > 0 && <span className="resumen-contador">{r.reponer.length}</span>}
          </h3>
          {r.reponer.length === 0 ? (
            <p className="resumen-ok">
              <Icono nombre="check" tam={16} /> Stock al día
            </p>
          ) : (
            <ul className="resumen-reponer">
              {r.reponer.slice(0, MAX_REPONER).map((p) => (
                <li key={p.nombre} className={p.stock <= 0 ? 'sin-stock' : ''}>
                  <span>{sinCortes(p.nombre)}</span>
                  <small>{p.stock <= 0 ? 'Sin stock' : `Quedan ${p.stock} · mín. ${p.minimo}`}</small>
                </li>
              ))}
              {r.reponer.length > MAX_REPONER && <li className="texto-suave">y {r.reponer.length - MAX_REPONER} más</li>}
            </ul>
          )}
        </section>

        <section className="resumen-bloque">
          <h3>Fiado sin cobrar</h3>
          {r.fiado.deudores === 0 ? (
            <p className="resumen-ok">
              <Icono nombre="check" tam={16} /> Nadie debe
            </p>
          ) : (
            <>
              <p className="resumen-monto importe">{formatPesos(r.fiado.total)}</p>
              <p className="texto-suave">
                {r.fiado.deudores} {r.fiado.deudores === 1 ? 'cliente' : 'clientes'}
                {r.fiado.fiadoHoy > 0 && ` · hoy se fiaron ${formatPesos(r.fiado.fiadoHoy)}`}
              </p>
              <ul className="resumen-lista">
                {r.fiado.mayores.map((c) => (
                  <li key={c.nombre}>
                    <span>{c.nombre}</span>
                    <span className="importe">{formatPesos(c.saldo)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="resumen-bloque">
          <h3>Proveedores</h3>
          {r.proveedores.deuda <= 0 && r.proveedores.comprasHoy === 0 && r.proveedores.pagadoHoy === 0 ? (
            <p className="resumen-ok">
              <Icono nombre="check" tam={16} /> No les debés nada
            </p>
          ) : (
            <>
              <p className="resumen-monto importe">{formatPesos(Math.max(r.proveedores.deuda, 0))}</p>
              <p className="texto-suave">
                {r.proveedores.deuda > 0 ? 'Les debés' : 'Al día'}
                {r.proveedores.comprasHoy > 0 && ` · compras de hoy ${formatPesos(r.proveedores.comprasHoy)}`}
                {r.proveedores.pagadoHoy > 0 && ` · pagado hoy ${formatPesos(r.proveedores.pagadoHoy)}`}
              </p>
              <ul className="resumen-lista">
                {r.proveedores.cuentas.map((c) => (
                  <li key={c.nombre}>
                    <span>{c.nombre}</span>
                    <span className="importe">{formatPesos(c.saldo)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </article>
  );
}

/** Botones para mandarlo: WhatsApp (al dueño si está cargado), compartir y copiar; y cómo salió el envío solo. */
export function AccionesResumen({ r, config, envio, ciego = false }: { r: ResumenDiario; config: ConfigResumen; envio?: EstadoEnvio; ciego?: boolean }) {
  const avisar = useAvisar();
  const [verTexto, setVerTexto] = useState(false);
  const texto = textoResumen(r, { ciego });
  const conNumero = telefonoWhatsApp(config.numero) !== null;
  const compartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="resumen-acciones">
      {envio && (
        <p className={`resumen-envio resumen-envio-${envio.tipo}`} role="status">
          <Icono nombre={envio.tipo === 'enviado' ? 'check' : envio.tipo === 'mandando' ? 'reloj' : 'alerta'} tam={16} />
          {envio.tipo === 'enviado'
            ? 'Listo: el resumen ya salió solo por WhatsApp.'
            : envio.tipo === 'mandando'
              ? 'Mandando el resumen por WhatsApp…'
              : `No salió solo (${envio.motivo}). Mandalo con el botón.`}
        </p>
      )}
      <div className="botonera">
        <a className="boton boton-whatsapp" href={enlaceWhatsApp(texto, config.numero)} target="_blank" rel="noreferrer">
          <Icono nombre="whatsapp" tam={18} /> {conNumero ? 'Mandar al WhatsApp del dueño' : 'Mandar por WhatsApp'}
        </a>
        {compartir && (
          <button type="button" className="boton" onClick={() => navigator.share({ text: texto }).catch(() => undefined)}>
            <Icono nombre="subir" tam={18} /> Compartir
          </button>
        )}
        <button
          type="button"
          className="boton"
          onClick={async () => avisar((await copiarTexto(texto)) ? { texto: 'Resumen copiado.', tipo: 'ok' } : { texto: 'No se pudo copiar.', tipo: 'error' })}
        >
          <Icono nombre="copiar" tam={18} /> Copiar
        </button>
      </div>
      {!ciego && (
        <button type="button" className="boton-link resumen-ver-texto" aria-expanded={verTexto} onClick={() => setVerTexto((v) => !v)}>
          {verTexto ? 'Ocultar el mensaje' : 'Ver cómo llega el mensaje'}
        </button>
      )}
      {verTexto && <BurbujaWhatsApp texto={texto} />}
      {!ciego && !mandaSolo(config) && (
        <p className="texto-suave resumen-nota">
          {conNumero ? 'Para que llegue solo, sin tocar nada, activá el envío automático en Ajustes.' : 'Cargá tu WhatsApp en Ajustes para mandarlo de un toque (o que llegue solo).'}
        </p>
      )}
    </div>
  );
}

/** El mensaje como se ve en WhatsApp: *negrita* en negrita. */
export function BurbujaWhatsApp({ texto }: { texto: string }) {
  return (
    <div className="burbuja-fondo">
      <div className="burbuja">
        {texto.split('\n').map((linea, i) => (
          <p key={i}>
            {linea === ''
              ? ' '
              : linea.split(/(\*[^*]+\*)/).map((parte, j) => (parte.startsWith('*') && parte.endsWith('*') && parte.length > 2 ? <strong key={j}>{parte.slice(1, -1)}</strong> : parte))}
          </p>
        ))}
        <span className="burbuja-hora">{hhmm(Date.now())} ✓✓</span>
      </div>
    </div>
  );
}
