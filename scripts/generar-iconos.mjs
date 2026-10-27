// Genera los íconos de la app instalable (PWA) a partir del logo en SVG.
// Uso: node scripts/generar-iconos.mjs [ruta/al/logo-icono.svg]
// Necesita Playwright con Chromium (no es dependencia del proyecto: se usa
// sólo para dibujar los PNG, que quedan guardados en public/).
// Si Playwright no está en node_modules, pasá su ruta en PLAYWRIGHT_MODULO.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const modulo = process.env.PLAYWRIGHT_MODULO ?? 'playwright';
const { chromium } = await import(modulo);

const origen = resolve(process.argv[2] ?? 'public/icono.svg');
const svg = await readFile(origen);
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
const ROJO = '#E30613';

// escala: qué parte del cuadrado ocupa el logo. Para "maskable" el logo va
// más chico, dentro de la zona segura (círculo del 80%) que no se recorta.
const salidas = [
  { archivo: 'public/pwa-192.png', lado: 192, escala: 1 },
  { archivo: 'public/pwa-512.png', lado: 512, escala: 1 },
  { archivo: 'public/pwa-maskable-512.png', lado: 512, escala: 0.76 },
  { archivo: 'public/apple-touch-icon.png', lado: 180, escala: 0.9 },
];

const navegador = await chromium.launch();
try {
  for (const s of salidas) {
    const pagina = await navegador.newPage({ viewport: { width: s.lado, height: s.lado } });
    const lado = Math.round(s.lado * s.escala);
    await pagina.setContent(
      `<html><body style="margin:0;width:${s.lado}px;height:${s.lado}px;background:${ROJO};display:grid;place-items:center">` +
        `<img src="${src}" width="${lado}" height="${lado}"></body></html>`,
    );
    await pagina.waitForFunction(() => document.images[0]?.complete);
    await pagina.screenshot({ path: s.archivo, omitBackground: false });
    await pagina.close();
    console.log(`✓ ${s.archivo}`);
  }
} finally {
  await navegador.close();
}
