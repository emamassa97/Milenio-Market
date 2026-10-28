// Instalar la caja como aplicación (PWA): ícono en el escritorio y en el menú Inicio,
// ventana propia sin barra del navegador y funciona sin internet.

export type Navegador = 'chrome' | 'edge' | 'safari-mac' | 'firefox' | 'android' | 'iphone' | 'otro';

/** Qué navegador es, sólo lo que cambia los pasos para instalar. */
export function detectarNavegador(ua: string): Navegador {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/OPR\/|SamsungBrowser/.test(ua)) return 'otro';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'safari-mac';
  return 'otro';
}

export interface ComoInstalar {
  /** Si este navegador puede instalarla. Firefox en PC no puede: hay que abrirla en Chrome o Edge. */
  puede: boolean;
  pasos: string[];
}

/** Los pasos a mano, para cuando el navegador no ofrece el botón directo. */
export function comoInstalar(navegador: Navegador): ComoInstalar {
  switch (navegador) {
    case 'chrome':
      return {
        puede: true,
        pasos: [
          'Arriba a la derecha, en la barra de la dirección, tocá el ícono de la compu con una flecha (o el menú ⋮).',
          'Elegí "Instalar Milenio Market" (en el menú está en "Transmitir, guardar y compartir").',
          'Confirmá con "Instalar". Queda el ícono en el escritorio y en el menú Inicio.',
        ],
      };
    case 'edge':
      return {
        puede: true,
        pasos: [
          'Arriba a la derecha, en la barra de la dirección, tocá el ícono de "Aplicación disponible" (o el menú ⋯).',
          'Elegí "Aplicaciones" y después "Instalar Milenio Market".',
          'Confirmá con "Instalar". Queda el ícono en el escritorio y en el menú Inicio.',
        ],
      };
    case 'safari-mac':
      return {
        puede: true,
        pasos: ['En el menú "Archivo" elegí "Agregar al Dock".', 'Confirmá con "Agregar". Queda en el Dock y en Aplicaciones.'],
      };
    case 'android':
      return {
        puede: true,
        pasos: ['Tocá el menú ⋮ de Chrome, arriba a la derecha.', 'Elegí "Instalar aplicación" o "Agregar a pantalla principal".'],
      };
    case 'iphone':
      return {
        puede: true,
        pasos: ['Abrila en Safari y tocá el botón Compartir (el cuadrado con la flecha).', 'Elegí "Agregar a inicio" y confirmá con "Agregar".'],
      };
    default:
      return {
        puede: false,
        pasos: [
          'Este navegador no instala aplicaciones. Abrí milenio-market.vercel.app en Google Chrome o en Microsoft Edge (viene con Windows).',
          'Entrá con tu usuario y en Ajustes tocá "Instalar en esta compu".',
        ],
      };
  }
}
