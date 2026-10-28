import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { buscarPorCodigo } from '../datos/operaciones';
import { db } from '../datos/db';
import { formatPesos } from '../dominio/dinero';
import { buscarAyuda, partesConTeclas, pasosGuia, type PantallaAyuda, type TemaAyuda } from '../dominio/ayuda';
import { codigoEscaneado } from '../dominio/entrada';
import type { Producto } from '../dominio/tipos';
import { Escaner, camaraDisponible } from './Escaner';
import { Icono, Modal } from './componentes';

/** Cualquier pantalla puede abrir la ayuda en un tema ("lector", "cerrar"…) sin pasar nada por props. */
const EVENTO_AYUDA = 'milenio-ayuda';
export function abrirAyuda(tema?: string) {
  window.dispatchEvent(new CustomEvent(EVENTO_AYUDA, { detail: tema }));
}
export function useAbrirAyuda(abrir: (tema?: string) => void) {
  useEffect(() => {
    const escuchar = (e: Event) => abrir((e as CustomEvent<string | undefined>).detail);
    window.addEventListener(EVENTO_AYUDA, escuchar);
    return () => window.removeEventListener(EVENTO_AYUDA, escuchar);
  }, [abrir]);
}

/** Texto de ayuda con las teclas dibujadas: "Apretá [F12]". */
export function TextoAyuda({ texto }: { texto: string }) {
  return (
    <>
      {partesConTeclas(texto).map((p, i) => (p.tecla ? <kbd key={i}>{p.texto}</kbd> : <span key={i}>{p.texto}</span>))}
    </>
  );
}

const NOMBRE_PANTALLA: Record<PantallaAyuda, string> = {
  caja: 'la Caja',
  inicio: 'el Panel del día',
  productos: 'Productos',
  cierre: 'el Cierre de caja',
  clientes: 'Clientes y fiado',
  reportes: 'Reportes',
  ajustes: 'Ajustes',
};

export function CentroAyuda({
  pantalla,
  dueño,
  temaInicial,
  onCerrar,
  onVerGuia,
}: {
  pantalla: PantallaAyuda;
  dueño: boolean;
  temaInicial?: string;
  onCerrar: () => void;
  onVerGuia: () => void;
}) {
  const [q, setQ] = useState('');
  const temas = useMemo(() => buscarAyuda(q, pantalla, dueño), [q, pantalla, dueño]);
  const [abierto, setAbierto] = useState<string | null>(temaInicial ?? null);
  const elegido = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (temaInicial) elegido.current?.scrollIntoView({ block: 'start' });
  }, [temaInicial]);

  const deEsta = q.trim() ? [] : temas.filter((t) => t.pantallas.includes(pantalla));
  const otros = q.trim() ? temas : temas.filter((t) => !t.pantallas.includes(pantalla));

  const tema = (t: TemaAyuda) => (
    <TemaPlegable
      key={t.id}
      tema={t}
      abierto={abierto === t.id || (!!q.trim() && temas.length === 1)}
      onClick={() => (t.extra === 'guia' ? onVerGuia() : setAbierto(abierto === t.id ? null : t.id))}
      refInicial={t.id === temaInicial ? elegido : undefined}
      enfocarProbador={t.id === temaInicial}
    />
  );

  return (
    <Modal titulo="Ayuda" onCerrar={onCerrar} ancho="ancho">
      <div className="ayuda">
        <label className="ayuda-buscar">
          <Icono nombre="buscar" tam={18} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscá: fiado, cierre, lector…"
            aria-label="Buscar en la ayuda"
            enterKeyHint="search"
          />
        </label>

        {q.trim() && temas.length === 0 && (
          <p className="texto-suave ayuda-nada">
            No encontré nada con "{q.trim()}". Probá con otra palabra, como "cobrar", "fiado", "stock" o "cierre".
          </p>
        )}

        {deEsta.length > 0 && (
          <section>
            <h3 className="ayuda-seccion">En {NOMBRE_PANTALLA[pantalla]}</h3>
            <div className="ayuda-lista">{deEsta.map(tema)}</div>
          </section>
        )}
        {otros.length > 0 && (
          <section>
            {!q.trim() && <h3 className="ayuda-seccion">Todo lo demás</h3>}
            <div className="ayuda-lista">{otros.map(tema)}</div>
          </section>
        )}
        <p className="texto-suave ayuda-pie">
          Tip: <kbd>F1</kbd> abre esta ayuda desde cualquier pantalla.
        </p>
      </div>
    </Modal>
  );
}

function TemaPlegable({
  tema,
  abierto,
  onClick,
  refInicial,
  enfocarProbador,
}: {
  tema: TemaAyuda;
  abierto: boolean;
  onClick: () => void;
  refInicial?: Ref<HTMLDivElement>;
  enfocarProbador: boolean;
}) {
  return (
    <div className={`ayuda-tema ${abierto ? 'ayuda-tema-abierto' : ''}`} ref={refInicial}>
      <button type="button" className="ayuda-tema-boton" aria-expanded={tema.extra === 'guia' ? undefined : abierto} onClick={onClick}>
        <span>
          <strong>{tema.titulo}</strong>
          <small className="texto-suave">{tema.resumen}</small>
        </span>
        <span className="ayuda-tema-flecha" aria-hidden="true">
          <Icono nombre="abrir" tam={18} />
        </span>
      </button>
      {abierto && tema.extra !== 'guia' && (
        <div className="ayuda-tema-cuerpo">
          <ol className="ayuda-pasos">
            {tema.pasos.map((p, i) => (
              <li key={i}>
                <TextoAyuda texto={p} />
              </li>
            ))}
          </ol>
          {tema.consejos && (
            <ul className="ayuda-consejos">
              {tema.consejos.map((c, i) => (
                <li key={i}>
                  <Icono nombre="consejo" tam={16} />
                  <span>
                    <TextoAyuda texto={c} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {tema.extra === 'probarLector' && <ProbarLector enfocar={enfocarProbador} />}
          {tema.extra === 'probarCamara' && <ProbarCamara />}
        </div>
      )}
    </div>
  );
}

type Prueba =
  | { tipo: 'bien'; codigo: string; producto: Producto | null; via: 'lector' | 'camara' }
  | { tipo: 'aMano' }
  | { tipo: 'sinEnter'; codigo: string }
  | { tipo: 'raro'; texto: string };

function ResultadoPrueba({ prueba }: { prueba: Prueba }) {
  if (prueba.tipo === 'aMano') {
    return (
      <p className="ayuda-resultado ayuda-resultado-info">
        Eso parece escrito a mano. Para probar el lector, dejá el cursor en el campo y pasá un producto.
      </p>
    );
  }
  if (prueba.tipo === 'sinEnter') {
    return (
      <p className="ayuda-resultado ayuda-resultado-aviso">
        El lector leyó <strong>{prueba.codigo}</strong> pero no mandó <kbd>Enter</kbd> al final. Va a escribir el código sin sumarlo: en el manual del lector
        buscá "Enter" o "CR" y escaneá ese código de configuración.
      </p>
    );
  }
  if (prueba.tipo === 'raro') {
    return (
      <p className="ayuda-resultado ayuda-resultado-aviso">
        Llegó "<strong>{prueba.texto}</strong>", con símbolos en vez de números: el lector está configurado para otro teclado. En su manual buscá
        "Spanish" o "Latinoamérica" y escaneá ese código.
      </p>
    );
  }
  const quien = prueba.via === 'camara' ? 'La cámara' : 'El lector';
  return prueba.producto ? (
    <p className="ayuda-resultado ayuda-resultado-bien">
      <Icono nombre="check" tam={18} />
      <span>
        {quien} anda bien. Leyó <strong>{prueba.codigo}</strong>: {prueba.producto.nombre}, {formatPesos(prueba.producto.precio)}.
      </span>
    </p>
  ) : (
    <p className="ayuda-resultado ayuda-resultado-bien">
      <Icono nombre="check" tam={18} />
      <span>
        {quien} anda bien. Leyó <strong>{prueba.codigo}</strong>, pero ese código todavía no está cargado: en la Caja aparece "No encontré" con el botón
        "Cargarlo".
      </span>
    </p>
  );
}

/**
 * Probador del lector USB: el lector tipea todas las cifras en milisegundos y termina con Enter.
 * Midiendo el tiempo entre teclas se sabe si fue el lector o una persona, y si faltó el Enter.
 */
function ProbarLector({ enfocar }: { enfocar: boolean }) {
  const [valor, setValor] = useState('');
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const teclas = useRef<number[]>([]);
  const espera = useRef<number>();
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // En la compu el cursor ya queda listo para pasar un producto; en el celular no se abre el teclado solo.
    if (enfocar && window.matchMedia('(pointer: fine)').matches) campo.current?.focus();
    return () => window.clearTimeout(espera.current);
  }, [enfocar]);

  const rapido = () => {
    const t = teclas.current;
    if (t.length < 6) return false;
    return (t[t.length - 1]! - t[0]!) / (t.length - 1) < 45;
  };

  const evaluar = async (texto: string, conEnter: boolean) => {
    window.clearTimeout(espera.current);
    const limpio = texto.trim();
    const fueLector = rapido();
    teclas.current = [];
    setValor('');
    if (!limpio) return;
    const codigo = codigoEscaneado(limpio);
    if (!fueLector) {
      setPrueba({ tipo: 'aMano' });
      return;
    }
    if (!codigo) {
      setPrueba({ tipo: 'raro', texto: limpio });
      return;
    }
    if (!conEnter) {
      setPrueba({ tipo: 'sinEnter', codigo });
      return;
    }
    setPrueba({ tipo: 'bien', codigo, producto: (await buscarPorCodigo(db, codigo)) ?? null, via: 'lector' });
  };

  return (
    <div className="ayuda-probar">
      <div className="ayuda-probar-cabecera">
        <Icono nombre="lector" tam={20} />
        <strong>Probar el lector</strong>
      </div>
      <input
        ref={campo}
        value={valor}
        placeholder="Hacé clic acá y pasá un producto por el lector"
        aria-label="Probar el lector: pasá un producto"
        onChange={(e) => {
          const texto = e.target.value;
          setValor(texto);
          // Si no llega el Enter, a los 400 ms se da por terminado: el lector ya habría mandado todo.
          window.clearTimeout(espera.current);
          espera.current = window.setTimeout(() => {
            if (rapido()) void evaluar(texto, false);
          }, 400);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void evaluar(valor, true);
          } else if (e.key.length === 1) {
            if (teclas.current.length === 0) setPrueba(null);
            teclas.current.push(performance.now());
          }
        }}
      />
      {prueba && <ResultadoPrueba prueba={prueba} />}
    </div>
  );
}

function ProbarCamara() {
  const [abierta, setAbierta] = useState(false);
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const leido = useCallback(async (codigo: string) => {
    setAbierta(false);
    setPrueba({ tipo: 'bien', codigo, producto: (await buscarPorCodigo(db, codigo)) ?? null, via: 'camara' });
  }, []);
  const cerrar = useCallback(() => setAbierta(false), []);
  return (
    <div className="ayuda-probar">
      <div className="ayuda-probar-cabecera">
        <Icono nombre="camara" tam={20} />
        <strong>Probar la cámara</strong>
      </div>
      {camaraDisponible() ? (
        <button
          type="button"
          className="boton"
          onClick={() => {
            setPrueba(null);
            setAbierta(true);
          }}
        >
          <Icono nombre="camara" tam={18} /> Abrir la cámara y leer un código
        </button>
      ) : (
        <p className="ayuda-resultado ayuda-resultado-info">
          Este navegador no lee códigos con la cámara. Abrí el sistema en Chrome, en un celular Android o en una compu con cámara.
        </p>
      )}
      {prueba && <ResultadoPrueba prueba={prueba} />}
      {abierta && <Escaner onCodigo={leido} onCerrar={cerrar} />}
    </div>
  );
}

// ---------- Guía de primer uso ----------

const CLAVE_GUIA = 'milenio-guia-vista';

export function guiaVista(usuario: string): boolean {
  try {
    return localStorage.getItem(`${CLAVE_GUIA}:${usuario}`) === '1';
  } catch {
    // Sin almacenamiento (ventana privada estricta): no se insiste con la guía.
    return true;
  }
}

export function marcarGuiaVista(usuario: string) {
  try {
    localStorage.setItem(`${CLAVE_GUIA}:${usuario}`, '1');
  } catch {
    /* sin almacenamiento */
  }
}

export function GuiaPrimerUso({ dueño, nombre, onTerminar, onAbrirAyuda }: { dueño: boolean; nombre?: string; onTerminar: () => void; onAbrirAyuda: () => void }) {
  const pasos = pasosGuia(dueño);
  const [i, setI] = useState(0);
  const paso = pasos[i]!;
  const ultimo = i === pasos.length - 1;
  const saludo = nombre?.trim().split(/\s+/)[0];
  return (
    <Modal titulo={i === 0 && saludo ? `¡Hola, ${saludo}!` : 'Cómo se usa'} onCerrar={onTerminar}>
      <div className="guia" aria-live="polite">
        <span className="guia-icono" aria-hidden="true">
          <Icono nombre={paso.icono} tam={36} />
        </span>
        <h3 className="guia-titulo">{paso.titulo}</h3>
        <p className="guia-texto">
          <TextoAyuda texto={paso.texto} />
        </p>
        <div className="guia-puntos" aria-label={`Paso ${i + 1} de ${pasos.length}`}>
          {pasos.map((_, n) => (
            <button
              key={n}
              type="button"
              className={n === i ? 'activo' : ''}
              aria-label={`Ir al paso ${n + 1}`}
              aria-current={n === i ? 'step' : undefined}
              onClick={() => setI(n)}
            />
          ))}
        </div>
        <div className="guia-botones">
          {i > 0 ? (
            <button type="button" className="boton" onClick={() => setI(i - 1)}>
              Anterior
            </button>
          ) : (
            <button type="button" className="boton boton-texto" onClick={onTerminar}>
              Ahora no
            </button>
          )}
          {ultimo ? (
            <span className="guia-fin">
              <button
                type="button"
                className="boton"
                onClick={() => {
                  onTerminar();
                  onAbrirAyuda();
                }}
              >
                Ver la ayuda
              </button>
              <button type="button" className="boton boton-primario" onClick={onTerminar}>
                Empezar
              </button>
            </span>
          ) : (
            <button type="button" className="boton boton-primario" onClick={() => setI(i + 1)}>
              Siguiente
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** El "?" al lado del título de cada pantalla: abre la ayuda en el tema de esa pantalla. */
export function BotonAyuda({ tema, que }: { tema?: string; que: string }) {
  return (
    <button type="button" className="boton-ayuda" onClick={() => abrirAyuda(tema)} aria-label={`Ayuda: ${que}`} title={`Ayuda: ${que}`}>
      <Icono nombre="ayuda" tam={20} />
    </button>
  );
}
